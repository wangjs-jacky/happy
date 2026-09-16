import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImageRef, RunSnapshot, StartInput } from '../src/contracts.js';
import { createPocServer, type PocServer } from '../src/server/http.js';
import { decryptText } from '../vendor/agents-party/src/core/crypto.js';
import type { Message as PartyMessage } from '../vendor/agents-party/src/core/types.js';
import { TestOnlySdk } from './fake-sdk.js';

const token = 'runs-test-token';
const dirs: string[] = [];
const servers: PocServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function start(sdk: TestOnlySdk, turnTimeoutMs?: number): Promise<PocServer> {
  const dataDir = await mkdtemp(join(tmpdir(), 'paws-agent-party-runs-'));
  dirs.push(dataDir);
  return startAt(sdk, dataDir, turnTimeoutMs);
}

async function startAt(sdk: TestOnlySdk, dataDir: string, turnTimeoutMs?: number): Promise<PocServer> {
  const server = await createPocServer({ dataDir, accessToken: token, sdk: sdk as never, turnTimeoutMs });
  servers.push(server);
  return server;
}

const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

describe('consultation runs', () => {
  it('rejects a remote run before the Paws account is linked', async () => {
    const server = await start(new TestOnlySdk({ ready: false }));

    const response = await fetch(`${server.url}/api/consultations`, {
      method: 'POST', headers, body: JSON.stringify(input()),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Link a Paws account before starting a consultation.' });
  });

  it('deduplicates requestId, runs exactly eight turns, forwards images, and publishes only statements', async () => {
    const sdk = new TestOnlySdk();
    const server = await start(sdk);
    const image = await upload(server, new Uint8Array([9, 8, 7]));
    const body = input({ images: [image] });

    const [first, replay] = await Promise.all([postStart(server, body), postStart(server, body)]);
    expect(replay.id).toBe(first.id);
    const completed = await waitForTerminal(server, first.id);

    expect(completed.status).toBe('completed');
    expect(sdk.callsFor('trend30')).toHaveLength(2);
    expect(sdk.callsFor('structure10')).toHaveLength(2);
    expect(sdk.callsFor('timing1')).toHaveLength(2);
    expect(sdk.callsFor('moderator')).toHaveLength(2);
    expect(sdk.calls).toHaveLength(8);
    expect(sdk.calls.map(call => call.role)).toEqual([
      'moderator',
      'trend30', 'structure10', 'timing1',
      'trend30', 'structure10', 'timing1',
      'moderator',
    ]);
    expect(sdk.callsFor('moderator')[0].text).toContain('30-minute:');
    expect(sdk.callsFor('moderator')[0].text).toContain('10-minute:');
    expect(sdk.callsFor('moderator')[0].text).toContain('1-minute:');
    expect(sdk.callsFor('trend30')[0].text).toContain('30-minute trend');
    expect(sdk.callsFor('structure10')[0].text).toContain('10-minute structure');
    expect(sdk.callsFor('timing1')[0].text).toContain('1-minute timing');
    expect(sdk.calls.every(call => call.text.includes('not investment advice'))).toBe(true);
    expect(sdk.calls.every(call => call.text.includes('Do not fetch real-time market data'))).toBe(true);
    expect(sdk.calls.every(call => call.text.includes('Do not place orders or modify project files'))).toBe(true);
    expect(sdk.calls.every(call => call.images?.[0]?.bytes.byteLength === 3)).toBe(true);
    const publicMessages = await readParty(server, completed.partyId);
    expect(publicMessages.some(message => message.text.includes('tool-secret'))).toBe(false);
    expect(publicMessages.filter(message => message.from !== 'host').map(message => message.text)).toContain('public-moderator-2');
  });

  it('marks a failed agent run failed and does not execute dependent moderator rounds', async () => {
    const sdk = new TestOnlySdk({ failRole: 'timing1' });
    const server = await start(sdk);
    const started = await postStart(server, input());

    const failed = await waitForTerminal(server, started.id);

    expect(failed.status).toBe('failed');
    expect(sdk.callsFor('moderator')).toHaveLength(1);
  });

  it('stop aborts coordination and unsubscribes without claiming remote process termination', async () => {
    const sdk = new TestOnlySdk({ delayMs: 2_000 });
    const server = await start(sdk);
    const started = await postStart(server, input());
    await waitUntil(() => sdk.calls.length > 0);

    const response = await fetch(`${server.url}/api/consultations/${started.id}/stop`, {
      method: 'POST', headers, body: '{}',
    });
    const stopped = await response.json() as RunSnapshot;

    expect(response.status).toBe(200);
    expect(stopped.status).toBe('stopped');
    await waitUntil(() => sdk.unsubscribeCount > 0);
    expect(sdk.sessionsStopped).toBe(0);
  });

  it('serializes terminal follow-ups per role and exposes durable owner-only agent history', async () => {
    const sdk = new TestOnlySdk({ delayMs: 20 });
    const server = await start(sdk);
    const started = await postStart(server, input());
    await waitForTerminal(server, started.id);

    const follow = (requestId: string) => fetch(`${server.url}/api/consultations/${started.id}/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ requestId, text: `Follow ${requestId}`, to: ['trend30'], images: [] }),
    });
    const [first, second] = await Promise.all([follow('follow-1'), follow('follow-2')]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({ accepted: true });
    await waitUntil(() => sdk.callsFor('trend30').length === 4);
    expect(sdk.maxConcurrentByRole.get('trend30')).toBe(1);

    const [duplicateA, duplicateB] = await Promise.all([follow('same-follow'), follow('same-follow')]);
    expect(duplicateA.status).toBe(200);
    expect(duplicateB.status).toBe(200);
    await waitUntil(() => sdk.callsFor('trend30').length >= 5);
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(sdk.callsFor('trend30')).toHaveLength(5);

    const details = await fetch(`${server.url}/api/consultations/${started.id}/agents/trend30/messages?afterSeq=0`, { headers });
    const body = await details.json() as { sessionId: string; messages: Array<{ seq: number }>; requests: unknown[] };
    expect(body.sessionId).toBe('session-trend30');
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages.map(message => message.seq)).toEqual([...body.messages.map(message => message.seq)].sort((a, b) => a - b));
    expect(body.requests).toEqual([]);
  });

  it('marks a persisted running consultation interrupted after restart without replaying it', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'paws-agent-party-restart-'));
    dirs.push(dataDir);
    const firstSdk = new TestOnlySdk({ delayMs: 2_000 });
    const first = await startAt(firstSdk, dataDir);
    const started = await postStart(first, input());
    await waitUntil(() => firstSdk.calls.length > 0);
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const secondSdk = new TestOnlySdk();
    const second = await startAt(secondSdk, dataDir);
    const response = await fetch(`${second.url}/api/consultations/${started.id}`, { headers });
    const restored = await response.json() as RunSnapshot;

    expect(restored.status).toBe('interrupted');
    expect(secondSdk.calls).toHaveLength(0);
  });

  it('times out observation, removes the durable subscription, and fails the run', async () => {
    const sdk = new TestOnlySdk({ delayMs: 2_000 });
    const server = await start(sdk, 30);
    const started = await postStart(server, input({ mode: 'single' }));

    const failed = await waitForTerminal(server, started.id);

    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('deadline');
    expect(sdk.unsubscribeCount).toBeGreaterThan(0);
  });

  it('rejects malformed attachment arrays at both start and follow-up boundaries', async () => {
    const sdk = new TestOnlySdk();
    const server = await start(sdk);
    const malformedStart = await fetch(`${server.url}/api/consultations`, {
      method: 'POST', headers, body: JSON.stringify({ ...input(), images: 'x' }),
    });
    expect(malformedStart.status).toBe(400);

    const started = await postStart(server, input({ mode: 'single', requestId: 'valid-run' }));
    await waitForTerminal(server, started.id);
    const malformedFollowUp = await fetch(`${server.url}/api/consultations/${started.id}/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ requestId: 'bad-follow', text: 'hello', to: [], images: 'x' }),
    });
    expect(malformedFollowUp.status).toBe(400);
  });

  it('preserves a session link when a spawn resolves after coordination was stopped', async () => {
    const sdk = new TestOnlySdk({ spawnDelayMs: 80 });
    const server = await start(sdk);
    const started = await postStart(server, input({ mode: 'single', requestId: 'late-spawn' }));
    await waitUntil(async () => {
      const response = await fetch(`${server.url}/api/consultations/${started.id}`, { headers });
      return ((await response.json()) as RunSnapshot).roles.moderator.status === 'spawning';
    });
    await fetch(`${server.url}/api/consultations/${started.id}/stop`, { method: 'POST', headers, body: '{}' });

    let snapshot!: RunSnapshot;
    await waitUntil(async () => {
      const response = await fetch(`${server.url}/api/consultations/${started.id}`, { headers });
      snapshot = await response.json() as RunSnapshot;
      return snapshot.roles.moderator.sessionId === 'session-moderator';
    });

    expect(snapshot.status).toBe('stopped');
    expect(sdk.calls).toHaveLength(0);
  });
});

