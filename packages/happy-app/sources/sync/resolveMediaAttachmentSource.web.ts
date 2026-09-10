import { decryptBlob } from '@/encryption/blob';
import { sync } from './sync';
import { captureAttachmentContext } from './attachmentCacheContext';
import {
    downloadEncryptedAttachment,
    requestAttachmentDownloadSource,
} from './apiAttachments';
import { createMediaPlaybackSource } from './createMediaPlaybackSource';
import type { MediaPlaybackSource } from './mediaPlaybackSourceTypes';
import type { ResolveMediaAttachmentSourceInput } from './resolveMediaAttachmentSource';

/** Web can stream plaintext media from its signed URL instead of caching it. */
export async function resolveMediaAttachmentSource(
    input: ResolveMediaAttachmentSourceInput,
): Promise<MediaPlaybackSource> {
    const credentials = sync.getCredentials();
    if (!credentials) throw new Error('Attachment credentials are unavailable');

    if (input.encrypted === false) {
        const context = captureAttachmentContext(credentials, input.sessionId);
        const resolve = async (forceRefresh = false): Promise<MediaPlaybackSource> => {
            await context.assertCurrent();
            const source = await requestAttachmentDownloadSource(credentials, input.sessionId, input.ref, { forceRefresh });
            await context.assertCurrent();
            return { ...source, isCurrent: context.isCurrent, reuseKey: JSON.stringify([context.server, context.key, input.ref]),
                refreshSource: () => resolve(true) };
        };
        return resolve();
    }

    const blobKey = sync.encryption.getSessionBlobKey(input.sessionId);
    if (!blobKey || blobKey.length !== 32) {
        throw new Error('Attachment key is unavailable');
    }
    const encrypted = await downloadEncryptedAttachment(credentials, input.sessionId, input.ref);
    const decrypted = decryptBlob(encrypted, blobKey);
    if (!decrypted) throw new Error('Attachment decryption failed');
    return createMediaPlaybackSource(decrypted, input.mimeType);
}
