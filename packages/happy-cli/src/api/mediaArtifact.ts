import { extname, isAbsolute } from 'node:path';

export type MediaArtifactKind = 'audio' | 'video';

export type MediaArtifactDescriptor = {
    kind: MediaArtifactKind;
    mimeType: string;
};

const MEDIA_TYPES: Readonly<Record<string, MediaArtifactDescriptor>> = {
    '.mp4': { kind: 'video', mimeType: 'video/mp4' },
    '.m4v': { kind: 'video', mimeType: 'video/x-m4v' },
    '.mov': { kind: 'video', mimeType: 'video/quicktime' },
    '.webm': { kind: 'video', mimeType: 'video/webm' },
    '.mp3': { kind: 'audio', mimeType: 'audio/mpeg' },
    '.m4a': { kind: 'audio', mimeType: 'audio/mp4' },
    '.aac': { kind: 'audio', mimeType: 'audio/aac' },
    '.wav': { kind: 'audio', mimeType: 'audio/wav' },
    '.flac': { kind: 'audio', mimeType: 'audio/flac' },
    '.ogg': { kind: 'audio', mimeType: 'audio/ogg' },
    '.opus': { kind: 'audio', mimeType: 'audio/opus' },
};

/** Resolve a local artifact to the media lane supported by Happy chat cards. */
export function resolveMediaArtifact(filePath: string, requestedMimeType?: string): MediaArtifactDescriptor {
    if (!isAbsolute(filePath)) {
        throw new Error('send_file requires an absolute local file path');
    }

    const byExtension = MEDIA_TYPES[extname(filePath).toLowerCase()];
    const explicit = requestedMimeType?.trim().toLowerCase();
    if (explicit) {
        const kind = explicit.startsWith('video/')
            ? 'video'
            : explicit.startsWith('audio/')
                ? 'audio'
                : null;
        if (!kind) {
            throw new Error(`Unsupported media type: ${requestedMimeType}`);
        }
        if (byExtension && byExtension.kind !== kind) {
            throw new Error(`Media type ${requestedMimeType} does not match ${extname(filePath)}`);
        }
        return { kind, mimeType: explicit };
    }

    if (!byExtension) {
        throw new Error(`Unsupported media file: ${extname(filePath) || '(no extension)'}`);
    }
    return byExtension;
}
