export type AttachmentGalleryPresentation = 'compact' | 'featured';

const COMPACT_THUMB_SIZE = 100;
const COMPACT_INPUT_THUMB_SIZE = 72;
const DEFAULT_FEATURED_ASPECT = 4 / 3;

export function computeAttachmentGalleryImageSize(args: {
    presentation: AttachmentGalleryPresentation;
    sourceWidth?: number;
    sourceHeight?: number;
    maxWidth: number;
    maxHeight: number;
}): { width: number; height: number } {
    if (args.presentation === 'compact') {
        return { width: COMPACT_THUMB_SIZE, height: COMPACT_THUMB_SIZE };
    }

    const aspect = args.sourceWidth && args.sourceWidth > 0 && args.sourceHeight && args.sourceHeight > 0
        ? args.sourceWidth / args.sourceHeight
        : DEFAULT_FEATURED_ASPECT;
    let width = args.maxWidth;
    let height = width / aspect;
    if (height > args.maxHeight) {
        height = args.maxHeight;
        width = height * aspect;
    }

    return {
        width: Math.round(width),
        height: Math.round(height),
    };
}

export function computeInputAttachmentImageSize(args: {
    presentation: AttachmentGalleryPresentation;
    sourceWidth?: number;
    sourceHeight?: number;
    maxWidth: number;
    maxHeight: number;
}): { width: number; height: number } {
    if (args.presentation === 'compact') {
        return { width: COMPACT_INPUT_THUMB_SIZE, height: COMPACT_INPUT_THUMB_SIZE };
    }

    return computeAttachmentGalleryImageSize(args);
}

export function formatPendingImageElapsed(elapsedMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }

    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) {
        return `${totalMinutes}m${seconds.toString().padStart(2, '0')}s`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h${minutes.toString().padStart(2, '0')}m`;
}
