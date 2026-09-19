import fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { type Fastify } from '@/app/api/types';
import { cloudflareConnectRoutes, type CloudflareConnectDependencies } from '@/app/api/routes/cloudflareConnectRoutes';
import { CloudflareApiError } from '@/app/previews/cloudflareClient';

async function setup(overrides: Partial<CloudflareConnectDependencies> = {}) {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        if (!request.headers['x-user-id']) return reply.code(401).send({});
        request.userId = request.headers['x-user-id'];
    });
    const dependencies = {
        available: () => true,
        activeCredential: vi.fn(async () => null),
        disconnect: vi.fn(async () => ({})),
        reconnect: vi.fn(async () => {}),
        verify: vi.fn(async () => ({ id: 'managed-project' })),
        ...overrides,
    };
    cloudflareConnectRoutes(typed, dependencies);
    await app.ready();
    return { app, dependencies };
}
describe('Cloudflare connection', () => {
    it('requires Happy authentication, validates and encrypts through reconnect without returning secrets', async () => {
        const { app, dependencies } = await setup();
        try {
            const payload = { accountId: 'a'.repeat(32), apiToken: 'secret'.repeat(8) };
            expect((await app.inject({ method: 'POST', url: '/v1/connect/cloudflare', payload })).statusCode).toBe(401);
            const result = await app.inject({ method: 'POST', url: '/v1/connect/cloudflare', headers: { 'x-user-id': 'u1' }, payload });
            expect(result.json()).toEqual({ success: true });
            expect(dependencies.reconnect).toHaveBeenCalledWith('u1', expect.objectContaining({ accessToken: payload.apiToken, teamId: payload.accountId, projectId: 'managed-project' }));
            expect((await app.inject({ method: 'GET', url: '/v1/connect/vercel/status' })).statusCode).toBe(404);
        } finally { await app.close(); }
    });
    it('redacts provider errors and never saves invalid credentials', async () => {
        const { app, dependencies } = await setup({ verify: vi.fn(async () => { throw new CloudflareApiError('secret', 403); }) });
        try {
            const result = await app.inject({ method: 'POST', url: '/v1/connect/cloudflare', headers: { 'x-user-id': 'u1' }, payload: { accountId: 'a'.repeat(32), apiToken: 'secret'.repeat(8) } });
            expect(result.statusCode).toBe(400);
            expect(result.body).not.toContain('secret');
            expect(dependencies.reconnect).not.toHaveBeenCalled();
        } finally { await app.close(); }
    });
    it('reports only non-sensitive account configuration', async () => {
        const { app } = await setup({ activeCredential: vi.fn(async () => ({ version: 1 as const, accessToken: 'secret', configurationId: 'config', teamId: 'a'.repeat(32), projectId: 'project' })) });
        try {
            const result = await app.inject({ method: 'GET', url: '/v1/connect/cloudflare/status', headers: { 'x-user-id': 'u1' } });
            expect(result.json()).toEqual({ available: true, connected: true, account: { accountId: 'a'.repeat(32), projectId: 'project' } });
            expect(result.body).not.toContain('secret');
        } finally { await app.close(); }
    });
});

describe('Cloudflare connection check', () => {
    const credential = { version: 1 as const, accessToken: 'secret', configurationId: 'config', teamId: 'a'.repeat(32), connectionEpoch: 1 };
    it.each([[401, 'authorization_error'], [403, 'authorization_error'], [429, 'unavailable'], [503, 'unavailable']] as const)('classifies %s without leaking provider details', async (status, state) => {
        const save = vi.fn(async () => {});
        const { app } = await setup({ activeCredential: vi.fn(async () => credential),
            verify: vi.fn(async () => { throw new CloudflareApiError('secret-provider-detail', status); }),
            verification: { save, get: vi.fn() } });
        try {
            const result = await app.inject({ method: 'POST', url: '/v1/connect/cloudflare/check', headers: { 'x-user-id': 'u1' } });
            expect(result.statusCode).toBe(200);
            expect(result.json().verification.state).toBe(state);
            expect(result.body).not.toContain('secret');
            expect(save).toHaveBeenCalledWith('u1', credential, expect.objectContaining({ state }));
        } finally { await app.close(); }
    });
    it('does not probe without authentication and rejects a replaced credential', async () => {
        const read = vi.fn().mockResolvedValueOnce(credential).mockResolvedValue({ ...credential, accessToken: 'replacement', connectionEpoch: 2 });
        const save = vi.fn(async () => {});
        const { app, dependencies } = await setup({ activeCredential: read, verification: { save, get: vi.fn() } });
        try {
            expect((await app.inject({ method: 'POST', url: '/v1/connect/cloudflare/check' })).statusCode).toBe(401);
            expect(dependencies.verify).not.toHaveBeenCalled();
            const response = await app.inject({ method: 'POST', url: '/v1/connect/cloudflare/check', headers: { 'x-user-id': 'u1' } });
            expect(response.statusCode).toBe(409);
            expect(save).not.toHaveBeenCalled();
        } finally { await app.close(); }
    });
    it('returns shared evidence without a new provider request on GET', async () => {
        const { app, dependencies } = await setup({ activeCredential: vi.fn(async () => credential), verification: { save: vi.fn(), get: vi.fn(async () => ({ state: 'verified' as const, checkedAt: 123 })) } });
        try {
            const result = await app.inject({ method: 'GET', url: '/v1/connect/cloudflare/status', headers: { 'x-user-id': 'u1' } });
            expect(result.json().verification).toEqual({ state: 'verified', checkedAt: 123 });
            expect(dependencies.verify).not.toHaveBeenCalled();
        } finally { await app.close(); }
    });
});
