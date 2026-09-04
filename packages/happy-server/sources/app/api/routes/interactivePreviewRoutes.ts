import { interactivePreviewEventSchema, interactivePreviewManifestSchema, type InteractivePreviewEvent, type InteractivePreviewManifest } from '@slopus/happy-wire';
import { z } from 'zod';
import { type Fastify } from '../types';
import { previewService } from '@/app/previews/previewService';

const previewIdSchema = z.uuid();
const assetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,96}$/);
const uploadSchema = z.object({ assetId: assetIdSchema, method: z.literal('POST'), uploadUrl: z.string(), formFields: z.record(z.string(), z.string()) });

function isPreviewNotFound(error: unknown): boolean {
    return error instanceof Error && error.message === 'Preview not found';
}

export interface InteractivePreviewRouteDependencies {
    sessionOwnedBy(accountId: string, sessionId: string): Promise<boolean>;
    createDraft(accountId: string, sessionId: string, manifest: InteractivePreviewManifest): Promise<{ previewId: string; uploads: Array<z.infer<typeof uploadSchema>> }>;
    completeAsset(accountId: string, sessionId: string, previewId: string, assetId: string): Promise<void>;
    publish(accountId: string, sessionId: string, previewId: string): Promise<InteractivePreviewEvent>;
    list(accountId: string, sessionId: string): Promise<InteractivePreviewEvent[]>;
    delete(accountId: string, sessionId: string, previewId: string): Promise<void>;
}

export function interactivePreviewRoutes(app: Fastify, dependencies: InteractivePreviewRouteDependencies = previewService) {
    const sessionParams = z.object({ sessionId: z.string().min(1) });
    const previewParams = sessionParams.extend({ previewId: previewIdSchema });
    const assetParams = previewParams.extend({ assetId: assetIdSchema });

    app.post('/v1/sessions/:sessionId/previews/:previewId/draft', {
        preHandler: app.authenticate,
        schema: { params: previewParams, body: interactivePreviewManifestSchema,
            response: { 200: z.object({ previewId: previewIdSchema, uploads: z.array(uploadSchema) }), 404: z.object({ error: z.string() }) } },
    }, async (request, reply) => {
        if (request.params.previewId !== request.body.previewId) return reply.code(404).send({ error: 'Preview not found' });
        if (!await dependencies.sessionOwnedBy(request.userId, request.params.sessionId)) return reply.code(404).send({ error: 'Session not found' });
        try {
            return reply.send(await dependencies.createDraft(request.userId, request.params.sessionId, request.body));
        } catch (error) {
            if (isPreviewNotFound(error)) return reply.code(404).send({ error: 'Preview not found' });
            throw error;
        }
    });

    app.post('/v1/sessions/:sessionId/previews/:previewId/assets/:assetId/uploaded', {
        preHandler: app.authenticate,
        schema: { params: assetParams, response: { 200: z.object({ success: z.literal(true) }), 404: z.object({ error: z.string() }) } },
    }, async (request, reply) => {
        if (!await dependencies.sessionOwnedBy(request.userId, request.params.sessionId)) return reply.code(404).send({ error: 'Session not found' });
        try {
            await dependencies.completeAsset(request.userId, request.params.sessionId, request.params.previewId, request.params.assetId);
        } catch (error) {
            if (isPreviewNotFound(error)) return reply.code(404).send({ error: 'Preview not found' });
            throw error;
        }
        return reply.send({ success: true as const });
    });

    app.post('/v1/sessions/:sessionId/previews/:previewId/publish', {
        preHandler: app.authenticate,
        schema: { params: previewParams, response: { 200: z.object({ preview: interactivePreviewEventSchema }), 404: z.object({ error: z.string() }) } },
    }, async (request, reply) => {
        if (!await dependencies.sessionOwnedBy(request.userId, request.params.sessionId)) return reply.code(404).send({ error: 'Session not found' });
        try {
            return reply.send({ preview: await dependencies.publish(request.userId, request.params.sessionId, request.params.previewId) });
        } catch (error) {
            if (isPreviewNotFound(error)) return reply.code(404).send({ error: 'Preview not found' });
            throw error;
        }
    });

    app.get('/v1/sessions/:sessionId/previews', {
        preHandler: app.authenticate,
        schema: { params: sessionParams, response: { 200: z.object({ previews: z.array(interactivePreviewEventSchema) }), 404: z.object({ error: z.string() }) } },
    }, async (request, reply) => {
        if (!await dependencies.sessionOwnedBy(request.userId, request.params.sessionId)) return reply.code(404).send({ error: 'Session not found' });
        return reply.send({ previews: await dependencies.list(request.userId, request.params.sessionId) });
    });

    app.delete('/v1/sessions/:sessionId/previews/:previewId', {
        preHandler: app.authenticate,
        schema: { params: previewParams, response: { 200: z.object({ success: z.literal(true) }), 404: z.object({ error: z.string() }) } },
    }, async (request, reply) => {
        if (!await dependencies.sessionOwnedBy(request.userId, request.params.sessionId)) return reply.code(404).send({ error: 'Session not found' });
        try {
            await dependencies.delete(request.userId, request.params.sessionId, request.params.previewId);
        } catch (error) {
            if (isPreviewNotFound(error)) return reply.code(404).send({ error: 'Preview not found' });
            throw error;
        }
        return reply.send({ success: true as const });
    });
}
