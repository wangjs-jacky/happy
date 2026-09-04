import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'minio';
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { interactivePreviewEventSchema, type InteractivePreviewManifest } from '@slopus/happy-wire';
import { runMigrations } from '../../standalone';
import { createPGlite } from '../../storage/pgliteLoader';
import { decryptString, encryptString, initEncrypt } from '../../modules/encrypt';
import { type Fastify } from '../api/types';
import { interactivePreviewRoutes } from '../api/routes/interactivePreviewRoutes';
import { fenceSessionInteractivePreviews } from '../session/sessionDelete';
import { createPreviewCleanup } from './previewCleanup';
import { createPreviewService } from './previewService';
import { createPreviewStorage } from './previewStorage';
import { createVercelCredentialRepository, createVercelCredentialStore } from './vercelCredentialStore';
import { createVercelClient } from './vercelClient';

const accountA = 'account-a';
const accountB = 'account-b';
const sessionA = 'session-a';
const sessionB = 'session-b';
const bucket = 'preview';
const clockStart = new Date();

function after(time: Date, milliseconds: number): Date {
    return new Date(time.getTime() + milliseconds);
}

const ids = {
    primary: '11111111-1111-4111-8111-111111111111',
    concurrentOne: '22222222-2222-4222-8222-222222222222',
    concurrentTwo: '33333333-3333-4333-8333-333333333333',
    concurrentThree: '44444444-4444-4444-8444-444444444444',
    restart: '55555555-5555-4555-8555-555555555555',
    explicitDelete: '66666666-6666-4666-8666-666666666666',
    pendingStaging: '77777777-7777-4777-8777-777777777777',
    fencedExplicitDelete: '88888888-8888-4888-8888-888888888888',
    fencedSessionDelete: '99999999-9999-4999-8999-999999999999',
    fencedDisconnect: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    providerOutage: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    disconnectCheckpoint: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    lateCompensation: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const;

type AssetInput = { id: string; path: string; mimeType: string; bytes: Buffer };
type UploadDescriptor = { assetId: string; method: 'POST'; uploadUrl: string; formFields: Record<string, string> };
type Deployment = {
    id: string;
    url: string;
    readyState: 'QUEUED' | 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'DELETED';
    target: null;
    aliasAssigned: false;
    meta: Record<string, string>;
    projectId: string;
    teamId: string | null;
};

function digest(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function manifest(previewId: string, assets: AssetInput[]): InteractivePreviewManifest {
    return {
        version: 1,
        previewId,
        title: `Preview ${previewId.slice(0, 8)}`,
        assets: assets.map((asset) => ({
            id: asset.id,
            path: asset.path,
            mimeType: asset.mimeType,
            size: asset.bytes.byteLength,
            sha256: digest(asset.bytes),
        })),
    };
}

function readBody(request: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer | Uint8Array | string) => chunks.push(Buffer.from(chunk)));
        request.on('end', () => resolve(Buffer.concat(chunks)));
        request.on('error', reject);
    });
}

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function unescapeXml(value: string): string {
    return value.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function parseMultipart(body: Buffer, contentType: string): { fields: Record<string, string>; file: Buffer | null } {
    const match = /boundary=([^;]+)/i.exec(contentType);
    if (!match) throw new Error('S3 direct upload did not include a multipart boundary');
    const boundary = `--${match[1].replace(/^"|"$/g, '')}`;
    const fields: Record<string, string> = {};
    let file: Buffer | null = null;
    for (const rawPart of body.toString('latin1').split(boundary).slice(1, -1)) {
        const part = rawPart.replace(/^\r\n/, '');
        const separator = part.indexOf('\r\n\r\n');
        if (separator < 0) continue;
        const headers = part.slice(0, separator);
        const value = Buffer.from(part.slice(separator + 4).replace(/\r\n$/, ''), 'latin1');
        const name = /name="([^"]+)"/i.exec(headers)?.[1];
        if (!name) continue;
        if (/filename="/i.test(headers)) file = value;
        else fields[name] = value.toString('utf8');
    }
    return { fields, file };
}

