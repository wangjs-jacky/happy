import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MagpieActionSchema, MagpieSnapshotSchema, type MagpieSnapshot, type MagpieAccount } from '@slopus/happy-wire';
import { z } from 'zod';
import { createProcessRunner, resolveExecutable, type ProcessRunner } from '@/environment/processRunner';

const sourceAccount = z.object({
    agent: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    user: z.string().min(1).max(512).refine(value => !value.startsWith('-') && !/[\x00-\x1f\x7f]/.test(value)),
    alias: z.string().max(512).optional(), plan: z.string().max(120).optional(), active: z.boolean(), on: z.boolean(),
    error: z.string().optional(), lapsed: z.string().optional(), readAt: z.string().optional(),
    windows: z.array(z.object({ name: z.string().max(120), remaining: z.number().min(0).max(100).optional(), resetsAt: z.string().optional() })).max(30).nullable().optional(),
});
const sourceAccounts = z.array(sourceAccount).max(1000);
const controlledAgents = new Set(['codex', 'claude', 'gemini', 'antigravity', 'copilot']);
const validDate = (value: string | undefined) => value && Number.isFinite(Date.parse(value)) ? value : null;
const idOf = (agent: string, user: string) => createHash('sha256').update(`${agent}\0${user}`).digest('hex');

export function createMagpieService(deps: { runner?: ProcessRunner; resolve?: () => Promise<string | null>; env?: NodeJS.ProcessEnv } = {}) {
    const runner = deps.runner ?? createProcessRunner();
    const env = deps.env ?? process.env;
    const resolve = deps.resolve ?? (() => resolveExecutable('magpie', env.PATH, [
        join(homedir(), '.local/bin/magpie'), '/Applications/magpie.app/Contents/MacOS/magpie',
        '/opt/homebrew/bin/magpie', '/usr/local/bin/magpie',
    ]));
    let busy = false;
    async function run(executable: string, args: string[], timeoutMs = 60_000) {
        const result = await runner.run(executable, args, { env, timeoutMs, maxOutputBytes: 1024 * 1024 });
        if (result.timedOut || result.exitCode !== 0) throw new Error('operation-failed');
        return result.stdout;
    }
    async function read(executable: string): Promise<MagpieAccount[]> {
        const output = await run(executable, ['accounts', '--json']);
        let parsed: z.infer<typeof sourceAccounts>;
        try { parsed = sourceAccounts.parse(JSON.parse(output)); }
        catch { throw new Error('invalid-response'); }
        const accounts = parsed.map(a => ({
            id: idOf(a.agent, a.user), agent: a.agent, user: a.user, name: a.alias || a.user, plan: a.plan ?? '',
            active: a.active, enabled: a.on, needsLogin: !!a.lapsed, quotaError: !!a.error, readAt: validDate(a.readAt),
            windows: (a.windows ?? []).map(w => ({ name: w.name, remaining: w.remaining ?? null, resetsAt: validDate(w.resetsAt) })),
            canSwitch: controlledAgents.has(a.agent) && !a.active && !a.lapsed,
            canRename: controlledAgents.has(a.agent),
        }));
        if (new Set(accounts.map(a => a.id)).size !== accounts.length) throw new Error('invalid-response');
        return accounts;
    }
    return {
        async execute(raw: unknown): Promise<MagpieSnapshot> {
            const request = MagpieActionSchema.safeParse(raw);
            const snapshot: MagpieSnapshot = { status: 'error', version: null, accounts: [], observedAt: new Date().toISOString(), error: null, changed: false };
            if (!request.success) return { ...snapshot, error: 'unsupported-action' };
            if (busy) return { ...snapshot, error: 'busy' };
            busy = true;
            try {
                const executable = await resolve();
                if (!executable) return { ...snapshot, status: 'not-installed' };
                snapshot.accounts = await read(executable);
                const action = request.data;
                if (action.action !== 'inspect') {
                    const account = snapshot.accounts.find(a => a.id === action.accountId);
                    if (!account) throw new Error('account-missing');
                    if (!controlledAgents.has(account.agent)) throw new Error('unsupported-action');
                    if (action.action === 'refresh') {
                        await run(executable, ['quota', 'refresh', account.agent, account.user, '--json']);
                    } else if (action.action === 'rename') {
                        if (!account.canRename) throw new Error('unsupported-action');
                        snapshot.changed = true;
                        await run(executable, ['accounts', 'alias', account.agent, account.user, action.name], 15_000);
                    } else {
                        if (!account.canSwitch) throw new Error('unsupported-action');
                        snapshot.changed = true;
                        await run(executable, ['accounts', 'switch', account.agent, account.user], 30_000);
                    }
                    const after = await read(executable);
                    const updated = after.find(a => a.id === account.id);
                    if (!updated || (action.action === 'rename' && updated.name !== action.name)
                        || (action.action === 'switch' && !updated.active)) throw new Error('verification-failed');
                    snapshot.accounts = after;
                    if (action.action === 'refresh' && updated.quotaError) throw new Error('operation-failed');
                }
                return MagpieSnapshotSchema.parse({ ...snapshot, status: 'ready', observedAt: new Date().toISOString() });
            } catch (error) {
                const code = error instanceof Error ? error.message : '';
                const allowed = ['invalid-response', 'account-missing', 'unsupported-action', 'operation-failed', 'verification-failed'] as const;
                snapshot.error = allowed.find(value => value === code) ?? 'unavailable';
                // Keep no stale pre-write inventory when a write might have succeeded.
                if (snapshot.changed) { snapshot.accounts = []; snapshot.error = 'verification-failed'; }
                return snapshot;
            } finally { busy = false; }
        },
    };
}
