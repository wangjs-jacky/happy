import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { verifyProductionTunnel, requestReadOnly, probeWebSocket } from './verify-production-tunnel.mjs';

const revision = '1234567890abcdef1234567890abcdef12345678';
const oldRevision = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const assetPath = '/_expo/static/js/web/app-1234567890abcdef.js';
const html = (rev = revision) => `<html><head><meta name="paws-release-revision" content="${rev}"></head><script src="${assetPath}"></script></html>`;
const response = (body, headers = {}, status = 200) => ({ status, headers: new Headers(headers), body });
function fixture(change = () => undefined) {
    return {
        origin: 'https://pilot.example', fallbackOrigin: 'https://fallback.example:8443',
        assetOrigin: 'https://assets.example', timeoutMs: 100,
        request: async (url, options) => {
            assert.equal(options.method, 'GET');
            const parsed = new URL(url);
            const changed = change(parsed);
            if (changed) return changed;
            if (parsed.pathname === '/health') return response('{"status":"ok","service":"happy-server"}', {
                'content-type': 'application/json', 'cache-control': 'no-store', 'cf-cache-status': 'DYNAMIC',
            });
            if (parsed.pathname.startsWith('/v') || parsed.pathname.startsWith('/files/')) {
                return response('{"error":"unauthorized"}', { 'content-type': 'application/json', 'cache-control': 'no-cache' }, 401);
            }
            if (parsed.pathname === assetPath) {
                if (parsed.origin === 'https://assets.example') return response('console.log("paws")', {
                    'content-type': 'application/javascript', 'cache-control': 'public,max-age=31536000,immutable',
                });
                return response('', { location: `https://assets.example${assetPath}` }, 302);
            }
            return response(html(), { 'content-type': 'text/html' });
        },
        websocket: async (url) => {
            assert.equal(url, 'https://pilot.example/v1/updates/?EIO=4&transport=websocket');
            return { status: 101 };
        },
    };
}

test('verifies domain, fallback, HTML revision, asset redirect, uncached APIs, and WebSocket', async () => {
    const result = await verifyProductionTunnel(fixture());
    assert.equal(result.revision, revision);
    assert.equal(result.fallbackReady, true);
    assert.equal(result.websocket, 'upgrade-only');
});

test('rejects a domain redirect to the old IP and a fallback redirect to the domain', async () => {
    for (const host of ['pilot.example', 'fallback.example']) {
        const options = fixture((url) => url.hostname === host && url.pathname === '/'
            ? response('', { location: host === 'pilot.example' ? 'https://47.115.228.20:8443' : 'https://pilot.example' }, 308) : null);
        await assert.rejects(verifyProductionTunnel(options), /redirect/i);
    }
});

test('rejects cached health even if it contains valid healthy JSON', async () => {
    for (const headers of [
        { 'cache-control': 'public,max-age=60' },
        { 'cache-control': 'no-store', 'cf-cache-status': 'HIT' },
        { 'cache-control': 'no-cache', age: '5' },
        { 'cache-control': 'no-store', 'cf-cache-status': 'REVALIDATED' },
        { 'cache-control': 'no-cache,max-age=00060' },
        { 'cache-control': 'no-cache,s-maxage="60"' },
        { 'cache-control': 'no-cache,max-age=invalid' },
    ]) {
        const options = fixture((url) => url.hostname === 'pilot.example' && url.pathname === '/health'
            ? response('{"status":"ok","service":"happy-server"}', { 'content-type': 'application/json', ...headers }) : null);
        await assert.rejects(verifyProductionTunnel(options), /cache/i);
    }
});

test('rejects API responses without cache bypass headers', async () => {
    const options = fixture((url) => url.pathname === '/v1/sessions'
        ? response('{"error":"unauthorized"}', { 'content-type': 'application/json' }, 401) : null);
    await assert.rejects(verifyProductionTunnel(options), /cache/i);
});

test('rejects cached domain HTML on the homepage, deep link, and share entry', async () => {
    for (const path of ['/', '/session/tunnel-verification', '/share/public-deployment-probe']) {
        for (const headers of [
            { 'cf-cache-status': 'HIT', age: '300', 'cache-control': 'public,max-age=86400' },
            { 'cf-cache-status': 'HIT' },
            { age: '300' },
            { 'cache-control': 'public,max-age=86400' },
            { 'cf-cache-status': 'MISS' },
        ]) {
            const options = fixture((url) => url.hostname === 'pilot.example' && url.pathname === path
                ? response(html(), { 'content-type': 'text/html', ...headers }) : null);
            await assert.rejects(verifyProductionTunnel(options), /cache/i, `${path}: ${JSON.stringify(headers)}`);
        }
    }
});

test('rejects unhealthy or SPA health responses', async () => {
    for (const body of ['{}', '{"status":"down","service":"happy-server"}']) {
        const options = fixture((url) => url.pathname === '/health'
            ? response(body, { 'content-type': 'application/json', 'cache-control': 'no-store' }) : null);
        await assert.rejects(verifyProductionTunnel(options), /healthy happy-server/i);
    }
});

test('rejects a mismatched domain revision or a stale fallback against an explicit revision', async () => {
    const options = fixture((url) => url.hostname === 'pilot.example' && url.pathname === '/'
        ? response(html(oldRevision), { 'content-type': 'text/html' }) : null);
    await assert.rejects(verifyProductionTunnel(options), /revision mismatch/i);
    await assert.rejects(verifyProductionTunnel({ ...fixture(), expectedRevision: oldRevision }), /revision mismatch/i);
});