async function eventually(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

/**
 * A deliberately small S3 protocol implementation. The production MinIO client
 * still performs every request over HTTP; this only implements the operations
 * previewStorage invokes: region discovery, POST policy uploads, HEAD/GET,
 * list-prefix, and multi-object delete.
 */
class S3WireServer {
    readonly objects = new Map<string, Buffer>();
    readonly directUploads: Array<{ bucket: string; key: string; bytes: Buffer }> = [];
    readonly deleteBatches: string[][] = [];
    readonly protocolErrors: string[] = [];
    failDeleteRequests = 0;
    server!: Server;
    port!: number;
    storage!: ReturnType<typeof createPreviewStorage>;

    async start(now: () => Date): Promise<void> {
        this.server = createServer((request, response) => {
            void this.handle(request, response).catch((error) => {
                response.statusCode = 500;
                response.end(`<Error><Code>InternalError</Code><Message>${escapeXml(error instanceof Error ? error.message : 'unknown')}</Message></Error>`);
            });
        });
        this.server.listen(0, '127.0.0.1');
        await once(this.server, 'listening');
        this.port = (this.server.address() as { port: number }).port;
        const client = new Client({
            endPoint: '127.0.0.1',
            port: this.port,
            useSSL: false,
            accessKey: 'integration-access',
            secretKey: 'integration-secret',
            region: 'us-east-1',
            pathStyle: true,
        });
        this.storage = createPreviewStorage({ client: client as never, bucket, now });
    }

    async close(): Promise<void> {
        await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }

    seed(key: string, bytes: Buffer): void {
        this.objects.set(key, Buffer.from(bytes));
    }

    private sendXml(response: ServerResponse, statusCode: number, body: string): void {
        response.statusCode = statusCode;
        response.setHeader('content-type', 'application/xml');
        response.end(body);
    }

    private location(request: IncomingMessage): { bucket: string; key: string; url: URL } {
        const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
        const [bucketName = '', ...keyParts] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        return { bucket: bucketName, key: keyParts.join('/'), url };
    }

    private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const location = this.location(request);
        if (location.bucket !== bucket) {
            this.protocolErrors.push(`unexpected bucket ${location.bucket}`);
            return this.sendXml(response, 404, '<Error><Code>NoSuchBucket</Code></Error>');
        }
        if (request.method === 'GET' && location.url.searchParams.has('location')) {
            return this.sendXml(response, 200, '<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>');
        }
        if (request.method === 'POST' && location.url.searchParams.has('delete')) {
            const body = await readBody(request);
            const keys = [...body.toString('utf8').matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) => unescapeXml(match[1]));
            if (!keys.length) this.protocolErrors.push('empty multi-delete request');
            this.deleteBatches.push(keys);
            if (this.failDeleteRequests > 0) {
                this.failDeleteRequests--;
                return this.sendXml(response, 403, '<Error><Code>AccessDenied</Code></Error>');
            }
            for (const key of keys) this.objects.delete(key);
            return this.sendXml(response, 200, '<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>');
        }
        if (request.method === 'GET' && location.key === '') {
            const prefix = location.url.searchParams.get('prefix') || '';
            const contents = [...this.objects.entries()]
                .filter(([key]) => key.startsWith(prefix))
                .map(([key, bytes]) => `<Contents><Key>${escapeXml(key)}</Key><LastModified>2026-09-04T00:00:00.000Z</LastModified><ETag>\"etag\"</ETag><Size>${bytes.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`)
                .join('');
            return this.sendXml(response, 200, `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${escapeXml(prefix)}</Prefix><Marker></Marker><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
        }
        if (request.method === 'POST' && location.key === '') {
            const body = await readBody(request);
            const { fields, file } = parseMultipart(body, String(request.headers['content-type'] || ''));
            const key = fields.key;
            if (fields.bucket !== bucket) this.protocolErrors.push(`POST policy bucket was ${fields.bucket || 'missing'}`);
            if (!key) this.protocolErrors.push('POST policy key was missing');
            if (!file) this.protocolErrors.push('POST policy file was missing');
            if (key && file) {
                this.objects.set(key, file);
                this.directUploads.push({ bucket: location.bucket, key, bytes: file });
            }
            response.statusCode = 204;
            response.end();
            return;
        }
        const object = this.objects.get(location.key);
        if (!object) return this.sendXml(response, 404, '<Error><Code>NoSuchKey</Code></Error>');
        if (request.method === 'HEAD') {
            response.statusCode = 200;
            response.setHeader('content-length', object.byteLength);
            response.setHeader('etag', '"etag"');
            response.setHeader('last-modified', 'Mon, 01 Jan 2040 00:00:00 GMT');
            response.end();
            return;
        }
        if (request.method === 'GET') {
            response.statusCode = 200;
            response.setHeader('content-length', object.byteLength);
            response.setHeader('etag', '"etag"');
            response.end(object);
            return;
        }
        return this.sendXml(response, 405, '<Error><Code>MethodNotAllowed</Code></Error>');
    }
}

/** Local HTTP Vercel API used through the production createVercelClient. */
class VercelWireServer {
    readonly fileUploads: Array<{ digest: string; mimeType: string; bytes: Buffer }> = [];
    readonly createRequests: Array<{ files: Array<{ file: string; sha: string; size: number }>; meta: Record<string, string> }> = [];
    readonly deleteRequests: string[] = [];
    readonly providerScopes: Array<{ operation: 'create' | 'delete'; deploymentId?: string; teamId: string | null }> = [];
    readonly authorization: string[] = [];
    readonly protocolErrors: string[] = [];
    readonly deployments = new Map<string, Deployment>();
    readonly pendingCreates: Array<() => void> = [];
    readonly pendingMetadataLookups: Array<() => void> = [];
    metadataLookups = 0;
    maxFileUploadConcurrency = 0;
    activeFileUploads = 0;
    maxDeploymentConcurrency = 0;
    activeDeployments = 0;
    holdDeploymentCreates = false;
    holdMetadataLookups = false;
    failDeleteRequests = 0;
    failMetadataLookups = 0;
    private readonly delayedVisibility = new Map<string, { visibleAfterLookups: number; readyOnPoll: boolean }>();
    server!: Server;
    port!: number;

    async start(): Promise<void> {
        this.server = createServer((request, response) => {
            void this.handle(request, response).catch((error) => {
                this.sendJson(response, 500, { error: { code: error instanceof Error ? error.message : 'unknown' } });
            });
        });
        this.server.listen(0, '127.0.0.1');
        await once(this.server, 'listening');
        this.port = (this.server.address() as { port: number }).port;
    }

    get origin(): string {
        return `http://127.0.0.1:${this.port}`;
    }

    async close(): Promise<void> {
        await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }

    addReconciledDeployment(previewId: string, publicationAttemptId: string, id = 'dpl_reconciled'): void {
        this.deployments.set(id, {
            id,
            url: `${id}.preview.local`,
            readyState: 'READY',
            target: null,
            aliasAssigned: false,
            meta: { happyPreviewId: previewId, happyPublicationAttemptId: publicationAttemptId },
            projectId: 'prj',
            teamId: null,
        });
    }

    addDelayedDeployment(previewId: string, publicationAttemptId: string, id = 'dpl_delayed'): void {
        this.deployments.set(id, {
            id,
            url: `${id}.preview.local`,
            readyState: 'BUILDING',
            target: null,
            aliasAssigned: false,
            meta: { happyPreviewId: previewId, happyPublicationAttemptId: publicationAttemptId },
            projectId: 'prj',
            teamId: null,
        });
        this.delayedVisibility.set(id, { visibleAfterLookups: this.metadataLookups + 2, readyOnPoll: true });
    }

    releaseOneDeployment(): void {
        const release = this.pendingCreates.shift();
        if (!release) throw new Error('No held Vercel deployment to release');
        release();
    }

    releaseOneMetadataLookup(): void {
        const release = this.pendingMetadataLookups.shift();
        if (!release) throw new Error('No held Vercel metadata lookup to release');
        release();
    }

    private deploymentJson(deployment: Deployment) {
        return {
            id: deployment.id,
            url: deployment.url,
            readyState: deployment.readyState,
            target: deployment.target,
            aliasAssigned: deployment.aliasAssigned,
            meta: deployment.meta,
        };
    }

    private sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
        response.statusCode = statusCode;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(value));
    }

    private projectMarker(): string {
        return `echo happy-preview-owner:${createHash('sha256').update('cfg-a').digest('hex').slice(0, 16)}`;
    }

    private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const url = new URL(request.url || '/', this.origin);
        const authorization = request.headers.authorization;
        if (typeof authorization === 'string') this.authorization.push(authorization);
        if (url.pathname === '/v9/projects/prj' && request.method === 'GET') {
            return this.sendJson(response, 200, { id: 'prj', name: 'happy-previews', installCommand: this.projectMarker() });
        }
        if (url.pathname === '/v6/deployments' && request.method === 'GET') {
            this.metadataLookups++;
            if (this.failMetadataLookups > 0) {
                this.failMetadataLookups--;
                return this.sendJson(response, 503, { error: { code: 'provider_unavailable' } });
            }
            if (this.holdMetadataLookups) await new Promise<void>((resolve) => this.pendingMetadataLookups.push(resolve));
            const matching = [...this.deployments.values()].filter((deployment) =>
                deployment.projectId === url.searchParams.get('projectId')
                && deployment.meta.happyPreviewId === url.searchParams.get('meta-happyPreviewId')
                && deployment.meta.happyPublicationAttemptId === url.searchParams.get('meta-happyPublicationAttemptId')
                && (this.delayedVisibility.get(deployment.id)?.visibleAfterLookups ?? 0) <= this.metadataLookups,
            );
            return this.sendJson(response, 200, { deployments: matching.map((deployment) => this.deploymentJson(deployment)) });
        }
        if (url.pathname === '/v2/files' && request.method === 'POST') {
            this.activeFileUploads++;
            this.maxFileUploadConcurrency = Math.max(this.maxFileUploadConcurrency, this.activeFileUploads);
            const bytes = await readBody(request);
            const digest = String(request.headers['x-vercel-digest'] || '');
            if (!/^[a-f0-9]{40}$/.test(digest) || createHash('sha1').update(bytes).digest('hex') !== digest) {
                this.protocolErrors.push('invalid Vercel file digest');
                this.activeFileUploads--;
                return this.sendJson(response, 400, { error: { code: 'invalid_file_digest' } });
            }
            this.fileUploads.push({
                digest,
                mimeType: String(request.headers['content-type'] || ''),
                bytes,
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            this.activeFileUploads--;
            return this.sendJson(response, 200, {});
        }
        if (url.pathname === '/v13/deployments' && request.method === 'POST') {
            const requestBody = JSON.parse((await readBody(request)).toString('utf8')) as { files: Array<{ file: string; sha: string; size: number }>; meta: Record<string, string> };
            if (requestBody.files.some((file) => !/^[a-f0-9]{40}$/.test(file.sha)
                || this.fileUploads.find((upload) => upload.digest === file.sha)?.bytes.byteLength !== file.size)) {
                this.protocolErrors.push('invalid Vercel deployment file reference');
                return this.sendJson(response, 400, { error: { code: 'invalid_file_reference' } });
            }
            this.createRequests.push({ files: requestBody.files, meta: requestBody.meta });
            this.providerScopes.push({ operation: 'create', teamId: url.searchParams.get('teamId') });
            const id = `dpl_${this.createRequests.length}`;
            this.activeDeployments++;
            this.maxDeploymentConcurrency = Math.max(this.maxDeploymentConcurrency, this.activeDeployments);
            const respond = () => {
                this.activeDeployments--;
                const deployment: Deployment = {
                    id,
                    url: `${id}.preview.local`,
                    readyState: 'READY',
                    target: null,
                    aliasAssigned: false,
                    meta: requestBody.meta,
                    projectId: 'prj',
                    teamId: url.searchParams.get('teamId'),
                };
                this.deployments.set(id, deployment);
                this.sendJson(response, 200, this.deploymentJson(deployment));
            };
            if (this.holdDeploymentCreates) {
                this.pendingCreates.push(respond);
                return;
            }
            respond();
            return;
        }
        const deploymentId = /^\/v13\/deployments\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1];
        if (deploymentId && request.method === 'GET') {
            const deployment = this.deployments.get(deploymentId);
            if (!deployment) return this.sendJson(response, 404, { error: { code: 'not_found' } });
            const delayed = this.delayedVisibility.get(deploymentId);
            if (delayed?.readyOnPoll && deployment.readyState === 'BUILDING') deployment.readyState = 'READY';
            return this.sendJson(response, 200, this.deploymentJson(deployment));
        }
        if (deploymentId && request.method === 'DELETE') {
            this.deleteRequests.push(deploymentId);
            this.providerScopes.push({ operation: 'delete', deploymentId, teamId: url.searchParams.get('teamId') });
            if (this.failDeleteRequests > 0) {
                this.failDeleteRequests--;
                return this.sendJson(response, 503, { error: { code: 'provider_unavailable' } });
            }
            const deployment = this.deployments.get(deploymentId);
            if (deployment && deployment.teamId !== url.searchParams.get('teamId')) return this.sendJson(response, 404, { error: { code: 'not_found' } });
            this.deployments.delete(deploymentId);
            return this.sendJson(response, 200, {});
        }
        return this.sendJson(response, 404, { error: { code: 'not_found' } });
    }
}

