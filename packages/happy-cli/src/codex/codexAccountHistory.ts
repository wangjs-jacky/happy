import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AsyncLock } from '@/utils/lock';

const copyLock = new AsyncLock();
export class CodexSourceHistoryUnavailableError extends Error {
  constructor() { super('Codex source history unavailable. This session has no retained Paws account history on this machine.'); }
}
const profilePath = (root: string, profileId: string) => join(root, createHash('sha256').update(profileId).digest('hex'));
async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory()) throw new Error('Invalid Codex history directory');
  await chmod(path, 0o700);
}
async function copyRollouts(source: string, destination: string, threadId?: string): Promise<number> {
  const sourceStat = await lstat(source).catch(() => null);
  if (!sourceStat?.isDirectory()) return 0;
  let found = 0;
  await privateDirectory(destination);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name); const to = join(destination, entry.name);
    if (entry.isDirectory()) { found += await copyRollouts(from, to, threadId); continue; }
    if (!entry.isFile() || !/^rollout-[^/\\]+\.jsonl$/.test(entry.name)) continue;
    if (threadId && !entry.name.endsWith(`-${threadId}.jsonl`)) continue;
    const input = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const temp = join(destination, `.copy-${randomUUID()}`);
    try {
      const info = await input.stat(); if (!info.isFile()) continue;
      found++;
      const existing = await lstat(to).catch(() => null);
      if (existing && (!existing.isFile() || existing.mtimeMs >= info.mtimeMs)) continue;
      const output = await open(temp, 'wx', 0o600);
      try { await pipeline(input.createReadStream(), output.createWriteStream()); }
      finally { await output.close(); }
      await utimes(temp, info.atime, info.mtime);
      await rename(temp, to);
    } finally { await input.close(); await rm(temp, { force: true }); }
  }
  return found;
}
async function copyNativeHistory(source: string, destination: string, threadId?: string): Promise<number> {
  if (!(await lstat(source).catch(() => null))?.isDirectory()) return 0;
  // Native thread lookup can rebuild indexes from rollouts. Never copy SQLite,
  // auth, config, logs, credentials, arbitrary JSON, or symlinks.
  let found = 0;
  for (const entry of ['sessions', 'archived_sessions']) found += await copyRollouts(join(source, entry), join(destination, entry), threadId);
  return found;
}
export async function retainCodexAccountHistory(root: string, profileId: string, home: string): Promise<void> {
  await copyLock.inLock(async () => {
    await privateDirectory(root); const target = profilePath(root, profileId); await privateDirectory(target);
    await copyNativeHistory(home, target);
  });
}
export async function restoreCodexAccountHistory(root: string, profileId: string, home: string): Promise<void> {
  await copyLock.inLock(async () => { await copyNativeHistory(profilePath(root, profileId), home); });
}

const auditPath = (root: string, sessionId: string) => join(root, 'session-audit', createHash('sha256').update(sessionId).digest('hex') + '.json');
export async function rememberCodexAccountSession(root: string, sessionId: string, profileId: string, home?: string): Promise<void> {
  await copyLock.inLock(async () => {
    await privateDirectory(root); await privateDirectory(join(root, 'session-audit'));
    const target = auditPath(root, sessionId); const temp = target + '.' + randomUUID();
    try { await writeFile(temp, JSON.stringify({ profileId, home }), { mode: 0o600, flag: 'wx' }); await rename(temp, target); }
    finally { await rm(temp, { force: true }); }
  });
}

/** An explicit owned Paws session is the only bridge across profile caches. */
export async function copyCodexSourceThread(root: string, sourceSessionId: string, threadId: string, target: string): Promise<string> {
  if (!sourceSessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(threadId)) throw new CodexSourceHistoryUnavailableError();
  return copyLock.inLock(async () => {
    try {
      const path = auditPath(root, sourceSessionId);
      if (!(await lstat(path)).isFile()) throw new Error();
      const audit = JSON.parse(await readFile(path, 'utf8'));
      if (typeof audit.profileId !== 'string' || !audit.profileId) throw new Error();
      let found = 0;
      if (typeof audit.home === 'string' && basename(audit.home).startsWith('happy-codex-home-')) {
        const marker = join(audit.home, '.paws-account-launch.json');
        if ((await lstat(marker).catch(() => null))?.isFile()) {
          const ownership = JSON.parse(await readFile(marker, 'utf8'));
          if (ownership.profileId === audit.profileId) found += await copyNativeHistory(audit.home, target, threadId);
        }
      }
      found += await copyNativeHistory(profilePath(root, audit.profileId), target, threadId);
      if (!found) throw new Error();
      return audit.profileId;
    } catch { throw new CodexSourceHistoryUnavailableError(); }
  });
}
