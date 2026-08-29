import {
    deleteFilePrefix,
    isLocalStorage,
    localFileExists,
    putLocalFile,
    readLocalFile,
    s3bucket,
    s3client,
} from '@/storage/files';

const PRESIGNED_TTL_SECONDS = 15 * 60;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;

function assertSafeIdentifier(value: string): void {
    if (!SAFE_IDENTIFIER.test(value)) {
        throw new Error('Invalid share storage identifier');
    }
}

export function buildPublicShareStoragePath(shareId: string, generation: string, assetId: string): string {
    assertSafeIdentifier(shareId);
    assertSafeIdentifier(generation);
    assertSafeIdentifier(assetId);
    return `public/session-shares/${shareId}/${generation}/${assetId}`;
}

export async function createPublicShareUploadDescriptor(
    storagePath: string,
    localUploadUrl: string,
): Promise<{ method: 'PUT'; uploadUrl: string }> {
    if (isLocalStorage()) {
        return { method: 'PUT', uploadUrl: localUploadUrl };
    }
    return {
        method: 'PUT',
        uploadUrl: await s3client.presignedPutObject(s3bucket, storagePath, PRESIGNED_TTL_SECONDS),
    };
}

export async function putPublicShareLocalAsset(storagePath: string, data: Buffer): Promise<void> {
    if (!isLocalStorage()) {
        throw new Error('Direct share upload is unavailable');
    }
    await putLocalFile(storagePath, data);
}

export async function publicShareAssetExists(storagePath: string, expectedSize: number): Promise<boolean> {
    if (isLocalStorage()) {
        if (!localFileExists(storagePath)) return false;
        return readLocalFile(storagePath)?.length === expectedSize;
    }
    try {
        const stat = await s3client.statObject(s3bucket, storagePath);
        return stat.size === expectedSize;
    } catch {
        return false;
    }
}

export async function getPublicShareDownloadSource(storagePath: string): Promise<
    | { kind: 'buffer'; data: Buffer }
    | { kind: 'redirect'; url: string }
> {
    if (isLocalStorage()) {
        const data = readLocalFile(storagePath);
        if (!data) throw new Error('Public share asset not found');
        return { kind: 'buffer', data };
    }
    return {
        kind: 'redirect',
        url: await s3client.presignedGetObject(s3bucket, storagePath, PRESIGNED_TTL_SECONDS),
    };
}

export async function deletePublicShareGeneration(shareId: string, generation: string): Promise<void> {
    assertSafeIdentifier(shareId);
    assertSafeIdentifier(generation);
    await deleteFilePrefix(`public/session-shares/${shareId}/${generation}`);
}
