import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

interface ResolvedAddress {
    address: string;
    family: number;
}

type Lookup = (
    hostname: string,
    options: { all: true; verbatim: true },
) => Promise<ResolvedAddress[]>;

function isPublicIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
        return false;
    }
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
}

function isPublicIpv6(address: string): boolean {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return false;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
    if (/^fe[89ab]/.test(normalized) || normalized.startsWith('ff')) return false;
    if (normalized.startsWith('2001:db8:')) return false;
    if (normalized.startsWith('::ffff:')) {
        const embeddedIpv4 = normalized.slice('::ffff:'.length);
        return isIP(embeddedIpv4) === 4 && isPublicIpv4(embeddedIpv4);
    }
    return true;
}

function isPublicAddress(address: string): boolean {
    const family = isIP(address);
    if (family === 4) return isPublicIpv4(address);
    if (family === 6) return isPublicIpv6(address);
    return false;
}

function unsafeProviderUrl(): Error {
    return new Error('Unsafe relationship advisor provider URL');
}

export async function validateRelationshipAdvisorProviderUrl(
    baseUrl: string,
    lookup: Lookup = dnsLookup,
): Promise<string> {
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        throw unsafeProviderUrl();
    }
    if (
        url.protocol !== 'https:'
        || url.username
        || url.password
        || url.search
        || url.hash
        || !url.hostname
    ) {
        throw unsafeProviderUrl();
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname)) {
        if (!isPublicAddress(hostname)) throw unsafeProviderUrl();
        return baseUrl;
    }
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw unsafeProviderUrl();

    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
        throw unsafeProviderUrl();
    }
    return baseUrl;
}
