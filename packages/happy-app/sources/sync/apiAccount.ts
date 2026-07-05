import { AuthCredentials } from '@/auth/tokenStorage';
import { getHappyClientId } from './apiSocket';
import { getServerUrl } from './serverConfig';
import { readFileBytes } from '@/utils/readFileBytes';
import type { ImageRef } from './profile';

export async function updateAccountProfile(
    credentials: AuthCredentials,
    profile: { name: string },
): Promise<{ firstName: string | null; lastName: string | null }> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/account/profile`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
            'X-Happy-Client': getHappyClientId(),
        },
        body: JSON.stringify(profile),
    });

    if (!response.ok) {
        let message = `Failed to update profile: ${response.status}`;
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

    const data = await response.json() as {
        success: true;
        firstName: string | null;
        lastName: string | null;
    };
    return {
        firstName: data.firstName,
        lastName: data.lastName,
    };
}

export async function uploadProfileAvatar(
    credentials: AuthCredentials,
    image: { uri: string; mimeType?: string | null },
): Promise<ImageRef> {
    const API_ENDPOINT = getServerUrl();
    const bytes = await readFileBytes(image.uri);
    const body = new Uint8Array(bytes).buffer;

    const response = await fetch(`${API_ENDPOINT}/v1/account/avatar`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/octet-stream',
            ...(image.mimeType ? { 'X-Happy-Image-Type': image.mimeType } : {}),
            'X-Happy-Client': getHappyClientId(),
        },
        body,
    });

    if (!response.ok) {
        let message = `Failed to update avatar: ${response.status}`;
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

    const data = await response.json() as { avatar: ImageRef };
    return data.avatar;
}
