import { describe, expect, it, vi } from 'vitest';
import { checkAppUpdates } from './checkAppUpdates';

describe('manual App update decision', () => {
    it('offers a required new binary instead of saying OTA is current', async () => {
        const result = await checkAppUpdates({
            checkNative: async () => ({ status: 'update-available', available: true, updateUrl: 'https://github.com/example.apk' }),
            checkOta: async () => ({ isAvailable: false }),
            fetchOta: async () => ({ isNew: true }),
        });
        expect(result).toEqual({ kind: 'native', url: 'https://github.com/example.apk' });
    });
    it('downloads a compatible OTA even if the native version service is unavailable', async () => {
        const fetchOta = vi.fn(async () => ({ isNew: true }));
        expect(await checkAppUpdates({ checkNative: async () => { throw new Error('offline'); },
            checkOta: async () => ({ isAvailable: true }), fetchOta })).toEqual({ kind: 'ota', nativeCheckFailed: true });
        expect(fetchOta).toHaveBeenCalledOnce();
    });
    it('reports incomplete checking when native lookup fails and OTA has no update', async () => {
        expect(await checkAppUpdates({ checkNative: async () => { throw new Error('offline'); },
            checkOta: async () => ({ isAvailable: false }), fetchOta: async () => ({ isNew: true }) })).toEqual({ kind: 'unknown' });
    });
    it('reports current only after the native and OTA checks both succeed', async () => {
        expect(await checkAppUpdates({ checkNative: async () => ({ status: 'up-to-date', available: false }),
            checkOta: async () => ({ isAvailable: false }), fetchOta: async () => ({ isNew: true }) })).toEqual({ kind: 'current' });
    });
    it('does not call an unsupported native package fully up to date', async () => {
        expect(await checkAppUpdates({ checkNative: async () => ({ status: 'unsupported', available: false }),
            checkOta: async () => ({ isAvailable: false }), fetchOta: async () => ({ isNew: true }) })).toEqual({ kind: 'ota-current-only' });
    });
    it('does not offer reload when Expo resolves a failed download', async () => {
        await expect(checkAppUpdates({ checkNative: async () => ({ status: 'up-to-date', available: false }),
            checkOta: async () => ({ isAvailable: true }), fetchOta: async () => ({ isNew: false }) })).rejects.toThrow();
    });
});
