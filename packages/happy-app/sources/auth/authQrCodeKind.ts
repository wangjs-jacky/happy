export type AuthQrCodeKind = 'account' | 'terminal';

export function getAuthQrCodeKind(url: string): AuthQrCodeKind | null {
    if (url.startsWith('paws:///account?')) {
        return 'account';
    }

    if (url.startsWith('paws://terminal?')) {
        return 'terminal';
    }

    return null;
}
