import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { restoreCodexAccountHistory, retainCodexAccountHistory, rememberCodexAccountSession, copyCodexSourceThread } from './codexAccountHistory';
const dirs: string[] = [];
async function temp() { const h = await mkdtemp(join(tmpdir(), 'codex-history-test-')); dirs.push(h); return h; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(h => rm(h, { recursive: true, force: true }))); });
describe('profile-scoped native history', () => {
  it('hands off only the requested thread across profiles through an explicit Paws source-session audit', async () => {
    const cache = await temp(); const source = await temp();
    await mkdir(join(source, 'sessions')); await writeFile(join(source, 'sessions', 'rollout-thread-a.jsonl'), 'requested');
    await writeFile(join(source, 'sessions', 'rollout-thread-other.jsonl'), 'unrelated');
    await retainCodexAccountHistory(cache, 'profile-a', source);
    await rememberCodexAccountSession(cache, 'paws-session-a', 'profile-a');
    const target = await temp();
    await copyCodexSourceThread(cache, 'paws-session-a', 'thread-a', target);
    expect(await readFile(join(target, 'sessions', 'rollout-thread-a.jsonl'), 'utf8')).toBe('requested');
    await expect(stat(join(target, 'sessions', 'rollout-thread-other.jsonl'))).rejects.toThrow();
    await expect(copyCodexSourceThread(cache, 'legacy-unmapped', 'thread-a', target)).rejects.toThrow('unavailable');
    await expect(copyCodexSourceThread(cache, 'paws-session-a', 'missing', target)).rejects.toThrow('unavailable');
  });
  it('restores the same profile after temporary home deletion and excludes auth/config and other profiles', async () => {
    const cache = await temp(); const first = await temp();
    await mkdir(join(first, 'sessions', '2026'), { recursive: true });
    await writeFile(join(first, 'sessions', '2026', 'rollout-thread.jsonl'), 'native-thread');
    await writeFile(join(first, 'auth.json'), 'credential-secret'); await writeFile(join(first, 'config.toml'), 'config-secret');
    await retainCodexAccountHistory(cache, 'profile-a', first);
    await rm(first, { recursive: true, force: true });
    const next = await temp(); await restoreCodexAccountHistory(cache, 'profile-a', next);
    expect(await readFile(join(next, 'sessions', '2026', 'rollout-thread.jsonl'), 'utf8')).toBe('native-thread');
    expect((await stat(join(next, 'sessions'))).mode & 0o777).toBe(0o700);
    await expect(stat(join(next, 'auth.json'))).rejects.toThrow(); await expect(stat(join(next, 'config.toml'))).rejects.toThrow();
    const other = await temp(); await restoreCodexAccountHistory(cache, 'profile-b', other);
    await expect(stat(join(other, 'sessions', '2026', 'rollout-thread.jsonl'))).rejects.toThrow();
  });
  it('does not follow native-history symlinks or copy unrelated files', async () => {
    const cache = await temp(); const first = await temp(); const external = await temp();
    await writeFile(join(external, 'auth.json'), 'secret'); await mkdir(join(first, 'sessions'));
    await symlink(join(external, 'auth.json'), join(first, 'sessions', 'rollout-link.jsonl'));
    await writeFile(join(first, 'sessions', 'auth.json'), 'secret');
    await retainCodexAccountHistory(cache, 'a', first);
    const next = await temp(); await restoreCodexAccountHistory(cache, 'a', next);
    await expect(stat(join(next, 'sessions', 'rollout-link.jsonl'))).rejects.toThrow();
    await expect(stat(join(next, 'sessions', 'auth.json'))).rejects.toThrow();
  });
});
