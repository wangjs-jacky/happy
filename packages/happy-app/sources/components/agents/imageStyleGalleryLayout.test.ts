import { describe, expect, it } from 'vitest';
import {
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
});
