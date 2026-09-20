import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createCodexManagedAccess } from './codexManagedAccess';
import { readCodexAccountLaunchState } from './codexAccountLaunchState';
vi.mock('./codexAccountLaunchState', () => ({ readCodexAccountLaunchState: vi.fn() }));

const result = { accessToken: 'access-v2', chatgptAccountId: 'provider-account', chatgptPlanType: null, credentialVersion: 2 };
const state = { profileId: 'profile', launchId: 'launch', machineId: 'machine', currentVersion: 1,
    accountFingerprint: createHash('sha256').update('launch\0provider-account').digest('hex'), identityInvalid: false };
describe('managed access adoption', () => {
    it('adopts a newer generation without replacing the session or exposing a refresh token', async () => {
        vi.mocked(readCodexAccountLaunchState).mockResolvedValue(state as any);
        const api = { getCodexAccountAccessToken: vi.fn().mockResolvedValue(result) };
        const provider = await createCodexManagedAccess(api, '/synthetic-home');
        expect(await provider(false)).toEqual(result);
        await provider(true);
        expect(api.getCodexAccountAccessToken.mock.calls[1]).toEqual(['profile', {
            machineId: 'machine', launchId: 'launch', previousVersion: 2, forceRefresh: true,
        }]);
    });
    it('does not satisfy a forced refresh with a concurrent non-refreshing read', async () => {
        vi.mocked(readCodexAccountLaunchState).mockResolvedValue(state as any);
        let release!: (value: typeof result) => void;
        const api = { getCodexAccountAccessToken: vi.fn()
            .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
            .mockResolvedValue({ ...result, accessToken: 'access-v3', credentialVersion: 3 }) };
        const provider = await createCodexManagedAccess(api, '/synthetic-home');
        const read = provider(false);
        const refresh = provider(true);
        release(result);
        await read;
        expect((await refresh).credentialVersion).toBe(3);
        expect(api.getCodexAccountAccessToken).toHaveBeenCalledTimes(2);
        expect(api.getCodexAccountAccessToken.mock.calls[1][1].forceRefresh).toBe(true);
    });
    it('rejects a different provider identity before handing tokens to native Codex', async () => {
        vi.mocked(readCodexAccountLaunchState).mockResolvedValue(state as any);
        const provider = await createCodexManagedAccess({ getCodexAccountAccessToken: async () => ({ ...result, chatgptAccountId: 'other' }) }, '/synthetic-home');
        await expect(provider(false)).rejects.toThrow('identity');
    });
});
