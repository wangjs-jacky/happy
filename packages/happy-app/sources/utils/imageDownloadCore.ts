export interface ImageDownloadSource {
    /** Image URI: file://, http(s)://, blob:, or data:. */
    uri: string;
    /** Optional human-facing filename, usually from the original attachment. */
    filename?: string;
}

export type DataUriInfo = {
    mimeType: string;
    isBase64: boolean;
    data: string;
};

const DEFAULT_BASENAME = 'happy-image';

const MIME_EXTENSIONS: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/svg+xml': 'svg',
};

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|heic|heif|svg)$/i;

export function getImageDownloadFileName(source: ImageDownloadSource): string {
    const mimeType = getImageDownloadMimeType(source);
    const extension = getImageExtensionForMimeType(mimeType);
    const explicit = source.filename ?? '';
    const candidate = explicit || getBasenameFromUri(source.uri) || DEFAULT_BASENAME;
    const sanitized = sanitizeFileName(candidate) || DEFAULT_BASENAME;

    if (IMAGE_EXTENSION_RE.test(sanitized)) {
        return sanitized;
    }
    return `${sanitized}.${extension}`;
}

export function getImageDownloadMimeType(source: ImageDownloadSource): string {
    const dataUri = parseDataUri(source.uri);
    if (dataUri?.mimeType) {
        return dataUri.mimeType;
    }

    const name = source.filename || getBasenameFromUri(source.uri);
    const extension = name?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    switch (extension) {
        case 'jpg':
        case 'jpeg':
            return 'image/jpeg';
        case 'gif':
            return 'image/gif';
        case 'webp':
            return 'image/webp';
        case 'heic':
            return 'image/heic';
        case 'heif':
            return 'image/heif';
        case 'svg':
            return 'image/svg+xml';
        case 'png':
        default:
            return 'image/png';
    }
}

export function parseDataUri(uri: string): DataUriInfo | null {
    const match = /^data:([^;,]+)?((?:;[^,]*)?),(.*)$/i.exec(uri);
    if (!match) return null;

    const metadata = match[2] ?? '';
    return {
        mimeType: (match[1] || 'image/png').toLowerCase(),
        isBase64: /(^|;)base64($|;)/i.test(metadata),
        data: match[3] ?? '',
    };
}

function getImageExtensionForMimeType(mimeType: string): string {
    return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? 'png';
}

function getBasenameFromUri(uri: string): string {
    const withoutQuery = stripQueryAndHash(uri);
    if (!withoutQuery || withoutQuery.startsWith('data:')) return '';

    try {
        const parsed = new URL(uri);
        const segments = parsed.pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1] ?? '';
        return decodeUriComponentSafe(last);
    } catch {
        const segments = withoutQuery.split('/').filter(Boolean);
        return decodeUriComponentSafe(segments[segments.length - 1] ?? '');
    }
}

function stripQueryAndHash(value: string): string {
    return value.split('#')[0]?.split('?')[0] ?? '';
}

function decodeUriComponentSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function sanitizeFileName(value: string): string {
    return value
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .replace(/^\.+/, '')
        .replace(/\.+$/, '')
        .trim()
        .slice(0, 120);
}
