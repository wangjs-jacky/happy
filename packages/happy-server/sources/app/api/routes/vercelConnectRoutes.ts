import { z } from 'zod';
import { type Fastify } from '../types';
import { log } from '@/utils/log';
import { vercelCredentialStore, type VercelCredential } from '@/app/previews/vercelCredentialStore';
import { vercelOAuthStateStore } from '@/app/previews/vercelOAuthState';
import { isPreviewStorageConfigured } from '@/app/previews/previewStorage';
import { previewService } from '@/app/previews/previewService';

export interface VercelConnectConfig {
    clientId: string;
    clientSecret: string;
    integrationSlug: string;
    redirectUri: string;
    webUrl: string;
}

export interface VercelConnectDependencies {
    config: VercelConnectConfig | null;
    stateStore: { create(accountId: string): Promise<string>; consume(state: string): Promise<string | null> };
    credentialStore: {
        get(accountId: string): Promise<VercelCredential | null>;
        delete(accountId: string): Promise<void>;
    };
    activeCredential(accountId: string): Promise<VercelCredential | null>;
    disconnect(accountId: string): Promise<{ warning?: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' }>;
    reconnect(accountId: string, credential: VercelCredential): Promise<void>;
    exchangeCode(code: string, config: VercelConnectConfig): Promise<Omit<VercelCredential, 'version'>>;
}

function readConfig(): VercelConnectConfig | null {
    const clientId = process.env.VERCEL_INTEGRATION_CLIENT_ID;
    const clientSecret = process.env.VERCEL_INTEGRATION_CLIENT_SECRET;
    const integrationSlug = process.env.VERCEL_INTEGRATION_SLUG;
    const redirectUri = process.env.VERCEL_INTEGRATION_REDIRECT_URI;
    const webUrl = process.env.HAPPY_WEB_URL || process.env.PUBLIC_URL;
    return clientId && clientSecret && integrationSlug && redirectUri && webUrl
        ? { clientId, clientSecret, integrationSlug, redirectUri, webUrl: webUrl.replace(/\/$/, '') }
        : null;
}

const exchangeResponseSchema = z.object({
    access_token: z.string().min(1),
    team_id: z.string().min(1).optional(),
    installation_id: z.string().min(1).optional(),
    configuration_id: z.string().min(1).optional(),
}).passthrough();

async function exchangeCode(code: string, config: VercelConnectConfig): Promise<Omit<VercelCredential, 'version'>> {
    const fetchImpl = fetch as unknown as (input: string, init: {
        method: string; redirect: 'error'; signal: unknown; headers: Record<string, string>; body: string;
    }) => Promise<Response>;
    const response = await fetchImpl('https://api.vercel.com/v2/oauth/access_token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: config.redirectUri,
        }).toString(),
    });
    if (!response.ok) throw new Error(`vercel_oauth_http_${response.status}`);
    const parsed = exchangeResponseSchema.parse(await response.json());
    const configurationId = parsed.configuration_id || parsed.installation_id;
    if (!configurationId) throw new Error('vercel_oauth_missing_configuration');
    return {
        accessToken: parsed.access_token,
        configurationId,
        ...(parsed.team_id ? { teamId: parsed.team_id } : {}),
    };
}

const defaultDependencies: VercelConnectDependencies = {
    config: isPreviewStorageConfigured() ? readConfig() : null,
    stateStore: vercelOAuthStateStore, credentialStore: vercelCredentialStore,
    disconnect: (accountId) => previewService.disconnectVercel(accountId),
    reconnect: (accountId, credential) => previewService.reconnectVercel(accountId, credential),
    activeCredential: (accountId) => previewService.getActiveVercelCredential(accountId),
    exchangeCode,
};

function redirectUrl(config: VercelConnectConfig | null, key: string, value: string): string {
    const base = config?.webUrl || process.env.HAPPY_WEB_URL || process.env.PUBLIC_URL || 'http://localhost:5173';
    const url = new URL('/', base);
    url.searchParams.set(key, value);
    return url.toString();
}

export function vercelConnectRoutes(app: Fastify, dependencies: VercelConnectDependencies = defaultDependencies) {
    app.get('/v1/connect/vercel/status', {
        preHandler: app.authenticate,
        schema: { response: { 200: z.object({
            available: z.boolean(), connected: z.boolean(),
            account: z.object({ teamId: z.string().optional(), teamName: z.string().optional(), projectId: z.string().optional() }).optional(),
        }) } },
    }, async (request, reply) => {
        const credential = await dependencies.activeCredential(request.userId);
        return reply.send({
            available: dependencies.config !== null,
            connected: credential !== null,
            ...(credential ? { account: {
                ...(credential.teamId ? { teamId: credential.teamId } : {}),
                ...(credential.teamName ? { teamName: credential.teamName } : {}),
                ...(credential.projectId ? { projectId: credential.projectId } : {}),
            } } : {}),
        });
    });

    app.get('/v1/connect/vercel/params', {
        preHandler: app.authenticate,
        schema: { response: { 200: z.object({ url: z.string() }), 400: z.object({ error: z.string() }) } },
    }, async (request, reply) => {
        const config = dependencies.config;
        if (!config) return reply.code(400).send({ error: 'VERCEL_NOT_CONFIGURED' });
        const state = await dependencies.stateStore.create(request.userId);
        const url = new URL(`https://vercel.com/integrations/${encodeURIComponent(config.integrationSlug)}/new`);
        url.searchParams.set('state', state);
        return reply.send({ url: url.toString() });
    });

    app.get('/v1/connect/vercel/callback', {
        schema: { querystring: z.object({ code: z.string().min(1), state: z.string().min(1) }) },
    }, async (request, reply) => {
        const config = dependencies.config;
        if (!config) return reply.redirect(redirectUrl(config, 'vercel_error', 'server_config'));
        const accountId = await dependencies.stateStore.consume(request.query.state);
        if (!accountId) return reply.redirect(redirectUrl(config, 'vercel_error', 'invalid_state'));
        try {
            const credential = await dependencies.exchangeCode(request.query.code, config);
            await dependencies.reconnect(accountId, { version: 1, ...credential });
            return reply.redirect(redirectUrl(config, 'vercel', 'connected'));
        } catch (error) {
            log({ module: 'vercel-oauth', level: 'error' }, `Vercel OAuth exchange failed: ${error instanceof Error ? error.name : 'unknown'}`);
            return reply.redirect(redirectUrl(config, 'vercel_error', 'exchange_failed'));
        }
    });

    app.delete('/v1/connect/vercel', {
        preHandler: app.authenticate,
        schema: { response: { 200: z.object({ success: z.literal(true), warning: z.literal('VERCEL_DEPLOYMENT_CLEANUP_PENDING').optional() }) } },
    }, async (request, reply) => {
        return reply.send({ success: true as const, ...await dependencies.disconnect(request.userId) });
    });
}
