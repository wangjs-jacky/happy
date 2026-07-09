import type { Message, ToolCallMessage } from '@/sync/typesMessage';

const DEFAULT_MAX_IMAGES = 24;
const DEFAULT_MAX_TOTAL_URL_LENGTH = 64_000;
const DEFAULT_MAX_IMAGE_DIMENSION = 720;
const DEFAULT_IMAGE_COMPRESS = 0.72;
const DEFAULT_MAX_RAW_UPLOAD_LENGTH = 2_800_000;
const DEFAULT_MAX_PER_IMAGE_DATA_URI_LENGTH = 260_000;

export interface OpenBirdImageAttachment {
    ref: string;
    name: string;
    size?: number;
    width?: number;
    height?: number;
}

export interface PrepareOpenBirdAttachmentUrlsOptions {
    maxImages?: number;
    maxTotalDataUriLength?: number;
    maxImageDimension?: number;
    compress?: number;
    maxRawDataUriLength?: number;
    maxPerImageDataUriLength?: number;
    /** 覆盖 OpenBird 图片上传的 base url（本地 wrangler dev 时用）。 */
    apiBaseUrl?: string;
    imageUrlLoader?: (attachment: OpenBirdImageAttachment, sessionId: string) => Promise<string | null>;
    dataUriLoader?: (attachment: OpenBirdImageAttachment, sessionId: string) => Promise<string | null>;
}

interface OrderedToolCall {
    message: ToolCallMessage;
    order: number;
}

export function collectOpenBirdImageAttachments(messages: Message[]): OpenBirdImageAttachment[] {
    const tools: OrderedToolCall[] = [];
    collectToolCalls(messages, tools);

    const seen = new Set<string>();
    const attachments: OpenBirdImageAttachment[] = [];
    for (const { message } of tools.sort((a, b) => {
        const timeDiff = a.message.createdAt - b.message.createdAt;
        return timeDiff === 0 ? a.order - b.order : timeDiff;
    })) {
        const attachment = parseImageAttachment(message);
        if (!attachment || seen.has(attachment.ref)) {
            continue;
        }
        seen.add(attachment.ref);
        attachments.push(attachment);
    }
    return attachments;
}

export async function prepareOpenBirdAttachmentUrls(
    sessionId: string,
    messages: Message[],
    options: PrepareOpenBirdAttachmentUrlsOptions = {},
): Promise<Record<string, string>> {
    const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
    const maxTotalDataUriLength = options.maxTotalDataUriLength ?? DEFAULT_MAX_TOTAL_URL_LENGTH;
    if (maxImages <= 0 || maxTotalDataUriLength <= 0) {
        return {};
    }

    const loader = options.imageUrlLoader
        ?? options.dataUriLoader
        ?? ((attachment: OpenBirdImageAttachment) => loadShareAttachmentUrl(sessionId, attachment, options));
    const urls: Record<string, string> = {};
    let usedLength = 0;

    for (const attachment of collectOpenBirdImageAttachments(messages).slice(0, maxImages)) {
        let url: string | null = null;
        try {
            url = await loader(attachment, sessionId);
        } catch {
            continue;
        }
        if (!isShareImageUrl(url)) {
            continue;
        }
        if (usedLength + url.length > maxTotalDataUriLength) {
            continue;
        }

        urls[attachment.ref] = url;
        usedLength += url.length;
    }

    return urls;
}

function collectToolCalls(messages: Message[], tools: OrderedToolCall[]): void {
    for (const message of messages) {
        if (message.kind !== 'tool-call') {
            continue;
        }
        tools.push({ message, order: tools.length });
        collectToolCalls(message.children, tools);
    }
}

