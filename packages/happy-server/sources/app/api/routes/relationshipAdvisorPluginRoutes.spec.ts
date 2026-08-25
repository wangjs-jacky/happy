import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Fastify } from '../types';
import { relationshipAdvisorPluginRoutes } from './relationshipAdvisorPluginRoutes';

async function createApp(plugin: Parameters<typeof relationshipAdvisorPluginRoutes>[1]) {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        const userId = request.headers['x-user-id'];
        if (typeof userId !== 'string') return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = userId;
    });
    relationshipAdvisorPluginRoutes(typed, plugin);
    await typed.ready();
    return typed;
}

describe('relationshipAdvisorPluginRoutes', () => {
    let app: Fastify | undefined;

    afterEach(async () => {
        if (app) await app.close();
        app = undefined;
        vi.clearAllMocks();
    });

    it('installs encrypted provider configuration without returning the API key', async () => {
        const install = vi.fn(async () => undefined);
        const plugin = {
            install,
            getStatus: vi.fn(async () => ({
                installed: true as const,
                baseUrl: 'https://api.example.com/v1',
                model: 'example-chat',
                keyHint: '1234',
            })),
            uninstall: vi.fn(async () => undefined),
        };
        app = await createApp(plugin);

        const response = await app.inject({
            method: 'PUT',
            url: '/v1/plugins/relationship-advisor',
            headers: { 'x-user-id': 'user-1' },
            payload: {
                apiKey: 'sk-secret-1234',
                baseUrl: 'https://api.example.com/v1',
                model: 'example-chat',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            installed: true,
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
            keyHint: '1234',
        });
        expect(JSON.stringify(response.json())).not.toContain('sk-secret-1234');
        expect(install).toHaveBeenCalledWith('user-1', {
            apiKey: 'sk-secret-1234',
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
        });
    });

    it('returns installation status and uninstalls idempotently for the authenticated user', async () => {
        const uninstall = vi.fn(async () => undefined);
        const plugin = {
            install: vi.fn(async () => undefined),
            getStatus: vi.fn(async () => ({ installed: false as const })),
            uninstall,
        };
        app = await createApp(plugin);

        const status = await app.inject({
            method: 'GET',
            url: '/v1/plugins/relationship-advisor',
            headers: { 'x-user-id': 'user-2' },
        });
        const removed = await app.inject({
            method: 'DELETE',
            url: '/v1/plugins/relationship-advisor',
            headers: { 'x-user-id': 'user-2' },
        });

        expect(status.statusCode).toBe(200);
        expect(status.json()).toEqual({ installed: false });
        expect(removed.statusCode).toBe(200);
        expect(removed.json()).toEqual({ installed: false });
        expect(uninstall).toHaveBeenCalledWith('user-2');
    });

    it('rejects provider URLs that are not HTTPS before saving credentials', async () => {
        const install = vi.fn(async () => undefined);
        const plugin = {
            install,
            getStatus: vi.fn(async () => ({ installed: false as const })),
            uninstall: vi.fn(async () => undefined),
        };
        app = await createApp(plugin);

        const response = await app.inject({
            method: 'PUT',
            url: '/v1/plugins/relationship-advisor',
            headers: { 'x-user-id': 'user-3' },
            payload: {
                apiKey: 'secret',
                baseUrl: 'http://127.0.0.1:9000/v1',
                model: 'internal-model',
            },
        });

        expect(response.statusCode).toBe(400);
        expect(install).not.toHaveBeenCalled();
    });
});
