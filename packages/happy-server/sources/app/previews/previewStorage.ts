import { PREVIEW_LIMITS } from '@slopus/happy-wire';
import { s3bucket, s3client } from '@/storage/files';

const PREVIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ID = /^[A-Za-z0-9_-]{1,96}$/;
const PRESIGNED_TTL_SECONDS = 15 * 60;

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

export const previewStorage = createPreviewStorage({ client: s3client as PreviewS3Client, bucket: s3bucket });
