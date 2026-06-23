import { describe, it, expect } from 'vitest';
import { createEnvelope, sessionEnvelopeSchema } from '@slopus/happy-wire';
import { readImageSize } from './imageSize';

describe('readImageSize', () => {
    it('reads PNG dimensions from IHDR', () => {
        const png = new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x0d, 0x00, 0x00, 0x00, 0x25,
            0x08, 0x06, 0x00, 0x00, 0x00,
        ]);
        expect(readImageSize(png)).toEqual({ width: 13, height: 37 });
    });

    it('reads JPEG dimensions from a hand-crafted SOF0 segment', () => {
        // Minimal JPEG: SOI (FFD8) + SOF0 (FFC0) segment.
        // SOF0 layout after the marker: length(2) precision(1) height(2) width(2) ...
        // length = 0x0011 (17), precision = 8, height = 0x0025 (37), width = 0x000d (13)
        const jpeg = new Uint8Array([
            0xff, 0xd8,                   // SOI
            0xff, 0xc0,                   // SOF0 marker
            0x00, 0x11,                   // segment length = 17
            0x08,                         // precision = 8
            0x00, 0x25,                   // height = 37
            0x00, 0x0d,                   // width = 13
            0x03,                         // num components
            0x01, 0x22, 0x00,             // component 1
            0x02, 0x11, 0x01,             // component 2
            0x03, 0x11, 0x01,             // component 3
        ]);
        expect(readImageSize(jpeg)).toEqual({ width: 13, height: 37 });
    });

    it('skips non-SOF JPEG segments before reaching SOF0', () => {
        // SOI + an APP0 (FFE0) segment that must be skipped, then SOF0.
        const jpeg = new Uint8Array([
            0xff, 0xd8,                   // SOI
            0xff, 0xe0,                   // APP0 marker (must skip)
            0x00, 0x06,                   // APP0 length = 6
            0x4a, 0x46, 0x49, 0x46,       // 4 bytes of payload
            0xff, 0xc0,                   // SOF0 marker
            0x00, 0x11,                   // length = 17
            0x08,                         // precision
            0x01, 0x00,                   // height = 256
            0x02, 0x00,                   // width = 512
            0x03,
            0x01, 0x22, 0x00,
            0x02, 0x11, 0x01,
            0x03, 0x11, 0x01,
        ]);
        expect(readImageSize(jpeg)).toEqual({ width: 512, height: 256 });
    });

    it('returns null for unknown formats', () => {
        expect(readImageSize(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    });
});

describe('thumbhash:"" wire validity', () => {
    it('file event with image{thumbhash:""} is schema-valid', () => {
        const env = createEnvelope('user', {
            t: 'file',
            ref: 'r',
            name: 'n.png',
            size: 1,
            image: { width: 13, height: 37, thumbhash: '' },
        });
        expect(sessionEnvelopeSchema.safeParse(env).success).toBe(true);
    });
});
