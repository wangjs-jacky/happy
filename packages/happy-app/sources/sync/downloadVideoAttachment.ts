import * as Sharing from 'expo-sharing';

/** Hand a staged video to the native save/share sheet. */
export async function downloadVideoAttachment(
    uri: string,
    fileName: string,
    mimeType: string,
): Promise<boolean> {
    if (!await Sharing.isAvailableAsync()) {
        throw new Error('Video sharing is unavailable');
    }
    await Sharing.shareAsync(uri, { dialogTitle: fileName, mimeType });
    return true;
}
