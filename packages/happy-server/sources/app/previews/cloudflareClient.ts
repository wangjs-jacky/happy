import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { blake3 } from '@noble/hashes/blake3';
import { z } from 'zod';
import { encodeBase64 } from 'privacy-kit';

const API = 'https://api.cloudflare.com/client/v4';
interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    redirect?: 'error';
    signal?: unknown;
}
type FetchLike = (url: string, init?: RequestOptions) => Promise<Response>;
const safeId = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const accountId = z.string().regex(/^[a-f0-9]{32}$/);
const deploymentSchema = z.object({
    id: safeId, url: z.string().url(), environment: z.literal('preview'),
    latest_stage: z.object({ status: z.string() }),
    deployment_trigger: z.object({ metadata: z.object({
        branch: z.string(), commit_message: z.string().optional(),
    }) }),
});
const projectSchema = z.object({
    name: safeId, production_branch: z.string(),
    source: z.unknown().nullable().optional(),
});
export interface CloudflareDeployment {
    id: string;
    url: string;
    readyState: 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED';
}
export type CloudflareDeploymentLookup =
    | { visibility: 'not_found' }
    | { visibility: 'ready' | 'in_progress' | 'terminal'; deployment: CloudflareDeployment };

export class CloudflareApiError extends Error {
    constructor(readonly code: string, readonly status: number) {
        super(`Cloudflare request failed: ${code}`);
        this.name = 'CloudflareApiError';
    }
}

/** Pages direct upload. Only managed preview branches, never production or arbitrary URLs.
 * Remote IDs include account/project scope so cleanup cannot silently target another account.
 */
