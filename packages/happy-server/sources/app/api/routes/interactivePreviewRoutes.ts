import { interactivePreviewEventSchema, interactivePreviewManifestSchema, type InteractivePreviewEvent, type InteractivePreviewManifest } from '@slopus/happy-wire';
import { z } from 'zod';
import { type Fastify } from '../types';
import { previewService } from '@/app/previews/previewService';

const previewIdSchema = z.uuid();
const assetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);
const uploadSchema = z.object({ assetId: assetIdSchema, method: z.literal('POST'), uploadUrl: z.string(), formFields: z.record(z.string(), z.string()) });

export interface InteractivePreviewRouteDependencies {
    sessionOwnedBy(accountId: string, sessionId: string): Promise<boolean>;
    createDraft(accountId: string, sessionId: string, manifest: InteractivePreviewManifest): Promise<{ previewId: string; uploads: Array<z.infer<typeof uploadSchema>> }>;
    completeAsset(accountId: string, previewId: string, assetId: string): Promise<void>;
    publish(accountId: string, previewId: string): Promise<InteractivePreviewEvent>;
    list(accountId: string): Promise<InteractivePreviewEvent[]>;
    delete(accountId: string, previewId: string): Promise<void>;
}

export function interactivePreviewRoutes(app: Fastify, dependencies: InteractivePreviewRouteDependencies = previewService) {
    app.post('/v1/sessions/:sessionId/interactive-previews/drafts', {
        preHandler: app.authenticate,
        schema: { params: z.object({ sessionId: z.string().min(1) }), body: interactivePreviewManifestSchema,
            response: { 200: z.object({ previewId: previewIdSchema, uploads: z.array(uploadSchema) }), 404: z.object({ error: z.string() }) } },
    }, async (request, reply) => {
        if (!await dependencies.sessionOwnedBy(request.userId, request.params.sessionId)) return reply.code(404).send({ error: 'Session not found' });
        return reply.send(await dependencies.createDraft(request.userId, request.params.sessionId, request.body));
    });

    app.post('/v1/interactive-previews/:previewId/assets/:assetId/complete', {
        preHandler: app.authenticate,
        schema: { params: z.object({ previewId: previewIdSchema, assetId: assetIdSchema }), response: { 200: z.object({ success: z.literal(true) }) } },
    }, async (request, reply) => {
        await dependencies.completeAsset(request.userId, request.params.previewId, request.params.assetId);
        return reply.send({ success: true as const });
    });

    app.post('/v1/interactive-previews/:previewId/publish', {
        preHandler: app.authenticate,
        schema: { params: z.object({ previewId: previewIdSchema }), response: { 200: z.object({ preview: interactivePreviewEventSchema }) } },
    }, async (request, reply) => reply.send({ preview: await dependencies.publish(request.userId, request.params.previewId) }));

    app.get('/v1/interactive-previews', {
        preHandler: app.authenticate,
        schema: { response: { 200: z.object({ previews: z.array(interactivePreviewEventSchema) }) } },
    }, async (request, reply) => reply.send({ previews: await dependencies.list(request.userId) }));

    app.delete('/v1/interactive-previews/:previewId', {
        preHandler: app.authenticate,
        schema: { params: z.object({ previewId: previewIdSchema }), response: { 200: z.object({ success: z.literal(true) }) } },
    }, async (request, reply) => {
        await dependencies.delete(request.userId, request.params.previewId);
        return reply.send({ success: true as const });
    });
}
