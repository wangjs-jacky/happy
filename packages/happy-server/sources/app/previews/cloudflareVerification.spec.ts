import { describe, expect, it } from 'vitest';
import { cloudflareCredentialFingerprint, classifyCloudflareFailure } from './cloudflareVerification';
import { CloudflareApiError } from './cloudflareClient';
describe('Cloudflare verification evidence', () => {
    it('binds evidence to credentials and connection generation', () => {
        const base = { version: 1 as const, accessToken: 'secret', configurationId: 'project', connectionEpoch: 1 };
        expect(cloudflareCredentialFingerprint(base)).not.toContain('secret');
        expect(cloudflareCredentialFingerprint(base)).not.toBe(cloudflareCredentialFingerprint({ ...base, accessToken: 'replacement' }));
        expect(cloudflareCredentialFingerprint(base)).not.toBe(cloudflareCredentialFingerprint({ ...base, connectionEpoch: 2 }));
    });
    it('does not guess revoked/expired from a provider status or mistake a network failure for authorization', () => {
        expect(classifyCloudflareFailure(new CloudflareApiError('secret', 403))).toBe('authorization_error');
        expect(classifyCloudflareFailure(new CloudflareApiError('secret', 401))).toBe('authorization_error');
        expect(classifyCloudflareFailure(new Error('network secret'))).toBe('unavailable');
        expect(classifyCloudflareFailure(new CloudflareApiError('http_429', 429))).toBe('unavailable');
    });
});

import { createCloudflareVerificationStore } from './cloudflareVerification';
it('isolates overlapping old/new credential checks and preserves newer evidence', async () => {
    const rows = new Map<string, Uint8Array<ArrayBuffer>>();
    const store = createCloudflareVerificationStore({
        find: async (_account, key) => rows.get(key) ?? null,
        upsert: async (_account, key, value) => { rows.set(key, value); },
        createIfAbsent: async (_account, key, value) => { if (rows.has(key)) return false; rows.set(key, value); return true; },
        compareAndSet: async (_account, key, expected, value) => { if (rows.get(key) !== expected) return false; rows.set(key, value); return true; },
        delete: async (_account, key) => { rows.delete(key); },
    }, (_path, value) => new TextEncoder().encode(value), (_path, value) => new TextDecoder().decode(value));
    const old = { version: 1 as const, accessToken: 'old', configurationId: 'project', connectionEpoch: 1 };
    const next = { ...old, accessToken: 'new', connectionEpoch: 2 };
    await store.save('user', old, { state: 'verified', checkedAt: 20 });
    await store.save('user', next, { state: 'verified', checkedAt: 10 });
    await store.save('user', old, { state: 'authorization_error', checkedAt: 30 });
    expect(await store.get('user', next)).toEqual({ state: 'verified', checkedAt: 10 });
    await store.save('user', next, { state: 'authorization_error', checkedAt: 40, source: 'publication' });
    await store.save('user', next, { state: 'verified', checkedAt: 15 });
    expect(await store.get('user', next)).toEqual({ state: 'authorization_error', checkedAt: 40, source: 'publication' });
});
