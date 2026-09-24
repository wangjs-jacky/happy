import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ApiClient } from '@/api/api';
import { CodexAccountRequestError } from '@/api/codexAccountTypes';
import { readCodexAccountLaunchState } from './codexAccountLaunchState';

const accessSchema = z.object({ accessToken: z.string().min(1).max(24000), chatgptAccountId: z.string().min(1).max(256),
    chatgptPlanType: z.string().nullable(), credentialVersion: z.number().int().positive() }).strict();
export type CodexManagedAccess = z.infer<typeof accessSchema>;
export type CodexManagedAccessProvider = (forceRefresh: boolean) => Promise<CodexManagedAccess>;

/** A running session keeps its immutable account identity, while generations advance. */
export async function createCodexManagedAccess(api: Pick<ApiClient, 'getCodexAccountAccessToken'>, home: string): Promise<CodexManagedAccessProvider> {
    const state = await readCodexAccountLaunchState(home);
    if (state.identityInvalid) throw new Error('Codex account identity is invalid');
    let version = state.currentVersion;
    let pending: Promise<CodexManagedAccess> | undefined;
    let pendingForce = false;
    const get: CodexManagedAccessProvider = forceRefresh => {
        if (pending) return forceRefresh && !pendingForce ? pending.then(() => get(true)) : pending;
        pendingForce = forceRefresh;
        pending = (async () => {
            const deadline = Date.now() + 25_000;
            for (;;) {
                try {
                    const value = accessSchema.parse(await api.getCodexAccountAccessToken(state.profileId, {
                        machineId: state.machineId, launchId: state.launchId, previousVersion: version, forceRefresh,
                    }));
                    const identity = createHash('sha256').update(`${state.launchId}\0${value.chatgptAccountId}`).digest('hex');
                    if (identity !== state.accountFingerprint || value.credentialVersion < version) throw new Error('Codex account identity or generation changed unexpectedly');
                    version = value.credentialVersion;
                    return value;
                } catch (error) {
                    if (!(error instanceof CodexAccountRequestError) || !['credential-refresh-busy', 'credential-version-conflict', 'codex-account-request-failed'].includes(error.code) || Date.now() >= deadline) throw error;
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
            }
        })().finally(() => { pending = undefined; });
        return pending;
    };
    return get;
}
