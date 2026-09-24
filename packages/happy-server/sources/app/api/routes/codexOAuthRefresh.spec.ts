import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const tls = vi.hoisted(() => ({ ca: '' }));
// Trust only this test's private CA; production still verifies the public CA chain.
vi.mock('undici', async load => {
    const original = await load<typeof import('undici')>();
    return { ...original, EnvHttpProxyAgent: class extends original.EnvHttpProxyAgent {
        constructor(options: ConstructorParameters<typeof original.EnvHttpProxyAgent>[0] = {}) {
            const trusted = { ...options, requestTls: { ca: tls.ca } }; super(trusted);
        }
    } };
});
import { refreshCodexOAuth } from './codexOAuthRefresh';

describe('Codex OAuth through a CONNECT-only production-style proxy', () => {
    let directory: string;
    let upstream: ReturnType<typeof httpsServer>;
    let proxy: ReturnType<typeof httpServer>;
    let tunnels = 0;
    let forwardedPlaintext = 0;
    let requests = 0;
    let reply: 'success' | 'revoked' | 'html' = 'success';
    const sockets = new Set<any>();
    const auth = { OPENAI_API_KEY: null, tokens: { id_token: 'id', access_token: 'old', refresh_token: 'single-use', account_id: 'same-account' } };
    const token = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'same-account' } })).toString('base64url');
    beforeAll(async () => {
        directory = mkdtempSync(join(tmpdir(), 'codex-proxy-test-'));
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=auth.openai.com', '-addext', 'subjectAltName=DNS:auth.openai.com'], { stdio: 'ignore' });
        tls.ca = readFileSync(join(directory, 'cert.pem'), 'utf8');
        upstream = httpsServer({ key: readFileSync(join(directory, 'key.pem')), cert: tls.ca }, (req, res) => {
            let body = ''; req.on('data', part => { body += part; }); req.on('end', () => {
                requests++;
                if (req.url !== '/oauth/token' || JSON.parse(body).refresh_token !== 'single-use') { res.writeHead(400).end(); return; }
                if (reply === 'revoked') { res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code: 'refresh_token_revoked', message: 'sensitive provider message' } })); return; }
                if (reply === 'html') { res.writeHead(400, { 'Content-Type': 'text/html' }).end('proxy error'); return; }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ access_token: `e30.${token}.signature`, refresh_token: 'rotated-once' }));
            });
        });
        await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
        proxy = httpServer((_req, res) => { forwardedPlaintext++; res.writeHead(400).end('Plain HTTP sent to HTTPS port'); });
        proxy.on('connect', (req, client, head) => {
            if (req.url !== 'auth.openai.com:443') { client.destroy(); return; }
            tunnels++;
            const remote = connect((upstream.address() as any).port, '127.0.0.1', () => {
                client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head.length) remote.write(head);
                remote.pipe(client); client.pipe(remote);
            });
            sockets.add(client); sockets.add(remote);
            client.on('error', () => remote.destroy()); remote.on('error', () => client.destroy());
        });
        await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
        for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) vi.stubEnv(key, `http://127.0.0.1:${(proxy.address() as any).port}`);
        for (const key of ['NO_PROXY', 'no_proxy', 'PAWS_CODEX_OAUTH_TEST_URL']) vi.stubEnv(key, '');
    }, 20_000);
    afterAll(async () => {
        vi.unstubAllEnvs(); for (const socket of sockets) socket.destroy();
        await Promise.all([new Promise<void>(resolve => proxy?.close(() => resolve())), new Promise<void>(resolve => upstream?.close(() => resolve()))]);
        if (directory) rmSync(directory, { recursive: true, force: true });
    });
    it('sends one TLS OAuth request through CONNECT and retains the rotated token', async () => {
        const rotated = await refreshCodexOAuth(auth);
        expect(rotated.tokens.refresh_token).toBe('rotated-once');
        expect(rotated.tokens.account_id).toBe('same-account');
        expect(tunnels).toBe(1); expect(requests).toBe(1); expect(forwardedPlaintext).toBe(0);
    });
    it('classifies structured provider rejection without exposing its body', async () => {
        reply = 'revoked';
        await expect(refreshCodexOAuth(auth)).rejects.toMatchObject({ definitive: true, message: 'Codex credential refresh failed' });
    });
    it('does not treat an HTML proxy failure as authoritative token revocation', async () => {
        reply = 'html';
        await expect(refreshCodexOAuth(auth)).rejects.toMatchObject({ definitive: false, message: 'Codex credential refresh failed' });
    });
});
