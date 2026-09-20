import { createHash } from 'node:crypto';
import { readCodexAccountAuth } from './codexAccountAuth';
import { readFile, lstat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { retainCodexAccountHistory } from './codexAccountHistory';
import { readCodexAccountLaunchState } from './codexAccountLaunchState';
import { CodexAccountLaunch, type AccountApi } from '@/daemon/codexAccountLaunch';

async function recoverOrphanedObserver(home: string | undefined, api: AccountApi): Promise<CodexAccountLaunch | undefined> {
  if (!home || !basename(home).startsWith('happy-codex-home-')) return;
  const state = await readCodexAccountLaunchState(home);
  // Replacement daemons never own this home. Only the original daemon can be
  // writing its checkpoint; ESRCH guarantees its final CAS cannot race ours.
  try { process.kill(state.daemonPid, 0); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return; }
  // The daemon may have completed its last CAS after our first read. Only the
  // checkpoint read after confirmed death carries its final successful version.
  const finalState = await readCodexAccountLaunchState(home);
  const attribution = ['daemonPid', 'launchId', 'machineId', 'profileId', 'sourceSessionId',
    'credentialVersion', 'accountFingerprint', 'startedAt', 'historyRoot'] as const;
  if (attribution.some(key => finalState[key] !== state[key]) || finalState.currentVersion < state.currentVersion) return;
  return CodexAccountLaunch.recover(api, home, finalState);
}

/** Survives daemon replacement because the observer runs in the session worker. */
export function startCodexAccountWorkerObserver(api: AccountApi, home = process.env.CODEX_HOME): { finish(): Promise<void>; prepareTurn(): Promise<void>; bindTurn(turnId: string): Promise<void>; handleEvent(event: { type?: string; turn_id?: string; status?: string; error?: unknown }): Promise<void> } {
  let pending = Promise.resolve();
  let turn: { id?: string; state: Awaited<ReturnType<typeof readCodexAccountLaunchState>> } | undefined;
  const earlyCompletions = new Map<string, { type?: string; turn_id?: string; status?: string; error?: unknown }>();
  const handleEvent = async (event: { type?: string; turn_id?: string; status?: string; error?: unknown }) => {
    if (!home || !basename(home).startsWith('happy-codex-home-')) return;
    if (event.type !== 'task_complete' && event.type !== 'turn_aborted') return;
    if (!turn || !event.turn_id) return;
    if (!turn.id) {
      // A completion may beat the turn/start RPC response. Wait for its authoritative ID.
      if (earlyCompletions.size < 16) earlyCompletions.set(event.turn_id, event);
      return;
    }
    if (event.turn_id !== turn.id) return;
    const snapshot = turn.state;
    turn = undefined;
    const error = event.error;
    const message = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? error.message : undefined;
    // Do not quarantine an account for a generic provider 401, timeout, or model error.
    if (typeof message !== 'string' || !/refresh token (?:was revoked|has been revoked|has expired|has already been used)/i.test(message)) return;
    if (!snapshot.sourceSessionId) return;
    const current = await readCodexAccountLaunchState(home);
    const auth = await readCodexAccountAuth(home);
    const digest = createHash('sha256').update(JSON.stringify(auth)).digest('hex');
    // A delayed failure for an old turn must not invalidate a newer login.
    if (current.launchId !== snapshot.launchId || current.currentVersion !== snapshot.currentVersion
      || current.authFingerprint !== snapshot.authFingerprint || digest !== snapshot.authFingerprint) return;
    await api.reportCodexAccountStatus(snapshot.profileId, {
      machineId: snapshot.machineId, launchId: snapshot.launchId,
      credentialVersion: snapshot.currentVersion, status: 'needs-refresh',
    });
  };
  let finishing: Promise<void> | undefined;
  const observe = async () => {
    const observer = await recoverOrphanedObserver(home, api);
    await observer?.sync();
  };
  const timer = home && basename(home).startsWith('happy-codex-home-') ? setInterval(() => {
    pending = pending.then(observe).catch(() => undefined);
  }, 60_000) : undefined;
  timer?.unref();
  return { prepareTurn: () => {
    pending = pending.then(async () => {
      turn = undefined;
      earlyCompletions.clear();
      if (home && basename(home).startsWith('happy-codex-home-')) {
        turn = { state: await readCodexAccountLaunchState(home) };
      }
    }).catch(() => undefined);
    return pending;
  }, bindTurn: turnId => {
    pending = pending.then(async () => {
      if (!turn || !turnId) return;
      turn.id = turnId;
      const completion = earlyCompletions.get(turnId);
      earlyCompletions.clear();
      if (completion) await handleEvent(completion);
    }).catch(() => undefined);
    return pending;
  }, handleEvent: event => {
    pending = pending.then(() => handleEvent(event)).catch(() => undefined);
    return pending;
  }, finish: () => {
    clearInterval(timer);
    return finishing ??= pending.then(() => cleanupOrphanedCodexAccountHome(home, api)).catch(() => undefined);
  } };
}

export async function cleanupOrphanedCodexAccountHome(home = process.env.CODEX_HOME, api?: AccountApi): Promise<void> {
  if (api) {
    try { await (await recoverOrphanedObserver(home, api))?.finish(); } catch { /* Leave unreadable checkpoints untouched. */ }
    return;
  }
  if (!home || !basename(home).startsWith('happy-codex-home-')) return;
  try {
    const markerPath = join(home, '.paws-account-launch.json');
    if (!(await lstat(markerPath)).isFile()) return;
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    if (!Number.isSafeInteger(marker.daemonPid) || marker.daemonPid <= 0 || typeof marker.profileId !== 'string' || typeof marker.historyRoot !== 'string') return;
    try { process.kill(marker.daemonPid, 0); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return; }
    await retainCodexAccountHistory(marker.historyRoot, marker.profileId, home);
    // Without an API/checkpoint reconciliation we cannot know whether auth was uploaded.
    // Leave the login in place for its account-aware owner to recover.
  } catch { /* Best effort when another cleanup already owns this home. */ }
}

export function codexAccountSessionMetadata(env = process.env): { codexAccountProfileId?: string; codexAccountCredentialVersion?: number } {
  const profileId = env.HAPPY_CODEX_ACCOUNT_PROFILE_ID;
  const version = Number(env.HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION);
  if (!profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId) || !Number.isInteger(version) || version < 1) return {};
  return { codexAccountProfileId: profileId, codexAccountCredentialVersion: version };
}
