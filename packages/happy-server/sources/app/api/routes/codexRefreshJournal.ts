import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { encryptString, decryptString } from '@/modules/encrypt';
import { codexAuthSchema, type CodexAuth } from './codexAccountTypes';

const root = () => join(process.env.DATA_DIR || join(homedir(), '.paws-server'), 'codex-refresh-journal');
const file = (intentId: string) => {
    if (!/^[a-f0-9-]{36}$/.test(intentId)) throw new Error('Invalid refresh intent');
    return join(root(), intentId);
};
const scope = (accountId: string, profileId: string, intentId: string) => ['user', accountId, 'codex-refresh-journal', profileId, intentId];

/** Persist the only rotated token before a database outage can discard it. */
export async function writeRefreshJournal(accountId: string, profileId: string, intentId: string, auth: CodexAuth): Promise<void> {
    await mkdir(root(), { recursive: true, mode: 0o700 });
    const target = file(intentId), temporary = `${target}.${randomUUID()}`;
    try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(Buffer.from(encryptString(scope(accountId, profileId, intentId), JSON.stringify(auth)))); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, target);
        const directory = await open(root(), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temporary, { force: true }); }
}
export async function readRefreshJournal(accountId: string, profileId: string, intentId: string): Promise<CodexAuth | undefined> {
    let handle;
    try { handle = await open(file(intentId), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error('Refresh journal unavailable'); }
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 100_000) throw new Error('Invalid refresh journal');
        return codexAuthSchema.parse(JSON.parse(decryptString(scope(accountId, profileId, intentId), await handle.readFile())));
    } finally { await handle.close(); }
}
export async function removeRefreshJournal(intentId: string): Promise<void> { await rm(file(intentId), { force: true }); }
