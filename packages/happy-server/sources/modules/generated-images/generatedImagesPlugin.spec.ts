import { describe, expect, it, vi } from 'vitest';

import { createGeneratedImagesPlugin } from './generatedImagesPlugin';

describe('generated images plugin', () => {
    it('stores an encrypted installation marker and reports installation state', async () => {
        const vault = {
            set: vi.fn(async () => undefined),
            get: vi.fn(async () => JSON.stringify({ version: 1 })),
            delete: vi.fn(async () => undefined),
        };
        const plugin = createGeneratedImagesPlugin(vault);

        await plugin.install('user-1');

        expect(vault.set).toHaveBeenCalledWith(
            'user-1',
            'generated-images-gallery',
            JSON.stringify({ version: 1 }),
        );
        await expect(plugin.getStatus('user-1')).resolves.toEqual({ installed: true });
    });

    it('reports missing installations and removes the marker idempotently', async () => {
        const vault = {
            set: vi.fn(async () => undefined),
            get: vi.fn(async () => null),
            delete: vi.fn(async () => undefined),
        };
        const plugin = createGeneratedImagesPlugin(vault);

        await expect(plugin.getStatus('user-2')).resolves.toEqual({ installed: false });
        await plugin.uninstall('user-2');

        expect(vault.delete).toHaveBeenCalledWith('user-2', 'generated-images-gallery');
    });
});
