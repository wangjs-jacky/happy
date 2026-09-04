import fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { type Fastify } from '../types';
import { interactivePreviewRoutes, type InteractivePreviewRouteDependencies } from './interactivePreviewRoutes';

const manifest = { version: 1 as const, previewId: '11111111-1111-4111-8111-111111111111', title: 'Toolbar concept', assets: [
    { id: 'index', path: 'index.html', size: 12, sha256: 'a'.repeat(64), mimeType: 'text/html' },
] };

async function createApp(overrides: Partial<InteractivePreviewRouteDependencies> = {}) {
    const app = fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        const id = request.headers['x-user-id']; if (!id) return reply.code(401).send({ error: 'Unauthorized' }); request.userId = id;
    });
    const dependencies: InteractivePreviewRouteDependencies = {
        sessionOwnedBy: vi.fn(async () => true),
        createDraft: vi.fn(async () => ({ previewId: manifest.previewId, uploads: [{ assetId: 'index', method: 'POST' as const, uploadUrl: 'https://oss.test', formFields: { key: 'signed' } }] })),
        completeAsset: vi.fn(async () => {}),
        publish: vi.fn(async () => ({ version: 1 as const, id: manifest.previewId, title: manifest.title, state: 'ready' as const, url: 'https://draft.vercel.app', publishedAt: 1, expiresAt: 2 })),
        list: vi.fn(async () => []), delete: vi.fn(async () => {}), ...overrides,
    };
    interactivePreviewRoutes(typed, dependencies); await typed.ready(); return { app: typed, dependencies };
}

describe('interactivePreviewRoutes', () => {
    let app: Fastify | undefined; afterEach(async () => { if (app) await app.close(); });
    it('rejects every preview operation for another user session before invoking the service', async () => {
        const created = await createApp({ sessionOwnedBy: vi.fn(async () => false) }); app = created.app;
        const requests = [
            { method: 'POST' as const, url: `/v1/sessions/session-1/previews/${manifest.previewId}/draft`, payload: manifest, dependency: 'createDraft' },
            { method: 'POST' as const, url: `/v1/sessions/session-1/previews/${manifest.previewId}/assets/index/uploaded`, dependency: 'completeAsset' },
            { method: 'POST' as const, url: `/v1/sessions/session-1/previews/${manifest.previewId}/publish`, dependency: 'publish' },
            { method: 'GET' as const, url: '/v1/sessions/session-1/previews', dependency: 'list' },
            { method: 'DELETE' as const, url: `/v1/sessions/session-1/previews/${manifest.previewId}`, dependency: 'delete' },
        ];
        for (const request of requests) {
            const response = await app.inject({ ...request, headers: { 'x-user-id': 'user-2' } });
            expect(response.statusCode).toBe(404);
            expect((created.dependencies as any)[request.dependency]).not.toHaveBeenCalled();
        }
    });
    it('creates an immutable manifest draft and returns private direct-upload descriptors', async () => {
        const created = await createApp(); app = created.app;
        const response = await app.inject({ method: 'POST', url: `/v1/sessions/session-1/previews/${manifest.previewId}/draft`, headers: { 'x-user-id': 'user-1' }, payload: manifest });
        expect(response.statusCode).toBe(200); expect(response.json().uploads[0].uploadUrl).toBe('https://oss.test');
        expect(created.dependencies.createDraft).toHaveBeenCalledWith('user-1', 'session-1', manifest);
    });
    it('completes an exact asset and publishes only for the owning account', async () => {
        const created = await createApp(); app = created.app;
        const completed = await app.inject({ method: 'POST', url: `/v1/sessions/session-1/previews/${manifest.previewId}/assets/index/uploaded`, headers: { 'x-user-id': 'user-1' } });
        expect(completed.statusCode).toBe(200); expect(created.dependencies.completeAsset).toHaveBeenCalledWith('user-1', 'session-1', manifest.previewId, 'index');
        const published = await app.inject({ method: 'POST', url: `/v1/sessions/session-1/previews/${manifest.previewId}/publish`, headers: { 'x-user-id': 'user-1' } });
        expect(published.json().preview.state).toBe('ready'); expect(created.dependencies.publish).toHaveBeenCalledWith('user-1', 'session-1', manifest.previewId);
    });
    it('accepts the shared 96-character asset id at the route boundary and rejects 97 characters', async () => {
        const created = await createApp(); app = created.app;
        const assetId = 'a'.repeat(96);
        const accepted = await app.inject({ method: 'POST', url: `/v1/sessions/session-1/previews/${manifest.previewId}/assets/${assetId}/uploaded`, headers: { 'x-user-id': 'user-1' } });
        const rejected = await app.inject({ method: 'POST', url: `/v1/sessions/session-1/previews/${manifest.previewId}/assets/${'a'.repeat(97)}/uploaded`, headers: { 'x-user-id': 'user-1' } });
        expect(accepted.statusCode).toBe(200);
        expect(rejected.statusCode).toBe(400);
        expect(created.dependencies.completeAsset).toHaveBeenCalledWith('user-1', 'session-1', manifest.previewId, assetId);
    });
    it('normalizes a scoped missing preview to a 404 without exposing a cross-session record', async () => {
        const created = await createApp({ completeAsset: vi.fn(async () => { throw new Error('Preview not found'); }) }); app = created.app;

        const response = await app.inject({ method: 'POST', url: `/v1/sessions/session-1/previews/${manifest.previewId}/assets/index/uploaded`, headers: { 'x-user-id': 'user-1' } });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ error: 'Preview not found' });
    });
    it('lists and deletes only account-session-scoped previews', async () => {
        const created = await createApp(); app = created.app;
        await app.inject({ method: 'GET', url: '/v1/sessions/session-1/previews', headers: { 'x-user-id': 'user-1' } });
        await app.inject({ method: 'DELETE', url: `/v1/sessions/session-1/previews/${manifest.previewId}`, headers: { 'x-user-id': 'user-1' } });
        expect(created.dependencies.list).toHaveBeenCalledWith('user-1', 'session-1'); expect(created.dependencies.delete).toHaveBeenCalledWith('user-1', 'session-1', manifest.previewId);
    });
});
