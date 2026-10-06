/**
 * Sends push notifications via Expo's HTTP Push API.
 * Direct HTTP POST — no expo-server-sdk dependency needed.
 * Sends one token per request so tokens from different Expo projects cannot
 * cause a mixed-project batch rejection.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 1;
const MAX_ATTEMPTS = 3;

export interface PushMessage {
    to: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
    sound?: 'default' | null;
    badge?: number;
    channelId?: string;
}

export interface PushTicket {
    status: 'ok' | 'error';
    id?: string;
    message?: string;
    details?: { error?: string };
}

export async function sendPushNotifications(messages: PushMessage[]): Promise<PushTicket[]> {
    if (messages.length === 0) {
        return [];
    }

    const tickets: PushTicket[] = [];

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const batch = messages.slice(i, i + BATCH_SIZE);
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(EXPO_PUSH_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(batch)
                });

                if (!response.ok) {
                    if ((response.status === 429 || response.status >= 500) && attempt + 1 < MAX_ATTEMPTS) {
                        await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
                        continue;
                    }
                    const errorBody = await response.json().catch(() => null) as { errors?: Array<{ code?: unknown }> } | null;
                    const code = errorBody?.errors?.[0]?.code;
                    const errorCode = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : undefined;
                    tickets.push({
                        status: 'error',
                        message: `HTTP ${response.status}`,
                        ...(errorCode ? { details: { error: errorCode } } : {})
                    });
                    break;
                }

                const result = await response.json() as { data: PushTicket[] };
                tickets.push(...result.data);
                break;
            } catch {
                if (attempt + 1 < MAX_ATTEMPTS) {
                    await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
                    continue;
                }
                tickets.push({ status: 'error', message: 'Network error' });
            }
        }
    }

    return tickets;
}
