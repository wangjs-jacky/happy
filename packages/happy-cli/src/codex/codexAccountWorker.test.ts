import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupOrphanedCodexAccountHome, codexAccountSessionMetadata } from './codexAccountWorker';
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(h => rm(h, { recursive: true, force: true }))); });
describe('Codex worker account lifecycle', () => {
  it('removes an orphaned private home after preserving native history, while leaving a live daemon to collect final quota', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-worker-test-')); dirs.push(root);
    const home = await mkdtemp(join(tmpdir(), 'happy-codex-home-')); dirs.push(home);
    await writeFile(join(home, '.paws-account-launch.json'), JSON.stringify({ daemonPid: 123456, profileId: 'profile-a', historyRoot: join(root, 'cache') }));
    await writeFile(join(home, 'auth.json'), 'credential'); await mkdir(join(home, 'sessions'));
    await writeFile(join(home, 'sessions', 'rollout-thread.jsonl'), 'thread');
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    await cleanupOrphanedCodexAccountHome(home); expect(await readFile(join(home, 'auth.json'), 'utf8')).toBe('credential');
    vi.mocked(process.kill).mockImplementation(() => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); });
    await cleanupOrphanedCodexAccountHome(home); await expect(stat(home)).rejects.toThrow();
  });
  it('only exposes non-secret profile attribution from valid launch environment', () => {
    expect(codexAccountSessionMetadata({ HAPPY_CODEX_ACCOUNT_PROFILE_ID: '00000000-0000-4000-8000-000000000001', HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION: '3', SECRET: 'secret' })).toEqual({ codexAccountProfileId: '00000000-0000-4000-8000-000000000001', codexAccountCredentialVersion: 3 });
    expect(codexAccountSessionMetadata({ HAPPY_CODEX_ACCOUNT_PROFILE_ID: 'bad', HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION: 'NaN' })).toEqual({});
  });
});