function parseImageAttachment(message: ToolCallMessage): OpenBirdImageAttachment | null {
    if (message.tool.name !== 'file' || !isObject(message.tool.input)) {
        return null;
    }

    const input = message.tool.input;
    if (typeof input.ref !== 'string' || typeof input.name !== 'string') {
        return null;
    }
    if (!isObject(input.image)) {
        return null;
    }

    const width = readPositiveNumber(input.image.width);
    const height = readPositiveNumber(input.image.height);
    const size = readPositiveNumber(input.size);
    return {
        ref: input.ref,
        name: input.name,
        ...(size !== undefined ? { size } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
    };
}

async function loadShareAttachmentUrl(
    sessionId: string,
    attachment: OpenBirdImageAttachment,
    options: PrepareOpenBirdAttachmentUrlsOptions,
): Promise<string | null> {
    const [
        { sync },
        { downloadEncryptedAttachment },
        { decryptBlob },
        { uploadTranscriptImage },
    ] = await Promise.all([
        import('@/sync/sync'),
        import('@/sync/apiAttachments'),
        import('@/encryption/blob'),
        import('@/sync/apiOpenBirdTranscript'),
    ]);

    const credentials = sync.getCredentials();
    const blobKey = sync.encryption.getSessionBlobKey(sessionId);
    if (!credentials || !blobKey || blobKey.length !== 32) {
        return null;
    }

    const encrypted = await downloadEncryptedAttachment(credentials, sessionId, attachment.ref);
    const decrypted = decryptBlob(encrypted, blobKey);
    if (!decrypted) {
        return null;
    }

    const mime = detectImageMime(decrypted);
    const uploadBytes = await compressAttachmentImage(decrypted, mime, attachment, options)
        ?? (decrypted.length <= (options.maxRawDataUriLength ?? DEFAULT_MAX_RAW_UPLOAD_LENGTH) ? decrypted : null);
    if (!uploadBytes) {
        return null;
    }

    // 上传到 OpenBird 同源图片端点，拿回 https 同源 URL（不再走 Happy 中继）。
    // 上传本身无需鉴权（guest 分享）；credentials 仅用于前面下载/解密附件。
    const url = await uploadTranscriptImage({
        bytes: uploadBytes,
        mimeType: uploadBytes === decrypted ? mime : 'image/jpeg',
    }, options.apiBaseUrl ? { apiBaseUrl: options.apiBaseUrl } : {});
    return url;
}

async function compressAttachmentImage(
    bytes: Uint8Array,
    mime: string,
    attachment: OpenBirdImageAttachment,
    options: PrepareOpenBirdAttachmentUrlsOptions,
): Promise<Uint8Array | null> {
    const [
        fileSystem,
        imageManipulator,
        { encodeBase64, decodeBase64 },
    ] = await Promise.all([
        import('expo-file-system/legacy'),
        import('expo-image-manipulator'),
        import('@/encryption/base64'),
    ]);

    if (!fileSystem.cacheDirectory) {
        return null;
    }

    const maxDimension = options.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION;
    const compress = options.compress ?? DEFAULT_IMAGE_COMPRESS;
    const perImageLimit = options.maxPerImageDataUriLength ?? DEFAULT_MAX_PER_IMAGE_DATA_URI_LENGTH;
    const tempUri = `${fileSystem.cacheDirectory}happy-openbird-share-${Date.now()}-${Math.random().toString(36).slice(2)}.${getImageExtension(mime)}`;
    let resultUri: string | undefined;

    try {
        await fileSystem.writeAsStringAsync(tempUri, encodeBase64(bytes), { encoding: fileSystem.EncodingType.Base64 });

        const attempts = [
            { maxDimension, compress },
            { maxDimension: Math.min(maxDimension, 560), compress: Math.min(compress, 0.64) },
            { maxDimension: Math.min(maxDimension, 420), compress: Math.min(compress, 0.56) },
        ];

        let fallback: Uint8Array | null = null;
        for (const attempt of attempts) {
            const result = await imageManipulator.manipulateAsync(
                tempUri,
                getResizeActions(attachment, attempt.maxDimension),
                {
                    compress: attempt.compress,
                    format: imageManipulator.SaveFormat.JPEG,
                    base64: true,
                },
            );
            resultUri = result.uri;
            if (!result.base64) {
                continue;
            }

            const compressed = decodeBase64(result.base64);
            fallback = compressed;
            if (compressed.length <= perImageLimit) {
                return compressed;
            }
        }

        return fallback;
    } catch {
        return null;
    } finally {
        await deleteFileBestEffort(fileSystem.deleteAsync, tempUri);
        if (resultUri && resultUri !== tempUri) {
            await deleteFileBestEffort(fileSystem.deleteAsync, resultUri);
        }
    }
}

function isShareImageUrl(url: string | null): url is string {
    return typeof url === 'string'
        && (url.startsWith('data:image/') || /^https?:\/\//i.test(url));
}

function getResizeActions(
    attachment: OpenBirdImageAttachment,
    maxDimension: number,
): Array<{ resize: { width?: number; height?: number } }> {
    const width = attachment.width;
    const height = attachment.height;
    if (!width || !height) {
        return [{ resize: { width: maxDimension } }];
    }
    if (width <= maxDimension && height <= maxDimension) {
        return [];
    }
    if (width >= height) {
        return [{ resize: { width: maxDimension } }];
    }
    return [{ resize: { height: maxDimension } }];
}

async function deleteFileBestEffort(
    deleteAsync: (fileUri: string, options?: { idempotent?: boolean }) => Promise<void>,
    uri: string,
): Promise<void> {
    try {
        await deleteAsync(uri, { idempotent: true });
    } catch {
        // best effort
    }
}

function detectImageMime(bytes: Uint8Array): string {
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'image/jpeg';
    }
    if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'image/gif';
    }
    if (
        bytes.length >= 12
        && bytes[0] === 0x52
        && bytes[1] === 0x49
        && bytes[2] === 0x46
        && bytes[3] === 0x46
        && bytes[8] === 0x57
        && bytes[9] === 0x45
        && bytes[10] === 0x42
        && bytes[11] === 0x50
    ) {
        return 'image/webp';
    }
    return 'image/png';
}

function getImageExtension(mime: string): string {
    switch (mime) {
        case 'image/jpeg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/gif':
            return 'gif';
        case 'image/webp':
            return 'webp';
        default:
            return 'img';
    }
}

function readPositiveNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