export function createCloudflareClient(options: {
    token: string;
    teamId?: string;
    fetchImpl?: FetchLike;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    pollIntervalMs?: number;
    deploymentTimeoutMs?: number;
}) {
    const account = accountId.parse(options.teamId);
    const fetchImpl: FetchLike = options.fetchImpl ?? (fetch as unknown as FetchLike);
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const base = `/accounts/${account}/pages/projects`;
    const staged = new Map<string, { bytes: Uint8Array<ArrayBuffer>; mimeType: string }>();
    let activeProject: string | null = null;
    let preparedManifest: Record<string, string> | null = null;
    const projectPath = (project: string) => `${base}/${safeId.parse(project)}`;
    const encodedId = (project: string, id: string) => `cfpages:${account}:${project}:${safeId.parse(id)}`;
    const decodeId = (id: string) => {
        const parts = id.split(':');
        if (parts.length !== 4 || parts[0] !== 'cfpages' || parts[1] !== account) throw new Error('Cloudflare deployment scope mismatch');
        return { project: safeId.parse(parts[2]), id: safeId.parse(parts[3]) };
    };
    async function request(path: string, init: RequestOptions = {}, token = options.token): Promise<any> {
        // Retrying creates can orphan deployments after an ambiguous response.
        const retryable = !init.method || ['GET', 'DELETE'].includes(init.method);
        for (let attempt = 0; ; attempt++) {
            const response = await fetchImpl(API + path, {
                ...init, redirect: 'error', signal: AbortSignal.timeout(30_000),
                headers: { Authorization: `Bearer ${token}`, ...init.headers },
            });
            if (retryable && (response.status === 429 || response.status >= 500) && attempt < 2) {
                const seconds = Number(response.headers.get('retry-after'));
                await sleep(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10_000) : 250 * 2 ** attempt);
                continue;
            }
            if (!response.ok) throw new CloudflareApiError(`http_${response.status}`, response.status);
            const envelope = await response.json() as { success?: boolean; result?: unknown };
            if (envelope.success !== true) throw new CloudflareApiError('invalid_response', response.status);
            return envelope.result;
        }
    }
    function result(project: string, raw: unknown): CloudflareDeployment {
        const parsed = deploymentSchema.parse(raw);
        const url = new URL(parsed.url);
        if (url.protocol !== 'https:' || !url.hostname.endsWith(`.${project}.pages.dev`) || url.username || url.password || url.port) {
            throw new Error('Unexpected Cloudflare preview URL');
        }
        const status = parsed.latest_stage.status;
        return {
            id: encodedId(project, parsed.id), url: url.toString(),
            readyState: status === 'success' ? 'READY' : status === 'failure' ? 'ERROR'
                : status === 'canceled' ? 'CANCELED' : 'BUILDING',
        };
    }
    async function waitForDeploymentReady(initial: CloudflareDeployment): Promise<CloudflareDeployment> {
        const scope = decodeId(initial.id);
        const deadline = now() + (options.deploymentTimeoutMs ?? 120_000);
        let current = initial;
        while (true) {
            if (current.readyState === 'READY') return current;
            if (current.readyState === 'ERROR' || current.readyState === 'CANCELED') throw new Error('Cloudflare deployment reached terminal state');
            if (now() >= deadline) throw new Error('Cloudflare deployment timed out');
            await sleep(options.pollIntervalMs ?? 1_000);
            current = result(scope.project, await request(`${projectPath(scope.project)}/deployments/${scope.id}`));
        }
    }
    return {
        async verifyConnection(): Promise<void> {
            z.array(z.unknown()).parse(await request(base + '?per_page=1'));
        },
        async ensurePreviewProject(input: { configurationId: string; projectId?: string }): Promise<{ id: string }> {
            const digest = createHash('sha256').update(input.configurationId).digest('hex');
            const name = `happy-previews-${digest.slice(0, 20)}`;
            const marker = `paws-reserved-${digest.slice(0, 32)}`;
            if (input.projectId && input.projectId !== name) throw new Error('Cloudflare project ownership mismatch');
            const verify = (raw: unknown) => {
                const project = projectSchema.parse(raw);
                if (project.name !== name || project.production_branch !== marker || project.source) throw new Error('Cloudflare project ownership mismatch');
                activeProject = project.name;
                return { id: project.name };
            };
            try { return verify(await request(projectPath(name))); }
            catch (error) { if (!(error instanceof CloudflareApiError) || error.status !== 404) throw error; }
            try {
                return verify(await request(base, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, production_branch: marker }),
                }));
            } catch (error) {
                // Creation may have succeeded but its response was lost. Adopt only our marked project.
                try { return verify(await request(projectPath(name))); } catch { throw error; }
            }
        },
        async uploadFile(sha: string, bytes: Uint8Array, mimeType: string): Promise<void> {
            // Kept local until filenames are available: Pages hashes include the extension.
            if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error('Cloudflare staging digest mismatch');
            staged.set(sha, { bytes: Uint8Array.from(bytes), mimeType });
        },
        async prepareDeployment(files: Array<{ file: string; sha: string; size: number }>): Promise<void> {
            const project = safeId.parse(activeProject);
            const manifest: Record<string, string> = {};
            const assets: Array<{ key: string; value: string; metadata: { contentType: string }; base64: true }> = [];
            for (const file of files) {
                const asset = staged.get(file.sha);
                if (!asset || asset.bytes.byteLength !== file.size) throw new Error('Cloudflare upload is incomplete');
                if (file.file.startsWith('/') || file.file.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe Cloudflare asset path');
                const value = encodeBase64(asset.bytes);
                const key = Buffer.from(blake3(value + extname(file.file).slice(1))).toString('hex').slice(0, 32);
                manifest['/' + file.file] = key;
                assets.push({ key, value, metadata: { contentType: asset.mimeType }, base64: true });
            }
            if (assets.length) {
                const { jwt } = z.object({ jwt: z.string().min(1) }).parse(await request(`${projectPath(project)}/upload-token`));
                // The shared static preview limit bounds this batch to 10 MiB before base64.
                await request('/pages/assets/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assets) }, jwt);
                await request('/pages/assets/upsert-hashes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hashes: assets.map(asset => asset.key) }) }, jwt);
            }
            preparedManifest = manifest;
            staged.clear();
        },
        async lookupDeploymentByMetadata(input: { projectId: string; happyPreviewId: string; publicationAttemptId: string }): Promise<CloudflareDeploymentLookup> {
            const branch = `p-${safeId.parse(input.publicationAttemptId)}`;
            // List is paginated. A failed/incomplete scan must not be mistaken for absence.
            for (let page = 1; page <= 1000; page++) {
                const rows = z.array(z.unknown()).parse(await request(`${projectPath(input.projectId)}/deployments?env=preview&per_page=100&page=${page}`));
                for (const raw of rows) {
                    const parsed = deploymentSchema.parse(raw);
                    if (parsed.deployment_trigger.metadata.branch !== branch) continue;
                    const meta = JSON.parse(parsed.deployment_trigger.metadata.commit_message || '{}');
                    if (meta.happyPreviewId !== input.happyPreviewId || meta.happyPublicationAttemptId !== input.publicationAttemptId) continue;
                    const found = result(input.projectId, parsed);
                    return { visibility: found.readyState === 'READY' ? 'ready' : ['ERROR', 'CANCELED'].includes(found.readyState) ? 'terminal' : 'in_progress', deployment: found };
                }
                if (rows.length < 100) return { visibility: 'not_found' };
            }
            throw new Error('Cloudflare deployment lookup exceeded page limit');
        },
        waitForDeploymentReady,
        async resolveDeploymentScope(id: string): Promise<{ visibility: 'not_found' } | { visibility: 'found'; teamId: string }> {
            const scope = decodeId(id);
            try {
                result(scope.project, await request(`${projectPath(scope.project)}/deployments/${scope.id}`));
                return { visibility: 'found', teamId: account };
            } catch (error) {
                if (error instanceof CloudflareApiError && error.status === 404) return { visibility: 'not_found' };
                throw error;
            }
        },
        async createDeployment(input: {
            name: string; projectId?: string;
            files: Array<{ file: string; sha: string; size: number }>;
            meta: Record<string, string>;
            onCreated?: (deployment: { id: string }) => Promise<void>;
        }): Promise<CloudflareDeployment> {
            const project = safeId.parse(input.projectId);
            const manifest = input.files.length ? preparedManifest : {};
            if (!manifest) throw new Error('Cloudflare assets were not prepared');
            const form = new FormData();
            form.append('manifest', JSON.stringify(manifest));
            form.append('branch', `p-${safeId.parse(input.meta.happyPublicationAttemptId)}`);
            form.append('commit_message', JSON.stringify(input.meta));
            form.append('_headers', new Blob(['/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n']), '_headers');
            const raw = await request(`${projectPath(project)}/deployments`, { method: 'POST', body: form });
            // Checkpoint before readiness polling; ambiguous requests are reconciled by branch + metadata.
            const parsed = result(project, raw);
            await input.onCreated?.({ id: parsed.id });
            staged.clear();
            return waitForDeploymentReady(parsed);
        },
        async deleteDeployment(id: string): Promise<void> {
            const scope = decodeId(id);
            const path = `${projectPath(scope.project)}/deployments/${scope.id}`;
            try {
                result(scope.project, await request(path)); // Never delete production.
                await request(path + '?force=true', { method: 'DELETE' });
            } catch (error) {
                if (error instanceof CloudflareApiError && error.status === 404) return;
                throw error;
            }
        },
    };
}
