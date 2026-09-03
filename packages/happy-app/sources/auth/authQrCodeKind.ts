export type AuthQrCodeKind = 'account' | 'terminal';

export function getAuthQrCodeKind(url: string): AuthQrCodeKind | null {
    if (/^paws:\/\/\/account\?[A-Za-z0-9_-]+$/.test(url)) {
        return 'account';
    }

    if (/^paws:\/\/terminal\?[A-Za-z0-9_-]+$/.test(url)) {
        return 'terminal';
    }

    return null;
}
