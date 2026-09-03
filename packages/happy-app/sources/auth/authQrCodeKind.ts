import { decodeBase64, encodeBase64 } from '@/encryption/base64';

export type AuthQrCodeKind = 'account' | 'terminal';

function hasValidPublicKey(url: string, prefix: string): boolean {
    if (!url.startsWith(prefix)) {
        return false;
    }

    const encodedKey = url.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encodedKey)) {
        return false;
    }

    try {
        const publicKey = decodeBase64(encodedKey, 'base64url');
        return publicKey.length === 32 && encodeBase64(publicKey, 'base64url') === encodedKey;
    } catch {
        return false;
    }
}

export function getAuthQrCodeKind(url: string): AuthQrCodeKind | null {
    if (hasValidPublicKey(url, 'paws:///account?')) {
        return 'account';
    }

    if (hasValidPublicKey(url, 'paws://terminal?')) {
        return 'terminal';
    }

    return null;
}
