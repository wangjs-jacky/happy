import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rememberCodexAccountSession, retainCodexAccountHistory } from './codexAccountHistory';
import { withCodexAccountThread } from './codexAccountThread';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(h => rm(h, { recursive: true, force: true }))); });
describe('authless native thread operations', () => {
  it('requires an explicit mapped source and opens only an authless isolated home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-thread-test-')); dirs.push(root);
    const source = join(root, 'source'); await mkdir(join(source, 'sessions'), { recursive: true });
    await writeFile(join(source, 'sessions', 'rollout-thread-a.jsonl'), 'thread');
    await retainCodexAccountHistory(root, 'profile-a', source); await rememberCodexAccountSession(root, 'session-a', 'profile-a');
    let home: string | undefined;
    const client = { connect: vi.fn(), disconnect: vi.fn() };
    const createClient = vi.fn((env: NodeJS.ProcessEnv) => { home = env.CODEX_HOME; expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.HAPPY_CODEX_APP_SERVER_MODE).toBe('spawn'); return client as any; });
    const result = await withCodexAccountThread({ sourceSessionId: 'session-a', codexThreadId: 'thread-a' }, async () => {
      await expect(stat(join(home!, 'auth.json'))).rejects.toThrow();
      expect((await stat(join(home!, 'sessions', 'rollout-thread-a.jsonl'))).isFile()).toBe(true);
      return 'fork-created';
    }, { historyRoot: root, createClient });
    expect(result).toBe('fork-created'); expect(client.disconnect).toHaveBeenCalledOnce(); await expect(stat(home!)).rejects.toThrow();
    await expect(withCodexAccountThread({ sourceSessionId: 'legacy', codexThreadId: 'thread-a' }, async () => null, { historyRoot: root, createClient })).rejects.toThrow('unavailable');
    expect(createClient).toHaveBeenCalledOnce();
  });
});
