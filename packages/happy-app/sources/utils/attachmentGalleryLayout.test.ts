import { describe, expect, it } from 'vitest';
import {
    computeAttachmentGalleryImageSize,
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
        })).toEqual({ width: 100, height: 100 });
    });

    it('uses the available width for featured landscape images while preserving aspect ratio', () => {
        expect(computeAttachmentGalleryImageSize({
            presentation: 'featured',
            sourceWidth: 1600,
            sourceHeight: 900,
            maxWidth: 360,
            maxHeight: 480,
        })).toEqual({ width: 360, height: 203 });
    });

    it('caps featured portrait images by height while preserving aspect ratio', () => {
        expect(computeAttachmentGalleryImageSize({
            presentation: 'featured',
            sourceWidth: 900,
            sourceHeight: 1600,
            maxWidth: 360,
            maxHeight: 480,
        })).toEqual({ width: 270, height: 480 });
    });

    it('uses a stable default aspect ratio for featured images without metadata', () => {
        expect(computeAttachmentGalleryImageSize({
            presentation: 'featured',
            maxWidth: 360,
            maxHeight: 480,
        })).toEqual({ width: 360, height: 270 });
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
});
