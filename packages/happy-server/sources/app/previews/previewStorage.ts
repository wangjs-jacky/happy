import { PREVIEW_LIMITS } from '@slopus/happy-wire';
import { Client } from 'minio';

const PREVIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ID = /^[A-Za-z0-9_-]{1,96}$/;
const PRESIGNED_TTL_SECONDS = 15 * 60;

export interface PreviewStorageConfig {
    host: string;
    port?: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    region: string;
    pathStyle?: boolean;
    bucket: string;
}

function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed || undefined;
}

function parseBooleanSetting(name: string, value: string | undefined, fallback: boolean | undefined): boolean | undefined {
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${name} must be true or false`);
}

function parsePortSetting(name: string, value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer between 1 and 65535`);
    const port = Number(value);
    if (port < 1 || port > 65_535) throw new Error(`${name} must be an integer between 1 and 65535`);
    return port;
}

export function readPreviewStorageConfig(environment: NodeJS.ProcessEnv): PreviewStorageConfig | null {
    const host = nonEmpty(environment.PREVIEW_S3_HOST) || nonEmpty(environment.S3_HOST);
    const accessKey = nonEmpty(environment.PREVIEW_S3_ACCESS_KEY) || nonEmpty(environment.S3_ACCESS_KEY);
    const secretKey = nonEmpty(environment.PREVIEW_S3_SECRET_KEY) || nonEmpty(environment.S3_SECRET_KEY);
    const bucket = nonEmpty(environment.PREVIEW_S3_BUCKET);
    if (!host || !accessKey || !secretKey || !bucket) return null;
    const rawPort = nonEmpty(environment.PREVIEW_S3_PORT) || nonEmpty(environment.S3_PORT);
    const rawUseSSL = nonEmpty(environment.PREVIEW_S3_USE_SSL) || nonEmpty(environment.S3_USE_SSL);
    const rawPathStyle = nonEmpty(environment.PREVIEW_S3_PATH_STYLE) || nonEmpty(environment.S3_PATH_STYLE);
    const portName = nonEmpty(environment.PREVIEW_S3_PORT) ? 'PREVIEW_S3_PORT' : 'S3_PORT';
    const useSSLName = nonEmpty(environment.PREVIEW_S3_USE_SSL) ? 'PREVIEW_S3_USE_SSL' : 'S3_USE_SSL';
    const pathStyleName = nonEmpty(environment.PREVIEW_S3_PATH_STYLE) ? 'PREVIEW_S3_PATH_STYLE' : 'S3_PATH_STYLE';
    return {
        host,
        accessKey,
        secretKey,
        bucket,
        region: nonEmpty(environment.PREVIEW_S3_REGION) || nonEmpty(environment.S3_REGION) || 'us-east-1',
        pathStyle: parseBooleanSetting(pathStyleName, rawPathStyle, undefined),
        useSSL: parseBooleanSetting(useSSLName, rawUseSSL, true)!,
        port: parsePortSetting(portName, rawPort),
    };
}

interface PreviewS3Client {
    newPostPolicy(): {
        setBucket(bucket: string): void; setKey(key: string): void; setExpires(value: Date): void;
        setContentLengthRange(min: number, max: number): void;
    };
    presignedPostPolicy(policy: unknown): Promise<{ postURL: string; formData: Record<string, string> }>;
    statObject(bucket: string, key: string): Promise<{ size: number }>;
    getObject(bucket: string, key: string): Promise<NodeJS.ReadableStream>;
    listObjects(bucket: string, prefix: string, recursive: boolean): { on(name: string, fn: (...args: any[]) => void): unknown };
    removeObjects(bucket: string, keys: string[]): Promise<unknown>;
}

function keyFor(previewId: string, assetId?: string): string {
    if (!PREVIEW_ID.test(previewId)) throw new Error('Invalid preview id');
    if (assetId && !ASSET_ID.test(assetId)) throw new Error('Invalid preview asset id');
    return `private/interactive-previews/${previewId}/${assetId || ''}`;
}

export function createPreviewStorage(options: { client: PreviewS3Client; bucket: string; now?: () => Date }) {
    const now = options.now || (() => new Date());
    return {
        storageKey(previewId: string, assetId: string): string { return keyFor(previewId, assetId); },
        async createUpload(previewId: string, assetId: string, size: number) {
            if (!Number.isSafeInteger(size) || size < 0 || size > PREVIEW_LIMITS.maxFileBytes) throw new Error('Invalid preview asset size');
            const policy = options.client.newPostPolicy();
            policy.setBucket(options.bucket);
            policy.setKey(keyFor(previewId, assetId));
            policy.setExpires(new Date(now().getTime() + PRESIGNED_TTL_SECONDS * 1000));
            policy.setContentLengthRange(size, size);
            const signed = await options.client.presignedPostPolicy(policy);
            return { method: 'POST' as const, uploadUrl: signed.postURL, formFields: signed.formData };
        },
        async assertUploaded(previewId: string, assetId: string, expectedSize: number): Promise<void> {
            const stat = await options.client.statObject(options.bucket, keyFor(previewId, assetId));
            if (stat.size !== expectedSize) throw new Error('Uploaded preview asset size mismatch');
        },
        async read(previewId: string, assetId: string, maxBytes = PREVIEW_LIMITS.maxFileBytes): Promise<Buffer> {
            const stream = await options.client.getObject(options.bucket, keyFor(previewId, assetId));
            const chunks: Buffer[] = [];
            let total = 0;
            for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                total += buffer.length;
                if (total > maxBytes) throw new Error('Preview asset exceeds bounded read');
                chunks.push(buffer);
            }
            return Buffer.concat(chunks);
        },
        async deletePreview(previewId: string): Promise<void> {
            const prefix = keyFor(previewId);
            const stream = options.client.listObjects(options.bucket, prefix, true);
            const keys = await new Promise<string[]>((resolve, reject) => {
                const values: string[] = [];
                stream.on('data', (item: { name?: string }) => { if (item.name?.startsWith(prefix)) values.push(item.name); });
                stream.on('end', () => resolve(values));
                stream.on('error', reject);
            });
            if (keys.length) await options.client.removeObjects(options.bucket, keys);
        },
    };
}

const previewStorageConfig = readPreviewStorageConfig(process.env);
const previewS3Client = previewStorageConfig ? new Client({
    endPoint: previewStorageConfig.host,
    port: previewStorageConfig.port,
    useSSL: previewStorageConfig.useSSL,
    accessKey: previewStorageConfig.accessKey,
    secretKey: previewStorageConfig.secretKey,
    region: previewStorageConfig.region,
    pathStyle: previewStorageConfig.pathStyle,
}) : null;

export function isPreviewStorageConfigured(): boolean {
    return previewStorageConfig !== null;
}

export async function loadPreviewStorage(): Promise<void> {
    if (previewStorageConfig && !await previewS3Client!.bucketExists(previewStorageConfig.bucket)) {
        throw new Error(`Preview storage bucket does not exist: ${previewStorageConfig.bucket}`);
    }
}

const unavailableClient = new Proxy({}, {
    get() { return () => { throw new Error('PREVIEW_STORAGE_NOT_CONFIGURED'); }; },
}) as PreviewS3Client;

export const previewStorage = createPreviewStorage({
    client: (previewS3Client as PreviewS3Client | null) || unavailableClient,
    bucket: previewStorageConfig?.bucket || '',
});
