import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { StartInput } from '../src/contracts.js';
import { createPocServer, type PocServer } from '../src/server/http.js';
import { TestOnlySdk } from './fake-sdk.js';

const dirs: string[] = [];
const servers: PocServer[] = [];
const token = 'test-access-token';

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function start(dataDir?: string, sdk: unknown = disconnectedSdk): Promise<PocServer> {
  const dir = dataDir ?? await mkdtemp(join(tmpdir(), 'paws-agent-party-service-'));
  if (!dataDir) dirs.push(dir);
  const server = await createPocServer({ dataDir: dir, accessToken: token, sdk: sdk as never });
  servers.push(server);
  return server;
}

function authorized(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } };
}

const disconnectedSdk = {
  status: () => ({ state: 'disconnected' as const }),
  link: async () => ({ state: 'disconnected' as const }),
  disconnect: async () => undefined,
  machines: async () => [],
  dispose: async () => undefined,
};

describe('authenticated local service', () => {
  it('rejects missing bearer auth, an untrusted Origin, and an untrusted Host', async () => {
    const server = await start();

    expect((await fetch(`${server.url}/api/consultations`)).status).toBe(401);
    expect((await fetch(`${server.url}/api/consultations`, authorized({
      headers: { origin: 'https://evil.example' },
    }))).status).toBe(403);
    expect(await statusWithHost(`${server.url}/api/consultations`, 'evil.example')).toBe(403);
  });

  it('mounts the real vendored Party API and persists its SQLite registry', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'paws-agent-party-persist-'));
    dirs.push(dataDir);
    const first = await start(dataDir);
    const key = Buffer.alloc(32, 7).toString('base64url');
    const createdResponse = await fetch(`${first.url}/api/parties`, authorized({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Persistence proof', key }),
    }));
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json() as { id: string };
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await start(dataDir);
    const listed = await fetch(`${second.url}/api/parties`, authorized());
    expect(listed.status).toBe(200);
    expect((await listed.json() as { parties: Array<{ id: string }> }).parties.map(party => party.id)).toContain(created.id);
  });

  it('protects uploaded image bytes with the same access token', async () => {
    const server = await start();
    const uploaded = await fetch(`${server.url}/api/assets`, authorized({
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-filename': encodeURIComponent('图表.png') },
      body: new Uint8Array([1, 2, 3]),
    }));
    expect(uploaded.status).toBe(200);
    const ref = await uploaded.json() as { id: string; name: string };
    expect(ref.name).toBe('图表.png');

    expect((await fetch(`${server.url}/api/assets/${ref.id}`)).status).toBe(401);
    const downloaded = await fetch(`${server.url}/api/assets/${ref.id}`, authorized());
    expect(downloaded.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await downloaded.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('serves HTML, JavaScript, and CSS without bearer auth while retaining authority checks', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'paws-agent-party-static-data-'));
    const staticDir = await mkdtemp(join(tmpdir(), 'paws-agent-party-static-web-'));
    dirs.push(dataDir, staticDir);
    await mkdir(staticDir, { recursive: true });
    await writeFile(join(staticDir, 'index.html'), '<script src="/app.js"></script>');
    await writeFile(join(staticDir, 'app.js'), 'export {};');
    await writeFile(join(staticDir, 'app.css'), 'body {}');
    const server = await createPocServer({ dataDir, staticDir, accessToken: token, sdk: disconnectedSdk as never });
    servers.push(server);

    const html = await fetch(`${server.url}/`);
    const script = await fetch(`${server.url}/app.js`);
    const css = await fetch(`${server.url}/app.css`);

    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(css.headers.get('content-type')).toContain('text/css');
    expect((await fetch(`${server.url}/`, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('releases the data-directory lock when initialization fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'paws-agent-party-init-failure-'));
    dirs.push(dataDir);
    await writeFile(join(dataDir, 'runs.json'), '{');

    await expect(createPocServer({ dataDir, accessToken: token, sdk: disconnectedSdk as never })).rejects.toBeInstanceOf(SyntaxError);

    await writeFile(join(dataDir, 'runs.json'), JSON.stringify({ runs: [], requestIds: {} }));
    const server = await start(dataDir);
    expect((await fetch(`${server.url}/api/consultations`, authorized())).status).toBe(200);
  });

  it('rejects relinking while a consultation is active', async () => {
    const sdk = new TestOnlySdk({ delayMs: 2_000 });
    const server = await start(undefined, sdk);
    const started = await fetch(`${server.url}/api/consultations`, authorized({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startInput()),
    }));
    expect(started.status).toBe(200);

    const relink = await fetch(`${server.url}/api/paws/link`, authorized({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverUrl: 'https://example.invalid' }),
    }));

    expect(relink.status).toBe(409);
    expect(sdk.linkCalls).toBe(0);
  });

  it('rejects consultation admission while an account transition is pending', async () => {
    const sdk = new TestOnlySdk({ linkDelayMs: 100 });
    const server = await start(undefined, sdk);
    const linking = fetch(`${server.url}/api/paws/link`, authorized({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverUrl: 'https://example.invalid' }),
    }));
    await waitUntil(() => sdk.linkCalls === 1);

    const startResponse = await fetch(`${server.url}/api/consultations`, authorized({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startInput()),
    }));

    expect(startResponse.status).toBe(409);
    expect((await linking).status).toBe(200);
  });

  it('rejects follow-up admission while an account transition is pending', async () => {
    const sdk = new TestOnlySdk({ linkDelayMs: 100 });
    const server = await start(undefined, sdk);
    const startedResponse = await fetch(`${server.url}/api/consultations`, authorized({
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(startInput()),
    }));
    const started = await startedResponse.json() as { id: string };
    await waitUntil(async () => {
      const response = await fetch(`${server.url}/api/consultations/${started.id}`, authorized());
      return ((await response.json()) as { status: string }).status === 'completed';
    });
    const linking = fetch(`${server.url}/api/paws/link`, authorized({
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverUrl: 'https://example.invalid' }),
    }));
    await waitUntil(() => sdk.linkCalls === 1);

    const followUp = await fetch(`${server.url}/api/consultations/${started.id}/messages`, authorized({
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'during-link', text: 'Follow up.', to: [], images: [] }),
    }));

    expect(followUp.status).toBe(409);
    expect((await linking).status).toBe(200);
  });
});

function startInput(): StartInput {
  return {
    requestId: 'service-request', stock: 'SYNTH', text: 'Analyze.', images: [],
    machineId: 'machine-1', directory: '/workspace/project', mode: 'single',
    agents: { moderator: 'codex', trend30: 'claude', structure10: 'gemini', timing1: 'opencode' },
  };
}

async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition');
}

async function statusWithHost(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const pending = request(url, { headers: { authorization: `Bearer ${token}`, host } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    pending.once('error', reject);
    pending.end();
  });
}
