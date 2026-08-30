import { downloadOriginalAttachment } from './downloadOriginalAttachment.android';

/** Save the staged MP4 through Android's directory picker using bounded chunks. */
export async function downloadVideoAttachment(
    uri: string,
    fileName: string,
    mimeType: string,
): Promise<boolean> {
    return downloadOriginalAttachment(uri, fileName, mimeType);
}
