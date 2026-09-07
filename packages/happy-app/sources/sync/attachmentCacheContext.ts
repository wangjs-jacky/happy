import type { AuthCredentials } from '@/auth/tokenStorage';
import { parseToken } from '@/utils/parseToken';
import { getServerUrl } from './serverConfig';
import { findLocalHistory, subscribeLocalHistoryInvalidation } from './localHistoryStore';

let generation = 0;
const listeners = new Set<() => void>();
subscribeLocalHistoryInvalidation(() => {
    generation += 1;
    for (const listener of listeners) listener();
});
export const attachmentCacheGeneration = () => generation;
export function subscribeAttachmentCache(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Captures ownership before queued/network/decode work; never follows a changed
 * account or server across an await. Durable keys intentionally exclude tokens. */
export function captureAttachmentContext(credentials: AuthCredentials, sessionId: string) {
    const token = credentials.token;
    const server = getServerUrl();
    let origin: string;
    try { origin = new URL(server).origin; } catch { origin = server.trim().replace(/\/+$/, ''); }
    let scope: string | null = null;
    try { scope = `${origin}|${parseToken(token)}`; } catch { /* legacy/test credentials: network fallback */ }
    const history = scope ? findLocalHistory(scope) : null;
    const fence = history?.captureSessionFence(sessionId);
    const capturedGeneration = generation;
    const isCurrent = () => capturedGeneration === generation && getServerUrl() === server
        && credentials.token === token && (!history || history.isFenceCurrent(fence!));
    return {
        server, token, history, fence,
        key: JSON.stringify([origin, scope, token, sessionId, capturedGeneration]),
        isCurrent,
        async assertCurrent() {
            if (!isCurrent() || (history && !await history.attachmentFenceIsCurrent(fence!))) {
                throw new Error('Attachment context expired');
            }
        },
    };
}
export type AttachmentContext = ReturnType<typeof captureAttachmentContext>;
