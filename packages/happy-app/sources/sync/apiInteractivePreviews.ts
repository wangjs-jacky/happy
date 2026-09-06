import type { AuthCredentials } from '@/auth/tokenStorage';
import { getHappyClientId } from './apiSocket';
import { getServerUrl } from './serverConfig';

export type VercelPreviewStatus = {
    available: boolean;
    connected: boolean;
    account?: { teamId?: string; teamName?: string; projectId?: string };
};

export type VercelPreviewDisconnectResult = {
    warning?: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING';
};

export type VercelPreviewApiErrorKind = 'unavailable' | 'credentials' | 'network' | 'server';

/** A safe-to-display API error. Provider response text is intentionally never retained. */
export class VercelPreviewApiError extends Error {
    readonly name = 'VercelPreviewApiError';

    constructor(readonly kind: VercelPreviewApiErrorKind, message: string) {
        super(message);
    }
}

function headers(credentials: AuthCredentials) {
    return { Authorization: `Bearer ${credentials.token}`, 'X-Happy-Client': getHappyClientId() };
}

function safeHttpUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
    } catch {
        return null;
    }
}

function errorForResponse(response: Response, unavailableOnBadRequest = false): VercelPreviewApiError {
    if (unavailableOnBadRequest && response.status === 400) {
        return new VercelPreviewApiError('unavailable', 'Temporary previews are not configured on this Happy Server.');
    }
    if (response.status === 401 || response.status === 403) {
        return new VercelPreviewApiError('credentials', 'Your sign-in has expired. Sign in again and retry.');
    }
    return new VercelPreviewApiError('server', 'Happy Server could not complete this temporary preview request. Please retry.');
}

async function request(credentials: AuthCredentials, path: string, init?: RequestInit): Promise<Response> {
    try {
        return await fetch(`${getServerUrl()}${path}`, { ...init, headers: headers(credentials) });
    } catch (error) {
        if (error instanceof VercelPreviewApiError) throw error;
        throw new VercelPreviewApiError('network', 'Unable to reach Happy Server. Check your connection and retry.');
    }
}

function isStatus(value: unknown): value is VercelPreviewStatus {
    if (!value || typeof value !== 'object') return false;
    const status = value as Record<string, unknown>;
    if (typeof status.available !== 'boolean' || typeof status.connected !== 'boolean') return false;
    if (status.account === undefined) return true;
    if (!status.account || typeof status.account !== 'object') return false;
    return ['teamId', 'teamName', 'projectId'].every((key) => {
        const field = (status.account as Record<string, unknown>)[key];
        return field === undefined || typeof field === 'string';
    });
}

export async function getVercelPreviewStatus(credentials: AuthCredentials): Promise<VercelPreviewStatus> {
    const response = await request(credentials, '/v1/connect/vercel/status');
    if (!response.ok) throw errorForResponse(response);
    const value: unknown = await response.json().catch(() => undefined);
    if (!isStatus(value)) throw new VercelPreviewApiError('server', 'Happy Server returned an invalid temporary preview status.');
    return value;
}

export async function getVercelPreviewConnectUrl(credentials: AuthCredentials): Promise<string> {
    const response = await request(credentials, '/v1/connect/vercel/params');
    if (!response.ok) throw errorForResponse(response, true);
    const value: unknown = await response.json().catch(() => undefined);
    const url = value && typeof value === 'object' ? safeHttpUrl((value as { url?: unknown }).url) : null;
    if (!url) throw new VercelPreviewApiError('server', 'Happy Server returned an invalid Vercel connection URL.');
    return url;
}

export async function disconnectVercelPreview(credentials: AuthCredentials): Promise<VercelPreviewDisconnectResult> {
    const response = await request(credentials, '/v1/connect/vercel', { method: 'DELETE' });
    if (!response.ok) throw errorForResponse(response);
    const value: unknown = await response.json().catch(() => undefined);
    if (!value || typeof value !== 'object' || (value as { success?: unknown }).success !== true) {
        throw new VercelPreviewApiError('server', 'Happy Server returned an invalid temporary preview response.');
    }
    return (value as { warning?: unknown }).warning === 'VERCEL_DEPLOYMENT_CLEANUP_PENDING'
        ? { warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' }
        : {};
}
