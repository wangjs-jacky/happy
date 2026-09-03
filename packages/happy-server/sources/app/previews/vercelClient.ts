import { z } from 'zod';

const API_ORIGIN = 'https://api.vercel.com';
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

type VercelRequestInit = {
    method: string;
    headers?: Record<string, string>;
    body?: unknown;
    redirect?: 'error';
    signal?: unknown;
};

type FetchLike = (input: string, init?: VercelRequestInit) => Promise<Response>;

export class VercelApiError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, status: number) {
        super(`Vercel request failed: ${code}`);
        this.name = 'VercelApiError';
        this.code = code.slice(0, 64);
        this.status = status;
    }
}

const deploymentResponseSchema = z.object({
    id: z.string().min(1),
    url: z.string().min(1),
    readyState: z.string().optional(),
    target: z.union([z.string(), z.null()]).optional(),
}).passthrough();

function assertSafeIdentifier(value: string): void {
    if (!SAFE_ID.test(value)) throw new Error('Unsafe Vercel identifier');
}

export function createVercelClient(options: {
    token: string;
    teamId?: string;
    fetchImpl?: FetchLike;
}) {
    const fetchImpl: FetchLike = options.fetchImpl ?? (fetch as unknown as FetchLike);

    function endpoint(path: string): string {
        const url = new URL(path, API_ORIGIN);
        if (options.teamId) url.searchParams.set('teamId', options.teamId);
        return url.toString();
    }

    async function request(path: string, init: VercelRequestInit): Promise<Response> {
        const response = await fetchImpl(endpoint(path), {
            ...init,
            redirect: 'error',
            signal: init.signal ?? AbortSignal.timeout(30_000),
            headers: {
                Authorization: `Bearer ${options.token}`,
                ...init.headers,
            },
        });
        if (!response.ok) {
            const data = await response.json().catch(() => null) as { error?: { code?: string } } | null;
            throw new VercelApiError(data?.error?.code || `http_${response.status}`, response.status);
        }
        return response;
    }

    return {
        async uploadFile(sha: string, bytes: Uint8Array, mimeType: string): Promise<void> {
            if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Invalid Vercel file digest');
            await request('/v2/files', {
                method: 'POST',
                headers: {
                    'Content-Type': mimeType,
                    'Content-Length': String(bytes.byteLength),
                    'x-vercel-digest': sha,
                },
                body: bytes,
            });
        },

        async createDeployment(input: {
            name: string;
            projectId?: string;
            files: Array<{ file: string; sha: string; size: number }>;
            meta: Record<string, string>;
        }): Promise<{ id: string; url: string; readyState?: string }> {
            const response = await request('/v13/deployments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: input.name,
                    ...(input.projectId ? { project: input.projectId } : {}),
                    files: input.files,
                    target: null,
                    meta: input.meta,
                    projectSettings: { framework: null },
                }),
            });
            const parsed = deploymentResponseSchema.parse(await response.json());
            if (parsed.target === 'production') {
                throw new Error('Vercel returned an unexpected production deployment');
            }
            return {
                id: parsed.id,
                url: `https://${parsed.url.replace(/^https?:\/\//, '')}`,
                ...(parsed.readyState ? { readyState: parsed.readyState } : {}),
            };
        },

        async deleteDeployment(deploymentId: string): Promise<void> {
            assertSafeIdentifier(deploymentId);
            await request(`/v13/deployments/${deploymentId}`, { method: 'DELETE' });
        },
    };
}
