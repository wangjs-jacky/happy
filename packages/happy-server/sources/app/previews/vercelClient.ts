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
    readyState: z.enum(['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED', 'DELETED']),
    target: z.union([z.string().min(1), z.null()]),
    alias: z.array(z.string().min(1)).optional(),
    aliasAssigned: z.boolean(),
}).passthrough();

const projectResponseSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    installCommand: z.string().min(1).nullable().optional(),
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
    timeoutSignal?: (milliseconds: number) => unknown;
}) {
    const fetchImpl: FetchLike = options.fetchImpl ?? (fetch as unknown as FetchLike);
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const pollIntervalMs = options.pollIntervalMs ?? 1_000;
    const deploymentTimeoutMs = options.deploymentTimeoutMs ?? 120_000;
    const timeoutSignal = options.timeoutSignal ?? ((milliseconds: number) => AbortSignal.timeout(milliseconds));

    function endpoint(path: string): string {
        const url = new URL(path, API_ORIGIN);
        if (options.teamId) url.searchParams.set('teamId', options.teamId);
        return url.toString();
    }

    function projectName(configurationId: string): string {
        return `happy-previews-${createHash('sha256').update(configurationId).digest('hex').slice(0, 12)}`;
    }

    function ownershipMarker(configurationId: string): string {
        return `echo happy-preview-owner:${createHash('sha256').update(configurationId).digest('hex').slice(0, 16)}`;
    }

    async function request(path: string, init: VercelRequestInit, timeoutMs = 30_000): Promise<Response> {
        const response = await fetchImpl(endpoint(path), {
            ...init,
            redirect: 'error',
            signal: init.signal ?? timeoutSignal(Math.max(1, Math.min(30_000, timeoutMs))),
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
            const marker = ownershipMarker(input.configurationId);
            const isOwned = (project: z.infer<typeof projectResponseSchema>, name: string) => project.name === name && project.installCommand === marker;
            const readProject = async (idOrName: string) => {
                const response = await request(`/v9/projects/${idOrName}`, { method: 'GET' });
                return projectResponseSchema.parse(await response.json());
            };
            if (input.projectId) {
                assertSafeIdentifier(input.projectId);
                try {
                    const project = await readProject(input.projectId);
                    if (project.id !== input.projectId || !project.name.startsWith('happy-previews') || project.installCommand !== marker) {
                        throw new Error('Vercel preview project ownership validation failed');
                    }
                    return { id: project.id };
                } catch (error) {
                    if (!(error instanceof VercelApiError) || error.status !== 404) throw error;
                }
            }

            const createProject = async (name: string): Promise<{ id: string }> => {
                const response = await request('/v11/projects', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, framework: null, publicSource: false, installCommand: marker }),
                });
                const project = projectResponseSchema.parse(await response.json());
                if (project.installCommand === undefined || project.installCommand === null) {
                    const verified = await readProject(project.id);
                    if (!isOwned(verified, name)) throw new Error('Vercel preview project ownership validation failed');
                    return { id: verified.id };
                }
                if (!isOwned(project, name)) {
                    throw new Error('Vercel preview project ownership validation failed');
                }
                return { id: project.id };
            };
            const baseName = projectName(input.configurationId);
            const candidates = ['happy-previews', baseName, ...Array.from({ length: 8 }, (_, index) => `${baseName}-${index + 1}`)];
            for (const name of candidates) {
                try {
                    return await createProject(name);
                } catch (error) {
                    if (!(error instanceof VercelApiError) || error.status !== 409) throw error;
                }
                try {
                    const existing = await readProject(name);
                    if (isOwned(existing, name)) return { id: existing.id };
                } catch (error) {
                    if (!(error instanceof VercelApiError) || error.status !== 404) throw error;
                }
            }
            throw new Error('Vercel preview project name collision limit reached');
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
            const deadline = now() + deploymentTimeoutMs;
            const remaining = (): number => {
                const milliseconds = deadline - now();
                if (milliseconds <= 0) throw new Error('Vercel deployment timed out before becoming ready');
                return milliseconds;
            };
            const assertPreviewSemantics = (deployment: z.infer<typeof deploymentResponseSchema>): void => {
                if (deployment.target !== null) {
                    if (deployment.target === 'production') throw new Error('Vercel returned an unexpected production deployment');
                    throw new Error(`Vercel returned a non-preview deployment target: ${deployment.target}`);
                }
                if (deployment.alias?.length || deployment.aliasAssigned !== false) throw new Error('Vercel returned an unexpected deployment alias');
            };
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
            }, remaining());
            let parsed = deploymentResponseSchema.parse(await response.json());
            while (true) {
                remaining();
                assertPreviewSemantics(parsed);
                if (parsed.readyState === 'READY') {
                    return {
                        id: parsed.id,
                        url: `https://${parsed.url.replace(/^https?:\/\//, '')}`,
                        readyState: parsed.readyState,
                    };
                }
                if (parsed.readyState === 'ERROR' || parsed.readyState === 'CANCELED' || parsed.readyState === 'DELETED') {
                    throw new Error(`Vercel deployment reached terminal state: ${parsed.readyState}`);
                }
                await sleep(Math.min(pollIntervalMs, remaining()));
                const pollTimeoutMs = remaining();
                assertSafeIdentifier(parsed.id);
                const statusResponse = await request(`/v13/deployments/${parsed.id}`, { method: 'GET' }, pollTimeoutMs);
                parsed = deploymentResponseSchema.parse(await statusResponse.json());
            }
        },

        async deleteDeployment(deploymentId: string): Promise<void> {
            assertSafeIdentifier(deploymentId);
            await request(`/v13/deployments/${deploymentId}`, { method: 'DELETE' });
        },
    };
}
