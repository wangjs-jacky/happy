import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    readFileBytes: vi.fn(),
    uploadEncryptedBlob: vi.fn(),
    getCredentials: vi.fn(),
    readAdvisorImage: vi.fn(),
    writeAdvisorImage: vi.fn(),
    deleteAdvisorImages: vi.fn(),
}));

vi.mock('./relationshipAdvisorImageCache', () => ({
    readAdvisorImage: mocks.readAdvisorImage,
    writeAdvisorImage: mocks.writeAdvisorImage,
    deleteAdvisorImages: mocks.deleteAdvisorImages,
}));

vi.mock('./apiSocket', () => ({ apiSocket: { request: mocks.request } }));
vi.mock('@/utils/readFileBytes', () => ({ readFileBytes: mocks.readFileBytes }));
vi.mock('./apiAttachments', () => ({ uploadEncryptedBlob: mocks.uploadEncryptedBlob }));
vi.mock('@/auth/tokenStorage', () => ({ TokenStorage: { getCredentials: mocks.getCredentials } }));

import {
    discardRelationshipAdvisorImages,
    uploadRelationshipAdvisorImage,
    uploadRelationshipAdvisorImages,
    uploadRelationshipAdvisorHistory,
    saveRelationshipAdvisorImages,
} from './relationshipAdvisorImages';

const image = (id: string) => ({
    id,
    uri: `file:///${id}.jpg`,
    width: 100,
    height: 100,
    mimeType: 'image/jpeg',
    size: 3,
    name: `${id}.jpg`,
});

describe('uploadRelationshipAdvisorImage', () => {
    beforeEach(() => vi.clearAllMocks());
    it('reuploads a cached original onto its historical message without needing the picker URI', async () => {
        const bytes = new Uint8Array([8, 9]);
        mocks.readAdvisorImage.mockResolvedValue(bytes);
        mocks.getCredentials.mockResolvedValue({ token: 'test', secret: 'test' });
        mocks.request.mockImplementation(async () => new Response(JSON.stringify({ ref: 'advisor/user-1/fresh.jpg', uploadUrl: 'https://oss.test', method: 'POST' })));
        const messages = await uploadRelationshipAdvisorHistory([
            { id: 'image', role: 'user', text: '', createdAt: 1, imageCount: 1, imageKeys: ['saved.jpg'] },
            { id: 'next', role: 'user', text: '刚才那张呢', createdAt: 2, imageCount: 0 },
        ], { isCancelled: () => false });
        expect(mocks.readAdvisorImage).toHaveBeenCalledWith('saved.jpg');
        expect(mocks.readFileBytes).not.toHaveBeenCalled();
        expect(messages).toEqual([
            { role: 'user', text: '', imageRefs: ['advisor/user-1/fresh.jpg'] },
            { role: 'user', text: '刚才那张呢' },
        ]);
        expect(mocks.uploadEncryptedBlob.mock.calls[0][1]).toEqual(bytes);
    });

    it('saves bounded original bytes and removes a partial local batch on failure', async () => {
        mocks.readFileBytes.mockResolvedValueOnce(new Uint8Array([1])).mockRejectedValueOnce(new Error('read failed'));
        mocks.deleteAdvisorImages.mockResolvedValue(undefined);
        await expect(saveRelationshipAdvisorImages([image('one'), image('two')], ['one.jpg', 'two.jpg'])).rejects.toThrow('read failed');
        expect(mocks.writeAdvisorImage).toHaveBeenCalledWith('one.jpg', new Uint8Array([1]));
        expect(mocks.deleteAdvisorImages).toHaveBeenCalledWith(['one.jpg', 'two.jpg']);
    });
    it('uploads normalized image bytes without applying session encryption', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const upload = {
            ref: 'advisor/user-1/12345678-1234-1234-1234-123456789abc.jpg',
            uploadUrl: 'https://oss.test/upload',
            method: 'POST' as const,
            formFields: { policy: 'signed' },
        };
        mocks.readFileBytes.mockResolvedValue(bytes);
        mocks.getCredentials.mockResolvedValue({ token: 'token', secret: 'secret' });
        mocks.request.mockResolvedValue(new Response(JSON.stringify(upload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));

        const ref = await uploadRelationshipAdvisorImage({
            id: 'image-1',
            uri: 'file:///normalized.jpg',
            width: 1200,
            height: 800,
            mimeType: 'image/jpeg',
            size: 3,
            name: 'chat.jpg',
        });

        expect(ref).toBe(upload.ref);
        expect(mocks.request).toHaveBeenCalledWith('/v1/relationship-advisor/images/request-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mimeType: 'image/jpeg', size: 3 }),
        });
        expect(mocks.uploadEncryptedBlob).toHaveBeenCalledWith(upload, bytes, { token: 'token', secret: 'secret' });
    });

    it('discards temporary refs after a cancelled or failed start', async () => {
        mocks.request.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
        const refs = ['advisor/user-1/12345678-1234-1234-1234-123456789abc.jpg'];

        await discardRelationshipAdvisorImages(refs);

        expect(mocks.request).toHaveBeenCalledWith('/v1/relationship-advisor/images', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refs }),
        });
    });

    it('cleans already-uploaded refs when a later image upload fails', async () => {
        const upload = vi.fn()
            .mockResolvedValueOnce('advisor/user-1/first.jpg')
            .mockRejectedValueOnce(new Error('upload failed'));
        const discard = vi.fn(async () => undefined);

        await expect(uploadRelationshipAdvisorImages(
            [image('first'), image('second')],
            { isCancelled: () => false },
            { upload, discard },
        )).rejects.toThrow('upload failed');

        expect(discard).toHaveBeenCalledWith(['advisor/user-1/first.jpg']);
    });

    it('stops the batch and cleans refs when cancellation arrives during upload', async () => {
        let cancelled = false;
        const upload = vi.fn(async () => {
            cancelled = true;
            return 'advisor/user-1/first.jpg';
        });
        const discard = vi.fn(async () => undefined);

        const result = await uploadRelationshipAdvisorImages(
            [image('first'), image('second')],
            { isCancelled: () => cancelled },
            { upload, discard },
        );

        expect(result).toBeNull();
        expect(upload).toHaveBeenCalledTimes(1);
        expect(discard).toHaveBeenCalledWith(['advisor/user-1/first.jpg']);
    });
});