async function createApp(service: ReturnType<typeof createPreviewService>): Promise<Fastify> {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        if (typeof request.headers['x-user-id'] !== 'string') return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = request.headers['x-user-id'];
    });
    interactivePreviewRoutes(typed, service);
    await typed.ready();
    return typed;
}

class PreviewHarness {
    readonly directory: string;
    readonly s3 = new S3WireServer();
    readonly vercel = new VercelWireServer();
    clock = new Date(clockStart);
    database!: PrismaClient;
    pglite!: PGlite;
    credentialPaths: string[][] = [];
    credentialStore!: ReturnType<typeof createVercelCredentialStore>;
    service!: ReturnType<typeof createPreviewService>;
    app!: Fastify;

    private constructor(directory: string) {
        this.directory = directory;
    }

    static async create(): Promise<PreviewHarness> {
        const harness = new PreviewHarness(await mkdtemp(join(tmpdir(), 'happy-preview-pglite-')));
        await runMigrations({ pgliteDir: harness.directory });
        await harness.openDatabase();
        await harness.database.account.createMany({ data: [
            { id: accountA, publicKey: 'public-key-a' },
            { id: accountB, publicKey: 'public-key-b' },
        ] });
        await harness.database.session.createMany({ data: [
            { id: sessionA, accountId: accountA, tag: 'session-a', metadata: '{}' },
            { id: sessionB, accountId: accountB, tag: 'session-b', metadata: '{}' },
        ] });
        await harness.s3.start(() => harness.clock);
        await harness.vercel.start();
        await harness.recreateApplication();
        return harness;
    }

