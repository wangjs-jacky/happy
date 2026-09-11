import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as api from './apiCodexAccounts';

const { serverUrl } = vi.hoisted(() => ({ serverUrl: vi.fn(() => 'https://test') }));
vi.mock('./serverConfig', () => ({ getServerUrl: serverUrl }));
vi.mock('./apiSocket', () => ({ getHappyClientId: () => 'web' }));
const credentials = { token: 'paws-bearer', secret: 'paws-secret' };
const profile = {
    id: '00000000-0000-4000-8000-000000000001', displayName: 'Codex · 1234', status: 'available',
    credentialVersion: 2, createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z',
    lastValidatedAt: null,
    quota: { state: 'unknown', remainingPercent: null, weeklyResetsAt: null, observedAt: null },
};
const grant = { grant: 'a'.repeat(43), expiresAt: '2026-09-11T00:01:00Z',
    profile: { id: profile.id, displayName: profile.displayName, credentialVersion: 2 } };
let requests: { url: string; init: RequestInit }[];
function respond(body: unknown, status = 200) {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(body), { status });
    });
}
beforeEach(() => { requests = []; serverUrl.mockReturnValue('https://test'); });
afterEach(() => vi.unstubAllGlobals());

describe('App Codex accounts boundary', () => {
    it('lists only public metadata and authenticates with bearer/client headers', async () => {
        respond({ profiles: [{ ...profile, auth: { access_token: 'must-not-escape' } }], bindings: [], migration: 'none' });
        const result = await api.listCodexAccounts(credentials);
        expect(result).toEqual({ profiles: [profile], bindings: [], migration: 'none' });
        expect(requests[0]).toMatchObject({ url: 'https://test/v1/codex-accounts', init: {
            method: 'GET', headers: { Authorization: 'Bearer paws-bearer', 'X-Happy-Client': 'web' },
        } });
    });

    it('renames and deletes the exact selected profile', async () => {
        respond({ profile: { ...profile, displayName: 'Work' } });
        expect(await api.renameCodexAccount(credentials, profile.id, 'Work')).toMatchObject({ profile: { displayName: 'Work' } });
        respond({ success: true });
        expect(await api.deleteCodexAccount(credentials, profile.id)).toEqual({ success: true });
        expect(requests.map(({ url, init }) => [url, init.method, init.body])).toEqual([
            [`https://test/v1/codex-accounts/${profile.id}`, 'PATCH', '{"displayName":"Work"}'],
            [`https://test/v1/codex-accounts/${profile.id}`, 'DELETE', undefined],
        ]);
    });

    it.each([profile.id, null])('binds exactly one machine with CAS, including explicit unbind (%s)', async (profileId) => {
        respond({ binding: { machineId: 'machine/1', profileId, version: 4 } });
        expect(await api.bindCodexAccount(credentials, 'machine/1', { profileId, expectedVersion: 3 }))
            .toEqual({ binding: { machineId: 'machine/1', profileId, version: 4 } });
        expect(requests[0]).toMatchObject({ url: 'https://test/v1/machines/machine%2F1/codex-account', init: {
            method: 'PUT', body: JSON.stringify({ profileId, expectedVersion: 3 }),
        } });
    });

    it('creates an opaque grant from only machine identity and strips daemon-only fields', async () => {
        respond({ ...grant, auth: { access_token: 'must-not-escape' } });
        expect(await api.createCodexSessionGrant(credentials, 'machine-1')).toEqual(grant);
        expect(requests[0]).toMatchObject({ url: 'https://test/v1/codex-session-grants', init: {
            method: 'POST', body: '{"machineId":"machine-1"}', redirect: 'error',
            headers: { Authorization: 'Bearer paws-bearer', 'X-Happy-Client': 'web', 'Content-Type': 'application/json' },
        } });
    });

    it.each([
        ['codex-account-unbound', /bind.*machine/i],
        ['codex-account-unavailable', /upload|refresh/i],
        ['binding-version-conflict', /changed|refresh/i],
        ['display-name-conflict', /name/i],
        ['profile-not-found', /removed|found/i],
    ])('maps reviewed %s without forwarding server details', async (code, message) => {
        respond({ error: code, details: 'access_token=must-not-escape' }, 409);
        await expect(api.createCodexSessionGrant(credentials, 'machine-1')).rejects.toMatchObject({ code, status: 409, message });
        expect(requests).toHaveLength(1);
    });

    it('does not echo arbitrary HTTP/network/validation error text or retry grants', async () => {
        respond({ error: 'access_token=must-not-escape' }, 500);
        await expect(api.createCodexSessionGrant(credentials, 'machine-1')).rejects.toThrow(/operation failed/i);
        expect(requests).toHaveLength(1);
        vi.stubGlobal('fetch', async () => { throw new Error('access_token=must-not-escape'); });
        await expect(api.createCodexSessionGrant(credentials, 'machine-1')).rejects.toThrow(/network/i);
        respond({ ...grant, grant: 'access_token=must-not-escape' });
        await expect(api.createCodexSessionGrant(credentials, 'machine-1')).rejects.toThrow(/invalid.*response/i);
    });

    it('uses the reviewed HTTPS mapping and refuses other remote HTTP origins', async () => {
        respond(grant);
        serverUrl.mockReturnValue('http://47.115.228.20:3005');
        await api.createCodexSessionGrant(credentials, 'machine-1');
        expect(requests[0].url).toBe('https://47.115.228.20:8443/v1/codex-session-grants');
        serverUrl.mockReturnValue('http://unsafe.example');
        await expect(api.createCodexSessionGrant(credentials, 'machine-1')).rejects.toThrow(/HTTPS/);
        expect(requests).toHaveLength(1);
    });

    it('excludes raw credentials from public profile and grant types', () => {
        expectTypeOf<Extract<keyof api.CodexAccountProfile, 'auth' | 'tokens' | 'access_token' | 'refresh_token' | 'account_id'>>().toEqualTypeOf<never>();
        expectTypeOf<Extract<keyof api.CodexSessionGrant, 'auth' | 'tokens' | 'access_token' | 'refresh_token' | 'account_id'>>().toEqualTypeOf<never>();
    });
});
