import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-updates', () => ({
    updateId: 'current-update-id',
    channel: 'preview',
    getExtraParamsAsync: vi.fn(),
    setExtraParamAsync: vi.fn(),
    checkForUpdateAsync: vi.fn(),
    fetchUpdateAsync: vi.fn(),
    reloadAsync: vi.fn(),
}));

import { applyOtaTarget } from './useOtaTarget';

describe('applyOtaTarget', () => {
    it('sets the target stamp, fetches the matching OTA, then reloads', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1783449000000);
        const updates = {
            setExtraParamAsync: vi.fn().mockResolvedValue(undefined),
            checkForUpdateAsync: vi.fn().mockResolvedValue({ isAvailable: true }),
            fetchUpdateAsync: vi.fn().mockResolvedValue({ isNew: true }),
            reloadAsync: vi.fn().mockResolvedValue(undefined),
        };

        await applyOtaTarget('1783232002648', updates);

        expect(updates.setExtraParamAsync).toHaveBeenNthCalledWith(1, 'ota-target-stamp', '1783232002648');
        expect(updates.setExtraParamAsync).toHaveBeenNthCalledWith(2, 'ota-target-generation', '1783449000000');
        expect(updates.checkForUpdateAsync).toHaveBeenCalledOnce();
        expect(updates.fetchUpdateAsync).toHaveBeenCalledOnce();
        expect(updates.reloadAsync).toHaveBeenCalledOnce();
        expect(updates.setExtraParamAsync.mock.invocationCallOrder[0]).toBeLessThan(updates.checkForUpdateAsync.mock.invocationCallOrder[0]);
        expect(updates.setExtraParamAsync.mock.invocationCallOrder[1]).toBeLessThan(updates.checkForUpdateAsync.mock.invocationCallOrder[0]);
        expect(updates.checkForUpdateAsync.mock.invocationCallOrder[0]).toBeLessThan(updates.fetchUpdateAsync.mock.invocationCallOrder[0]);
        expect(updates.fetchUpdateAsync.mock.invocationCallOrder[0]).toBeLessThan(updates.reloadAsync.mock.invocationCallOrder[0]);
    });

    it('unsets the target stamp and fetches latest before reloading', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1783449000001);
        const updates = {
            setExtraParamAsync: vi.fn().mockResolvedValue(undefined),
            checkForUpdateAsync: vi.fn().mockResolvedValue({ isAvailable: true }),
            fetchUpdateAsync: vi.fn().mockResolvedValue({ isNew: true }),
            reloadAsync: vi.fn().mockResolvedValue(undefined),
        };

        await applyOtaTarget(null, updates);

        expect(updates.setExtraParamAsync).toHaveBeenNthCalledWith(1, 'ota-target-stamp', 'latest');
        expect(updates.setExtraParamAsync).toHaveBeenNthCalledWith(2, 'ota-target-generation', '1783449000001');
        expect(updates.checkForUpdateAsync).toHaveBeenCalledOnce();
        expect(updates.fetchUpdateAsync).toHaveBeenCalledOnce();
        expect(updates.reloadAsync).toHaveBeenCalledOnce();
    });

    it('does not mutate update params or reload outside preview channel', async () => {
        const updates = {
            setExtraParamAsync: vi.fn().mockResolvedValue(undefined),
            checkForUpdateAsync: vi.fn().mockResolvedValue({ isAvailable: true }),
            fetchUpdateAsync: vi.fn().mockResolvedValue({ isNew: true }),
            reloadAsync: vi.fn().mockResolvedValue(undefined),
        };

        await expect(applyOtaTarget('1783232002648', updates, 'production')).rejects.toThrow('preview builds');

        expect(updates.setExtraParamAsync).not.toHaveBeenCalled();
        expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
        expect(updates.fetchUpdateAsync).not.toHaveBeenCalled();
        expect(updates.reloadAsync).not.toHaveBeenCalled();
    });
});
