import { describe, expect, it } from 'vitest';
import {
    createImageStyleGalleryColumns,
    getImageStyleGalleryItemType,
    getImageStylePreviewHeight,
} from './imageStyleGalleryLayout';
import { IMAGE_STYLE_PREVIEW_MANIFEST } from './imageStylePreviewManifest';

describe('imageStyleGalleryLayout', () => {
    it('keeps preview tiles proportional so portrait styles are not forced into row-height cards', () => {
        const landscape = IMAGE_STYLE_PREVIEW_MANIFEST['scenes-and-illustrations/concept-scene/1'];
        const portrait = IMAGE_STYLE_PREVIEW_MANIFEST['scenes-and-illustrations/concept-scene/2'];
        const cardWidth = 180;

        expect(getImageStyleGalleryItemType(landscape)).toBe('landscape');
        expect(getImageStyleGalleryItemType(portrait)).toBe('portrait');
        expect(getImageStylePreviewHeight(portrait, cardWidth)).toBeGreaterThan(getImageStylePreviewHeight(landscape, cardWidth));
        expect(getImageStylePreviewHeight(landscape, cardWidth)).toBeGreaterThanOrEqual(120);
        expect(getImageStylePreviewHeight(portrait, cardWidth)).toBeLessThanOrEqual(260);
    });

    it('splits styles into masonry columns without dropping or duplicating entries', () => {
        const styles = [
            { id: 'scenes-and-illustrations/concept-scene/1' },
            { id: 'scenes-and-illustrations/concept-scene/2' },
            { id: 'product-visuals/white-background-product/1' },
            { id: 'avatars-and-profile/style-transfer-selfie/1' },
        ];

        const columns = createImageStyleGalleryColumns(
            styles,
            180,
            (style) => IMAGE_STYLE_PREVIEW_MANIFEST[style.id],
        );

        expect(columns).toHaveLength(2);
        expect(columns.flat().map((style) => style.id).sort()).toEqual(styles.map((style) => style.id).sort());
        expect(columns.every((column) => column.length > 0)).toBe(true);
    });
});
