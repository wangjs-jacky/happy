import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, link } from 'node:fs/promises';
import type { ArtifactErrorCode } from '@slopus/happy-wire';

export class ArtifactError extends Error {
  constructor(readonly code: ArtifactErrorCode, message: string, readonly operationId?: string, readonly actualRevision?: string) { super(message); }
}
export const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const inside = (root: string, path: string) => { const p = relative(root, path); return !isAbsolute(p) && p !== '..' && !p.startsWith('..' + sep); };
export const intersects = (a: string, b: string) => inside(a, b) || inside(b, a);
export function normalized(path: string): string {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') || isAbsolute(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new ArtifactError('PATH_OUT_OF_BOUNDS', 'Invalid managed path');
  return path;
}
/** Reject symlink components and hardlinks: managed paths must have a single owned identity. */
export async function ownedPath(root: string, path: string): Promise<string> {
  normalized(path);
  if (await realpath(root) !== root) throw new ArtifactError('PATH_OUT_OF_BOUNDS', 'Workspace root changed');
  let target = root;
  for (const component of path.split('/')) {
    target = join(target, component);
    try {
      const info = await lstat(target);
      if (await realpath(target) !== target || info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink > 1))) throw new ArtifactError('PATH_OUT_OF_BOUNDS', 'Managed path has an unsupported filesystem identity');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return target;
}
export async function boundedRead(path: string, limit: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new ArtifactError('LIMIT_EXCEEDED', 'File exceeds the supported limit');
    const buffer = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
    if (offset !== info.size) throw new ArtifactError('READ_UNSTABLE', 'File changed during read');
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}
export async function syncDirectory(path: string) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function atomicFile(path: string, bytes: string | Buffer, mode = 0o600, beforeRename?: () => Promise<void>) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.paws-artifact-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', mode);
  try {
    try { await handle.writeFile(bytes); await handle.chmod(mode & 0o777); await handle.sync(); } finally { await handle.close(); }
    await beforeRename?.(); await rename(temporary, path); await syncDirectory(dirname(path));
  } finally { await unlink(temporary).catch(() => {}); }
}
export type ProcessOwner = { pid: number; birth: string };
export async function processOwner(pid = process.pid): Promise<ProcessOwner> {
  // PID start identity prevents reuse being treated as ownership; errors fail closed.
  const { stdout } = await promisify(execFile)('ps', ['-o', 'lstart=', '-p', String(pid)]);
  const birth = stdout.trim();
  if (!birth) throw new ArtifactError('UNAVAILABLE', 'Cannot verify process identity');
  return { pid, birth };
}
export async function ownerAlive(owner: ProcessOwner): Promise<boolean> {
  try { process.kill(owner.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw new ArtifactError('UNAVAILABLE', 'Cannot verify writer process'); }
  return (await processOwner(owner.pid)).birth === owner.birth;
}
/** Atomic hardlink of an already fsynced owner record; no empty-owner acquisition window. */
export async function withMachineLock<T>(storage: string, body: () => Promise<T>): Promise<T> {
  await mkdir(storage, { recursive: true, mode: 0o700 });
  const candidate = join(storage, `.owner-${randomUUID()}`);
  const lock = join(storage, 'machine.lock');
  const owner = await processOwner();
  await atomicFile(candidate, JSON.stringify(owner));
  let acquired = false;
  try {
    try { await link(candidate, lock); acquired = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const previous = JSON.parse(await readFile(lock, 'utf8')) as ProcessOwner;
      if (await ownerAlive(previous)) throw new ArtifactError('WRITER_ACTIVE', 'Another managed operation is active');
      // Only one contender can reclaim a dead owner. An interrupted reclaim fails
      // closed, rather than allowing a second reaper to unlink a newly held lock.
      const reaper = join(storage, 'machine.reclaim');
      try { await link(candidate, reaper); } catch { throw new ArtifactError('UNAVAILABLE', 'Lock recovery requires verification'); }
      try {
        if (JSON.stringify(JSON.parse(await readFile(lock, 'utf8'))) !== JSON.stringify(previous)) throw new ArtifactError('WRITER_ACTIVE', 'Lock owner changed');
        await unlink(lock); await link(candidate, lock); acquired = true;
      } finally { await unlink(reaper); }
    }
    return await body();
  } finally { if (acquired) await unlink(lock); await unlink(candidate).catch(() => {}); }
}
