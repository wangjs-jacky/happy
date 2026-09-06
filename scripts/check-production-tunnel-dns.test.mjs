import assert from 'node:assert/strict';
import test from 'node:test';
import { checkProductionTunnelDns } from './check-production-tunnel-dns.mjs';

const noData = () => Object.assign(new Error('no records'), { code: 'ENODATA' });
function fixture(overrides = {}) {
    const records = {
        NS: ['alice.ns.cloudflare.com.', 'bob.ns.cloudflare.com.'],
        CNAME: ['12345678-1234-1234-1234-123456789abc.cfargotunnel.com.'],
        A: ['104.16.1.2'], AAAA: [], ...overrides,
    };
    return {
        zone: 'pilot.example', origin: 'https://pilot.example', timeoutMs: 50,
        resolve: async (name, type) => {
            assert.equal(name, 'pilot.example');
            if (!records[type]?.length) throw noData();
            return records[type];
        },
        probeHttps: async () => ({
            certificateVerified: true, status: 200,
            headers: new Headers({ server: 'cloudflare', 'cf-ray': 'abc-SJC' }), body: '',
        }),
    };
}

test('accepts Cloudflare delegation, a Tunnel CNAME, and trusted HTTPS', async () => {
    const result = await checkProductionTunnelDns(fixture());
    assert.equal(result.recordMode, 'cname');
    assert.equal(result.certificateReady, true);
});

test('rejects stale or mixed nameservers', async () => {
    for (const NS of [['ns1.dnsowl.com', 'ns2.dnsowl.com'], ['alice.ns.cloudflare.com', 'ns1.dnsowl.com'], []]) {
        await assert.rejects(checkProductionTunnelDns(fixture({ NS })), /nameserver/i);
    }
});

test('can verify the exact assigned nameserver pair without credentials', async () => {
    const options = fixture();
    options.expectedNameservers = ['carol.ns.cloudflare.com', 'bob.ns.cloudflare.com'];
    await assert.rejects(checkProductionTunnelDns(options), /assigned nameserver/i);
    options.expectedNameservers = ['bob.ns.cloudflare.com', 'alice.ns.cloudflare.com'];
    assert.equal((await checkProductionTunnelDns(options)).certificateReady, true);
});

test('accepts apex flattening only with address records and Cloudflare HTTPS evidence', async () => {
    const result = await checkProductionTunnelDns(fixture({ CNAME: [] }));
    assert.equal(result.recordMode, 'flattened');
    assert.match(result.notes.join(' '), /cannot prove.*Tunnel/i);
    await assert.rejects(checkProductionTunnelDns(fixture({ CNAME: [], A: [], AAAA: [] })), /address/i);
    const options = fixture({ CNAME: [] });
    options.probeHttps = async () => ({ certificateVerified: true, status: 200, headers: new Headers(), body: '' });
    await assert.rejects(checkProductionTunnelDns(options), /Cloudflare/i);
});

test('rejects non-Tunnel CNAMEs and untrusted certificates', async () => {
    await assert.rejects(checkProductionTunnelDns(fixture({ CNAME: ['parking.example.com'] })), /CNAME/i);
    const options = fixture();
    options.probeHttps = async () => ({ certificateVerified: false, headers: new Headers() });
    await assert.rejects(checkProductionTunnelDns(options), /certificate/i);
});

test('does not interpret resolver failures as flattened DNS', async () => {
    const options = fixture();
    const resolve = options.resolve;
    options.resolve = (name, type) => type === 'CNAME'
        ? Promise.reject(Object.assign(new Error('DNS SERVFAIL'), { code: 'ESERVFAIL' })) : resolve(name, type);
    await assert.rejects(checkProductionTunnelDns(options), /SERVFAIL/);
});

test('bounds a stalled DNS adapter', async () => {
    await assert.rejects(checkProductionTunnelDns({ ...fixture(), resolve: () => new Promise(() => {}) }), /timeout/i);
});
