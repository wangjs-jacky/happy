import { sync } from './sync';
import { markSessionCriticalPathHydrationRetry } from './sessionCriticalPathProbeBridge';

const SESSION_HYDRATION_DELAYS_MS = [0, 100, 250, 500] as const;

/**
 * Resolve a short read-after-create race without decrypting the account's
 * session history. The first attempt also covers the socket-event fast path
 * because ensureSessionHydrated checks local state before issuing a request.
 */
export async function ensureSessionHydratedWithRetry(sessionId: string, isCurrent: () => boolean = () => true): Promise<boolean> {
    for (const delayMs of SESSION_HYDRATION_DELAYS_MS) {
        if (!isCurrent()) return false;
        if (delayMs > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
            markSessionCriticalPathHydrationRetry();
        }
        try {
            if (!isCurrent()) return false;
            if (await sync.ensureSessionHydrated(sessionId)) {
                return isCurrent();
            }
        } catch {
            // Keep retries bounded to this one session. Callers decide how to
            // surface an exhausted hydration attempt.
        }
    }
    return false;
}
