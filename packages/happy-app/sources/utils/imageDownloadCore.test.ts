import { describe, expect, it } from 'vitest';
import { getImageDownloadFileName } from './imageDownloadCore';

describe('image download filename helpers', () => {
    it('prefers and sanitizes an explicit filename', () => {
        expect(getImageDownloadFileName({
            uri: 'file:///tmp/generated.png',
            filename: 'July: preview/image?.png',
        })).toBe('July_ preview_image_.png');
    });

    it('falls back to the decoded URL path basename', () => {
        expect(getImageDownloadFileName({
            uri: 'https://cdn.example.com/assets/final%20render.webp?token=abc',
        })).toBe('final render.webp');
    });

    it('uses the data URI image type when no filename is available', () => {
        expect(getImageDownloadFileName({
            uri: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ',
        })).toBe('happy-image.jpg');
    });
});
