/**
 * Sends push notifications via Expo's HTTP Push API.
 * Direct HTTP POST — no expo-server-sdk dependency needed.
 * Sends one token per request so tokens from different Expo projects cannot
 * cause a mixed-project batch rejection.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_CONCURRENT_REQUESTS = 6;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

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

function safeErrorCode(value: unknown): string | undefined {
    return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

function normalizeTicket(value: unknown): PushTicket {
    if (!value || typeof value !== 'object') {
        return { status: 'error', message: 'Malformed Expo response' };
    }
    const ticket = value as { status?: unknown; id?: unknown; details?: { error?: unknown } };
    if (ticket.status === 'ok' && typeof ticket.id === 'string') {
        return { status: 'ok', id: ticket.id };
    }
    if (ticket.status === 'error') {
        // Expo's ticket message can contain the complete device token. Only
        // retain its validated error code, which pushDispatch uses for cleanup.
        const errorCode = safeErrorCode(ticket.details?.error);
        return {
            status: 'error',
            message: 'Expo ticket error',
            ...(errorCode ? { details: { error: errorCode } } : {})
        };
    }
    return { status: 'error', message: 'Malformed Expo response' };
}

async function requestWithTimeout(message: PushMessage): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            fetch(EXPO_PUSH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([message]),
                // Expo's global fetch type uses a different AbortSignal declaration.
                signal: controller.signal as unknown as RequestInit['signal']
            }),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error('Expo request timed out'));
                }, REQUEST_TIMEOUT_MS);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function sendSingle(message: PushMessage): Promise<PushTicket> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            const response = await requestWithTimeout(message);
            if (!response.ok) {
                if ((response.status === 429 || response.status >= 500) && attempt + 1 < MAX_ATTEMPTS) {
                    await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
                    continue;
                }
                const errorBody = await response.json().catch(() => null) as { errors?: Array<{ code?: unknown }> } | null;
                const errorCode = safeErrorCode(errorBody?.errors?.[0]?.code);
                return {
                    status: 'error',
                    message: `HTTP ${response.status}`,
                    ...(errorCode ? { details: { error: errorCode } } : {})
                };
            }

            const result = await response.json() as { data?: unknown };
            return normalizeTicket(Array.isArray(result?.data) ? result.data[0] : undefined);
        } catch {
            if (attempt + 1 < MAX_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
                continue;
            }
            return { status: 'error', message: 'Network error' };
        }
    }
    return { status: 'error', message: 'Network error' };
}

export async function sendPushNotifications(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += MAX_CONCURRENT_REQUESTS) {
        // Promise.all preserves input order, which pushDispatch needs to map
        // DeviceNotRegistered errors back to the matching database token.
        tickets.push(...await Promise.all(messages.slice(i, i + MAX_CONCURRENT_REQUESTS).map(sendSingle)));
    }
    return tickets;
}
