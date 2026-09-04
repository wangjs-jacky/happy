import { describe, expect, it, vi } from 'vitest';
import { createPreviewStorage, readPreviewStorageConfig } from './previewStorage';

describe('createPreviewStorage', () => {
    it('requires a dedicated preview bucket while reusing the existing OSS connection by default', () => {
        expect(readPreviewStorageConfig({
            S3_HOST: 'oss-cn-hangzhou.aliyuncs.com',
            S3_ACCESS_KEY: 'attachments-access',
            S3_SECRET_KEY: 'attachments-secret',
            S3_REGION: 'cn-hangzhou',
            S3_PATH_STYLE: 'false',
            PREVIEW_S3_BUCKET: 'happy-temporary-previews',
        })).toEqual({
            host: 'oss-cn-hangzhou.aliyuncs.com',
            accessKey: 'attachments-access',
            secretKey: 'attachments-secret',
            bucket: 'happy-temporary-previews',
            region: 'cn-hangzhou',
            pathStyle: false,
            useSSL: true,
            port: undefined,
        });
    });

    it('does not silently fall back to the attachments bucket', () => {
        expect(readPreviewStorageConfig({
            S3_HOST: 'oss-cn-hangzhou.aliyuncs.com',
            S3_ACCESS_KEY: 'attachments-access',
            S3_SECRET_KEY: 'attachments-secret',
            S3_BUCKET: 'attachments',
        })).toBeNull();
    });

    it('supports a fully isolated preview OSS identity', () => {
        expect(readPreviewStorageConfig({
            S3_HOST: 'attachments.example.com',
            S3_ACCESS_KEY: 'attachments-access',
            S3_SECRET_KEY: 'attachments-secret',
            PREVIEW_S3_HOST: 'previews.example.com',
            PREVIEW_S3_PORT: '9443',
            PREVIEW_S3_USE_SSL: 'false',
            PREVIEW_S3_REGION: 'preview-region',
            PREVIEW_S3_PATH_STYLE: 'true',
            PREVIEW_S3_ACCESS_KEY: 'preview-access',
            PREVIEW_S3_SECRET_KEY: 'preview-secret',
            PREVIEW_S3_BUCKET: 'preview-bucket',
        })).toEqual({
            host: 'previews.example.com',
            accessKey: 'preview-access',
            secretKey: 'preview-secret',
            bucket: 'preview-bucket',
            region: 'preview-region',
            pathStyle: true,
            useSSL: false,
            port: 9443,
        });
    });

    it('rejects malformed preview transport settings during startup', () => {
        const base = {
            S3_HOST: 'oss.example.com',
            S3_ACCESS_KEY: 'access',
            S3_SECRET_KEY: 'secret',
            PREVIEW_S3_BUCKET: 'preview-bucket',
        };
        expect(() => readPreviewStorageConfig({ ...base, PREVIEW_S3_PORT: 'not-a-port' })).toThrow(/PREVIEW_S3_PORT/);
        expect(() => readPreviewStorageConfig({ ...base, PREVIEW_S3_USE_SSL: 'sometimes' })).toThrow(/PREVIEW_S3_USE_SSL/);
        expect(() => readPreviewStorageConfig({ ...base, PREVIEW_S3_PATH_STYLE: 'sometimes' })).toThrow(/PREVIEW_S3_PATH_STYLE/);
    });

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
