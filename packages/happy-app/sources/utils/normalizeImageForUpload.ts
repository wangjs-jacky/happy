/**
 * Normalize a picked image into a vision-model-readable format before upload.
 *
 * Phone photo libraries hand back HEIC/HEIF originals (iOS default, and some
 * Android devices), whose bytes GPT/Claude vision cannot decode. The CLI runners
 * (`codexImageInput.ts` / `claudeRemoteLauncher.ts`) sniff magic bytes and
 * silently DROP anything that isn't png/jpeg/gif/webp — so a HEIC attachment
 * reaches the model as "no image at all", and the user is told their reference
 * image wasn't detected even though they clearly attached one.
 *
 * We sniff the same magic bytes here (mirroring the CLI's allow-list) and only
 * transcode when the format is unsupported: already-readable formats are passed
 * through untouched so screenshot text stays sharp, while HEIC/HEIF/etc. are
 * re-encoded to JPEG via the phone's native decoder. This fixes both the Claude
 * and Codex paths at the source, since after this the uploaded bytes are always
 * a format the models accept.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { readFileBytes } from '@/utils/readFileBytes';
import { detectSupportedImageMime, type SupportedImageMime } from '@/utils/detectSupportedImageMime';

export type NormalizedImage = {
    uri: string;
    mimeType: SupportedImageMime;
    /** Byte size of the (possibly re-encoded) image — accurate even when the picker reports 0. */
    size: number;
    width: number;
    height: number;
};

/**
 * Read the image at `uri`, and if its bytes aren't a vision-readable format,
 * transcode to JPEG. Throws when the file can't be read or transcoded, so callers
 * can surface a clear failure instead of silently shipping an unreadable image.
 */
export async function normalizeImageForUpload(uri: string, width: number, height: number): Promise<NormalizedImage> {
    const bytes = await readFileBytes(uri);
    const detected = detectSupportedImageMime(bytes);
    if (detected) {
        // Already vision-readable — keep the original bytes untouched (no recompression).
        return { uri, mimeType: detected, size: bytes.length, width, height };
    }

    // Unsupported (HEIC/HEIF/…): re-encode to JPEG using the platform's native decoder.
    const rendered = await ImageManipulator.manipulate(uri).renderAsync();
    const result = await rendered.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
    const convertedBytes = await readFileBytes(result.uri);
    return {
        uri: result.uri,
        mimeType: 'image/jpeg',
        size: convertedBytes.length,
        width: result.width || width,
        height: result.height || height,
    };
}
