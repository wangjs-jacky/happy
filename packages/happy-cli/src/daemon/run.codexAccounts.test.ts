import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
const state = vi.hoisted(() => ({ control: null as any, handlers: null as any, tmux: false, spawned: [] as any[], children: [] as any[], rejectGrant: false, api: null as any }));
vi.mock('axios', () => ({ default: { get: vi.fn(async () => ({ data: { sessions: [] } })) } }));
vi.mock('@/ui/auth', () => ({ authAndSetupMachineIfNeeded: async () => ({ credentials: { token: 'fake', encryption: { type: 'legacy', secret: new Uint8Array(32) } }, machineId: 'machine-1' }) }));
vi.mock('@/persistence', () => ({ writeDaemonState: vi.fn(), readDaemonState: async () => null, acquireDaemonLock: async () => ({}), releaseDaemonLock: async () => {}, readPersistedSessions: () => ({}), persistSession: vi.fn() }));
vi.mock('./controlClient', () => ({ cleanupDaemonState: async () => {}, isDaemonRunningCurrentlyInstalledHappyVersion: async () => false, stopDaemon: async () => {} }));
vi.mock('./controlServer', () => ({ startDaemonControlServer: async (options: any) => { state.control = options; return { port: 45678, stop: async () => {} }; } }));
vi.mock('@/utils/caffeinate', () => ({ startCaffeinate: () => false, stopCaffeinate: async () => {} }));
vi.mock('@/ui/doctor', () => ({ getEnvironmentInfo: () => ({}) }));
vi.mock('@/utils/detectCLI', () => ({ detectCLIAvailability: () => ({}) }));
vi.mock('@/resume/localHappyAgentAuth', () => ({ detectResumeSupport: () => ({}) }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn(), warn: vi.fn() } }));
vi.mock('@/api/api', () => ({ ApiClient: { create: async () => state.api } }));
vi.mock('@/utils/tmux', () => ({ isTmuxAvailable: async () => state.tmux,
  getTmuxUtilities: () => ({ spawnInTmux: async (_args: any, _options: any, env: any) => { state.spawned.push(env); return { success: true, pid: 987602, sessionId: 'test:1' }; } }),
  parseTmuxSessionIdentifier: vi.fn(), formatTmuxSessionIdentifier: vi.fn(),
}));
vi.mock('@/utils/spawnHappyCLI', () => ({ resolveHappyCLIEntrypoint: () => '/fake/entry.mjs', spawnHappyCLI: (_args: any, options: any) => {
  const child = Object.assign(new EventEmitter(), { pid: 987601, kill: vi.fn() }); state.children.push(child); state.spawned.push(options.env); return child;
} }));
import { startDaemon } from './run';
import { logger } from '@/ui/logger';
import { configuration } from '@/configuration';

