import type { AuthCredentials } from '@/auth/tokenStorage';
import { z } from 'zod';
import { getHappyClientId } from './apiSocket';
import { ApiSessionSnapshotSchema, type ApiSessionSnapshot } from './apiTypes';
import { getServerUrl } from './serverConfig';

export class SessionRequestError extends Error {
    constructor(
        readonly kind: 'network' | 'timeout' | 'http' | 'invalid-response',
        readonly status?: number,
    ) {
        // Never retain URLs, response bodies, or credentials in diagnostics.
        super(`Session request failed: ${kind}${status === undefined ? '' : ` (${status})`}`);
        this.name = 'SessionRequestError';
    }

    get retryable(): boolean {
        return this.kind === 'network' || this.kind === 'timeout'
            || (this.kind === 'http' && (this.status === 408 || this.status === 429
                || (this.status !== undefined && this.status >= 500 && this.status <= 599)));
    }
}

export interface FetchSessionSnapshotPageOptions {
    cursor?: string;
    limit?: number;
    changedSince?: number;
    signal?: AbortSignal;
}

const sessionSnapshotResponseSchema = z.object({
    session: ApiSessionSnapshotSchema,
});

const sessionSnapshotsResponseSchema = z.object({
    sessions: z.array(ApiSessionSnapshotSchema),
});

const sessionSnapshotPageResponseSchema = sessionSnapshotsResponseSchema.extend({
    nextCursor: z.string().nullable(),
    hasNext: z.boolean(),
});

function buildSessionHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
        'X-Happy-Client': getHappyClientId(),
    };
}

// The deadline includes body consumption. Abort alone is insufficient when a
// browser/adapter fails to reject a stalled fetch or response.json().
async function readSessionResponse<T>(
    credentials: AuthCredentials,
    path: string,
    read: (response: Response) => Promise<T>,
    signal?: AbortSignal,
): Promise<T> {
    // RN's installed AbortSignal has no reason/throwIfAborted. Preserve a
    // browser caller's explicit reason (including null) when it is available.
    const cancellation = () => {
        if (signal?.reason !== undefined) return signal.reason;
        const error = new Error('Session request cancelled');
        error.name = 'AbortError';
        return error;
    };
    if (signal?.aborted) throw cancellation();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let abort: (() => void) | undefined;
    const cancelled = signal ? new Promise<never>((_resolve, reject) => {
        abort = () => { reject(cancellation()); controller.abort(); };
        signal.addEventListener('abort', abort, { once: true });
    }) : undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new SessionRequestError('timeout'));
            controller.abort();
        }, 20_000);
    });
    try {
        return await Promise.race([
            (async () => {
                let response: Response;
                try {
                    response = await fetch(`${getServerUrl()}${path}`, {
                        headers: buildSessionHeaders(credentials), signal: controller.signal,
                    });
                } catch {
                    throw new SessionRequestError('network');
                }
                try {
                    return await read(response);
                } catch (error) {
                    if (error instanceof SessionRequestError) throw error;
                    throw new SessionRequestError(error instanceof TypeError ? 'network' : 'invalid-response');
                }
            })(),
            deadline,
            ...(cancelled ? [cancelled] : []),
        ]);
    } finally {
        clearTimeout(timer!);
        if (abort) signal!.removeEventListener('abort', abort);
        controller.abort();
    }
}

export async function fetchSessionSnapshot(
    credentials: AuthCredentials,
    sessionId: string,
): Promise<ApiSessionSnapshot | null> {
    return readSessionResponse(credentials, `/v2/sessions/${encodeURIComponent(sessionId)}`, async response => {
        if (response.status === 404) return null;
        if (!response.ok) {
            throw new SessionRequestError('http', response.status);
        }
        return sessionSnapshotResponseSchema.parse(await response.json()).session;
    });
}

export async function fetchActiveSessionSnapshots(
    credentials: AuthCredentials,
    limit: number,
): Promise<ApiSessionSnapshot[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    return readSessionResponse(credentials, `/v2/sessions/active?${query}`, async response => {
        if (!response.ok) {
            throw new SessionRequestError('http', response.status);
        }
        return sessionSnapshotsResponseSchema.parse(await response.json()).sessions;
    });
}

export async function fetchSessionSnapshotPage(
    credentials: AuthCredentials,
    options: FetchSessionSnapshotPageOptions,
): Promise<{ sessions: ApiSessionSnapshot[]; nextCursor: string | null; hasNext: boolean }> {
    const query = new URLSearchParams();
    if (options.cursor !== undefined) query.set('cursor', options.cursor);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.changedSince !== undefined) query.set('changedSince', String(options.changedSince));
    const queryString = query.toString();
    return readSessionResponse(credentials, `/v2/sessions${queryString ? `?${queryString}` : ''}`, async response => {
        if (!response.ok) {
            throw new SessionRequestError('http', response.status);
        }
        return sessionSnapshotPageResponseSchema.parse(await response.json());
    }, options.signal);
}

export async function fetchLegacySessionSnapshots(credentials: AuthCredentials): Promise<ApiSessionSnapshot[]> {
    return readSessionResponse(credentials, '/v1/sessions', async response => {
        if (!response.ok) throw new SessionRequestError('http', response.status);
        return sessionSnapshotsResponseSchema.parse(await response.json()).sessions;
    });
}
