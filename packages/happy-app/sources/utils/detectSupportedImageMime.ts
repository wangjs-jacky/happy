/**
 * Sniff an image's media type from its magic-byte header.
 *
 * The vision models (and therefore the CLI runners that feed them) only accept
 * png/jpeg/gif/webp. The wire-supplied mimeType is unreliable — phone pickers
 * happily report "image/jpeg" for a HEIC file — so callers must sniff the actual
 * bytes. Kept byte-for-byte in sync with the CLI's `detectCodexImage` /
 * `detectClaudeImageMime` allow-list so the app and CLI agree on what's readable.
 */

export type SupportedImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * Returns the detected mime, or null when the bytes don't match a format the
 * vision models accept (e.g. HEIC/HEIF), signalling the image must be transcoded.
 */
export function detectSupportedImageMime(bytes: Uint8Array): SupportedImageMime | null {
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'image/jpeg';
    }
    if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'image/gif';
    }
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
        return 'image/webp';
    }
    return null;
}
