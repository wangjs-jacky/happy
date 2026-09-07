import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { configureProductionTunnelCaddy } from './configure-production-tunnel-caddy.mjs';
import { configureProductionWebCaddy } from './configure-production-web-caddy.mjs';

const start = '# paws-cloudflare-tunnel:start';
const end = '# paws-cloudflare-tunnel:end';
const unrelated = ':8001 {\n    respond "other # { site"\n}\n\n';
const fixture = `${unrelated}47.115.228.20:8443 {
    tls cert key {
        protocols tls1.2 tls1.3
    }
    bind 0.0.0.0
    @backend path /v1/* /v2/* /v3/* /v4/* /files/* /health
    handle @backend {
        reverse_proxy localhost:3005 {
            transport http {
                tls
            }
        }
    }
    handle {
        root * /var/www/happy-web
        try_files {path} /index.html
        file_server
    }
}
`;
const canonicalFixture = configureProductionWebCaddy(fixture.replace('"other # { site"', '"other site"'));
const tunnelBlock = (source) => source.slice(source.indexOf(start), source.indexOf(end) + end.length);

test('creates a bound loopback HTTP origin with an exact Host guard before normally sorted application routes', () => {
    const configured = configureProductionTunnelCaddy(canonicalFixture);
    const tunnel = tunnelBlock(configured);
    assert.match(tunnel, /http:\/\/:8081 \{\n    bind 127\.0\.0\.1/);
    assert.equal(tunnel.match(/^\s*bind\b/gm)?.length, 1);
    assert.doesNotMatch(tunnel, /bind 0\.0\.0\.0|tls cert key|protocols tls1/);
    assert.match(tunnel, /@paws_tunnel_wrong_host not host paws\.rodeo/);
    assert.match(tunnel, /route \{\n\s+respond @paws_tunnel_wrong_host 421\n/);
    assert.match(tunnel, /@backend path \/v1\/\* \/v2\/\*/);
    assert.match(tunnel, /transport http \{\n\s+tls\n/);
    assert.match(tunnel, /\/web\/current\/index\.html/);
    assert.match(tunnel, /redir @paws_web_asset https:\/\/happy-app-ota-jacky/);
    // /v1/updates is a member of /v1/*; no narrow replacement is allowed.
    assert.doesNotMatch(tunnel, /@backend path \/v1\/updates/);
    assert.ok(configured.startsWith(canonicalFixture));
});

test('adds deferred dynamic no-store headers only after the Tunnel Host guard and before copied routing', () => {
    const configured = configureProductionTunnelCaddy(canonicalFixture);
    assert.ok(configured.startsWith(canonicalFixture));
    const tunnel = tunnelBlock(configured);
    assert.match(tunnel, /@paws_tunnel_dynamic path \/v1\/\* \/v2\/\* \/v3\/\* \/v4\/\* \/files\/\* \/health \/v1\/updates\*/);
    assert.match(tunnel, /route \{\n\s+respond @paws_tunnel_wrong_host 421\n\s+header @paws_tunnel_dynamic >Cache-Control no-store\n\s+handle \{/);
    assert.throws(() => configureProductionTunnelCaddy(fixture.replace('    bind 0.0.0.0',
        '    @paws_tunnel_dynamic path /anything')), /reserved/i);
});

test('refreshes managed routes from the canonical site and remains idempotent', () => {
    const once = configureProductionTunnelCaddy(canonicalFixture);
    assert.equal(configureProductionTunnelCaddy(once), once);
    const updated = once.replace('reverse_proxy localhost:3005', 'reverse_proxy localhost:3006');
    const refreshed = configureProductionTunnelCaddy(updated);
    assert.match(tunnelBlock(refreshed), /reverse_proxy localhost:3006/);
    assert.doesNotMatch(tunnelBlock(refreshed), /localhost:3005/);
    assert.equal(configureProductionTunnelCaddy(refreshed), refreshed);
    assert.equal(refreshed.split(start).length - 1, 1);
});

test('preserves unrelated bytes and ignores quoted braces, comments, and placeholders', () => {
    for (const newline of ['\n', '\r\n']) {
        const source = fixture.replaceAll('\n', newline);
        const result = configureProductionTunnelCaddy(source);
        assert.ok(result.startsWith(source));
        assert.equal(configureProductionTunnelCaddy(result), result);
        assert.match(tunnelBlock(result), /try_files \{path\} \/index\.html/);
    }
});

test('rejects missing or ambiguous canonical sites and malformed structural braces', () => {
    for (const source of [':8001 {\n}\n', fixture + fixture]) {
        assert.throws(() => configureProductionTunnelCaddy(source), /canonical site/i);
    }
    for (const source of [fixture.slice(0, -2), fixture + '}\n', fixture + ':9000 {\n']) {
        assert.throws(() => configureProductionTunnelCaddy(source), /unbalanced/i);
    }
    assert.throws(() => configureProductionTunnelCaddy(fixture.replace('tls cert key', 'tls "unterminated')), /unterminated/i);
});

test('rejects incomplete, duplicate, nested, or overbroad managed markers', () => {
    const configured = configureProductionTunnelCaddy(fixture);
    for (const source of [fixture + start, fixture + end, configured + `\n${start}\n${end}\n`,
        fixture.replace('    tls cert key {', `    ${start}\n    ${end}\n    tls cert key {`),
        configured.replace(end, ':9999 {\n}\n' + end)]) {
        assert.throws(() => configureProductionTunnelCaddy(source), /managed/i);
    }
});

test('refuses unmanaged listeners on the reserved port even when their address differs', () => {
    for (const address of ['http://127.0.0.1:8081', ':8081', '0.0.0.0:8081', '[::]:8081', 'https://paws.rodeo:8081', ':8081,:9090', ':8080-8082']) {
        assert.throws(() => configureProductionTunnelCaddy(`${fixture}\n${address} {\n    respond 200\n}\n`), /unmanaged.*8081/i);
    }
});

test('rejects quoted unmanaged site addresses that could bypass reserved-port detection', () => {
    for (const address of [
        '"http://other.example:8081"', '`http://other.example:8081`',
        '":8081"', '"http://127.0.0.1:8081"', '"http://[::]:8081"',
        '":8080-8082"', '"http://other.example:8081", :9090',
        ':9090, "http://other.example:8081"', '"http://other.example:9090"',
    ]) {
        const unmanaged = `${address} {\n    bind 127.0.0.1\n    respond 200\n}\n`;
        assert.throws(() => configureProductionTunnelCaddy(fixture + unmanaged), /unsupported.*quoted.*site address/i, address);
    }
});

test('rejects path-bearing and nonliteral unmanaged site addresses before scanning reserved ports', () => {
    for (const address of [
        'http://other.example:8081/', 'http://other.example:8081/foo',
        '{$REVIEW_TUNNEL_ADDR}', '{env.REVIEW_TUNNEL_ADDR}', 'http://{$REVIEW_HOST}:8081',
        'http://other.example:9090/foo', 'http://other.example:8081?probe=1',
        'http://other.example:8081#fragment', 'http://user@other.example:8081',
        '*.example:8081', '(shared)',
    ]) {
        assert.throws(() => configureProductionTunnelCaddy(fixture + `${address} {\n    bind 127.0.0.1\n    respond 200\n}\n`),
            /unsupported.*site address/i, address);
    }
});

test('preserves supported literal production and unrelated site labels', () => {
    for (const address of [':8002', 'http://:8080', 'http://47.115.228.20', 'http://:3005',
        'other.example', 'https://other.example:9443', '[::1]:9000', ':9000-9002, :9003']) {
        const source = fixture + `${address} {\n    respond 200\n}\n`;
        assert.ok(configureProductionTunnelCaddy(source).startsWith(source), address);
    }
});

test('real Caddy shared-listener path and environment labels are rejected before they can precede the Host guard', {
    skip: !process.env.CADDY_BINARY && 'Set CADDY_BINARY to run the local Caddy integration check',
}, () => {
    const canonical = '47.115.228.20:8443 {\n    respond "application"\n}\n';
    const managed = tunnelBlock(configureProductionTunnelCaddy(canonical));
    for (const address of ['http://other.example:8081/', 'http://other.example:8081/foo', '{$REVIEW_TUNNEL_ADDR}']) {
        const unmanaged = `${address} {\n    bind 127.0.0.1\n    respond "unmanaged"\n}\n`;
        const adapted = spawnSync(process.env.CADDY_BINARY, ['adapt', '--config', '-', '--adapter', 'caddyfile'], {
            input: `{\n    admin off\n    auto_https off\n}\n${unmanaged}${managed}`,
            env: { ...process.env, REVIEW_TUNNEL_ADDR: 'http://other.example:8081' }, encoding: 'utf8',
        });
        assert.equal(adapted.status, 0, adapted.stderr);
        const servers = Object.values(JSON.parse(adapted.stdout).apps.http.servers);
        assert.deepEqual(servers.map((server) => server.listen), [['127.0.0.1:8081']]);
        assert.deepEqual(servers[0].routes[0].match[0].host, ['other.example']);
        assert.throws(() => configureProductionTunnelCaddy(canonical + unmanaged), /unsupported.*site address/i, address);
    }
});

test('rejects imports and reserved matcher collisions that could bypass the generated guard', () => {
    for (const directive of ['import shared-routes', '@paws_tunnel_wrong_host path /anything']) {
        assert.throws(() => configureProductionTunnelCaddy(fixture.replace('    bind 0.0.0.0', `    ${directive}`)), /unsupported|reserved/i);
    }
});

test('rejects nonliteral loopback origins and malformed host options before generating Caddy syntax', () => {
    for (const address of ['http://0.0.0.0:8081', 'http://[::]:8081', 'http://localhost:8081', 'https://127.0.0.1:8081', 'http://127.0.0.1:8081/path']) {
        assert.throws(() => configureProductionTunnelCaddy(fixture, { tunnelListenAddress: address }), /loopback/i);
    }
    for (const tunnelHost of ['*.rodeo', 'paws.rodeo other.example', 'paws.rodeo\nrespond 200', 'paws.rodeo:443']) {
        assert.throws(() => configureProductionTunnelCaddy(fixture, { tunnelHost }), /host/i);
    }
    const configured = configureProductionTunnelCaddy(fixture.replace('47.115.228.20:8443', 'example.com:8443'), {
        publicSiteAddress: 'example.com:8443', tunnelListenAddress: 'http://127.0.0.1:8082', tunnelHost: 'pilot.example.com',
    });
    assert.match(configured, /http:\/\/:8082/);
    assert.match(configured, /not host pilot\.example\.com/);
});

test('CLI writes changed and unchanged outputs and never overwrites a destination on invalid input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paws-tunnel-cli-'));
    const input = join(directory, 'input');
    const output = join(directory, 'output');
    const cli = new URL('./configure-production-tunnel-caddy.mjs', import.meta.url);
    const run = () => spawnSync(process.execPath, [cli.pathname, input, output], { encoding: 'utf8' });
    try {
        await writeFile(input, fixture);
        const first = run();
        assert.equal(first.status, 0, first.stderr);
        assert.equal(first.stdout, 'changed\n');
        const configured = await readFile(output, 'utf8');
        await writeFile(input, configured);
        assert.equal(run().stdout, 'unchanged\n');
        assert.equal(await readFile(output, 'utf8'), configured);
        await writeFile(input, fixture + start);
        assert.notEqual(run().status, 0);
        assert.equal(await readFile(output, 'utf8'), configured);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('real Caddy binds only loopback and applies the Host guard before backend, SPA, and asset routes', {
    skip: !process.env.CADDY_BINARY && 'Set CADDY_BINARY to run the local Caddy integration check',
}, async () => {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const port = probe.address().port;
    const fallbackProbe = createServer();
    await new Promise((resolve, reject) => { fallbackProbe.once('error', reject); fallbackProbe.listen(0, '127.0.0.1', resolve); });
    const fallbackPort = fallbackProbe.address().port;
    await new Promise((resolve) => fallbackProbe.close(resolve));
    await new Promise((resolve) => probe.close(resolve));
    const source = `http://:${fallbackPort} {
    bind 127.0.0.1
    @file path /files/tunnel-verification
    handle @file {
        header Content-Type "text/plain; charset=utf-8"
        respond "Not Found" 404
    }
    @backend path /v1/* /v2/* /v3/* /v4/* /files/* /health
    handle @backend {
        header Cache-Control "public, max-age=60"
        respond "backend" 200
    }
    @asset path /assets/*
    redir @asset https://assets.example.com{uri} 302
    handle {
        respond "spa" 200
    }
}
`;
    const configured = configureProductionTunnelCaddy(source, {
        publicSiteAddress: `http://:${fallbackPort}`, tunnelListenAddress: `http://127.0.0.1:${port}`,
    });
    const localConfig = '{\n    admin off\n    auto_https off\n}\n' + configured;
    const adapted = spawnSync(process.env.CADDY_BINARY, ['adapt', '--config', '-', '--adapter', 'caddyfile'], {
        input: localConfig, encoding: 'utf8',
    });
    assert.equal(adapted.status, 0, adapted.stderr);
    const servers = Object.values(JSON.parse(adapted.stdout).apps.http.servers);
    assert.deepEqual(servers.map((server) => server.listen).sort(), [[`127.0.0.1:${port}`], [`127.0.0.1:${fallbackPort}`]].sort());
    const child = spawn(process.env.CADDY_BINARY, ['run', '--config', '-', '--adapter', 'caddyfile'], {
        stdio: ['pipe', 'ignore', 'pipe'],
    });
    let logs = '';
    child.stderr.on('data', (data) => { logs += data; });
    child.stdin.end(localConfig);
    const get = (host, path, requestPort = port) => new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: requestPort, path, headers: { Host: host }, timeout: 1000 }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body, location: res.headers.location,
                cacheControl: res.headers['cache-control'] }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Local Caddy request timed out')));
        req.end();
    });
    try {
        let ready = false;
        for (let attempt = 0; attempt < 50; attempt += 1) {
            try { await get('paws.rodeo', '/health'); ready = true; break; } catch { await delay(100); }
        }
        assert.ok(ready, logs);
        for (const path of ['/health', '/v1/sessions', '/v2/sessions', '/v3/sessions', '/v4/sessions',
            '/files/example', '/v1/updates', '/v1/updates/', '/v1/updates-extra']) {
            assert.deepEqual(await get('paws.rodeo', path), { status: 200, body: 'backend', location: undefined, cacheControl: 'no-store' });
            assert.equal((await get('47.115.228.20', path, fallbackPort)).cacheControl, 'public, max-age=60', path);
        }
        assert.deepEqual(await get('paws.rodeo', '/files/tunnel-verification'), {
            status: 404, body: 'Not Found', location: undefined, cacheControl: 'no-store',
        });
        assert.equal((await get('47.115.228.20', '/files/tunnel-verification', fallbackPort)).cacheControl, undefined);
        assert.equal((await get('paws.rodeo', '/')).body, 'spa');
        for (const path of ['/', '/healthz', '/session/example']) assert.equal((await get('paws.rodeo', path)).cacheControl, undefined);
        assert.deepEqual(await get('paws.rodeo', '/assets/test.js'), {
            status: 302, body: '', location: 'https://assets.example.com/assets/test.js', cacheControl: undefined,
        });
        for (const host of ['invalid.example', '127.0.0.1', 'www.paws.rodeo', 'paws.rodeo.evil']) {
            for (const path of ['/health', '/v1/updates', '/assets/test.js', '/']) {
                const rejected = await get(host, path);
                assert.equal(rejected.status, 421, `${host}${path}`);
                assert.equal(rejected.cacheControl, undefined, `${host}${path}`);
            }
        }
    } finally {
        child.kill('SIGTERM');
        await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
    }
});
