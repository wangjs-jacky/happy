import { z } from 'zod';

import { generatedImagesPlugin } from '@/modules/generated-images/generatedImagesPlugin';
import type { Fastify } from '../types';

interface GeneratedImagesPluginRoutesDependency {
    install: (accountId: string) => Promise<void>;
    getStatus: (accountId: string) => Promise<{ installed: boolean }>;
    uninstall: (accountId: string) => Promise<void>;
}

const statusSchema = z.object({ installed: z.boolean() });

export function generatedImagesPluginRoutes(
    app: Fastify,
    plugin: GeneratedImagesPluginRoutesDependency = generatedImagesPlugin,
) {
    app.get('/v1/plugins/generated-images-gallery', {
        preHandler: app.authenticate,
        schema: { response: { 200: statusSchema } },
    }, async (request, reply) => reply.send(await plugin.getStatus(request.userId)));

    app.put('/v1/plugins/generated-images-gallery', {
        preHandler: app.authenticate,
        schema: { response: { 200: statusSchema } },
    }, async (request, reply) => {
        await plugin.install(request.userId);
        return reply.send(await plugin.getStatus(request.userId));
    });

    app.delete('/v1/plugins/generated-images-gallery', {
        preHandler: app.authenticate,
        schema: { response: { 200: statusSchema } },
    }, async (request, reply) => {
        await plugin.uninstall(request.userId);
        return reply.send({ installed: false });
    });
}
