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

    it('issues a ten-minute size-limited private upload under the exact account preview generation prefix', async () => {
        const policy = { setBucket: vi.fn(), setKey: vi.fn(), setExpires: vi.fn(), setContentLengthRange: vi.fn() };
        const client = {
            newPostPolicy: vi.fn(() => policy),
            presignedPostPolicy: vi.fn(async () => ({ postURL: 'https://oss.test', formData: { key: 'signed' } })),
            statObject: vi.fn(), getObject: vi.fn(), listObjects: vi.fn(), removeObjects: vi.fn(),
        };
        const now = new Date('2026-09-04T12:00:00.000Z');
        const storage = createPreviewStorage({ client: client as any, bucket: 'private-bucket', now: () => now });
        const storageKey = storage.storageKey({ accountId: 'account-1', previewId: '11111111-1111-4111-8111-111111111111', stagingGeneration: 'generation-1' }, 'asset_1');
        const result = await storage.createUpload(storageKey, 123);
        expect(policy.setKey).toHaveBeenCalledWith('private/interactive-previews/account-1/11111111-1111-4111-8111-111111111111/generation-1/asset_1');
        expect(policy.setExpires).toHaveBeenCalledWith(new Date('2026-09-04T12:10:00.000Z'));
        expect(policy.setContentLengthRange).toHaveBeenCalledWith(123, 123);
        expect(result).toEqual({ method: 'POST', uploadUrl: 'https://oss.test', formFields: { key: 'signed' } });
    });

    it('accepts the shared 96-character opaque asset id but rejects 97 characters', () => {
        const storage = createPreviewStorage({ client: {} as any, bucket: 'private-bucket' });
        const scope = { accountId: 'account-1', previewId: '11111111-1111-4111-8111-111111111111', stagingGeneration: 'generation-1' };
        expect(storage.storageKey(scope, 'a'.repeat(96))).toContain(`/${'a'.repeat(96)}`);
        expect(() => storage.storageKey(scope, 'a'.repeat(97))).toThrow(/asset id/i);
    });

    it('rejects an object whose observed size differs from the manifest', async () => {
        const client = { statObject: vi.fn(async () => ({ size: 9 })) };
        const storage = createPreviewStorage({ client: client as any, bucket: 'private-bucket' });
        await expect(storage.assertUploaded(storage.storageKey({ accountId: 'account-1', previewId: '11111111-1111-4111-8111-111111111111', stagingGeneration: 'generation-1' }, 'asset_1'), 10)).rejects.toThrow(/size/i);
    });

    it('deletes only the exact preview prefix', async () => {
        const listeners: Record<string, Function> = {};
        const stream = { on: vi.fn((name: string, fn: Function) => { listeners[name] = fn; return stream; }) };
        const client = { listObjects: vi.fn(() => stream), removeObjects: vi.fn(async () => {}) };
        const storage = createPreviewStorage({ client: client as any, bucket: 'private-bucket' });
        const scope = { accountId: 'account-1', previewId: '11111111-1111-4111-8111-111111111111', stagingGeneration: 'generation-1' };
        const promise = storage.deletePreview(scope);
        listeners.data({ name: 'private/interactive-previews/account-1/11111111-1111-4111-8111-111111111111/generation-1/asset_1' });
        listeners.data({ name: 'private/interactive-previews/account-2/11111111-1111-4111-8111-111111111111/generation-1/asset_2' });
        listeners.data({ name: 'private/interactive-previews/account-1/11111111-1111-4111-8111-111111111111/generation-2/asset_3' });
        listeners.end();
        await promise;
        expect(client.listObjects).toHaveBeenCalledWith('private-bucket', 'private/interactive-previews/account-1/11111111-1111-4111-8111-111111111111/generation-1/', true);
        expect(client.removeObjects).toHaveBeenCalledWith('private-bucket', ['private/interactive-previews/account-1/11111111-1111-4111-8111-111111111111/generation-1/asset_1']);
    });

    it('reads and removes persisted legacy keys exactly without listing their broad preview prefix', async () => {
        const listeners: Record<string, Function> = {};
        const stream = { on: vi.fn((name: string, fn: Function) => { listeners[name] = fn; return stream; }) };
        const previewId = '11111111-1111-4111-8111-111111111111';
        const legacyKey = `private/interactive-previews/${previewId}/legacy_asset`;
        const client = {
            listObjects: vi.fn(() => stream),
            removeObjects: vi.fn(async () => {}),
            statObject: vi.fn(async () => ({ size: 4 })),
        };
        const storage = createPreviewStorage({ client: client as any, bucket: 'private-bucket' });
        const scope = { accountId: 'account-1', previewId, stagingGeneration: 'generation-1' };
        const currentKey = storage.storageKey(scope, 'current_asset');

        await expect(storage.assertUploaded(legacyKey, 4)).resolves.toBeUndefined();
        await expect(storage.assertUploaded('private/interactive-previews/11111111-1111-0111-8111-111111111111/legacy_asset', 4)).rejects.toThrow(/storage key/i);
        const deletion = storage.deletePreview(scope, [legacyKey]);
        listeners.data({ name: currentKey });
        listeners.end();
        await deletion;

        expect(client.listObjects).toHaveBeenCalledWith('private-bucket', `${currentKey.slice(0, currentKey.lastIndexOf('/') + 1)}`, true);
        expect(client.listObjects).not.toHaveBeenCalledWith('private-bucket', `private/interactive-previews/${previewId}/`, true);
        expect(client.removeObjects).toHaveBeenCalledWith('private-bucket', [currentKey, legacyKey]);
    });
});
