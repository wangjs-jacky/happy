import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { type Fastify } from '../types';
import { vercelConnectRoutes, type VercelConnectDependencies } from './vercelConnectRoutes';

async function createApp(overrides: Partial<VercelConnectDependencies> = {}) {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        const userId = request.headers['x-user-id'];
        if (typeof userId !== 'string') return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = userId;
    });
    const dependencies: VercelConnectDependencies = {
        config: {
            clientId: 'client-id', clientSecret: 'client-secret', integrationSlug: 'happy-preview',
            redirectUri: 'https://happy.test/v1/connect/vercel/callback', webUrl: 'https://happy.test',
        },
        stateStore: { create: vi.fn(async () => 'state-token'), consume: vi.fn(async () => 'user-1') },
        credentialStore: { get: vi.fn(async () => null), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
        exchangeCode: vi.fn(async () => ({ accessToken: 'provider-secret', configurationId: 'icfg_1', teamId: 'team_1' })),
        ...overrides,
    };
    vercelConnectRoutes(typed, dependencies);
    await typed.ready();
    return { app: typed, dependencies };
}

describe('vercelConnectRoutes', () => {
    let app: Fastify | undefined;
    afterEach(async () => { if (app) await app.close(); });

    it('returns a server-generated connect URL for an authenticated user', async () => {
        const created = await createApp(); app = created.app;
        const response = await app.inject({ method: 'GET', url: '/v1/connect/vercel/params', headers: { 'x-user-id': 'user-1' } });
        expect(response.statusCode).toBe(200);
        expect(response.json().url).toBe('https://vercel.com/integrations/happy-preview/new?state=state-token');
        expect(created.dependencies.stateStore.create).toHaveBeenCalledWith('user-1');
    });

    it('reports availability separately from connection status', async () => {
        const created = await createApp({ credentialStore: {
            get: vi.fn(async () => ({ version: 1 as const, accessToken: 'hidden', configurationId: 'icfg_1', teamId: 'team_1', teamName: 'Acme' })),
            set: vi.fn(async () => {}), delete: vi.fn(async () => {}),
        } }); app = created.app;
        const response = await app.inject({ method: 'GET', url: '/v1/connect/vercel/status', headers: { 'x-user-id': 'user-1' } });
        expect(response.json()).toEqual({ available: true, connected: true, account: { teamId: 'team_1', teamName: 'Acme' } });
        expect(response.body).not.toContain('hidden');
    });

    it('consumes OAuth state, stores the token server-side, and redirects with a stable success flag', async () => {
        const created = await createApp(); app = created.app;
        const response = await app.inject({ method: 'GET', url: '/v1/connect/vercel/callback?code=one-use-code&state=state-token' });
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe('https://happy.test/?vercel=connected');
        expect(created.dependencies.exchangeCode).toHaveBeenCalledWith('one-use-code', created.dependencies.config);
        expect(created.dependencies.credentialStore.set).toHaveBeenCalledWith('user-1', {
            version: 1, accessToken: 'provider-secret', configurationId: 'icfg_1', teamId: 'team_1',
        });
    });

    it('never includes provider secrets or errors in a failed callback redirect', async () => {
        const created = await createApp({ exchangeCode: vi.fn(async () => { throw new Error('provider-secret raw detail'); }) }); app = created.app;
        const response = await app.inject({ method: 'GET', url: '/v1/connect/vercel/callback?code=bad-code&state=state-token' });
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe('https://happy.test/?vercel_error=exchange_failed');
        expect(response.headers.location).not.toContain('provider-secret');
        expect(response.headers.location).not.toContain('bad-code');
    });

    it('deletes only the current user connection', async () => {
        const created = await createApp(); app = created.app;
        const response = await app.inject({ method: 'DELETE', url: '/v1/connect/vercel', headers: { 'x-user-id': 'user-2' } });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true });
        expect(created.dependencies.credentialStore.delete).toHaveBeenCalledWith('user-2');
    });
});
