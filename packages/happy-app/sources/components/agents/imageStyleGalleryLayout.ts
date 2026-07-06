import type { ImageStylePreviewEntry } from './imageStylePreviewManifest';

export const IMAGE_STYLE_GALLERY_COLUMN_COUNT = 2;
export const IMAGE_STYLE_GALLERY_COLUMN_GAP = 10;
export const IMAGE_STYLE_GALLERY_MIN_PREVIEW_HEIGHT = 120;
export const IMAGE_STYLE_GALLERY_MAX_PREVIEW_HEIGHT = 260;
const ESTIMATED_CARD_COPY_HEIGHT = 126;

export type ImageStyleGalleryItemType = 'landscape' | 'portrait' | 'square';

export function getImageStylePreviewHeight(preview: ImageStylePreviewEntry, cardWidth: number) {
    if (preview.width <= 0 || preview.height <= 0 || cardWidth <= 0) {
        return IMAGE_STYLE_GALLERY_MIN_PREVIEW_HEIGHT;
    }

    const proportionalHeight = Math.round((cardWidth * preview.height) / preview.width);
    return Math.min(
        IMAGE_STYLE_GALLERY_MAX_PREVIEW_HEIGHT,
        Math.max(IMAGE_STYLE_GALLERY_MIN_PREVIEW_HEIGHT, proportionalHeight),
    );
}

export function getImageStyleGalleryItemType(preview: ImageStylePreviewEntry): ImageStyleGalleryItemType {
    const ratio = preview.height / preview.width;

    if (ratio >= 1.12) {
        return 'portrait';
    }

    if (ratio <= 0.88) {
        return 'landscape';
    }

    return 'square';
}

export function createImageStyleGalleryColumns<T>(
    items: readonly T[],
    cardWidth: number,
    getPreview: (item: T) => ImageStylePreviewEntry | undefined,
) {
    const columns = Array.from({ length: IMAGE_STYLE_GALLERY_COLUMN_COUNT }, () => [] as T[]);
    const columnHeights = Array.from({ length: IMAGE_STYLE_GALLERY_COLUMN_COUNT }, () => 0);

    for (const item of items) {
        const targetColumnIndex = columnHeights.indexOf(Math.min(...columnHeights));
        const preview = getPreview(item);
        const previewHeight = preview ? getImageStylePreviewHeight(preview, cardWidth) : IMAGE_STYLE_GALLERY_MIN_PREVIEW_HEIGHT;

        columns[targetColumnIndex].push(item);
        columnHeights[targetColumnIndex] += previewHeight + ESTIMATED_CARD_COPY_HEIGHT;
    }

    return columns;
}
