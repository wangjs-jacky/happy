import type { AuthCredentials } from '@/auth/tokenStorage';
import { getHappyClientId } from './apiSocket';
import { getServerUrl } from './serverConfig';

export type CloudflarePreviewStatus = {
    available: boolean;
    connected: boolean;
    account?: { accountId?: string; teamName?: string; projectId?: string };
};

export type CloudflarePreviewDisconnectResult = {
    warning?: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING';
};

export type CloudflarePreviewApiErrorKind = 'unavailable' | 'credentials' | 'network' | 'server' | 'insecure';

/** A safe-to-display API error. Provider response text is intentionally never retained. */
export class CloudflarePreviewApiError extends Error {
    readonly name = 'CloudflarePreviewApiError';

    constructor(readonly kind: CloudflarePreviewApiErrorKind, message: string) {
        super(message);
    }
}

function headers(credentials: AuthCredentials) {
    return { Authorization: `Bearer ${credentials.token}`, 'X-Happy-Client': getHappyClientId() };
}

function errorForResponse(response: Response, unavailableOnBadRequest = false): CloudflarePreviewApiError {
    if (unavailableOnBadRequest && response.status === 400) {
        return new CloudflarePreviewApiError('unavailable', 'Temporary previews are not configured on this Happy Server.');
    }
    if (response.status === 401 || response.status === 403) {
        return new CloudflarePreviewApiError('credentials', 'Your sign-in has expired. Sign in again and retry.');
    }
    return new CloudflarePreviewApiError('server', 'Happy Server could not complete this temporary preview request. Please retry.');
}

async function request(credentials: AuthCredentials, path: string, init?: RequestInit): Promise<Response> {
    try {
        return await fetch(`${getServerUrl()}${path}`, { ...init, headers: { ...headers(credentials), 'Content-Type': 'application/json' } });
    } catch (error) {
        if (error instanceof CloudflarePreviewApiError) throw error;
        throw new CloudflarePreviewApiError('network', 'Unable to reach Happy Server. Check your connection and retry.');
    }
}

function isStatus(value: unknown): value is CloudflarePreviewStatus {
    if (!value || typeof value !== 'object') return false;
    const status = value as Record<string, unknown>;
    if (typeof status.available !== 'boolean' || typeof status.connected !== 'boolean') return false;
    if (status.account === undefined) return true;
    if (!status.account || typeof status.account !== 'object') return false;
    return ['accountId', 'teamName', 'projectId'].every((key) => {
        const field = (status.account as Record<string, unknown>)[key];
        return field === undefined || typeof field === 'string';
    });
}

export async function getCloudflarePreviewStatus(credentials: AuthCredentials): Promise<CloudflarePreviewStatus> {
    const response = await request(credentials, '/v1/connect/cloudflare/status');
    if (!response.ok) throw errorForResponse(response);
    const value: unknown = await response.json().catch(() => undefined);
    if (!isStatus(value)) throw new CloudflarePreviewApiError('server', 'Happy Server returned an invalid temporary preview status.');
    return value;
}

export async function connectCloudflarePreview(credentials: AuthCredentials, accountId: string, apiToken: string): Promise<void> {
    if (!isCloudflareConnectionSecure()) throw new CloudflarePreviewApiError('insecure', 'Cloudflare credentials require an HTTPS Happy Server connection.');
    const response = await request(credentials, '/v1/connect/cloudflare', { method: 'POST', body: JSON.stringify({ accountId, apiToken }) });
    if (response.status === 400) throw new CloudflarePreviewApiError('credentials', 'Invalid Cloudflare account or API token.');
    if (!response.ok) throw errorForResponse(response);
    const value = await response.json().catch(() => null);
    if (value?.success !== true) throw new CloudflarePreviewApiError('server', 'Invalid connection response.');
}

export function isCloudflareConnectionSecure(): boolean {
    try {
        const server = new URL(getServerUrl());
        return server.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname);
    } catch { return false; }
}

export async function disconnectCloudflarePreview(credentials: AuthCredentials): Promise<CloudflarePreviewDisconnectResult> {
    const response = await request(credentials, '/v1/connect/cloudflare', { method: 'DELETE' });
    if (!response.ok) throw errorForResponse(response);
    const value: unknown = await response.json().catch(() => undefined);
    if (!value || typeof value !== 'object' || (value as { success?: unknown }).success !== true) {
        throw new CloudflarePreviewApiError('server', 'Happy Server returned an invalid temporary preview response.');
    }
    return (value as { warning?: unknown }).warning === 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING'
        ? { warning: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' }
        : {};
}
