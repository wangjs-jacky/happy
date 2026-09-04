import { createHash } from 'node:crypto';
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

const projectResponseSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
}).passthrough();

function assertSafeIdentifier(value: string): void {
    if (!SAFE_ID.test(value)) throw new Error('Unsafe Vercel identifier');
}

export function createVercelClient(options: {
    token: string;
    teamId?: string;
    fetchImpl?: FetchLike;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    pollIntervalMs?: number;
    deploymentTimeoutMs?: number;
}) {
    const fetchImpl: FetchLike = options.fetchImpl ?? (fetch as unknown as FetchLike);
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const deploymentTimeoutMs = options.deploymentTimeoutMs ?? 120_000;

    function endpoint(path: string): string {
        const url = new URL(path, API_ORIGIN);
        if (options.teamId) url.searchParams.set('teamId', options.teamId);
        return url.toString();
    }

    function projectName(configurationId: string): string {
        return `happy-previews-${createHash('sha256').update(configurationId).digest('hex').slice(0, 12)}`;
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
        async ensurePreviewProject(input: { configurationId: string; projectId?: string }): Promise<{ id: string }> {
            if (input.projectId) {
                assertSafeIdentifier(input.projectId);
                const response = await request(`/v9/projects/${input.projectId}`, { method: 'GET' });
                const project = projectResponseSchema.parse(await response.json());
                if (project.id !== input.projectId || !project.name.startsWith('happy-previews')) {
                    throw new Error('Vercel preview project ownership validation failed');
                }
                return { id: project.id };
            }

            const createProject = async (name: string): Promise<{ id: string }> => {
                const response = await request('/v11/projects', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, framework: null, publicSource: false }),
                });
                const project = projectResponseSchema.parse(await response.json());
                if (project.name !== name) throw new Error('Vercel preview project ownership validation failed');
                return { id: project.id };
            };

            try {
                return await createProject('happy-previews');
            } catch (error) {
                if (!(error instanceof VercelApiError) || error.status !== 409) throw error;
            }
            return createProject(projectName(input.configurationId));
        },

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
            let parsed = deploymentResponseSchema.parse(await response.json());
            const startedAt = now();
            while (true) {
                if (parsed.target === 'production') throw new Error('Vercel returned an unexpected production deployment');
                if (parsed.readyState === 'READY') {
                    return {
                        id: parsed.id,
                        url: `https://${parsed.url.replace(/^https?:\/\//, '')}`,
                        readyState: parsed.readyState,
                    };
                }
                if (parsed.readyState === 'ERROR' || parsed.readyState === 'CANCELED') {
                    throw new Error(`Vercel deployment reached terminal state: ${parsed.readyState}`);
                }
                if (now() - startedAt >= deploymentTimeoutMs) throw new Error('Vercel deployment timed out before becoming ready');
                await sleep(pollIntervalMs);
                assertSafeIdentifier(parsed.id);
                const statusResponse = await request(`/v13/deployments/${parsed.id}`, { method: 'GET' });
                parsed = deploymentResponseSchema.parse(await statusResponse.json());
            }
        },

        async deleteDeployment(deploymentId: string): Promise<void> {
            assertSafeIdentifier(deploymentId);
            await request(`/v13/deployments/${deploymentId}`, { method: 'DELETE' });
        },
    };
}
