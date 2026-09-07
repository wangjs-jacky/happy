import { describe, expect, it } from 'vitest';
import {
    computeAttachmentGalleryImageSize,
    computeGeneratedAttachmentGridLayout,
    computeInputAttachmentImageSize,
    formatPendingImageElapsed,
} from './attachmentGalleryLayout';

describe('computeAttachmentGalleryImageSize', () => {
    it('keeps compact gallery images as square thumbnails', () => {
        expect(computeAttachmentGalleryImageSize({
            presentation: 'compact',
            sourceWidth: 1600,
            sourceHeight: 900,
            maxWidth: 360,
            maxHeight: 480,
        })).toEqual({ width: 120, height: 120 });
    });

    it('uses the same thumbnail frame for featured landscape images', () => {
        expect(computeAttachmentGalleryImageSize({
            presentation: 'featured',
            sourceWidth: 1600,
            sourceHeight: 900,
            maxWidth: 360,
            maxHeight: 480,
        })).toEqual({ width: 120, height: 120 });
    });

    it('uses the same thumbnail frame for featured portrait images', () => {
        expect(computeAttachmentGalleryImageSize({
            presentation: 'featured',
            sourceWidth: 900,
            sourceHeight: 1600,
            maxWidth: 360,
            maxHeight: 480,
        })).toEqual({ width: 120, height: 120 });
    });

    it('keeps the frame size stable without metadata', () => {
        expect(computeAttachmentGalleryImageSize({
            presentation: 'featured',
            maxWidth: 360,
            maxHeight: 480,
        })).toEqual({ width: 120, height: 120 });
    });

    it('keeps regular input attachments compact but enlarges GPT Image input attachments by aspect ratio', () => {
        expect(computeInputAttachmentImageSize({
            presentation: 'compact',
            sourceWidth: 1600,
            sourceHeight: 900,
            maxWidth: 320,
            maxHeight: 220,
        })).toEqual({ width: 72, height: 72 });

        expect(computeInputAttachmentImageSize({
            presentation: 'featured',
            sourceWidth: 1600,
            sourceHeight: 900,
            maxWidth: 320,
            maxHeight: 220,
        })).toEqual({ width: 320, height: 180 });
    });

    it('formats pending image elapsed time for loading placeholders', () => {
        expect(formatPendingImageElapsed(0)).toBe('0s');
        expect(formatPendingImageElapsed(56_400)).toBe('56s');
        expect(formatPendingImageElapsed(83_000)).toBe('1m23s');
        expect(formatPendingImageElapsed(3_660_000)).toBe('1h01m');
    });

    it('packs generated thumbnails into a bounded responsive grid without horizontal overflow', () => {
        const phoneLayout = computeGeneratedAttachmentGridLayout({ containerWidth: 360 });
        expect(phoneLayout).toEqual({
            columns: 2,
            itemSize: 120,
            contentWidth: 248,
            gap: 8,
            horizontalPadding: 12,
        });

        const widePhoneLayout = computeGeneratedAttachmentGridLayout({ containerWidth: 390 });
        expect(widePhoneLayout).toEqual({
            columns: 2,
            itemSize: 120,
            contentWidth: 248,
            gap: 8,
            horizontalPadding: 12,
        });

        const desktopLayout = computeGeneratedAttachmentGridLayout({ containerWidth: 800 });
        expect(desktopLayout).toEqual({
            columns: 6,
            itemSize: 120,
            contentWidth: 760,
            gap: 8,
            horizontalPadding: 12,
        });

        for (const [containerWidth, layout] of [
            [360, phoneLayout],
            [390, widePhoneLayout],
            [800, desktopLayout],
        ] as const) {
            expect(layout.contentWidth + layout.horizontalPadding * 2).toBeLessThanOrEqual(containerWidth);
        }
    });
});
