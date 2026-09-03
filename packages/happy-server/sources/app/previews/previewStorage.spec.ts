import { describe, expect, it, vi } from 'vitest';
import { createPreviewStorage } from './previewStorage';

describe('createPreviewStorage', () => {
    it('issues a size-limited private upload under an opaque preview prefix', async () => {
        const policy = { setBucket: vi.fn(), setKey: vi.fn(), setExpires: vi.fn(), setContentLengthRange: vi.fn() };
        const client = {
            newPostPolicy: vi.fn(() => policy),
            presignedPostPolicy: vi.fn(async () => ({ postURL: 'https://oss.test', formData: { key: 'signed' } })),
            statObject: vi.fn(), getObject: vi.fn(), listObjects: vi.fn(), removeObjects: vi.fn(),
        };
        const storage = createPreviewStorage({ client: client as any, bucket: 'private-bucket' });
        const result = await storage.createUpload('11111111-1111-4111-8111-111111111111', 'asset_1', 123);
        expect(policy.setKey).toHaveBeenCalledWith('private/interactive-previews/11111111-1111-4111-8111-111111111111/asset_1');
        expect(policy.setContentLengthRange).toHaveBeenCalledWith(123, 123);
        expect(result).toEqual({ method: 'POST', uploadUrl: 'https://oss.test', formFields: { key: 'signed' } });
    });

    it('rejects an object whose observed size differs from the manifest', async () => {
        const client = { statObject: vi.fn(async () => ({ size: 9 })) };
        const storage = createPreviewStorage({ client: client as any, bucket: 'private-bucket' });
        await expect(storage.assertUploaded('11111111-1111-4111-8111-111111111111', 'asset_1', 10)).rejects.toThrow(/size/i);
    });

    it('deletes only the exact preview prefix', async () => {
        const listeners: Record<string, Function> = {};
        const stream = { on: vi.fn((name: string, fn: Function) => { listeners[name] = fn; return stream; }) };
        const client = { listObjects: vi.fn(() => stream), removeObjects: vi.fn(async () => {}) };
        const storage = createPreviewStorage({ client: client as any, bucket: 'private-bucket' });
        const promise = storage.deletePreview('11111111-1111-4111-8111-111111111111');
        listeners.data({ name: 'private/interactive-previews/11111111-1111-4111-8111-111111111111/asset_1' });
        listeners.end();
        await promise;
        expect(client.listObjects).toHaveBeenCalledWith('private-bucket', 'private/interactive-previews/11111111-1111-4111-8111-111111111111/', true);
        expect(client.removeObjects).toHaveBeenCalledWith('private-bucket', ['private/interactive-previews/11111111-1111-4111-8111-111111111111/asset_1']);
    });
});
