/** Non-secret, credential-bound verification evidence shared across devices. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/storage/db';
import { encryptString, decryptString } from '@/modules/encrypt';
import { type CloudflareCredential, createCloudflareCredentialRepository } from './cloudflareCredentialStore';
import { CloudflareApiError } from './cloudflareClient';

export const cloudflareVerificationSchema = z.object({
    state: z.enum(['verified', 'authorization_error', 'unavailable']),
    checkedAt: z.number().int().nonnegative(),
    source: z.enum(['check', 'publication']).optional(),
});
export type CloudflareVerification = z.infer<typeof cloudflareVerificationSchema>;
const recordSchema = cloudflareVerificationSchema.extend({ fingerprint: z.string() });
const keyFor = (credential: CloudflareCredential) => `provider:cloudflare:verification:${cloudflareCredentialFingerprint(credential)}`;
const path = (id: string) => ['user', id, 'providers', 'cloudflare', 'verification'];

/** Never expose this fingerprint or the token to clients. */
export function cloudflareCredentialFingerprint(credential: CloudflareCredential): string {
    return createHash('sha256').update(JSON.stringify([
        credential.accessToken, credential.teamId, credential.configurationId,
        credential.connectionEpoch, credential.connectionNonce,
    ])).digest('hex');
}

/** HTTP authentication failures cannot distinguish expiry, revocation, and permissions. */
export function classifyCloudflareFailure(error: unknown): 'authorization_error' | 'unavailable' {
    return error instanceof CloudflareApiError && [401, 403].includes(error.status) ? 'authorization_error' : 'unavailable';
}

export function createCloudflareVerificationStore(repository: ReturnType<typeof createCloudflareCredentialRepository>, encrypt = encryptString, decrypt = decryptString) {
return {
    async get(accountId: string, credential: CloudflareCredential): Promise<CloudflareVerification | undefined> {
        const key = keyFor(credential);
        const encrypted = await repository.find(accountId, key);
        if (!encrypted) return undefined;
        const value = recordSchema.parse(JSON.parse(decrypt(path(accountId), encrypted)));
        if (value.fingerprint !== cloudflareCredentialFingerprint(credential)) return undefined;
        return cloudflareVerificationSchema.parse(value);
    },
    /** Compare-and-set prevents an older concurrent probe from replacing newer evidence. */
    async save(accountId: string, credential: CloudflareCredential, verification: CloudflareVerification): Promise<void> {
        const key = keyFor(credential);
        const value = { ...verification, fingerprint: cloudflareCredentialFingerprint(credential) };
        const replacement = encrypt(path(accountId), JSON.stringify(value));
        for (let attempt = 0; attempt < 3; attempt++) {
            const encrypted = await repository.find(accountId, key);
            if (!encrypted) {
                if (await repository.createIfAbsent?.(accountId, key, replacement)) return;
            } else {
                const current = recordSchema.parse(JSON.parse(decrypt(path(accountId), encrypted)));
                if (current.checkedAt > verification.checkedAt) return;
                if (await repository.compareAndSet(accountId, key, encrypted, replacement)) return;
            }
        }
    },
};
}

export const cloudflareVerificationStore = createCloudflareVerificationStore(createCloudflareCredentialRepository(db as unknown as Parameters<typeof createCloudflareCredentialRepository>[0]));
