import { describe, expect, it } from 'vitest';
import { detectSupportedImageMime } from './detectSupportedImageMime';

const withHeader = (header: number[], padTo = 16): Uint8Array => {
    const bytes = new Uint8Array(padTo);
    bytes.set(header);
    return bytes;
};

describe('detectSupportedImageMime', () => {
    it('detects PNG', () => {
        expect(detectSupportedImageMime(withHeader([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]))).toBe('image/png');
    });

    it('detects JPEG', () => {
        expect(detectSupportedImageMime(withHeader([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('image/jpeg');
    });

    it('detects GIF', () => {
        expect(detectSupportedImageMime(withHeader([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    });

    it('detects WEBP (RIFF….WEBP)', () => {
        // "RIFF" + 4-byte size + "WEBP"
        expect(detectSupportedImageMime(withHeader([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    });

    it('rejects HEIC (ISO-BMFF ftyp), the format that silently broke reference images', () => {
        // "....ftypheic" — byte layout of a real HEIC header. Not vision-readable → must return null.
        const heic = withHeader([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
        expect(detectSupportedImageMime(heic)).toBeNull();
    });

    it('rejects a RIFF container that is not WEBP', () => {
        expect(detectSupportedImageMime(withHeader([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20]))).toBeNull();
    });

    it('returns null for empty / too-short input', () => {
        expect(detectSupportedImageMime(new Uint8Array([]))).toBeNull();
        expect(detectSupportedImageMime(new Uint8Array([0xFF, 0xD8]))).toBeNull();
    });
});