let sourceHome: string; let daemon: Promise<void>; let savedHome: string | undefined;
let signalListeners: Map<string, Function[]>;
const originalHappyHome = configuration.happyHomeDir;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  vi.spyOn(process, 'kill').mockImplementation(() => true);
  signalListeners = new Map(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', 'exit', 'beforeExit'].map(s => [s, process.listeners(s as NodeJS.Signals)]));
  state.control = null; state.handlers = null; state.spawned = []; state.children = []; state.rejectGrant = false;
  sourceHome = await mkdtemp(join(tmpdir(), 'daemon-codex-test-')); await writeFile(join(sourceHome, 'auth.json'), 'global-auth');
  (configuration as { happyHomeDir: string }).happyHomeDir = sourceHome;
  savedHome = process.env.CODEX_HOME; process.env.CODEX_HOME = sourceHome;
  state.api = {
    getOrCreateMachine: async () => ({ id: 'machine-1' }),
    machineSyncClient: () => ({ setRPCHandlers: (h: any) => { state.handlers = h; }, connect: vi.fn(), shutdown: vi.fn(), updateDaemonState: async () => {}, isConnected: () => false }),
    redeemCodexSessionGrant: vi.fn(async () => { if (state.rejectGrant) throw new Error('secret-canary'); return { auth: { tokens: { id_token: 'id', access_token: 'access', refresh_token: 'refresh', account_id: 'account' } }, launchId: 'launch-1', profile: { id: 'profile-1', displayName: 'Codex · ABCD', credentialVersion: 1 } }; }),
    attachCodexSession: vi.fn(async () => ({ success: true })), updateCodexAccountCredential: vi.fn(), reportCodexAccountQuota: vi.fn(), reportCodexAccountStatus: vi.fn(),
  };
  daemon = startDaemon();
  await vi.waitFor(() => expect(state.handlers).toBeTruthy());
});
afterEach(async () => {
  state.control?.requestShutdown(); await vi.advanceTimersByTimeAsync(150); await daemon;
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  for (const [signal, previous] of signalListeners) for (const listener of process.listeners(signal as NodeJS.Signals)) if (!previous.includes(listener)) process.removeListener(signal, listener as any);
  if (savedHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = savedHome;
  (configuration as { happyHomeDir: string }).happyHomeDir = originalHappyHome;
  await rm(sourceHome, { recursive: true, force: true });
});
describe('real daemon Codex spawn paths', () => {
  it('resumes an audited session under the newly bound profile and retains only its source thread', async () => {
    state.tmux = false;
    const first = state.handlers.spawnSession({ directory: sourceHome, agent: 'codex', codexSessionGrant: 'a'.repeat(43) });
    await vi.waitFor(() => expect(state.spawned).toHaveLength(1));
    const firstHome = state.spawned[0].CODEX_HOME;
    const metadata = { hostPid: 987601, flavor: 'codex', startedBy: 'daemon', path: sourceHome, codexThreadId: 'thread-source' };
    const encryption = { encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy', seq: 0, metadataVersion: 1, agentStateVersion: 1 };
    state.control.onHappySessionWebhook('paws-session', metadata, encryption); await first;
    await mkdir(join(firstHome, 'sessions')); await writeFile(join(firstHome, 'sessions', 'rollout-thread-source.jsonl'), 'source-native-thread');
    await writeFile(join(firstHome, 'sessions', 'rollout-unrelated.jsonl'), 'unrelated');
    state.children[0].emit('exit', 0);
    await vi.waitFor(async () => { await expect(stat(firstHome)).rejects.toThrow(); });
    state.api.redeemCodexSessionGrant.mockResolvedValue({ auth: { tokens: { id_token: 'b-id', access_token: 'b-access', refresh_token: 'b-refresh', account_id: 'b-account' } }, launchId: 'launch-b', profile: { id: 'profile-b', displayName: 'Codex · BBBB', credentialVersion: 2 } });
    const resumed = state.handlers.resumeSession('paws-session', { codexSessionGrant: 'b'.repeat(43) });
    await vi.waitFor(() => expect(state.spawned).toHaveLength(2));
    const nextHome = state.spawned[1].CODEX_HOME;
    expect(JSON.parse(await readFile(join(nextHome, 'auth.json'), 'utf8')).tokens.account_id).toBe('b-account');
    expect(await readFile(join(nextHome, 'sessions', 'rollout-thread-source.jsonl'), 'utf8')).toBe('source-native-thread');
    await expect(stat(join(nextHome, 'sessions', 'rollout-unrelated.jsonl'))).rejects.toThrow();
    state.control.onHappySessionWebhook('paws-session', metadata, encryption);
    expect(await resumed).toEqual({ type: 'success', sessionId: 'paws-session' });
    expect(state.api.attachCodexSession).toHaveBeenLastCalledWith('launch-b', { machineId: 'machine-1', sourceSessionId: 'paws-session' });
    state.children[1].emit('exit', 0);
    await vi.waitFor(async () => { await expect(stat(nextHome)).rejects.toThrow(); });
  });
  it.each([false, true])('redeems and attaches the actual direct/tmux spawn (tmux=%s)', async tmux => {
    state.tmux = tmux;
    const result = state.handlers.spawnSession({ directory: sourceHome, agent: 'codex', codexSessionGrant: 'g'.repeat(43), environmentVariables: { TMUX_SESSION_NAME: 'test', CODEX_HOME: sourceHome, OPENAI_API_KEY: 'caller-secret' } });
    await vi.waitFor(() => expect(state.spawned).toHaveLength(1));
    const env = state.spawned[0]; expect(env.CODEX_HOME).not.toBe(sourceHome); expect(env.OPENAI_API_KEY).toBeUndefined();
    const pid = tmux ? 987602 : 987601;
    state.control.onHappySessionWebhook('actual-session', { hostPid: pid, flavor: 'codex', startedBy: 'daemon' });
    expect(await result).toEqual({ type: 'success', sessionId: 'actual-session' });
    expect(state.api.attachCodexSession).toHaveBeenCalledWith('launch-1', { machineId: 'machine-1', sourceSessionId: 'actual-session' });
    if (tmux) {
      vi.mocked(process.kill).mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
      await vi.advanceTimersByTimeAsync(60_000);
    } else state.children[0].emit('exit', 0);
    await vi.waitFor(async () => { await expect(stat(env.CODEX_HOME)).rejects.toThrow(); });
    expect(await readFile(join(sourceHome, 'auth.json'), 'utf8')).toBe('global-auth');
  });
  it.each([false, true])('never spawns on a rejected grant (tmux=%s)', async tmux => {
    state.tmux = tmux; state.rejectGrant = true;
    const result = await state.handlers.spawnSession({ directory: sourceHome, agent: 'codex', codexSessionGrant: 'g'.repeat(43), environmentVariables: { TMUX_SESSION_NAME: 'test' } });
    expect(result.type).toBe('error'); expect(state.spawned).toHaveLength(0);
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('secret-canary');
  });
});
