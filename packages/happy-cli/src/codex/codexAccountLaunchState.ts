import { constants } from 'node:fs';
import { open, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(256);
const version = z.number().int().positive();
const schema = z.object({
  schemaVersion: z.literal(1), daemonPid: version, machineId: id, profileId: id, launchId: id,
  credentialVersion: version, currentVersion: version,
  authFingerprint: hash, accountFingerprint: hash,
  sourceSessionId: id.optional(), historyRoot: z.string().min(1).max(4096), startedAt: z.number().finite(),
  writeDisabled: z.boolean(), identityInvalid: z.boolean(), lastQuota: z.string().max(512).optional(),
}).strict();
export type CodexAccountLaunchState = z.infer<typeof schema>;
const marker = '.paws-account-launch.json';

/** Private, secret-free checkpoint for the worker after its original daemon exits. */
export async function writeCodexAccountLaunchState(home: string, state: CodexAccountLaunchState): Promise<void> {
  const temporary = join(home, `.paws-account-state-${randomUUID()}`);
  try {
    await writeFile(temporary, JSON.stringify(schema.parse(state)), { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(home, marker));
  } finally { await rm(temporary, { force: true }); }
}

export async function readCodexAccountLaunchState(home: string): Promise<CodexAccountLaunchState> {
  const file = await open(join(home, marker), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8192) throw new Error('Invalid account observer state');
    const buffer = Buffer.alloc(8193);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 8192) throw new Error('Invalid account observer state');
    return schema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
  } finally { await file.close(); }
}