function input(overrides: Partial<StartInput> = {}): StartInput {
  return {
    requestId: 'request-1',
    stock: 'SYNTH',
    text: 'Assess the synthetic scenario.',
    images: [],
    machineId: 'machine-1',
    directory: '/workspace/project',
    agents: { moderator: 'codex', trend30: 'claude', structure10: 'gemini', timing1: 'opencode' },
    mode: 'consultation',
    ...overrides,
  };
}

async function postStart(server: PocServer, body: StartInput): Promise<RunSnapshot> {
  const response = await fetch(`${server.url}/api/consultations`, { method: 'POST', headers, body: JSON.stringify(body) });
  expect(response.status).toBe(200);
  return response.json() as Promise<RunSnapshot>;
}

async function upload(server: PocServer, bytes: Uint8Array): Promise<ImageRef> {
  const response = await fetch(`${server.url}/api/assets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png', 'x-filename': 'chart.png' },
    body: Uint8Array.from(bytes).buffer,
  });
  return response.json() as Promise<ImageRef>;
}

async function waitForTerminal(server: PocServer, id: string): Promise<RunSnapshot> {
  let snapshot!: RunSnapshot;
  await waitUntil(async () => {
    const response = await fetch(`${server.url}/api/consultations/${id}`, { headers });
    snapshot = await response.json() as RunSnapshot;
    return snapshot.status !== 'running';
  });
  return snapshot;
}

async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

async function readParty(server: PocServer, partyId: string): Promise<Array<PartyMessage & { text: string }>> {
  const list = await fetch(`${server.url}/api/parties`, { headers });
  const parties = (await list.json() as { parties: Array<{ id: string; key: string }> }).parties;
  const key = parties.find(party => party.id === partyId)?.key;
  if (!key) throw new Error('party key unavailable');
  const response = await fetch(`${server.url}/api/parties/${partyId}/messages`, { headers });
  const messages = (await response.json() as { messages: PartyMessage[] }).messages.filter(message => message.kind === 'message');
  return Promise.all(messages.map(async message => {
    const plaintext = await decryptText(key, message.text);
    if (!plaintext) throw new Error('party message did not decrypt');
    const envelope = JSON.parse(plaintext) as { text: string };
    return { ...message, text: envelope.text };
  }));
}
