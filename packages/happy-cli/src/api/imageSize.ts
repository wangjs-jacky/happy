/**
 * Lightweight image dimension reader for PNG and JPEG byte buffers.
 *
 * Dependency-free: parses the PNG IHDR chunk and scans JPEG SOF (Start Of Frame)
 * markers. Used to attach real width/height to file events so the app renders
 * agent-sent images at their true aspect ratio instead of a 4:3 default.
 *
 * Returns null for anything it can't confidently parse (non-image, truncated,
 * or unsupported format) so callers can fall back to omitting dimensions.
 */
export function readImageSize(buf: Uint8Array): { width: number; height: number } | null {
    // PNG: 8-byte signature, then the IHDR chunk with width@16, height@20 (big-endian).
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }

    // JPEG: scan SOF0..SOF15 markers (0xFFC0..0xFFCF, excluding non-frame C4/C8/CC).
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let off = 2;
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        while (off + 9 < buf.length) {
            if (buf[off] !== 0xff) {
                off++;
                continue;
            }
            const marker = buf[off + 1];
            const len = dv.getUint16(off + 2);
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                const height = dv.getUint16(off + 5);
                const width = dv.getUint16(off + 7);
                return { width, height };
            }
            off += 2 + len;
        }
    }

    return null;
}