    async restart(): Promise<void> {
        await this.app.close();
        await this.database.$disconnect();
        await this.pglite.close();
        await this.openDatabase();
        await this.recreateApplication();
    }

    async close(): Promise<void> {
        await Promise.allSettled([
            this.app?.close(),
            this.database?.$disconnect(),
            this.pglite?.close(),
            this.s3.close(),
            this.vercel.close(),
        ]);
        await rm(this.directory, { recursive: true, force: true });
    }

    cleanup() {
        return createPreviewCleanup({
            database: this.database as never,
            storage: this.s3.storage as never,
            credentialStore: this.credentialStore as never,
            clientFactory: this.clientFactory as never,
            now: () => new Date(this.clock),
            recoverPublications: (time) => this.service.recoverStalePublications(time),
        });
    }

    async setCredentials(): Promise<void> {
        await this.credentialStore.set(accountA, { version: 1, accessToken: 'token-account-a', configurationId: 'cfg-a', projectId: 'prj' });
        await this.credentialStore.set(accountB, { version: 1, accessToken: 'token-account-b', configurationId: 'cfg-b', projectId: 'prj-b' });
    }

    async createAndUpload(previewId: string, assets: AssetInput[]): Promise<void> {
        const body = manifest(previewId, assets);
        const response = await this.app.inject({
            method: 'POST',
            url: `/v1/sessions/${sessionA}/previews/${previewId}/draft`,
            headers: { 'x-user-id': accountA },
            payload: body,
        });
        expect(response.statusCode, response.body).toBe(200);
        const draft = response.json() as { previewId: string; uploads: UploadDescriptor[] };
        expect(draft.previewId).toBe(previewId);
        for (const asset of assets) {
            const upload = draft.uploads.find((candidate) => candidate.assetId === asset.id);
            if (!upload) throw new Error(`Missing upload descriptor for ${asset.id}`);
            const form = new FormData();
            for (const [key, value] of Object.entries(upload.formFields)) form.set(key, value);
            form.set('file', new Blob([asset.bytes], { type: asset.mimeType }), `${asset.id}.bin`);
            const direct = await fetch(upload.uploadUrl, { method: upload.method, body: form as any });
            expect(direct.status).toBe(204);
            const completed = await this.app.inject({
                method: 'POST',
                url: `/v1/sessions/${sessionA}/previews/${previewId}/assets/${asset.id}/uploaded`,
                headers: { 'x-user-id': accountA },
            });
            expect(completed.statusCode, completed.body).toBe(200);
        }
    }

    private readonly clientFactory = (options: { token: string; teamId?: string }) => createVercelClient({
        ...options,
        apiOrigin: this.vercel.origin,
        sleep: async () => {},
        pollIntervalMs: 0,
        deploymentTimeoutMs: 5_000,
    });

    private async openDatabase(): Promise<void> {
        this.pglite = createPGlite(this.directory);
        this.database = new PrismaClient({ adapter: new PrismaPGlite(this.pglite) } as never);
        await this.database.$connect();
    }

    private async recreateApplication(): Promise<void> {
        this.credentialPaths = [];
        this.credentialStore = createVercelCredentialStore({
            repository: createVercelCredentialRepository(this.database as never),
            encrypt: (path, value) => {
                this.credentialPaths.push([...path]);
                return encryptString(path, value);
            },
            decrypt: (path, value) => {
                this.credentialPaths.push([...path]);
                return decryptString(path, value);
            },
        });
        this.service = createPreviewService({
            database: this.database as never,
            storage: this.s3.storage as never,
            credentialStore: this.credentialStore as never,
            clientFactory: this.clientFactory as never,
            now: () => new Date(this.clock),
        });
        this.app = await createApp(this.service);
    }
}

