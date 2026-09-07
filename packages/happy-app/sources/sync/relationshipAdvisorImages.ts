import { TokenStorage } from '@/auth/tokenStorage';
import { readFileBytes } from '@/utils/readFileBytes';
import type { AttachmentPreview } from './attachmentTypes';
import { uploadEncryptedBlob, type RequestUploadResult } from './apiAttachments';
import { apiSocket } from './apiSocket';
import { readAdvisorImage, writeAdvisorImage, deleteAdvisorImages } from './relationshipAdvisorImageCache';
import type { RelationshipAdvisorChatMessage } from '@/components/relationship-advisor/relationshipAdvisorChatModel';
import type { RelationshipAdvisorMessage } from './relationshipAdvisorClient';

export const MAX_RELATIONSHIP_ADVISOR_IMAGE_SIZE = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface RelationshipAdvisorImageBatchDependencies {
    upload: typeof uploadRelationshipAdvisorImage;
    discard: typeof discardRelationshipAdvisorImages;
}

export async function discardRelationshipAdvisorImages(refs: string[]): Promise<void> {
    if (refs.length === 0) return;
    const response = await apiSocket.request('/v1/relationship-advisor/images', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refs }),
    });
    if (!response.ok) {
        throw new Error(`Relationship advisor image cleanup failed: ${response.status}`);
    }
}

export async function uploadRelationshipAdvisorImage(image: AttachmentPreview): Promise<string> {
    if ((image.kind && image.kind !== 'image') || !SUPPORTED_IMAGE_MIME_TYPES.has(image.mimeType)) {
        throw new Error('Unsupported relationship advisor image');
    }

    const bytes = await readFileBytes(image.uri, MAX_RELATIONSHIP_ADVISOR_IMAGE_SIZE);
    return uploadRelationshipAdvisorBytes(bytes, image.mimeType);
}

async function uploadRelationshipAdvisorBytes(bytes: Uint8Array, mimeType: string): Promise<string> {
    const response = await apiSocket.request('/v1/relationship-advisor/images/request-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType, size: bytes.length }),
    });
    if (!response.ok) {
        throw new Error(`Relationship advisor image upload request failed: ${response.status}`);
    }

    const upload = await response.json() as RequestUploadResult;
    const credentials = await TokenStorage.getCredentials();
    if (!credentials) throw new Error('Authentication credentials are unavailable');

    // The helper handles presigned POST and authenticated local PUT transports.
    // These bytes are intentionally plaintext; no session key exists in this lane.
    await uploadEncryptedBlob(upload, bytes, credentials);
    return upload.ref;
}

export function relationshipAdvisorImageKeys(requestId: string, images: AttachmentPreview[]): string[] {
    return images.map((image, index) => {
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.mimeType];
        if (!extension) throw new Error('Unsupported image');
        return `${requestId}-${index}.${extension}`;
    });
}

/** Save originals before uploading temporary copies, so every retry can read the same images. */
export async function saveRelationshipAdvisorImages(images: AttachmentPreview[], keys: string[]): Promise<void> {
    try {
        for (let index = 0; index < images.length; index++) {
            await writeAdvisorImage(keys[index], await readFileBytes(images[index].uri, MAX_RELATIONSHIP_ADVISOR_IMAGE_SIZE));
        }
    } catch (error) {
        await deleteAdvisorImages(keys).catch(() => undefined);
        throw error;
    }
}

/** Resend up to four recent images on their original messages using fresh temporary uploads. */
export async function uploadRelationshipAdvisorHistory(
    messages: RelationshipAdvisorChatMessage[],
    options: { isCancelled: () => boolean },
): Promise<RelationshipAdvisorMessage[] | null> {
    const includedKeys = new Set(messages.flatMap((message) => message.role === 'user' ? message.imageKeys ?? [] : []).slice(-4));
    const uploadedRefs: string[] = [];
    try {
        const result: RelationshipAdvisorMessage[] = [];
        for (const message of messages) {
            const refs: string[] = [];
            for (const key of message.imageKeys ?? []) {
                if (!includedKeys.has(key) || message.role !== 'user') continue;
                if (options.isCancelled()) break;
                const mimeType = key.endsWith('.jpg') ? 'image/jpeg' : key.endsWith('.png') ? 'image/png' : 'image/webp';
                const ref = await uploadRelationshipAdvisorBytes(await readAdvisorImage(key), mimeType);
                uploadedRefs.push(ref);
                refs.push(ref);
            }
            if (options.isCancelled()) {
                await discardRelationshipAdvisorImages(uploadedRefs);
                return null;
            }
            const omitted = message.imageCount - refs.length;
            result.push({
                role: message.role,
                text: (omitted > 0
                    ? `${message.text}\n[${omitted} earlier image(s) are unavailable in this request. Ask for reattachment if needed; do not infer their contents.]`
                    : message.text).slice(0, 8_000),
                ...(refs.length ? { imageRefs: refs } : {}),
            });
        }
        return result;
    } catch (error) {
        await discardRelationshipAdvisorImages(uploadedRefs).catch(() => undefined);
        throw error;
    }
}

export async function uploadRelationshipAdvisorImages(
    images: AttachmentPreview[],
    options: { isCancelled: () => boolean },
    dependencies: RelationshipAdvisorImageBatchDependencies = {
        upload: uploadRelationshipAdvisorImage,
        discard: discardRelationshipAdvisorImages,
    },
): Promise<string[] | null> {
    const refs: string[] = [];
    try {
        for (const image of images) {
            if (options.isCancelled()) {
                await dependencies.discard(refs);
                return null;
            }
            refs.push(await dependencies.upload(image));
            if (options.isCancelled()) {
                await dependencies.discard(refs);
                return null;
            }
        }
        return refs;
    } catch (error) {
        await dependencies.discard(refs).catch(() => undefined);
        throw error;
    }
}
