import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { requestReadOnly, TUNNEL_ORIGIN, withTimeout } from './verify-production-tunnel.mjs';

export const EXPECTED_ZONE = 'paws.rodeo';

const normalize = (name) => name.toLowerCase().replace(/\.$/, '');
const cloudflareNs = (name) => /^[a-z0-9-]+\.ns\.cloudflare\.com$/.test(name);

/** Public DNS/TLS evidence only: no account access or DNS mutations. */
export async function checkProductionTunnelDns({ zone, origin, resolve, probeHttps,
    expectedNameservers, timeoutMs = 10_000 }) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.hostname !== zone || url.href !== `${url.origin}/`
        || url.username || url.password) throw new Error('Certificate origin must be HTTPS at the expected zone, without credentials');
    if (typeof resolve !== 'function' || typeof probeHttps !== 'function') throw new Error('DNS and HTTPS adapters are required');
    const query = async (type, optional = false) => {
        try { return await withTimeout(() => resolve(zone, type), timeoutMs, `${type} DNS`); }
        catch (error) {
            // NXDOMAIN/SERVFAIL/timeout must not become a false flattened-record success.
            if (optional && error.code === 'ENODATA') return [];
            throw new Error(`${type === 'NS' ? 'nameserver' : type} lookup failed: ${error.message}`);
        }
    };
    const nameservers = (await query('NS')).map(normalize).sort();
    if (nameservers.length < 2 || new Set(nameservers).size !== nameservers.length || !nameservers.every(cloudflareNs)) {
        throw new Error(`Stale or incomplete Cloudflare nameservers: ${nameservers.join(', ') || '(none)'}`);
    }
    if (expectedNameservers) {
        const expected = expectedNameservers.map(normalize).sort();
        if (expected.length !== 2 || new Set(expected).size !== 2 || !expected.every(cloudflareNs)
            || JSON.stringify(nameservers) !== JSON.stringify(expected)) throw new Error('DNS does not match the exact assigned nameserver pair');
    }
    const cnames = (await query('CNAME', true)).map(normalize);
    if (cnames.length && (cnames.length !== 1 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.cfargotunnel\.com$/.test(cnames[0]))) {
        throw new Error('CNAME does not identify a Cloudflare Tunnel');
    }
    const addresses = [...await query('A', true), ...await query('AAAA', true)];
    if (!addresses.length || !addresses.every((address) => isIP(address))) throw new Error('No usable address records for the zone');
    const https = await withTimeout(() => probeHttps(origin, { method: 'HEAD', timeoutMs }), timeoutMs, 'HTTPS certificate');
    if (https.certificateVerified !== true) throw new Error('HTTPS certificate is not trusted and valid for the zone');
    if (!https.headers.get('cf-ray') || https.headers.get('server')?.toLowerCase() !== 'cloudflare') {
        throw new Error('HTTPS response lacks Cloudflare edge evidence');
    }
    const notes = [expectedNameservers ? 'Exact assigned nameserver pair matches' : 'Cloudflare delegation observed; pass --nameservers to check the exact assigned pair'];
    if (!cnames.length) notes.push('Public flattened DNS cannot prove the Tunnel ID; use domain verification and retain the approved hostname record separately');
    if (https.status !== 200) notes.push(`HTTPS edge returned HTTP ${https.status}; certificate readiness does not imply application readiness`);
    return { zone, nameservers, cnames, addresses, recordMode: cnames.length ? 'cname' : 'flattened', certificateReady: true, notes };
}

async function main(args) {
    if (args.length === 1 && args[0] === '--help') {
        console.log('Read-only public DNS and trusted HTTPS checks: pnpm tunnel:check-dns [--nameservers <first,second>]\nUse the exact pair assigned to this zone. No Cloudflare credentials are accepted. Flattened DNS cannot prove Tunnel identity.');
        return;
    }
    let expectedNameservers;
    if (args.length === 2 && args[0] === '--nameservers') {
        expectedNameservers = args[1].split(',').map(normalize);
        if (expectedNameservers.length !== 2 || new Set(expectedNameservers).size !== 2 || !expectedNameservers.every(cloudflareNs)) {
            throw new Error('--nameservers requires two distinct assigned Cloudflare nameservers');
        }
    } else if (args.length) throw new Error('Unknown argument; use --help (credentials are not accepted)');
    const resolver = new Resolver({ timeout: 5_000, tries: 1 });
    try {
        const result = await checkProductionTunnelDns({ zone: EXPECTED_ZONE, origin: TUNNEL_ORIGIN,
            resolve: (name, type) => resolver.resolve(name, type), probeHttps: requestReadOnly, expectedNameservers });
        console.log(`OK nameservers: ${result.nameservers.join(', ')}`);
        console.log(`OK ${result.recordMode}: ${[...result.cnames, ...result.addresses].join(', ')}`);
        console.log('OK trusted HTTPS certificate and Cloudflare edge response');
        for (const note of result.notes) console.log(`NOTE ${note}`);
    } finally { resolver.cancel(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
}
