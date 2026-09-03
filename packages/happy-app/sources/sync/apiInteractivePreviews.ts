import type { AuthCredentials } from '@/auth/tokenStorage';
import { getHappyClientId } from './apiSocket';
import { getServerUrl } from './serverConfig';

export type VercelPreviewStatus = { available: boolean; connected: boolean; account?: { teamId?: string; teamName?: string; projectId?: string } };
function headers(credentials: AuthCredentials) { return { Authorization: `Bearer ${credentials.token}`, 'X-Happy-Client': getHappyClientId() }; }
export async function getVercelPreviewStatus(credentials: AuthCredentials): Promise<VercelPreviewStatus> {
    const response = await fetch(`${getServerUrl()}/v1/connect/vercel/status`, { headers: headers(credentials) });
    if (!response.ok) throw new Error(`Failed to load Vercel status (${response.status})`); return response.json();
}
export async function getVercelPreviewConnectUrl(credentials: AuthCredentials): Promise<string> {
    const response = await fetch(`${getServerUrl()}/v1/connect/vercel/params`, { headers: headers(credentials) });
    if (!response.ok) throw new Error(response.status === 400 ? 'Vercel preview publishing is not configured on this Happy Server.' : `Failed to start Vercel connection (${response.status})`);
    return ((await response.json()) as { url: string }).url;
}
export async function disconnectVercelPreview(credentials: AuthCredentials): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/connect/vercel`, { method: 'DELETE', headers: headers(credentials) });
    if (!response.ok) throw new Error(`Failed to disconnect Vercel (${response.status})`);
}
