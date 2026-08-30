import {
    EncodingType,
    getInfoAsync,
    readAsStringAsync,
    StorageAccessFramework,
} from 'expo-file-system/legacy';
import { getImageDownloadFileName } from '@/utils/imageDownloadCore';

const COPY_CHUNK_BYTES = 768 * 1024;

/** Preserve every original byte by copying the staged file through Android's directory picker. */
export async function downloadOriginalAttachment(
    uri: string,
    fileName: string,
    mimeType: string,
): Promise<boolean> {
    const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return false;

    const safeFileName = getImageDownloadFileName({ uri, filename: fileName });
    const info = await getInfoAsync(uri);
    if (!info.exists || info.isDirectory) throw new Error('Original attachment is unavailable');
    const destination = await StorageAccessFramework.createFileAsync(
        permission.directoryUri,
        safeFileName,
        mimeType,
    );
    for (let position = 0; position < info.size; position += COPY_CHUNK_BYTES) {
        const base64 = await readAsStringAsync(uri, {
            encoding: EncodingType.Base64,
            position,
            length: Math.min(COPY_CHUNK_BYTES, info.size - position),
        });
        await StorageAccessFramework.writeAsStringAsync(destination, base64, {
            encoding: EncodingType.Base64,
            append: position > 0,
        });
    }
    return true;
}
