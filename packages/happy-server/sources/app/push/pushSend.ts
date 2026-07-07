/**
 * Sends push notifications.
 *
 * Expo push tokens keep using Expo's HTTP Push API. Native Android device
 * tokens use Firebase Cloud Messaging HTTP v1 directly.
 */

import { readFile } from "node:fs/promises";
import jwt from "jsonwebtoken";

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const FCM_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const BATCH_SIZE = 100;

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

interface IndexedPushMessage {
    index: number;
    message: PushMessage;
}

interface FcmServiceAccount {
    projectId: string;
    clientEmail: string;
    privateKey: string;
}

function isExpoPushToken(token: string): boolean {
    return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
}

function stringifyData(data: Record<string, unknown> | undefined): Record<string, string> | undefined {
    if (!data) {
        return undefined;
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null) {
            continue;
        }
        result[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function parseServiceAccountJson(raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        try {
            return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
        } catch {
            return null;
        }
    }
}

async function loadFcmServiceAccount(): Promise<FcmServiceAccount | null> {
    let raw = process.env.FCM_SERVICE_ACCOUNT_JSON;

    if (!raw && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        try {
            raw = await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
        } catch {
            raw = undefined;
        }
    }

    if (!raw) {
        return null;
    }

    const parsed = parseServiceAccountJson(raw);
    const projectId = process.env.FCM_PROJECT_ID || (typeof parsed?.project_id === 'string' ? parsed.project_id : undefined);
    const clientEmail = typeof parsed?.client_email === 'string' ? parsed.client_email : undefined;
    const privateKey = typeof parsed?.private_key === 'string' ? parsed.private_key : undefined;

    if (!projectId || !clientEmail || !privateKey) {
        return null;
    }

    return { projectId, clientEmail, privateKey };
}

async function requestFcmAccessToken(serviceAccount: FcmServiceAccount): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign({
        iss: serviceAccount.clientEmail,
        scope: FCM_SCOPE,
        aud: FCM_OAUTH_TOKEN_URL,
        iat: now,
        exp: now + 3600,
    }, serviceAccount.privateKey, { algorithm: 'RS256' });

    const response = await fetch(FCM_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }).toString(),
    });

    if (!response.ok) {
        throw new Error(`FCM OAuth token request failed: HTTP ${response.status}`);
    }

    const result = await response.json() as { access_token?: string };
    if (!result.access_token) {
        throw new Error('FCM OAuth token response did not include access_token');
    }

    return result.access_token;
}

function getFcmErrorCode(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }
    const error = (payload as { error?: unknown }).error;
    if (!error || typeof error !== 'object') {
        return undefined;
    }

    const details = (error as { details?: unknown }).details;
    if (Array.isArray(details)) {
        for (const detail of details) {
            if (!detail || typeof detail !== 'object') {
                continue;
            }
            const errorCode = (detail as { errorCode?: unknown }).errorCode;
            if (typeof errorCode === 'string') {
                return errorCode;
            }
        }
    }

    const status = (error as { status?: unknown }).status;
    return typeof status === 'string' ? status : undefined;
}

function normalizeFcmError(errorCode: string | undefined): string {
    switch (errorCode) {
        case 'UNREGISTERED':
            return 'DeviceNotRegistered';
        case 'THIRD_PARTY_AUTH_ERROR':
        case 'SENDER_ID_MISMATCH':
        case 'PERMISSION_DENIED':
            return 'InvalidCredentials';
        case 'INVALID_ARGUMENT':
            return 'InvalidToken';
        default:
            return errorCode || 'UnknownError';
    }
}

async function sendExpoPushNotifications(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const batch = messages.slice(i, i + BATCH_SIZE);
        try {
            const response = await fetch(EXPO_PUSH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(batch)
            });

            if (!response.ok) {
                tickets.push(...batch.map(() => ({
                    status: 'error' as const,
                    message: `HTTP ${response.status}`
                })));
                continue;
            }

            const result = await response.json() as { data: PushTicket[] };
            tickets.push(...result.data);
        } catch {
            tickets.push(...batch.map(() => ({
                status: 'error' as const,
                message: 'Network error'
            })));
        }
    }

    return tickets;
}

async function sendFcmPushNotification(
    message: PushMessage,
    serviceAccount: FcmServiceAccount,
    accessToken: string
): Promise<PushTicket> {
    const androidNotification: Record<string, unknown> = {};
    if (message.channelId) {
        androidNotification.channel_id = message.channelId;
    }
    if (message.sound === 'default') {
        androidNotification.sound = 'default';
    }

    const payload: Record<string, unknown> = {
        message: {
            token: message.to,
            notification: {
                title: message.title,
                body: message.body,
            },
            data: stringifyData(message.data),
            android: {
                priority: 'HIGH',
                notification: Object.keys(androidNotification).length > 0 ? androidNotification : undefined,
            },
        },
    };

    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.projectId)}/messages:send`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({})) as { name?: string };
    if (!response.ok) {
        const errorCode = getFcmErrorCode(result);
        return {
            status: 'error',
            message: `FCM HTTP ${response.status}`,
            details: { error: normalizeFcmError(errorCode) },
        };
    }

    return {
        status: 'ok',
        id: result.name,
    };
}

async function sendFcmPushNotifications(messages: PushMessage[]): Promise<PushTicket[]> {
    const serviceAccount = await loadFcmServiceAccount();
    if (!serviceAccount) {
        return messages.map(() => ({
            status: 'error' as const,
            message: 'FCM credentials are not configured',
            details: { error: 'InvalidCredentials' },
        }));
    }

    try {
        const accessToken = await requestFcmAccessToken(serviceAccount);
        const tickets: PushTicket[] = [];
        for (const message of messages) {
            tickets.push(await sendFcmPushNotification(message, serviceAccount, accessToken));
        }
        return tickets;
    } catch (error) {
        const message = error instanceof Error && error.message ? error.message : 'FCM send failed';
        return messages.map(() => ({
            status: 'error' as const,
            message,
            details: { error: 'InvalidCredentials' },
        }));
    }
}

export async function sendPushNotifications(messages: PushMessage[]): Promise<PushTicket[]> {
    if (messages.length === 0) {
        return [];
    }

    const expoMessages: IndexedPushMessage[] = [];
    const fcmMessages: IndexedPushMessage[] = [];
    const tickets: PushTicket[] = new Array(messages.length);

    messages.forEach((message, index) => {
        if (isExpoPushToken(message.to)) {
            expoMessages.push({ index, message });
        } else {
            fcmMessages.push({ index, message });
        }
    });

    if (expoMessages.length > 0) {
        const expoTickets = await sendExpoPushNotifications(expoMessages.map(item => item.message));
        expoTickets.forEach((ticket, ticketIndex) => {
            tickets[expoMessages[ticketIndex].index] = ticket;
        });
    }

    if (fcmMessages.length > 0) {
        const fcmTickets = await sendFcmPushNotifications(fcmMessages.map(item => item.message));
        fcmTickets.forEach((ticket, ticketIndex) => {
            tickets[fcmMessages[ticketIndex].index] = ticket;
        });
    }

    return tickets;
}