test('rejects Cloudflare challenge HTML and challenge headers even with a revision marker', async () => {
    for (const challenged of [
        response('<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/test"></script></html>', { 'content-type': 'text/html' }),
        response(html(), { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }),
    ]) {
        const options = fixture((url) => url.hostname === 'pilot.example' && url.pathname === '/' ? challenged : null);
        await assert.rejects(verifyProductionTunnel(options), /challenge/i);
    }
});

test('rejects unsafe asset redirects and asset HTML fallback', async () => {
    for (const target of ['https://47.115.228.20:8443', 'http://assets.example', 'https://other.example']) {
        const options = fixture((url) => url.hostname === 'pilot.example' && url.pathname === assetPath
            ? response('', { location: `${target}${assetPath}` }, 302) : null);
        await assert.rejects(verifyProductionTunnel(options), /asset redirect/i);
    }
    const options = fixture((url) => url.hostname === 'assets.example'
        ? response(html(), { 'content-type': 'text/html' }) : null);
    await assert.rejects(verifyProductionTunnel(options), /asset.*MIME/i);
});

test('rejects a failed updates upgrade', async () => {
    await assert.rejects(verifyProductionTunnel({ ...fixture(), websocket: async () => ({ status: 403 }) }), /WebSocket.*101/i);
});

async function localServer(t, handler, upgrade) {
    const server = createServer(handler);
    if (upgrade) server.on('upgrade', upgrade);
    const sockets = new Set();
    server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
    });
    return `http://127.0.0.1:${server.address().port}`;
}

test('HTTP adapter uses GET without following redirects or sending credentials', async (t) => {
    const origin = await localServer(t, (req, res) => {
        assert.equal(req.method, 'GET');
        assert.equal(req.headers.authorization, undefined);
        res.writeHead(308, { location: 'https://never-contact.example' }); res.end();
    });
    assert.equal((await requestReadOnly(origin, { timeoutMs: 200 })).status, 308);
    await assert.rejects(requestReadOnly(`${origin}/`, { method: 'POST' }), /read-only/i);
    await assert.rejects(requestReadOnly(origin.replace('http://', 'http://user:password@')), /credentials/i);
});

test('HTTP adapter bounds a response whose body never ends', async (t) => {
    const origin = await localServer(t, (_req, res) => { res.writeHead(200); res.write('partial'); });
    await assert.rejects(requestReadOnly(origin, { timeoutMs: 30 }), /timeout/i);
});

test('bounds a stalled injected HTTP or WebSocket adapter', async () => {
    await assert.rejects(verifyProductionTunnel({ ...fixture(), request: () => new Promise(() => {}) }), /timeout/i);
    await assert.rejects(verifyProductionTunnel({ ...fixture(), websocket: () => new Promise(() => {}) }), /timeout/i);
});

test('WebSocket adapter checks the upgrade accept key and Engine.IO request path', async (t) => {
    const origin = await localServer(t, (_req, res) => res.end(), (req, socket) => {
        assert.equal(req.url, '/v1/updates/?EIO=4&transport=websocket');
        const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    });
    assert.equal((await probeWebSocket(`${origin}/v1/updates/?EIO=4&transport=websocket`, { timeoutMs: 200 })).status, 101);
});

test('WebSocket adapter rejects cache leakage on otherwise valid upgrades', async (t) => {
    for (const headers of [
        'Age: 300\r\nCache-Control: public,max-age=86400\r\nCF-Cache-Status: MISS\r\n',
        'Age: 300\r\n',
        'Cache-Control: public,max-age=86400\r\n',
        'Cache-Control: no-cache,s-maxage="60"\r\n',
        'Cache-Control: immutable\r\n',
        'CF-Cache-Status: MISS\r\n',
        'CF-Cache-Status: EXPIRED\r\n',
    ]) {
        const origin = await localServer(t, (_req, res) => res.end(), (req, socket) => {
            const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
            socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${headers}\r\n`);
        });
        await assert.rejects(probeWebSocket(origin, { timeoutMs: 200 }), /cache/i, headers);
    }
});

test('WebSocket adapter accepts supplied bypass evidence without requiring a cache-control header', async (t) => {
    const origin = await localServer(t, (_req, res) => res.end(), (req, socket) => {
        const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nCF-Cache-Status: BYPASS\r\nAge: 0\r\n\r\n`);
    });
    assert.equal((await probeWebSocket(origin, { timeoutMs: 200 })).status, 101);
});

test('WebSocket adapter rejects fake upgrades, challenges, and timeouts', async (t) => {
    const fake = await localServer(t, (_req, res) => res.end(), (_req, socket) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: wrong\r\n\r\n');
    });
    await assert.rejects(probeWebSocket(fake, { timeoutMs: 100 }), /accept/i);
    const challenge = await localServer(t, (_req, res) => { res.writeHead(403, { 'cf-mitigated': 'challenge' }); res.end(); });
    await assert.rejects(probeWebSocket(challenge, { timeoutMs: 100 }), /WebSocket.*403/i);
    const stalled = await localServer(t, () => undefined);
    await assert.rejects(probeWebSocket(stalled, { timeoutMs: 30 }), /timeout/i);
});

test('CLI help is offline and unknown credential arguments are rejected', () => {
    for (const script of ['check-production-tunnel-dns.mjs', 'verify-production-tunnel.mjs']) {
        const path = new URL(script, import.meta.url);
        const help = spawnSync(process.execPath, [path.pathname, '--help'], { encoding: 'utf8' });
        assert.equal(help.status, 0, help.stderr);
        assert.match(help.stdout, /read-only/i);
        const invalid = spawnSync(process.execPath, [path.pathname, '--token', 'not-a-secret'], { encoding: 'utf8' });
        assert.notEqual(invalid.status, 0);
        assert.match(invalid.stderr, /unknown argument/i);
        assert.doesNotMatch(invalid.stderr, /not-a-secret/);
    }
});
