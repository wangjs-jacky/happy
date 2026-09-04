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
} as const;

type AssetInput = { id: string; path: string; mimeType: string; bytes: Buffer };
type UploadDescriptor = { assetId: string; method: 'POST'; uploadUrl: string; formFields: Record<string, string> };
type Deployment = {
    id: string;
    url: string;
    readyState: 'READY';
    target: null;
    aliasAssigned: false;
    meta: Record<string, string>;
    projectId: string;
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

async function eventually(predicate: () => boolean, label: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
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
    readonly authorization: string[] = [];
    readonly deployments = new Map<string, Deployment>();
    readonly pendingCreates: Array<() => void> = [];
    metadataLookups = 0;
    maxFileUploadConcurrency = 0;
    activeFileUploads = 0;
    maxDeploymentConcurrency = 0;
    activeDeployments = 0;
    holdDeploymentCreates = false;
    failDeleteRequests = 0;
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
        });
    }

    releaseOneDeployment(): void {
        const release = this.pendingCreates.shift();
        if (!release) throw new Error('No held Vercel deployment to release');
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
            const matching = [...this.deployments.values()].filter((deployment) =>
                deployment.projectId === url.searchParams.get('projectId')
                && deployment.meta.happyPreviewId === url.searchParams.get('meta-happyPreviewId')
                && deployment.meta.happyPublicationAttemptId === url.searchParams.get('meta-happyPublicationAttemptId'),
            );
            return this.sendJson(response, 200, { deployments: matching.map((deployment) => this.deploymentJson(deployment)) });
        }
        if (url.pathname === '/v2/files' && request.method === 'POST') {
            this.activeFileUploads++;
            this.maxFileUploadConcurrency = Math.max(this.maxFileUploadConcurrency, this.activeFileUploads);
            const bytes = await readBody(request);
            this.fileUploads.push({
                digest: String(request.headers['x-vercel-digest'] || ''),
                mimeType: String(request.headers['content-type'] || ''),
                bytes,
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            this.activeFileUploads--;
            return this.sendJson(response, 200, {});
        }
        if (url.pathname === '/v13/deployments' && request.method === 'POST') {
            const requestBody = JSON.parse((await readBody(request)).toString('utf8')) as { files: Array<{ file: string; sha: string; size: number }>; meta: Record<string, string> };
            this.createRequests.push({ files: requestBody.files, meta: requestBody.meta });
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
            return this.sendJson(response, 200, this.deploymentJson(deployment));
        }
        if (deploymentId && request.method === 'DELETE') {
            this.deleteRequests.push(deploymentId);
            if (this.failDeleteRequests > 0) {
                this.failDeleteRequests--;
                return this.sendJson(response, 503, { error: { code: 'provider_unavailable' } });
            }
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

    it('recreates the app and service over the same PGlite, reconciles a stale publication, then honors a deleting backoff tombstone after another restart', async () => {
        const harness = await setup();
        const assets = [{ id: 'index', path: 'index.html', mimeType: 'text/html', bytes: Buffer.from('<h1>recovery</h1>') }];
        await harness.createAndUpload(ids.restart, assets);
        const publicationAttemptId = 'attempt-reconcile';
        const recoveryTime = after(clockStart, 16 * 60 * 1000);
        await harness.database.interactivePreview.update({ where: { id: ids.restart }, data: {
            status: 'publishing', publicationAttemptId, publicationGeneration: 1, updatedAt: new Date(clockStart),
        } });
        harness.vercel.addReconciledDeployment(ids.restart, publicationAttemptId);

        await harness.restart();
        await harness.cleanup().recoverStalePublications(recoveryTime);
        const recovered = await harness.app.inject({
            method: 'POST', url: `/v1/sessions/${sessionA}/previews/${ids.restart}/publish`, headers: { 'x-user-id': accountA },
        });
        expect(recovered.statusCode, recovered.body).toBe(200);
        expect(interactivePreviewEventSchema.parse(recovered.json().preview)).toMatchObject({ state: 'ready', url: 'https://dpl_reconciled.preview.local' });
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
        expect(tombstone).toMatchObject({ status: 'deleting', vercelDeploymentId: 'dpl_reconciled', cleanupRetryCount: 1, cleanupNextAttemptAt: after(firstCleanup, 60_000) });
        const failedDeleteRequests = harness.vercel.deleteRequests.length;
        await harness.cleanup().cleanupExpired(after(firstCleanup, 30_000));
        expect(harness.vercel.deleteRequests).toHaveLength(failedDeleteRequests);

        await harness.restart();
        await harness.cleanup().cleanupExpired(after(firstCleanup, 60_000));
        tombstone = await harness.database.interactivePreview.findUnique({ where: { id: ids.restart } });
        expect(tombstone).toMatchObject({ status: 'expired', vercelDeploymentId: null });
        expect(harness.vercel.deployments.has('dpl_reconciled')).toBe(false);
        expect([...harness.s3.objects.keys()].filter((key) => key.includes(`/${ids.restart}/`))).toEqual([]);
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
