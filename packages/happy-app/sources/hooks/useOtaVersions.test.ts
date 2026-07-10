import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OTA_RUNTIME_VERSION, fetchOtaVersion } from './useOtaVersions';

describe('useOtaVersions runtime defaults', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches runtime 22 metadata by default', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                id: 'update-id',
                createdAt: '2026-07-10T19:03:08.454Z',
                channel: 'preview',
                git: {},
            }),
        } as Response);

        await expect(fetchOtaVersion('preview', '1783710188454')).resolves.toMatchObject({
            stamp: '1783710188454',
            id: 'update-id',
            channel: 'preview',
        });

        expect(DEFAULT_OTA_RUNTIME_VERSION).toBe('22');
        expect(fetchMock).toHaveBeenCalledWith(
            'https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/meta/android/22/preview/1783710188454.json',
        );
    });
});
