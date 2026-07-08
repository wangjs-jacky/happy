import { AuthCredentials } from '@/auth/tokenStorage';
import { getHappyClientId } from './apiSocket';
import { getServerUrl } from './serverConfig';

export type OpenBirdShareImage = {
    width: number;
    height: number;
    thumbhash: string;
    path: string;
    url: string;
};

export async function uploadOpenBirdShareImage(
    credentials: AuthCredentials,
    image: { bytes: Uint8Array; mimeType: string },
): Promise<OpenBirdShareImage> {
    const API_ENDPOINT = getServerUrl();
    const body = new ArrayBuffer(image.bytes.byteLength);
    new Uint8Array(body).set(image.bytes);

    const response = await fetch(`${API_ENDPOINT}/v1/openbird/share-image`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/octet-stream',
            'X-Happy-Image-Type': image.mimeType,
            'X-Happy-Client': getHappyClientId(),
        },
        body,
    });

    if (!response.ok) {
        let message = `Failed to upload OpenBird share image: ${response.status}`;
        try {
            const data = await response.json();
            if (typeof data?.error === 'string') {
                message = data.error;
            }
        } catch {
            // Keep the status-based fallback.
        }
        throw new Error(message);
    }

    const data = await response.json() as { image: OpenBirdShareImage };
    return data.image;
}
