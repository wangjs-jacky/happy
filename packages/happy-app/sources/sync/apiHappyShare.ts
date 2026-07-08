import { AuthCredentials } from '@/auth/tokenStorage';
import { getHappyClientId } from './apiSocket';
import { getServerUrl } from './serverConfig';

export type HappySessionShareResult = {
    id: string;
    url: string;
};

export async function publishHappySessionShare(
    credentials: AuthCredentials,
    input: { html: string; title?: string },
): Promise<HappySessionShareResult> {
    const API_ENDPOINT = getServerUrl();
    const response = await fetch(`${API_ENDPOINT}/v1/share/session`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
            'X-Happy-Client': getHappyClientId(),
        },
        body: JSON.stringify(input),
    });

    if (!response.ok) {
        let message = `Failed to publish Happy share page: ${response.status}`;
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

    return await response.json() as HappySessionShareResult;
}