describe('interactive preview persisted integration', () => {
    const harnesses: PreviewHarness[] = [];

    beforeAll(async () => {
        process.env.HANDY_MASTER_SECRET ||= 'interactive-preview-integration-master-secret';
        await initEncrypt();
    });

    afterEach(async () => {
        await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
    });

    async function setup(): Promise<PreviewHarness> {
        const harness = await PreviewHarness.create();
        harnesses.push(harness);
        await harness.setCredentials();
        return harness;
    }

    it('persists an authenticated draft through direct S3 upload and emits a typed ready event after sequential Vercel publication', async () => {
        const harness = await setup();
        const assets = [
            { id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>preview</h1>') },
            { id: 'app', path: 'app.js', mimeType: 'text/javascript', bytes: Buffer.from('console.log("preview")') },
        ];

        await harness.createAndUpload(ids.primary, assets);
        const persisted = await harness.database.interactivePreview.findUnique({ where: { id: ids.primary }, include: { assets: true } });
        expect(persisted?.assets.map((asset) => asset.storageKey)).toHaveLength(2);
        expect(harness.s3.directUploads).toEqual(expect.arrayContaining(assets.map((asset) => expect.objectContaining({ bucket, bytes: asset.bytes }))));
        expect(new Set(harness.s3.directUploads.map((upload) => upload.key))).toEqual(new Set(persisted?.assets.map((asset) => asset.storageKey)));

        const published = await harness.app.inject({
            method: 'POST',
            url: `/v1/sessions/${sessionA}/previews/${ids.primary}/publish`,
            headers: { 'x-user-id': accountA },
        });
        expect(published.statusCode, published.body).toBe(200);
        const event = interactivePreviewEventSchema.parse(published.json().preview);
        expect(event).toMatchObject({ version: 1, id: ids.primary, state: 'ready', url: 'https://dpl_1.preview.local' });
        expect(harness.vercel.fileUploads.map((upload) => upload.bytes)).toEqual([
            ...(persisted?.assets.map((asset) => assets.find((candidate) => candidate.id === asset.id)?.bytes) || []),
            Buffer.from(JSON.stringify({ headers: [{ source: '/(.*)', headers: [
                { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'no-referrer' },
            ] }] })),
        ]);
        expect(harness.vercel.maxFileUploadConcurrency).toBe(1);
        expect(harness.vercel.fileUploads.every((upload) => upload.digest === createHash('sha1').update(upload.bytes).digest('hex'))).toBe(true);
        expect(harness.vercel.createRequests[0]?.files.every((file) => /^[a-f0-9]{40}$/.test(file.sha))).toBe(true);
        expect(harness.vercel.protocolErrors).toEqual([]);
        const stagingPrefix = persisted!.assets[0]!.storageKey.slice(0, persisted!.assets[0]!.storageKey.lastIndexOf('/') + 1);
        expect([...harness.s3.objects.keys()].filter((key) => key.startsWith(stagingPrefix))).toEqual([]);
        expect(harness.s3.protocolErrors).toEqual([]);

        const credentials = await harness.database.serviceAccountToken.findMany({ orderBy: { accountId: 'asc' } });
        expect(credentials.map((row) => row.accountId)).toEqual([accountA, accountB]);
        expect(credentials.every((row) => !Buffer.from(row.token).includes(Buffer.from('token-account')))).toBe(true);
        expect(harness.credentialPaths).toEqual(expect.arrayContaining([
            ['user', accountA, 'providers', 'vercel', 'credential'],
            ['user', accountB, 'providers', 'vercel', 'credential'],
        ]));
        expect(harness.vercel.authorization.every((header) => header === 'Bearer token-account-a')).toBe(true);

        const wrongAccount = { 'x-user-id': accountB };
        expect((await harness.app.inject({ method: 'GET', url: `/v1/sessions/${sessionA}/previews`, headers: wrongAccount })).statusCode).toBe(404);
        expect((await harness.app.inject({ method: 'POST', url: `/v1/sessions/${sessionA}/previews/${ids.primary}/assets/index/uploaded`, headers: wrongAccount })).statusCode).toBe(404);
        expect((await harness.app.inject({ method: 'POST', url: `/v1/sessions/${sessionA}/previews/${ids.primary}/publish`, headers: wrongAccount })).statusCode).toBe(404);
        expect((await harness.app.inject({ method: 'DELETE', url: `/v1/sessions/${sessionA}/previews/${ids.primary}`, headers: wrongAccount })).statusCode).toBe(404);
        expect((await harness.app.inject({ method: 'POST', url: `/v1/sessions/${sessionB}/previews/${ids.primary}/publish`, headers: wrongAccount })).statusCode).toBe(404);
    }, 30_000);

    it('finishes and cleans an existing persisted legacy staging object without touching sibling legacy prefixes', async () => {
        const harness = await setup();
        const previewId = '39393939-3939-4939-8939-393939393939';
        const bytes = Buffer.from('<h1>legacy</h1>');
        const assets = [{ id: 'legacy_asset', path: 'index.html', mimeType: 'text/html', bytes }];
        const draft = await harness.app.inject({ method: 'POST', url: `/v1/sessions/${sessionA}/previews/${previewId}/draft`, headers: { 'x-user-id': accountA }, payload: manifest(previewId, assets) });
        expect(draft.statusCode).toBe(200);
        const legacyKey = `private/interactive-previews/${previewId}/legacy_asset`;
        const siblingKey = `private/interactive-previews/${previewId}/sibling_asset`;
        await harness.database.interactivePreviewAsset.update({ where: { previewId_id: { previewId, id: 'legacy_asset' } }, data: { storageKey: legacyKey } });
        harness.s3.seed(legacyKey, bytes);
        harness.s3.seed(siblingKey, Buffer.from('must-survive'));

        const completed = await harness.app.inject({ method: 'POST', url: `/v1/sessions/${sessionA}/previews/${previewId}/assets/legacy_asset/uploaded`, headers: { 'x-user-id': accountA } });
        expect(completed.statusCode, completed.body).toBe(200);
        const published = await harness.app.inject({ method: 'POST', url: `/v1/sessions/${sessionA}/previews/${previewId}/publish`, headers: { 'x-user-id': accountA } });
        expect(published.statusCode, published.body).toBe(200);

        expect(harness.s3.deleteBatches.flat()).toContain(legacyKey);
        expect(harness.s3.deleteBatches.flat()).not.toContain(siblingKey);
        expect(harness.s3.objects.has(legacyKey)).toBe(false);
        expect(harness.s3.objects.get(siblingKey)).toEqual(Buffer.from('must-survive'));
    }, 30_000);

    it('holds three persisted previews to two active publication jobs and does not duplicate an in-flight deployment', async () => {
        const harness = await setup();
        const assetsFor = (id: string): AssetInput[] => [
            { id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from(`<h1>${id}</h1>`) },
            { id: 'app', path: 'app.js', mimeType: 'text/javascript', bytes: Buffer.from(`console.log('${id}')`) },
        ];
        for (const id of [ids.concurrentOne, ids.concurrentTwo, ids.concurrentThree]) await harness.createAndUpload(id, assetsFor(id));
        harness.vercel.holdDeploymentCreates = true;

        const publishes = [ids.concurrentOne, ids.concurrentTwo, ids.concurrentThree].map((previewId) =>
            harness.service.publish(accountA, sessionA, previewId),
        );
        await eventually(() => harness.vercel.createRequests.length === 2, 'the first two provider deployment requests');
        expect(harness.vercel.maxDeploymentConcurrency).toBe(2);
        const duplicate = await harness.service.publish(accountA, sessionA, harness.vercel.createRequests[0]!.meta.happyPreviewId!);
        expect(duplicate.state).toBe('publishing');
        expect(harness.vercel.createRequests).toHaveLength(2);

        // Let the queued job complete as soon as one of the two held jobs frees
        // a gate slot; it must not create while both held requests are active.
        harness.vercel.holdDeploymentCreates = false;
        harness.vercel.releaseOneDeployment();
        harness.vercel.releaseOneDeployment();
        const responses = await Promise.all(publishes);
        expect(responses.map((response) => response.state)).toEqual(['ready', 'ready', 'ready']);
        expect(harness.vercel.createRequests).toHaveLength(3);
        expect(harness.vercel.maxDeploymentConcurrency).toBe(2);
    }, 30_000);

    it('lets a recovery claim finish a delayed publisher deployment without the publisher deleting the matching ready result', async () => {
        const harness = await setup();
        const previewId = '48484848-4848-4484-8484-484848484848';
        await harness.createAndUpload(previewId, [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>race</h1>') }]);
        harness.vercel.holdDeploymentCreates = true;
        const publication = harness.service.publish(accountA, sessionA, previewId);
        await eventually(() => harness.vercel.createRequests.length === 1, 'the delayed publisher create');
        await harness.database.interactivePreview.update({ where: { id: previewId }, data: { updatedAt: after(clockStart, -16 * 60 * 1000), publicationReconcileNextAttemptAt: new Date(clockStart) } });
        harness.vercel.holdMetadataLookups = true;
        const recovery = harness.service.recoverStalePublications(after(clockStart, 16 * 60 * 1000));
        await eventually(() => harness.vercel.pendingMetadataLookups.length === 1, 'the recovery metadata claim');
        harness.vercel.holdDeploymentCreates = false;
        harness.vercel.releaseOneDeployment();
        await eventually(() => harness.vercel.deployments.has('dpl_1'), 'the delayed provider deployment');
        harness.vercel.holdMetadataLookups = false;
        harness.vercel.releaseOneMetadataLookup();

        await expect(publication).rejects.toThrow(/fenced|publish/i);
        await recovery;
        expect(await harness.database.interactivePreview.findUnique({ where: { id: previewId } })).toMatchObject({ status: 'ready', vercelDeploymentId: 'dpl_1' });
        expect(harness.vercel.deleteRequests).toEqual([]);
        expect(harness.vercel.deployments.has('dpl_1')).toBe(true);
    }, 30_000);

    it('fences an old-team publisher on reconnect and compensates through its old provider scope', async () => {
        const harness = await setup();
        const previewId = '49494949-4949-4494-8494-494949494949';
        await harness.credentialStore.set(accountA, { version: 1, accessToken: 'token-old-team', configurationId: 'cfg-a', teamId: 'team-old', projectId: 'prj' });
        await harness.createAndUpload(previewId, [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>reconnect</h1>') }]);
        harness.vercel.holdDeploymentCreates = true;
        const publication = harness.service.publish(accountA, sessionA, previewId);
        await eventually(() => harness.vercel.createRequests.length === 1, 'the old-team delayed deployment');

        await harness.service.reconnectVercel(accountA, { version: 1, accessToken: 'token-new-team', configurationId: 'cfg-a', teamId: 'team-new' });
        expect(await harness.database.account.findUnique({ where: { id: accountA } })).toMatchObject({ vercelConnectionEpoch: 1 });
        expect(await harness.database.interactivePreview.findUnique({ where: { id: previewId } })).toMatchObject({ status: 'deleting', url: null });
        expect(await harness.credentialStore.get(accountA)).toMatchObject({ accessToken: 'token-new-team', teamId: 'team-new' });

        harness.vercel.holdDeploymentCreates = false;
        harness.vercel.releaseOneDeployment();
        await expect(publication).rejects.toThrow(/connection changed/i);

        expect(harness.vercel.providerScopes).toContainEqual({ operation: 'create', teamId: 'team-old' });
        expect(harness.vercel.providerScopes).toContainEqual({ operation: 'delete', deploymentId: 'dpl_1', teamId: 'team-old' });
        expect(harness.vercel.deployments.has('dpl_1')).toBe(false);
        expect(await harness.database.interactivePreview.findUnique({ where: { id: previewId } })).toMatchObject({ status: 'expired', vercelDeploymentId: null });
    }, 30_000);

    it('restarts over PGlite and lets the scheduler alone recover a delayed visible deployment without a second create', async () => {
        const harness = await setup();
        const assets = [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>recovery</h1>') }];
        await harness.createAndUpload(ids.restart, assets);
        const publicationAttemptId = 'attempt-reconcile';
        const recoveryTime = after(clockStart, 16 * 60 * 1000);
        await harness.database.interactivePreview.update({ where: { id: ids.restart }, data: {
            status: 'publishing', publicationAttemptId, publicationGeneration: 1, publicationCreateStartedAt: new Date(clockStart), updatedAt: new Date(clockStart),
        } });
        harness.vercel.addDelayedDeployment(ids.restart, publicationAttemptId);

        await harness.restart();
        await harness.cleanup().cleanupExpired(recoveryTime);
        await harness.cleanup().cleanupExpired(after(recoveryTime, 60_000));
        const recovered = await harness.database.interactivePreview.findUnique({ where: { id: ids.restart } });
        expect(recovered).toMatchObject({ status: 'ready', vercelDeploymentId: 'dpl_delayed', url: 'https://dpl_delayed.preview.local' });
        expect(harness.vercel.metadataLookups).toBeGreaterThan(0);
        expect(harness.vercel.createRequests).toHaveLength(0);
        expect(harness.vercel.fileUploads).toHaveLength(0);

        const ready = await harness.database.interactivePreview.findUnique({ where: { id: ids.restart }, include: { assets: true } });
        if (!ready) throw new Error('Recovered preview row was not persisted');
        harness.s3.seed(ready.assets[0].storageKey, assets[0].bytes);
        const firstCleanup = after(clockStart, 60 * 60 * 1000);
        await harness.database.interactivePreview.update({ where: { id: ids.restart }, data: {
            status: 'deleting', url: null, expiresAt: firstCleanup, cleanupClaimedAt: null, cleanupRetryCount: 0, cleanupNextAttemptAt: null,
        } });
        harness.vercel.failDeleteRequests = 3;
        await harness.cleanup().cleanupExpired(firstCleanup);
        let tombstone = await harness.database.interactivePreview.findUnique({ where: { id: ids.restart } });
        expect(tombstone).toMatchObject({ status: 'deleting', vercelDeploymentId: 'dpl_delayed', cleanupRetryCount: 1, cleanupNextAttemptAt: after(firstCleanup, 60_000) });
        const failedDeleteRequests = harness.vercel.deleteRequests.length;
        await harness.cleanup().cleanupExpired(after(firstCleanup, 30_000));
        expect(harness.vercel.deleteRequests).toHaveLength(failedDeleteRequests);

        await harness.restart();
        await harness.cleanup().cleanupExpired(after(firstCleanup, 60_000));
        tombstone = await harness.database.interactivePreview.findUnique({ where: { id: ids.restart } });
        expect(tombstone).toMatchObject({ status: 'expired', vercelDeploymentId: null });
        expect(harness.vercel.deployments.has('dpl_delayed')).toBe(false);
        expect([...harness.s3.objects.keys()].filter((key) => key.includes(`/${ids.restart}/`))).toEqual([]);
    }, 30_000);

    it.each([
        ['explicit delete', ids.fencedExplicitDelete, async (harness: PreviewHarness, previewId: string) => {
            const response = await harness.app.inject({ method: 'DELETE', url: `/v1/sessions/${sessionA}/previews/${previewId}`, headers: { 'x-user-id': accountA } });
            expect(response.statusCode).toBe(200);
        }],
        ['session deletion', ids.fencedSessionDelete, async (harness: PreviewHarness, previewId: string) => {
            await harness.database.$transaction(async (tx) => {
                await fenceSessionInteractivePreviews(tx as never, accountA, sessionA);
                await tx.session.delete({ where: { id: sessionA } });
            });
        }],
        ['disconnect', ids.fencedDisconnect, async (harness: PreviewHarness) => {
            const result = await harness.service.disconnectVercel(accountA);
            expect(result).toEqual({ warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' });
            expect(await harness.credentialStore.get(accountA)).toBeNull();
        }],
    ])('keeps a %s tombstone when a publisher is fenced before its delayed create response and compensation fails', async (_label, previewId, fence) => {
        const harness = await setup();
        await harness.createAndUpload(previewId, [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from(`<h1>${previewId}</h1>`) }]);
        harness.vercel.holdDeploymentCreates = true;
        const publication = harness.service.publish(accountA, sessionA, previewId);
        await eventually(() => harness.vercel.createRequests.length === 1, 'the delayed provider create request');
        harness.vercel.failDeleteRequests = 3;
        await fence(harness, previewId);
        harness.vercel.holdDeploymentCreates = false;
        harness.vercel.releaseOneDeployment();
        await expect(publication).rejects.toThrow(/fenced|publish/i);

        const tombstone = await harness.database.interactivePreview.findUnique({ where: { id: previewId } });
        expect(tombstone).toMatchObject({ status: 'deleting', vercelDeploymentId: 'dpl_1', errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' });
        expect(tombstone?.cleanupNextAttemptAt).toBeInstanceOf(Date);
        expect(tombstone?.cleanupRetryCount).toBeGreaterThan(0);
        expect(harness.vercel.deployments.has('dpl_1')).toBe(true);
    }, 30_000);

    it('does not expire a deleting unresolved create attempt while Vercel metadata is still invisible', async () => {
        const harness = await setup();
        await harness.createAndUpload(ids.primary, [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>unresolved</h1>') }]);
        const attempt = 'attempt-not-yet-visible';
        const cleanupTime = after(clockStart, 16 * 60 * 1000);
        await harness.database.interactivePreview.update({ where: { id: ids.primary }, data: {
            status: 'deleting', publicationAttemptId: attempt, publicationCreateStartedAt: new Date(clockStart),
            publicationGeneration: 1, publicationReconcileNextAttemptAt: new Date(clockStart), updatedAt: new Date(clockStart),
        } });

        await harness.cleanup().cleanupExpired(cleanupTime);

        expect(await harness.database.interactivePreview.findUnique({ where: { id: ids.primary } })).toMatchObject({
            status: 'deleting', vercelDeploymentId: null, errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING',
            cleanupNextAttemptAt: after(cleanupTime, 60_000), publicationReconcileNextAttemptAt: after(cleanupTime, 60_000),
        });
    }, 30_000);

    it('moves an expired create-started attempt into durable deleting reconciliation when Vercel metadata returns 503', async () => {
        const harness = await setup();
        const assets = [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>outage</h1>') }];
        await harness.createAndUpload(ids.providerOutage, assets);
        const expiry = after(clockStart, 2 * 60 * 60 * 1000);
        await harness.database.interactivePreview.update({ where: { id: ids.providerOutage }, data: {
            status: 'publishing', publicationAttemptId: 'attempt-provider-503', publicationGeneration: 1,
            publicationCreateStartedAt: clockStart, publicationReconcileNextAttemptAt: clockStart,
            expiresAt: expiry, updatedAt: clockStart,
        } });
        harness.vercel.failMetadataLookups = 3;

        await harness.cleanup().cleanupExpired(expiry);

        const row = await harness.database.interactivePreview.findUnique({ where: { id: ids.providerOutage }, include: { assets: true } });
        expect(row).toMatchObject({
            status: 'deleting', vercelDeploymentId: null, publicationAttemptId: 'attempt-provider-503',
            publicationCreateStartedAt: clockStart, errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING',
            publicationReconcileNextAttemptAt: after(expiry, 60_000), cleanupNextAttemptAt: after(expiry, 60_000),
        });
        expect(row?.assets.every((asset) => harness.s3.objects.has(asset.storageKey))).toBe(true);
        expect(harness.vercel.deleteRequests).toEqual([]);
    }, 30_000);

    it('reconciles every expired ambiguous create across batches before ordinary cleanup can claim an overflow row', async () => {
        const harness = await setup();
        const expiry = after(clockStart, 2 * 60 * 60 * 1000);
        const rows = Array.from({ length: 51 }, (_, index) => {
            const id = `bulk-expiry-${String(index + 1).padStart(2, '0')}`;
            return {
                id, accountId: accountA, sessionId: sessionA, title: `Bulk ${index + 1}`, status: 'publishing',
                manifest: manifest(id, [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>bulk</h1>') }]) as any,
                expiresAt: expiry, stagingGeneration: `bulk-generation-${index + 1}`,
                publicationAttemptId: `attempt-bulk-${index + 1}`, publicationGeneration: 1,
                publicationCreateStartedAt: clockStart, publicationReconcileNextAttemptAt: clockStart,
                createdAt: clockStart, updatedAt: clockStart,
            };
        });
        await harness.database.interactivePreview.createMany({ data: rows });
        harness.vercel.failMetadataLookups = rows.length * 3;

        await harness.cleanup().cleanupExpired(expiry);

        const persisted = await harness.database.interactivePreview.findMany({ where: { id: { in: rows.map((row) => row.id) } }, orderBy: { id: 'asc' } });
        expect(persisted).toHaveLength(51);
        expect(persisted.every((row) => row.status === 'deleting' && row.vercelDeploymentId === null && row.publicationCreateStartedAt !== null)).toBe(true);
        expect(persisted.every((row) => row.publicationReconcileNextAttemptAt?.getTime() === after(expiry, 60_000).getTime())).toBe(true);
    }, 30_000);

    it('retries only OSS cleanup after disconnect checkpointed a successful provider deletion and removed the credential', async () => {
        const harness = await setup();
        const assets = [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>disconnect checkpoint</h1>') }];
        await harness.createAndUpload(ids.disconnectCheckpoint, assets);
        const attempt = 'attempt-disconnect-checkpoint';
        harness.vercel.addReconciledDeployment(ids.disconnectCheckpoint, attempt, 'dpl_disconnect_checkpoint');
        await harness.database.interactivePreview.update({ where: { id: ids.disconnectCheckpoint }, data: {
            status: 'ready', vercelDeploymentId: 'dpl_disconnect_checkpoint', publicationAttemptId: attempt,
            publicationGeneration: 1, publicationCreateStartedAt: clockStart,
        } });
        harness.s3.failDeleteRequests = 1;

        await expect(harness.service.disconnectVercel(accountA)).resolves.toEqual({ warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' });

        expect(await harness.database.interactivePreview.findUnique({ where: { id: ids.disconnectCheckpoint } })).toMatchObject({
            status: 'deleting', vercelDeploymentId: null, publicationAttemptId: null, publicationCreateStartedAt: null,
        });
        expect(await harness.credentialStore.get(accountA)).toBeNull();
        expect(harness.vercel.deleteRequests).toEqual(['dpl_disconnect_checkpoint']);

        await harness.cleanup().cleanupExpired(after(clockStart, 1));

        expect(await harness.database.interactivePreview.findUnique({ where: { id: ids.disconnectCheckpoint } })).toMatchObject({ status: 'expired', vercelDeploymentId: null });
        expect(harness.vercel.deleteRequests).toEqual(['dpl_disconnect_checkpoint']);
    }, 30_000);

    it('checkpoints and completes a successful late compensation after an explicit delete fences publication', async () => {
        const harness = await setup();
        const assets = [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>late compensation</h1>') }];
        await harness.createAndUpload(ids.lateCompensation, assets);
        harness.vercel.holdDeploymentCreates = true;
        const publication = harness.service.publish(accountA, sessionA, ids.lateCompensation);
        await eventually(() => harness.vercel.createRequests.length === 1, 'the held late-compensation deployment');
        const deleted = await harness.app.inject({ method: 'DELETE', url: `/v1/sessions/${sessionA}/previews/${ids.lateCompensation}`, headers: { 'x-user-id': accountA } });
        expect(deleted.statusCode).toBe(200);
        harness.vercel.holdDeploymentCreates = false;
        harness.vercel.releaseOneDeployment();

        await expect(publication).rejects.toThrow(/fenced|publish/i);

        expect(await harness.database.interactivePreview.findUnique({ where: { id: ids.lateCompensation } })).toMatchObject({
            status: 'expired', vercelDeploymentId: null, publicationAttemptId: null, publicationCreateStartedAt: null,
        });
        expect(harness.vercel.deleteRequests).toEqual(['dpl_1']);
        expect([...harness.s3.objects.keys()].filter((key) => key.includes(`/${ids.lateCompensation}/`))).toEqual([]);
    }, 30_000);

    it('keeps an explicit delete durable through provider failure, then prunes its expired tombstone after thirty days', async () => {
        const harness = await setup();
        await harness.createAndUpload(ids.explicitDelete, [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>delete</h1>') }]);
        const published = await harness.app.inject({
            method: 'POST', url: `/v1/sessions/${sessionA}/previews/${ids.explicitDelete}/publish`, headers: { 'x-user-id': accountA },
        });
        expect(published.statusCode).toBe(200);
        const deleted = await harness.app.inject({
            method: 'DELETE', url: `/v1/sessions/${sessionA}/previews/${ids.explicitDelete}`, headers: { 'x-user-id': accountA },
        });
        expect(deleted.statusCode).toBe(200);
        harness.vercel.failDeleteRequests = 3;
        const firstCleanup = after(clockStart, 2 * 60 * 60 * 1000);
        await harness.cleanup().cleanupExpired(firstCleanup);
        expect(await harness.database.interactivePreview.findUnique({ where: { id: ids.explicitDelete } })).toMatchObject({
            status: 'deleting', cleanupRetryCount: 1, cleanupNextAttemptAt: after(firstCleanup, 60_000),
        });
        await harness.cleanup().cleanupExpired(after(firstCleanup, 60_000));
        expect(await harness.database.interactivePreview.findUnique({ where: { id: ids.explicitDelete } })).toMatchObject({ status: 'expired', vercelDeploymentId: null });

        await harness.database.interactivePreview.update({ where: { id: ids.explicitDelete }, data: { updatedAt: new Date(clockStart) } });
        await harness.cleanup().cleanupExpired(after(clockStart, 31 * 24 * 60 * 60 * 1000));
        expect(await harness.database.interactivePreview.findUnique({ where: { id: ids.explicitDelete } })).toBeNull();
    }, 30_000);

    it('retries failed ready-stage cleanup without deleting the live Vercel deployment', async () => {
        const harness = await setup();
        await harness.createAndUpload(ids.pendingStaging, [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>staging</h1>') }]);
        harness.s3.failDeleteRequests = 1;
        const published = await harness.app.inject({
            method: 'POST', url: `/v1/sessions/${sessionA}/previews/${ids.pendingStaging}/publish`, headers: { 'x-user-id': accountA },
        });
        expect(published.statusCode).toBe(200);
        const ready = await harness.database.interactivePreview.findUnique({ where: { id: ids.pendingStaging } });
        expect(ready).toMatchObject({ status: 'ready', stagingCleanupPending: true, vercelDeploymentId: 'dpl_1' });
        if (!ready?.publishedAt) throw new Error('Ready preview did not persist its publication time');

        await harness.cleanup().cleanupExpired(new Date(ready.publishedAt.getTime() + 60_000));
        const retried = await harness.database.interactivePreview.findUnique({ where: { id: ids.pendingStaging } });
        expect(retried).toMatchObject({ status: 'ready', stagingCleanupPending: false, vercelDeploymentId: 'dpl_1' });
        expect(harness.vercel.deleteRequests).toEqual([]);
        expect(harness.vercel.deployments.has('dpl_1')).toBe(true);
    }, 30_000);
});
