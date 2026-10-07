/** Opt-in localhost fixture for Ego browser acceptance; normal test runs skip it. */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import fastify from 'fastify';
import nacl from 'tweetnacl';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Fastify } from '@/app/api/types';
const state = vi.hoisted(() => ({ database: null as unknown as PrismaClient }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: new Proxy({}, { get: (_, key) => {
    const value = (state.database as any)[key]; return typeof value === 'function' ? value.bind(state.database) : value;
} }) }));
// Match the deployed registered application while retaining the real route/action implementations.
vi.mock('@/app/appDelegation/appDelegation', async importOriginal => {
    const actual = await importOriginal<typeof import('@/app/appDelegation/appDelegation')>();
    Object.assign(actual.delegatedApp, { origin: 'https://advisor.paws.rodeo' });
    return actual;
});
import { createTestDatabase } from './testDatabase';
import { appDelegationRoutes } from '@/app/api/routes/appDelegationRoutes';
import { sealServiceEnvelope } from './grants';
const enabled = process.env.HAPPY_APP_HISTORY_BROWSER_FIXTURE === '1';
const fixtureTest = enabled ? it : it.skip;
const port = Number(process.env.HAPPY_APP_HISTORY_BROWSER_PORT ?? 14318);
const url = `http://127.0.0.1:${port}`;
const owner = 'ego-history-owner-a', otherOwner = 'ego-history-owner-b', machine = 'ego-history-device';
const master = new Uint8Array(32).fill(7), messageKey = new Uint8Array(32).fill(11);
const ids = {
    legacyGrant: '10000000-0000-4000-8000-000000000001', legacyConversation: '10000000-0000-4000-8000-000000000002', legacyTurn: '10000000-0000-4000-8000-000000000003',
    serviceGrant: '20000000-0000-4000-8000-000000000001', serviceConversation: '20000000-0000-4000-8000-000000000002', serviceTurn: '20000000-0000-4000-8000-000000000003', service: '20000000-0000-4000-8000-000000000004',
};
function secretbox(value: unknown, key: Uint8Array) {
    const nonce = randomBytes(24);
    return Buffer.concat([nonce, nacl.secretbox(Buffer.from(JSON.stringify(value)), nonce, key)]).toString('base64');
}
const token = (id: string) => `fixture.${Buffer.from(JSON.stringify({ sub: id })).toString('base64')}.synthetic`;
function bootstrap() {
    const accounts = [owner, otherOwner].map((accountId, index) => {
        const key = Buffer.from(`${url}\n${accountId}`).toString('base64url');
        return { key, accountId, serverUrl: url, label: index ? 'Fixture B — isolation' : 'Fixture A — app history', scope: key };
    });
    const credentials = accounts.map((account, index) => ({ token: token(account.accountId), secret: Buffer.from(index ? new Uint8Array(32).fill(9) : master).toString('base64url') }));
    return { url, localIDs: ids, accounts, credentials, localStorage: {
        'paws.accounts.accounts': JSON.stringify(accounts), 'paws.accounts.initialized': '1',
        'paws.accounts.active': JSON.stringify({ ...accounts[0], generation: 'ego-fixture-initial' }),
        ...Object.fromEntries(accounts.map((account, index) => [`paws_account_${account.key}`, JSON.stringify(credentials[index])])),
    } };
}
fixtureTest('serves synthetic encrypted legacy/shared owner history for local Ego acceptance', async () => {
    const ctx = await createTestDatabase(); state.database = ctx.database;
    const app = fastify() as unknown as Fastify;
    let finish!: () => void, timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<void>(resolveStop => { finish = resolveStop; });
    try {
        for (const accountId of [owner, otherOwner]) await ctx.database.account.create({ data: { id: accountId, publicKey: accountId } });
        const metadata = secretbox({ host: 'fixture-device', displayName: 'Fixture Mac', platform: 'darwin', happyCliVersion: 'fixture-only', homeDir: '/synthetic', happyHomeDir: '/synthetic/.paws' }, master);
        await ctx.database.machine.create({ data: { id: machine, accountId: owner, metadata } });
        const appId = 'relationship-advisor';
        const date = new Date('2026-10-06T12:00:00.000Z');
        const legacyEnvelope = secretbox({ v: 1, grantId: ids.legacyGrant, appId, machineId: machine, scope: 'agent:chat', protocol: 3, expiresAt: null, key: Buffer.from(messageKey).toString('base64') }, master);
        await ctx.database.appDelegation.create({ data: { id: ids.legacyGrant, appId, accountId: owner, protocol: 3, state: 'redeemed', machineId: machine, machineEnvelope: legacyEnvelope, publicKey: '', challengeHash: '', requestExpiresAt: date, createdAt: date } });
        await ctx.database.appChatConversation.create({ data: { id: ids.legacyConversation, grantId: ids.legacyGrant, createdAt: date } });
        const legacyContext = { v: 2, grantId: ids.legacyGrant, conversationId: ids.legacyConversation, turnId: ids.legacyTurn, selection: { engine: 'codex', model: 'fixture-model' } };
        await ctx.database.appChatTurn.create({ data: { id: ids.legacyTurn, conversationId: ids.legacyConversation, state: 'completed', sequence: 1, createdAt: date, deadline: date,
            input: secretbox({ ...legacyContext, direction: 'input', sequence: 0, messages: [{ role: 'user', text: 'Legacy fixture question' }] }, messageKey),
            output: secretbox({ ...legacyContext, direction: 'output', sequence: 1, text: 'Legacy fixture answer' }, messageKey) } });
        const target = { machineId: machine, engine: 'codex' as const, accountRef: { kind: 'codex-profile' as const, id: 'fixture-profile' } };
        const scope = { appId, serviceId: ids.service, targets: [target], permissions: ['chat'], expiresAt: null };
        const binding = { id: ids.serviceConversation, appId, serviceId: ids.service, revision: 1, ...target, requestedModel: 'fixture-model', reasoning: { mode: 'default' }, permissions: ['chat'] };
        const servicePrivateKey = createHash('sha256').update('paws-ai-services-machine-box/1\0').update(master).digest();
        const servicePublicKey = nacl.box.keyPair.fromSecretKey(servicePrivateKey).publicKey;
        const serviceEnvelope = sealServiceEnvelope({ protocol: 'ai-services/1', grantId: ids.serviceGrant, ownerId: owner, appId, serviceId: ids.service, machineId: machine, scope, messageKey: Buffer.from(messageKey).toString('base64') }, Buffer.from(servicePublicKey).toString('base64'));
        await ctx.database.aIServiceApplication.upsert({ where: { appId }, create: { appId, policy: {} }, update: {} });
        await ctx.database.aIService.create({ data: { id: ids.service, ownerId: owner, name: 'Fixture service', revisions: { create: { revision: 1, config: {}, accountFingerprint: 'synthetic' } } } });
        await ctx.database.appDelegation.create({ data: { id: ids.serviceGrant, appId, accountId: owner, protocol: 4, state: 'service-ready', publicKey: '', challengeHash: '', requestExpiresAt: date, createdAt: date } });
        await ctx.database.aIServiceAuthorization.create({ data: { id: ids.serviceGrant, ownerId: owner, appId, serviceId: ids.service, kind: 'service-grant', scope, machineEnvelopes: { [machine]: serviceEnvelope }, createdAt: date } });
        await ctx.database.aIServiceBinding.create({ data: { id: ids.serviceConversation, ownerId: owner, appId, serviceId: ids.service, revision: 1, authorizationId: ids.serviceGrant, snapshot: binding, accountFingerprint: 'synthetic', capabilityObservedAt: date } });
        await ctx.database.appChatConversation.create({ data: { id: ids.serviceConversation, grantId: ids.serviceGrant, createdAt: date } });
        const context = { protocol: 'ai-services/1', grantId: ids.serviceGrant, appId, serviceId: ids.service, bindingId: ids.serviceConversation, requestId: 'fixture-current-request' };
        await ctx.database.appChatTurn.create({ data: { id: ids.serviceTurn, bindingId: ids.serviceConversation, conversationId: ids.serviceConversation, requestId: context.requestId, state: 'completed', sequence: 1, deadline: date, createdAt: new Date(date.getTime() + 1000),
            input: secretbox({ ...context, direction: 'input', sequence: 0, messages: [{ role: 'user', text: 'Shared fixture prior question' }, { role: 'assistant', text: 'Shared fixture prior answer' }, { role: 'user', text: 'Shared fixture current question' }] }, messageKey),
            output: secretbox({ ...context, turnId: ids.serviceTurn, direction: 'output', sequence: 1, text: 'Shared fixture current answer' }, messageKey) } });
        app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: any, reply: any) => {
            const header = request.headers.authorization;
            const accountId = [owner, otherOwner].find(id => header === `Bearer ${token(id)}`);
            if (!accountId) return reply.code(401).send({ error: 'Synthetic account authentication required' });
            request.userId = accountId;
        });
        appDelegationRoutes(app);
        app.get('/__e2e/bootstrap', async () => bootstrap());
        app.post('/__e2e/stop', async () => { setTimeout(finish, 50); return { stopping: true }; });
        app.get('/config.js', async (_request, reply) => reply.type('application/javascript').send(`globalThis.__HAPPY_CONFIG__=${JSON.stringify({ serverUrl: url, disableAnalytics: true })};`));
        app.get('/v1/machines', { preHandler: app.authenticate }, async request => request.userId === owner ? [{ id: machine, metadata, metadataVersion: 1, daemonState: null, daemonStateVersion: 0, dataEncryptionKey: null, seq: 1, active: false, activeAt: date.getTime(), createdAt: date.getTime(), updatedAt: date.getTime() }] : []);
        app.get('/v1/account/profile', { preHandler: app.authenticate }, async request => ({ id: request.userId, timestamp: Date.now(), firstName: request.userId === owner ? 'Fixture A' : 'Fixture B', lastName: null, avatar: null, github: null, connectedServices: [] }));
        app.get('/v1/account/settings', { preHandler: app.authenticate }, async () => ({ settings: null, settingsVersion: 0 }));
        app.get('/v2/sessions', { preHandler: app.authenticate }, async () => ({ sessions: [], nextCursor: null, hasNext: false, hasMore: false }));
        app.get('/v2/sessions/active', { preHandler: app.authenticate }, async () => ({ sessions: [] }));
        app.get('/v1/sessions', { preHandler: app.authenticate }, async () => ({ sessions: [] }));
        const dist = resolve('../happy-app/dist');
        const mime: Record<string, string> = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
        app.get('/*', async (request, reply) => {
            const path = request.url.split('?')[0];
            if (/^\/(v\d|socket\.io)(\/|$)/.test(path)) return reply.code(404).send({ error: 'Fixture endpoint unavailable' });
            const file = resolve(dist, '.' + decodeURIComponent(path));
            if (file.startsWith(dist + sep) && existsSync(file) && statSync(file).isFile()) return reply.type(mime[extname(file)] ?? 'application/octet-stream').send(createReadStream(file));
            const index = resolve(dist, 'index.html');
            if (!existsSync(index)) return reply.code(503).send('Build happy-app/dist before browser acceptance');
            return reply.type('text/html').send(readFileSync(index, 'utf8').replace('<head>', '<head><script src="/config.js"></script>'));
        });
        await app.listen({ host: '127.0.0.1', port });
        expect((await app.inject({ method: 'GET', url: '/v1/app-authorizations/conversations?includeServices=1', headers: { authorization: `Bearer ${token(owner)}` } })).json().conversations).toHaveLength(2);
        console.log('EGO_HISTORY_FIXTURE_READY', JSON.stringify({ url, localIDs: ids }));
        timer = setTimeout(finish, 10 * 60_000);
        await stopped;
    } finally {
        if (timer) clearTimeout(timer);
        await app.close(); await ctx.database.$disconnect(); await ctx.pg.close();
    }
}, 660_000);
