import { beforeEach, describe, expect, it, vi } from 'vitest';

const { filesMock, resetStorage } = vi.hoisted(() => {
    const state = {
        local: true,
        objects: new Map<string, Buffer>(),
    };
    const s3client = {
        presignedPutObject: vi.fn(async (_bucket: string, key: string) => `https://s3.test/put/${key}`),
        presignedGetObject: vi.fn(async (_bucket: string, key: string) => `https://s3.test/get/${key}`),
        statObject: vi.fn(async (_bucket: string, key: string) => {
            if (!state.objects.has(key)) throw new Error('missing');
            return { size: state.objects.get(key)!.length };
        }),
        listObjects: vi.fn(),
        removeObjects: vi.fn(async () => undefined),
    };
    const filesMock = {
        s3client,
        s3bucket: 'bucket',
        isLocalStorage: vi.fn(() => state.local),
        getLocalFilesDir: vi.fn(() => '/tmp/paws-share-storage'),
        putLocalFile: vi.fn(async (key: string, value: Buffer) => { state.objects.set(key, value); }),
        readLocalFile: vi.fn((key: string) => state.objects.get(key) ?? null),
        localFileExists: vi.fn((key: string) => state.objects.has(key)),
        deleteFilePrefix: vi.fn(async (prefix: string) => {
            for (const key of state.objects.keys()) {
                if (key.startsWith(`${prefix}/`)) state.objects.delete(key);
            }
        }),
        __state: state,
    };
    const resetStorage = () => {
        state.local = true;
        state.objects.clear();
        vi.clearAllMocks();
    };
    return { filesMock, resetStorage };
});

vi.mock('@/storage/files', () => filesMock);

import {
    buildPublicShareStoragePath,
    createPublicShareUploadDescriptor,
    deletePublicShareGeneration,
    getPublicShareDownloadSource,
    publicShareAssetExists,
    putPublicShareLocalAsset,
} from './publicSessionShareStorage';

describe('publicSessionShareStorage', () => {
    beforeEach(resetStorage);

    it('builds a generation-contained object path and rejects unsafe identifiers', () => {
        expect(buildPublicShareStoragePath('share_1', 'generation-1', 'asset_1')).toBe(
            'public/session-shares/share_1/generation-1/asset_1',
        );
        expect(() => buildPublicShareStoragePath('../share', 'generation-1', 'asset_1')).toThrow('Invalid share storage identifier');
        expect(() => buildPublicShareStoragePath('share_1', 'generation/1', 'asset_1')).toThrow('Invalid share storage identifier');
    });

    it('writes and resolves local share assets without exposing a filesystem path', async () => {
        const storagePath = buildPublicShareStoragePath('share_1', 'generation-1', 'asset_1');
        const descriptor = await createPublicShareUploadDescriptor(storagePath, 'https://paws.test/upload/asset_1');
        expect(descriptor).toEqual({ method: 'PUT', uploadUrl: 'https://paws.test/upload/asset_1' });

        await putPublicShareLocalAsset(storagePath, Buffer.from('hello'));
        expect(await publicShareAssetExists(storagePath, 5)).toBe(true);
        expect(await getPublicShareDownloadSource(storagePath)).toEqual({ kind: 'buffer', data: Buffer.from('hello') });
    });

    it('uses private S3 presigned URLs and checks the expected object size', async () => {
        filesMock.__state.local = false;
        const storagePath = buildPublicShareStoragePath('share_1', 'generation-1', 'asset_1');
        filesMock.__state.objects.set(storagePath, Buffer.from('hello'));

        expect(await createPublicShareUploadDescriptor(storagePath, 'https://unused.test')).toEqual({
            method: 'PUT',
            uploadUrl: `https://s3.test/put/${storagePath}`,
        });
        expect(await publicShareAssetExists(storagePath, 5)).toBe(true);
        expect(await publicShareAssetExists(storagePath, 4)).toBe(false);
        expect(await getPublicShareDownloadSource(storagePath, {
            contentType: 'video/mp4',
            contentDisposition: 'inline; filename="demo.mp4"',
        })).toEqual({
            kind: 'redirect',
            url: `https://s3.test/get/${storagePath}`,
        });
        expect(filesMock.s3client.presignedGetObject).toHaveBeenCalledWith(
            'bucket',
            storagePath,
            15 * 60,
            {
                'response-cache-control': 'no-store',
                'response-content-disposition': 'inline; filename="demo.mp4"',
                'response-content-type': 'video/mp4',
            },
        );
    });

    it('deletes only the requested generation prefix', async () => {
        const oldPath = buildPublicShareStoragePath('share_1', 'old-generation', 'asset_1');
        const activePath = buildPublicShareStoragePath('share_1', 'active-generation', 'asset_2');
        filesMock.__state.objects.set(oldPath, Buffer.from('old'));
        filesMock.__state.objects.set(activePath, Buffer.from('active'));

        await deletePublicShareGeneration('share_1', 'old-generation');

        expect(filesMock.__state.objects.has(oldPath)).toBe(false);
        expect(filesMock.__state.objects.has(activePath)).toBe(true);
    });
});
