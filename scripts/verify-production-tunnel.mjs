import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pathToFileURL } from 'node:url';

export const TUNNEL_ORIGIN = 'https://paws.rodeo';
export const FALLBACK_ORIGIN = 'https://47.115.228.20:8443';

function checkedUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) probes are supported');
    if (url.username || url.password) throw new Error('Probe URLs must not contain credentials');
    return url;
}

function checkedOrigin(value) {
    const url = checkedUrl(value);
    if (url.href !== `${url.origin}/`) throw new Error('Expected an origin without a path, query, or fragment');
    return url.origin;
}

function duration(value) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('timeoutMs must be a positive integer');
    return value;
}

export async function withTimeout(operation, timeoutMs, label) {
    duration(timeoutMs);
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function responseHeaders(raw) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(raw)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    return headers;
}

/** GET/HEAD only, no redirects, cookies, credentials, or TLS bypass; bounded through body completion. */
export async function requestReadOnly(value, { method = 'GET', timeoutMs = 10_000 } = {}) {
    const url = checkedUrl(value);
    duration(timeoutMs);
    if (!['GET', 'HEAD'].includes(method)) throw new Error('Only read-only GET/HEAD requests are allowed');
    return new Promise((resolve, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
            method, rejectUnauthorized: true, agent: false,
        });
        const timer = setTimeout(() => request.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`)), timeoutMs);
        const fail = (error) => { clearTimeout(timer); reject(error); };
        request.on('error', fail);
        request.on('response', (response) => {
            const certificateVerified = url.protocol === 'https:' && response.socket.authorized === true;
            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size > 16 * 1024 * 1024) request.destroy(new Error('HTTP probe body exceeds 16 MiB limit'));
                else chunks.push(chunk);
            });
            response.on('error', fail);
            response.on('end', () => {
                clearTimeout(timer);
                resolve({ status: response.statusCode, headers: responseHeaders(response.headers),
                    body: Buffer.concat(chunks).toString('utf8'), certificateVerified });
            });
        });
        request.end();
    });
}

/** Transport-only probe. Never sends a Socket.IO auth packet or application message. */
export async function probeWebSocket(value, { timeoutMs = 10_000 } = {}) {
    const url = checkedUrl(value);
    duration(timeoutMs);
    const key = randomBytes(16).toString('base64');
    const expectedAccept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    return new Promise((resolve, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
            method: 'GET', rejectUnauthorized: true, agent: false,
            headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': key, Origin: url.origin },
        });
        const timer = setTimeout(() => request.destroy(new Error(`WebSocket timeout after ${timeoutMs}ms`)), timeoutMs);
        const fail = (error) => { clearTimeout(timer); reject(error); };
        request.on('error', fail);
        request.on('response', (response) => {
            fail(new Error(`WebSocket expected HTTP 101, got ${response.statusCode}`));
            response.destroy();
        });
        request.on('upgrade', (response, socket) => {
            clearTimeout(timer);
            socket.destroy();
            if (response.statusCode !== 101 || response.headers.upgrade?.toLowerCase() !== 'websocket'
                || !response.headers.connection?.toLowerCase().split(/\s*,\s*/).includes('upgrade')
                || response.headers['sec-websocket-accept'] !== expectedAccept) {
                reject(new Error('WebSocket upgrade has an invalid status, Upgrade header, or accept key'));
            } else if (response.headers['cf-mitigated']) {
                reject(new Error('WebSocket upgrade was challenged'));
            } else {
                try {
                    assertNoCache('WebSocket upgrade', { headers: responseHeaders(response.headers) }, { requireDirective: false });
                    resolve({ status: 101 });
                } catch (error) { reject(error); }
            }
        });
        request.end();
    });
}

function rejectChallenge(label, response) {
    if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge'
        || /\/cdn-cgi\/challenge-platform\/|<title>\s*(?:Just a moment|Attention Required)/i.test(response.body)) {
        throw new Error(`${label} returned Cloudflare challenge content`);
    }
}

function assertStatus(label, response, expected = [200]) {
    rejectChallenge(label, response);
    if (response.status >= 300 && response.status < 400) throw new Error(`${label} must not redirect (HTTP ${response.status})`);
    if (!expected.includes(response.status)) throw new Error(`${label} returned HTTP ${response.status}`);
}

function assertNoCache(label, response, { requireDirective = true } = {}) {
    const control = response.headers.get('cache-control') ?? '';
    const directives = control.toLowerCase().split(',').map((part) => part.trim());
    const edge = response.headers.get('cf-cache-status')?.toUpperCase();
    const age = response.headers.get('age');
    const cacheableTtl = directives.some((part) => {
        if (!/^(?:s-maxage|max-age)\b/.test(part)) return false;
        const value = part.match(/^(?:s-maxage|max-age)\s*=\s*(?:"(\d+)"|(\d+))$/);
        return !value || Number(value[1] ?? value[2]) > 0;
    });
    if ((requireDirective && !directives.some((part) => part === 'no-store' || part === 'no-cache'))
        || cacheableTtl || directives.includes('immutable')
        || (edge && !['DYNAMIC', 'BYPASS'].includes(edge))
        || (age !== null && (!/^\d+$/.test(age) || Number(age) > 0))) {
        throw new Error(`${label} cache bypass failed: Cache-Control=${control || '(missing)'}, CF-Cache-Status=${edge ?? '(missing)'}, Age=${age ?? '(missing)'}`);
    }
}

function jsonBody(label, response) {
    if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '')) {
        throw new Error(`${label} must return application/json`);
    }
    try { return JSON.parse(response.body); } catch { throw new Error(`${label} returned invalid JSON`); }
}

function assertFileBody(label, response) {
    const mime = response.headers.get('content-type') ?? '';
    if (/^(?:text\/html|application\/xhtml\+xml)\b/i.test(mime)
        || /<!doctype\s+html\b|<(?:html|head|body|script|div)\b/i.test(response.body)) {
        throw new Error(`${label} file probe returned HTML/SPA fallback`);
    }
    // The credential-free nonexistent-file route legitimately returns plain
    // text 404 in production. Other responses retain the JSON API contract.
    if (response.status === 404 && /^text\/plain\b/i.test(mime)) return;
    jsonBody(label, response);
}

function htmlRevision(label, response) {
    assertStatus(label, response);
    if (!/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) throw new Error(`${label} must return HTML`);
    // Attribute ordering is not significant in HTML.
    const tag = response.body.match(/<meta\b[^>]*\bname=["']paws-release-revision["'][^>]*>/i)?.[0];
    const revision = tag?.match(/\bcontent=["']([0-9a-f]{40})["']/i)?.[1]?.toLowerCase();
    if (!revision) throw new Error(`${label} release revision mismatch: missing or invalid revision marker`);
    return revision;
}

/** All origins are explicit; importing this module never contacts production. */
export async function verifyProductionTunnel({ origin, fallbackOrigin, assetOrigin, expectedRevision,
    request = requestReadOnly, websocket = probeWebSocket, timeoutMs = 10_000 }) {
    origin = checkedOrigin(origin);
    fallbackOrigin = checkedOrigin(fallbackOrigin);
    assetOrigin = checkedOrigin(assetOrigin);
    duration(timeoutMs);
    if (expectedRevision !== undefined && !/^[0-9a-f]{40}$/.test(expectedRevision)) throw new Error('Expected revision must be a full lowercase Git SHA');
    const get = (url) => withTimeout(() => request(url, { method: 'GET', timeoutMs }), timeoutMs, url);
    const checks = [];
    // The old origin must remain independent, including when the domain is unavailable.
    const fallbackHtml = await get(`${fallbackOrigin}/`);
    const fallbackRevision = htmlRevision('fallback HTML', fallbackHtml);
    const revision = expectedRevision ?? fallbackRevision;
    if (fallbackRevision !== revision) throw new Error(`fallback release revision mismatch: expected ${revision}, got ${fallbackRevision}`);
    const fallbackHealth = await get(`${fallbackOrigin}/health`);
    assertStatus('fallback /health', fallbackHealth);
    const fallback = jsonBody('fallback /health', fallbackHealth);
    if (fallback?.status !== 'ok' || fallback?.service !== 'happy-server') throw new Error('fallback /health must return a healthy happy-server response');
    checks.push(`fallback healthy at revision ${revision}`);

    const entry = await get(`${origin}/`);
    for (const [path, response] of [
        ['/', entry],
        ['/session/tunnel-verification', await get(`${origin}/session/tunnel-verification`)],
        ['/share/public-deployment-probe', await get(`${origin}/share/public-deployment-probe`)],
    ]) {
        const actual = htmlRevision(path, response);
        if (actual !== revision) throw new Error(`${path} release revision mismatch: expected ${revision}, got ${actual}`);
        assertNoCache(`${path} HTML`, response, { requireDirective: false });
    }
    checks.push(`domain HTML, deep link, and share revision ${revision}`);

    for (const path of ['/health', '/v1/sessions', '/v2/sessions', '/v3/sessions', '/v4/sessions']) {
        const response = await get(`${origin}${path}`);
        assertStatus(path, response, path === '/health' ? [200] : [200, 401, 403, 404]);
        assertNoCache(path, response);
        const body = jsonBody(path, response);
        if (path === '/health' && (body?.status !== 'ok' || body?.service !== 'happy-server')) {
            throw new Error('/health must return a healthy happy-server response');
        }
        checks.push(`${path} HTTP ${response.status}, cache bypass`);
    }

    const filePath = '/files/tunnel-verification';
    const file = await get(`${origin}${filePath}`);
    assertStatus(filePath, file, [200, 401, 403, 404]);
    assertNoCache(filePath, file);
    assertFileBody(filePath, file);
    checks.push(`${filePath} HTTP ${file.status}, cache bypass`);

    const asset = [...entry.body.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
        .map((match) => new URL(match[1], origin))
        .find((url) => url.origin === origin && /^\/(?:_expo|assets)\/.+\.(?:js|css)$/.test(url.pathname));
    if (!asset) throw new Error('HTML has no same-origin JavaScript/CSS asset to verify');
    const redirect = await get(asset.href);
    rejectChallenge('asset', redirect);
    const location = redirect.headers.get('location');
    const target = location ? checkedUrl(new URL(location, asset).href) : null;
    if (![301, 302, 303, 307, 308].includes(redirect.status) || !target || target.origin !== assetOrigin
        || target.pathname !== asset.pathname || target.search !== asset.search || target.hash) {
        throw new Error('asset redirect must preserve its path and query at the expected OSS origin');
    }
    const content = await get(target.href);
    assertStatus('OSS asset', content);
    const mime = content.headers.get('content-type') ?? '';
    if (!(asset.pathname.endsWith('.css') ? /^text\/css\b/i : /^(?:application|text)\/javascript\b/i).test(mime)) {
        throw new Error(`asset MIME type is invalid: ${mime}`);
    }
    if (!/\bimmutable\b/i.test(content.headers.get('cache-control') ?? '')) throw new Error('asset cache-control must be immutable');
    checks.push('same-origin asset redirects to reachable immutable OSS asset');
    const upgrade = await withTimeout(() => websocket(`${origin}/v1/updates/?EIO=4&transport=websocket`, { timeoutMs }), timeoutMs, 'WebSocket');
    if (upgrade.status !== 101) throw new Error(`WebSocket expected HTTP 101, got ${upgrade.status}`);
    checks.push('WebSocket HTTP 101 (transport only; authenticated sessions/reconnect need browser acceptance)');
    return { origin, fallbackOrigin, revision, fallbackReady: true, websocket: 'upgrade-only', checks };
}

async function main(args) {
    if (args.length === 1 && args[0] === '--help') {
        console.log('Read-only Tunnel verification: pnpm tunnel:verify [--revision <40-character SHA>]\nChecks the domain and independent fallback; no credentials. Omit --revision to compare with the current fallback HTML.');
        return;
    }
    let expectedRevision;
    if (args.length === 2 && args[0] === '--revision') expectedRevision = args[1];
    else if (args.length) throw new Error('Unknown argument; use --help (credentials are not accepted)');
    const result = await verifyProductionTunnel({ origin: TUNNEL_ORIGIN, fallbackOrigin: FALLBACK_ORIGIN,
        assetOrigin: 'https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com', expectedRevision });
    for (const check of result.checks) console.log(`OK ${check}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
}
