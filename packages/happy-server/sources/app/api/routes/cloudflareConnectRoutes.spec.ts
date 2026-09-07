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
