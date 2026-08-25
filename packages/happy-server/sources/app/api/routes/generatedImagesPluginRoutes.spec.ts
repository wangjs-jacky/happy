import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Fastify } from '../types';
import { generatedImagesPluginRoutes } from './generatedImagesPluginRoutes';

async function createApp(plugin: Parameters<typeof generatedImagesPluginRoutes>[1]) {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        const userId = request.headers['x-user-id'];
        if (typeof userId !== 'string') return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = userId;
    });
    generatedImagesPluginRoutes(typed, plugin);
    await typed.ready();
    return typed;
}

describe('generatedImagesPluginRoutes', () => {
    let app: Fastify | undefined;

    afterEach(async () => {
        if (app) await app.close();
        app = undefined;
        vi.clearAllMocks();
    });

    it('installs and uninstalls the gallery for the authenticated user', async () => {
        const install = vi.fn(async () => undefined);
        const uninstall = vi.fn(async () => undefined);
        const getStatus = vi.fn()
            .mockResolvedValueOnce({ installed: true as const })
            .mockResolvedValueOnce({ installed: false as const });
        app = await createApp({ install, uninstall, getStatus });

        const installed = await app.inject({
            method: 'PUT',
            url: '/v1/plugins/generated-images-gallery',
            headers: { 'x-user-id': 'user-1' },
        });
        const removed = await app.inject({
            method: 'DELETE',
            url: '/v1/plugins/generated-images-gallery',
            headers: { 'x-user-id': 'user-1' },
        });

        expect(installed.statusCode).toBe(200);
        expect(installed.json()).toEqual({ installed: true });
        expect(removed.statusCode).toBe(200);
        expect(removed.json()).toEqual({ installed: false });
        expect(install).toHaveBeenCalledWith('user-1');
        expect(uninstall).toHaveBeenCalledWith('user-1');
    });

    it('returns the current installation state', async () => {
        app = await createApp({
            install: vi.fn(async () => undefined),
            uninstall: vi.fn(async () => undefined),
            getStatus: vi.fn(async () => ({ installed: false as const })),
        });

        const response = await app.inject({
            method: 'GET',
            url: '/v1/plugins/generated-images-gallery',
            headers: { 'x-user-id': 'user-2' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ installed: false });
    });
});
