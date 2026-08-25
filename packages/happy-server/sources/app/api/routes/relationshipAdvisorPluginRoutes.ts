import { z } from 'zod';

import { relationshipAdvisorPlugin } from '@/modules/relationship-advisor/relationshipAdvisorPlugin';
import type { Fastify } from '../types';

interface RelationshipAdvisorPluginRoutesDependency {
    install: (accountId: string, configuration: {
        apiKey: string;
        baseUrl: string;
        model: string;
    }) => Promise<void>;
    getStatus: (accountId: string) => Promise<
        | { installed: false }
        | { installed: true; baseUrl: string; model: string; keyHint: string }
    >;
    uninstall: (accountId: string) => Promise<void>;
}

const statusSchema = z.discriminatedUnion('installed', [
    z.object({ installed: z.literal(false) }),
    z.object({
        installed: z.literal(true),
        baseUrl: z.string(),
        model: z.string(),
        keyHint: z.string(),
    }),
]);

const providerBaseUrlSchema = z.string().trim().url().max(2_000).refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:'
        && !url.username
        && !url.password
        && !url.search
        && !url.hash;
}, 'Provider URL must be a credential-free HTTPS URL');

export function relationshipAdvisorPluginRoutes(
    app: Fastify,
    plugin: RelationshipAdvisorPluginRoutesDependency = relationshipAdvisorPlugin,
) {
    app.get('/v1/plugins/relationship-advisor', {
        preHandler: app.authenticate,
        schema: { response: { 200: statusSchema } },
    }, async (request, reply) => reply.send(await plugin.getStatus(request.userId)));

    app.put('/v1/plugins/relationship-advisor', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                apiKey: z.string().trim().min(1).max(500),
                baseUrl: providerBaseUrlSchema,
                model: z.string().trim().min(1).max(200),
            }),
            response: { 200: statusSchema },
        },
    }, async (request, reply) => {
        await plugin.install(request.userId, request.body);
        return reply.send(await plugin.getStatus(request.userId));
    });

    app.delete('/v1/plugins/relationship-advisor', {
        preHandler: app.authenticate,
        schema: { response: { 200: z.object({ installed: z.literal(false) }) } },
    }, async (request, reply) => {
        await plugin.uninstall(request.userId);
        return reply.send({ installed: false });
    });
}
