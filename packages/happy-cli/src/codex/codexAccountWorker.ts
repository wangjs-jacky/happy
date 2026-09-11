import { readFile, lstat, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { retainCodexAccountHistory } from './codexAccountHistory';

export async function cleanupOrphanedCodexAccountHome(home = process.env.CODEX_HOME): Promise<void> {
  if (!home || !basename(home).startsWith('happy-codex-home-')) return;
  try {
    const markerPath = join(home, '.paws-account-launch.json');
    if (!(await lstat(markerPath)).isFile()) return;
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    if (!Number.isSafeInteger(marker.daemonPid) || marker.daemonPid <= 0 || typeof marker.profileId !== 'string' || typeof marker.historyRoot !== 'string') return;
    try { process.kill(marker.daemonPid, 0); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return; }
    try { await retainCodexAccountHistory(marker.historyRoot, marker.profileId, home); }
    finally { await rm(home, { recursive: true, force: true }); }
  } catch { /* Best effort when another cleanup already owns this home. */ }
}

export function codexAccountSessionMetadata(env = process.env): { codexAccountProfileId?: string; codexAccountCredentialVersion?: number } {
  const profileId = env.HAPPY_CODEX_ACCOUNT_PROFILE_ID;
  const version = Number(env.HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION);
  if (!profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId) || !Number.isInteger(version) || version < 1) return {};
  return { codexAccountProfileId: profileId, codexAccountCredentialVersion: version };
}
