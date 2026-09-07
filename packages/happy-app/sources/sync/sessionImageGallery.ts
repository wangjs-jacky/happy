import type { Message } from './typesMessage';
import type { ImageViewerSource } from './imageViewer';

/** Build from session history, not mounted rows or already decrypted thumbnails. */
export function collectSessionImageGallery(sessionId: string, messages: readonly Message[]): ImageViewerSource[] {
    const files: Message[] = [];
    const visit = (message: Message) => {
        if (message.kind !== 'tool-call') return;
        if (message.tool.name === 'file') files.push(message);
        message.children.forEach(visit);
    };
    // Storage is newest-first, including ties. Match the chat's reversed runs.
    [...messages].reverse().forEach(visit);
    files.sort((a, b) => a.createdAt - b.createdAt);
    const seen = new Set<string>();
    const sources: ImageViewerSource[] = [];
    for (const message of files) {
        if (message.kind !== 'tool-call') continue;
        const input = message.tool.input;
        if (!input || typeof input.ref !== 'string' || !input.ref || typeof input.name !== 'string') continue;
        if (input.kind !== undefined && input.kind !== 'image') continue;
        if (seen.has(input.ref)) continue;
        seen.add(input.ref);
        sources.push({
            uri: '',
            sessionId,
            attachmentRef: input.ref,
            filename: input.name,
            width: input.image?.width,
            height: input.image?.height,
            motionPhoto: input.motionPhoto,
        });
    }
    return sources;
}
