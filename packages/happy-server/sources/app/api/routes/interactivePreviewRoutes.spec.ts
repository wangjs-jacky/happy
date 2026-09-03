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
    it('rejects creating a draft for another user session', async () => {
        const created = await createApp({ sessionOwnedBy: vi.fn(async () => false) }); app = created.app;
        const response = await app.inject({ method: 'POST', url: '/v1/sessions/session-1/interactive-previews/drafts', headers: { 'x-user-id': 'user-2' }, payload: manifest });
        expect(response.statusCode).toBe(404); expect(created.dependencies.createDraft).not.toHaveBeenCalled();
    });
    it('creates an immutable manifest draft and returns private direct-upload descriptors', async () => {
        const created = await createApp(); app = created.app;
        const response = await app.inject({ method: 'POST', url: '/v1/sessions/session-1/interactive-previews/drafts', headers: { 'x-user-id': 'user-1' }, payload: manifest });
        expect(response.statusCode).toBe(200); expect(response.json().uploads[0].uploadUrl).toBe('https://oss.test');
        expect(created.dependencies.createDraft).toHaveBeenCalledWith('user-1', 'session-1', manifest);
    });
    it('completes an exact asset and publishes only for the owning account', async () => {
        const created = await createApp(); app = created.app;
        const completed = await app.inject({ method: 'POST', url: `/v1/interactive-previews/${manifest.previewId}/assets/index/complete`, headers: { 'x-user-id': 'user-1' } });
        expect(completed.statusCode).toBe(200); expect(created.dependencies.completeAsset).toHaveBeenCalledWith('user-1', manifest.previewId, 'index');
        const published = await app.inject({ method: 'POST', url: `/v1/interactive-previews/${manifest.previewId}/publish`, headers: { 'x-user-id': 'user-1' } });
        expect(published.json().preview.state).toBe('ready'); expect(created.dependencies.publish).toHaveBeenCalledWith('user-1', manifest.previewId);
    });
    it('lists and deletes only account-scoped previews', async () => {
        const created = await createApp(); app = created.app;
        await app.inject({ method: 'GET', url: '/v1/interactive-previews', headers: { 'x-user-id': 'user-1' } });
        await app.inject({ method: 'DELETE', url: `/v1/interactive-previews/${manifest.previewId}`, headers: { 'x-user-id': 'user-1' } });
        expect(created.dependencies.list).toHaveBeenCalledWith('user-1'); expect(created.dependencies.delete).toHaveBeenCalledWith('user-1', manifest.previewId);
    });
});
