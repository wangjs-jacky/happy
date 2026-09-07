import { createHash } from 'node:crypto';
import { z } from 'zod';
import { type Fastify } from '@/app/api/types';
import { type CloudflareCredential } from '@/app/previews/cloudflareCredentialStore';
import { createCloudflareClient, CloudflareApiError } from '@/app/previews/cloudflareClient';
import { isPreviewStorageConfigured } from '@/app/previews/previewStorage';
import { previewService } from '@/app/previews/previewService';

export interface CloudflareConnectDependencies {
    available(): boolean;
    activeCredential(accountId: string): Promise<CloudflareCredential | null>;
    disconnect(accountId: string): Promise<{ warning?: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' }>;
    reconnect(accountId: string, credential: CloudflareCredential): Promise<void>;
    verify(token: string, accountId: string, configurationId: string): Promise<{ id: string }>;
}
const defaults: CloudflareConnectDependencies = {
    available: isPreviewStorageConfigured,
    activeCredential: accountId => previewService.getActiveCloudflareCredential(accountId),
    disconnect: accountId => previewService.disconnectCloudflare(accountId),
    reconnect: (accountId, credential) => previewService.reconnectCloudflare(accountId, credential),
    async verify(token, accountId, configurationId) {
        const client = createCloudflareClient({ token, teamId: accountId });
        await client.verifyConnection();
        // Proves Pages Edit as well as Read access, and only creates our empty managed project.
        return client.ensurePreviewProject({ configurationId });
    },
};

/** Authenticated, token-based Pages connection. Never log or return the provider token. */
export function cloudflareConnectRoutes(app: Fastify, dependencies: CloudflareConnectDependencies = defaults) {
    app.get('/v1/connect/cloudflare/status', {
        preHandler: app.authenticate,
        schema: { response: { 200: z.object({
            available: z.boolean(), connected: z.boolean(),
            account: z.object({ accountId: z.string(), projectId: z.string().optional() }).optional(),
        }) } },
    }, async (request, reply) => {
        const credential = await dependencies.activeCredential(request.userId);
        return reply.send({
            available: dependencies.available(), connected: credential !== null,
            ...(credential?.teamId ? { account: { accountId: credential.teamId, projectId: credential.projectId } } : {}),
        });
    });
    app.post('/v1/connect/cloudflare', {
        preHandler: app.authenticate,
        bodyLimit: 8_192,
        schema: {
            body: z.object({ accountId: z.string().regex(/^[a-f0-9]{32}$/), apiToken: z.string().min(20).max(4096).regex(/^[A-Za-z0-9_-]+$/) }).strict(),
            response: { 200: z.object({ success: z.literal(true) }), 400: z.object({ error: z.string() }), 503: z.object({ error: z.string() }) },
        },
    }, async (request, reply) => {
        if (!dependencies.available()) return reply.code(503).send({ error: 'CLOUDFLARE_NOT_CONFIGURED' });
        const configurationId = createHash('sha256').update(`paws-pages:${request.userId}:${request.body.accountId}`).digest('hex');
        try {
            const project = await dependencies.verify(request.body.apiToken, request.body.accountId, configurationId);
            const current = await dependencies.activeCredential(request.userId);
            if (current?.accessToken === request.body.apiToken && current.teamId === request.body.accountId
                && current.configurationId === configurationId && current.projectId === project.id) {
                return reply.send({ success: true as const });
            }
            await dependencies.reconnect(request.userId, {
                version: 1, accessToken: request.body.apiToken, teamId: request.body.accountId, configurationId, projectId: project.id,
            });
            return reply.send({ success: true as const });
        } catch (error) {
            if (error instanceof CloudflareApiError && [400, 401, 403].includes(error.status)) {
                return reply.code(400).send({ error: 'CLOUDFLARE_INVALID_CREDENTIALS' });
            }
            return reply.code(503).send({ error: 'CLOUDFLARE_CONNECTION_FAILED' });
        }
    });
    app.delete('/v1/connect/cloudflare', {
        preHandler: app.authenticate,
        schema: { response: { 200: z.object({ success: z.literal(true), warning: z.literal('CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING').optional() }) } },
    }, async (request, reply) => reply.send({ success: true as const, ...await dependencies.disconnect(request.userId) }));
}
