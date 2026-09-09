import { expect, it, vi } from 'vitest';
import { resolveMediaAttachmentSource } from './resolveMediaAttachmentSource.web';
const mocks = vi.hoisted(() => ({ request: vi.fn(), current: true }));
vi.mock('./sync', () => ({ sync: { getCredentials: () => ({ token: 'token' }) } }));
vi.mock('./apiAttachments', () => ({ requestAttachmentDownloadSource: mocks.request, downloadEncryptedAttachment: vi.fn() }));
vi.mock('./createMediaPlaybackSource', () => ({ createMediaPlaybackSource: vi.fn() }));
vi.mock('@/encryption/blob', () => ({ decryptBlob: vi.fn() }));
vi.mock('./attachmentCacheContext', () => ({ captureAttachmentContext: () => ({ key: 'owner-generation', server: 'https://api.test',
    assertCurrent: async () => { if (!mocks.current) throw new Error('expired'); } }) }));
it('provides ownership-scoped identity and forced error refresh for streaming media', async () => {
    mocks.current = true;
    mocks.request.mockResolvedValue({ uri: 'https://objects.test/video.mp4', headers: {} });
    const source = await resolveMediaAttachmentSource({ sessionId: 's', ref: 'ref', mimeType: 'video/mp4', encrypted: false });
    expect(source.reuseKey).toBe(JSON.stringify(['https://api.test', 'owner-generation', 'ref']));
    await source.refreshSource!();
    expect(mocks.request).toHaveBeenLastCalledWith({ token: 'token' }, 's', 'ref', { forceRefresh: true });
    mocks.current = false;
    await expect(source.refreshSource!()).rejects.toThrow('expired');
});
