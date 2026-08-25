import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());

vi.mock('./apiSocket', () => ({ apiSocket: { request } }));

import {
    getGeneratedImagesPluginStatus,
    installGeneratedImagesPlugin,
    uninstallGeneratedImagesPlugin,
} from './generatedImagesPlugin';

describe('generated images plugin client', () => {
    beforeEach(() => vi.clearAllMocks());

    it('loads, installs, and uninstalls through the authenticated Paws server', async () => {
        request
            .mockResolvedValueOnce(new Response(JSON.stringify({ installed: false }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ installed: true }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ installed: false }), { status: 200 }));

        await expect(getGeneratedImagesPluginStatus()).resolves.toEqual({ installed: false });
        await expect(installGeneratedImagesPlugin()).resolves.toEqual({ installed: true });
        await expect(uninstallGeneratedImagesPlugin()).resolves.toEqual({ installed: false });

        expect(request).toHaveBeenNthCalledWith(1, '/v1/plugins/generated-images-gallery');
        expect(request).toHaveBeenNthCalledWith(2, '/v1/plugins/generated-images-gallery', { method: 'PUT' });
        expect(request).toHaveBeenNthCalledWith(3, '/v1/plugins/generated-images-gallery', { method: 'DELETE' });
    });
});
