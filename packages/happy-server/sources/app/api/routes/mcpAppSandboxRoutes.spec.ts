import fastify from 'fastify';
import cors from '@fastify/cors';
import { afterEach, describe, expect, it } from 'vitest';

import type { Fastify } from '@/app/api/types';
import { encodeSandboxCspMetadata } from '@/app/api/mcpAppSandboxSecurity';
import { mcpAppSandboxRoutes } from './mcpAppSandboxRoutes';

const sandboxOrigin = 'https://sandbox.paws.example';
const parentOrigin = 'https://paws.example';
const allowedParentOrigins = [parentOrigin];

function buildHostUrl(csp: string, parent = parentOrigin): string {
    return `/mcp-app-sandbox/host?parentOrigin=${encodeURIComponent(parent)}&csp=${encodeURIComponent(csp)}`;
}

async function createApp(overrides: Partial<Parameters<typeof mcpAppSandboxRoutes>[1]> = {}) {
    const app = fastify();
    await app.register(cors, { origin: '*' });
    mcpAppSandboxRoutes(app as Fastify, {
        sandboxOrigin,
        allowedParentOrigins,
        development: false,
        ...overrides,
    });
    await app.ready();
    return app as Fastify;
}

describe('mcpAppSandboxRoutes', () => {
    let app: Fastify | undefined;

    afterEach(async () => {
        await app?.close();
        app = undefined;
    });

    it('serves the external Host Shell only for the exact sandbox and parent origins', async () => {
        const csp = encodeSandboxCspMetadata({
            connectDomains: ['https://api.allowed.example'],
            resourceDomains: ['https://cdn.allowed.example'],
            frameDomains: ['https://frame.allowed.example'],
        }, false)!;
        app = await createApp();

        const response = await app.inject({
            method: 'GET',
            url: buildHostUrl(csp),
            headers: { host: 'sandbox.paws.example', origin: parentOrigin },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=(), clipboard-write=()');
        expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
        expect(response.body).toContain('<script src="/mcp-app-sandbox/host.js" defer></script>');
        expect(response.body).not.toMatch(/<script(?![^>]+src=)[^>]*>/);

        const policy = response.headers['content-security-policy'];
        expect(policy).toBe([
            "default-src 'none'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'unsafe-inline'",
            'img-src data: blob: https://cdn.allowed.example',
            'media-src blob: https://cdn.allowed.example',
            'font-src data: https://cdn.allowed.example',
            'connect-src https://api.allowed.example',
            "frame-src 'self' https://frame.allowed.example",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            `frame-ancestors ${parentOrigin}`,
        ].join('; '));
        expect(policy).not.toContain('undeclared.example');
    });

    it('uses restrictive none directives when no external domains are declared', async () => {
        const csp = encodeSandboxCspMetadata({
            connectDomains: [],
            resourceDomains: [],
            frameDomains: [],
        }, false)!;
        app = await createApp();

        const response = await app.inject({
            method: 'GET',
            url: buildHostUrl(csp),
            headers: { host: 'sandbox.paws.example' },
        });

        expect(response.headers['content-security-policy']).toContain("connect-src 'none'");
        expect(response.headers['content-security-policy']).toContain("img-src data: blob:");
        expect(response.headers['content-security-policy']).toContain("frame-src 'self'");
    });

    it.each([
        ['wrong host', { host: 'paws.example' }, parentOrigin],
        ['lookalike host', { host: 'sandbox.paws.example.evil.test' }, parentOrigin],
        ['unexpected parent', { host: 'sandbox.paws.example' }, 'https://evil.example'],
    ])('returns an indistinguishable no-store 404 for %s', async (_label, headers, parent) => {
        const csp = encodeSandboxCspMetadata({ connectDomains: [], resourceDomains: [], frameDomains: [] }, false)!;
        app = await createApp();

        const response = await app.inject({
            method: 'GET',
            url: buildHostUrl(csp, parent),
            headers,
        });

        expect(response.statusCode).toBe(404);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.json()).toEqual({ error: 'Not found' });
        expect(response.body).not.toContain(parentOrigin);
        expect(response.body).not.toContain(sandboxOrigin);
    });

    it('returns the same 404 when configuration or CSP input is missing or invalid', async () => {
        app = await createApp({ sandboxOrigin: undefined, allowedParentOrigins: [] });
        const missingConfig = await app.inject({
            method: 'GET',
            url: '/mcp-app-sandbox/host?parentOrigin=https%3A%2F%2Fpaws.example&csp=bad',
            headers: { host: 'sandbox.paws.example' },
        });
        await app.close();

        app = await createApp();
        const invalidCsp = await app.inject({
            method: 'GET',
            url: '/mcp-app-sandbox/host?parentOrigin=https%3A%2F%2Fpaws.example&csp=bad',
            headers: { host: 'sandbox.paws.example' },
        });

        expect(missingConfig.statusCode).toBe(404);
        expect(invalidCsp.statusCode).toBe(404);
        expect(missingConfig.body).toBe(invalidCsp.body);
        expect(missingConfig.headers['cache-control']).toBe('no-store');
        expect(invalidCsp.headers['cache-control']).toBe('no-store');
    });

    it('parses escaped exact-origin query values without broad matching', async () => {
        const csp = encodeSandboxCspMetadata({ connectDomains: [], resourceDomains: [], frameDomains: [] }, false)!;
        app = await createApp();

        const accepted = await app.inject({
            method: 'GET',
            url: buildHostUrl(csp, 'https://paws.example:443'),
            headers: { host: 'sandbox.paws.example:443' },
        });
        const rejected = await app.inject({
            method: 'GET',
            url: buildHostUrl(csp, 'https://paws.example.evil.test'),
            headers: { host: 'sandbox.paws.example' },
        });

        expect(accepted.statusCode).toBe(200);
        expect(rejected.statusCode).toBe(404);
    });

    it('serves JavaScript only on the configured host with no CORS or configuration disclosure', async () => {
        app = await createApp();

        const accepted = await app.inject({
            method: 'GET',
            url: '/mcp-app-sandbox/host.js',
            headers: { host: 'sandbox.paws.example', origin: 'https://attacker.example' },
        });
        const rejected = await app.inject({
            method: 'GET',
            url: '/mcp-app-sandbox/host.js',
            headers: { host: 'paws.example' },
        });

        expect(accepted.statusCode).toBe(200);
        expect(accepted.headers['content-type']).toBe('text/javascript; charset=utf-8');
        expect(accepted.headers['cache-control']).toBe('no-store');
        expect(accepted.headers['x-content-type-options']).toBe('nosniff');
        expect(accepted.headers['cross-origin-resource-policy']).toBe('same-origin');
        expect(accepted.headers['access-control-allow-origin']).toBeUndefined();
        expect(accepted.body).toContain('parentOrigin');
        expect(accepted.body).not.toContain(parentOrigin);
        expect(accepted.body).not.toContain(sandboxOrigin);
        expect(rejected.statusCode).toBe(404);
        expect(rejected.headers['cache-control']).toBe('no-store');
    });

    it.each(['/mcp-app-sandbox/host', '/mcp-app-sandbox/host.js'])(
        'does not expose %s through a wildcard CORS preflight', async (url) => {
        app = await createApp();

        const response = await app.inject({
            method: 'OPTIONS',
            url,
            headers: {
                host: 'sandbox.paws.example',
                origin: 'https://attacker.example',
                'access-control-request-method': 'GET',
            },
        });

        expect(response.statusCode).toBe(404);
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
});
