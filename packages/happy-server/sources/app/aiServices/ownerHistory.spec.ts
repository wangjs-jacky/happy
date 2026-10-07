import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Fastify } from '@/app/api/types';
const state = vi.hoisted(() => ({ database: null as unknown as PrismaClient }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/storage/db', () => ({ db: new Proxy({}, { get: (_, key) => { const value = (state.database as any)[key]; return typeof value === 'function' ? value.bind(state.database) : value; } }) }));
import { createTestDatabase } from './testDatabase';
import { appDelegationRoutes } from '@/app/api/routes/appDelegationRoutes';
let ctx: Awaited<ReturnType<typeof createTestDatabase>>, app: Fastify, owner: string, machine: string;
beforeAll(async () => {
    ctx = await createTestDatabase(); state.database = ctx.database;
    app = fastify() as unknown as Fastify;
    app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async (request: any, reply: any) => {
        if (!request.headers.authorization?.startsWith('Bearer owner-')) return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = request.headers.authorization.slice(7);
    });
    appDelegationRoutes(app); await app.ready();
}, 120000);
beforeEach(async () => {
    owner = 'owner-' + randomUUID(); machine = owner + '-machine';
    await ctx.database.account.create({ data: { id: owner, publicKey: owner } });
});
afterAll(async () => { await app.close(); await ctx.database.$disconnect(); await ctx.pg.close(); });
const get = (url: string, account = owner) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${account}` } });
async function fixture(legacy = false, date = new Date(), bindingOwner = owner, grantOwner = owner, shadowOwner = owner) {
    const grantId = randomUUID(), id = randomUUID(), serviceId = randomUUID();
    const target = { machineId: machine, engine: 'codex' as const, accountRef: { kind: 'codex-profile' as const, id: 'profile-fixture' } };
    const scope = { appId: 'relationship-advisor', serviceId, targets: [target], permissions: ['chat'], expiresAt: null };
    const binding = { id, appId: scope.appId, serviceId, revision: 1, ...target, requestedModel: null, reasoning: { mode: 'default' }, permissions: ['chat'] };
    await ctx.database.appDelegation.create({ data: { id: grantId, accountId: shadowOwner, appId: scope.appId, protocol: legacy ? 3 : 4, state: legacy ? 'redeemed' : 'service-ready', publicKey: '', challengeHash: '', requestExpiresAt: date, machineId: legacy ? machine : null, machineEnvelope: legacy ? 'legacy-envelope' : null, credentialHash: 'SECRET-shadow', createdAt: date } });
    if (!legacy) {
        await ctx.database.aIServiceApplication.upsert({ where: { appId: scope.appId }, create: { appId: scope.appId, policy: {} }, update: {} });
        await ctx.database.aIService.create({ data: { id: serviceId, ownerId: owner, name: 'Service', revisions: { create: { revision: 1, config: {}, accountFingerprint: 'SECRET-fingerprint' } } } });
        await ctx.database.aIServiceAuthorization.create({ data: { id: grantId, ownerId: grantOwner, appId: scope.appId, serviceId, kind: 'service-grant', scope, credentialDigest: 'SECRET-digest', targetFingerprints: { secret: 'SECRET-native' }, machineEnvelopes: { [machine]: 'sealed-fixture', foreign: 'SECRET-foreign-envelope' }, createdAt: date } });
        await ctx.database.aIServiceBinding.create({ data: { id, ownerId: bindingOwner, appId: scope.appId, serviceId, revision: 1, authorizationId: grantId, snapshot: binding, accountFingerprint: 'SECRET-fingerprint', capabilityObservedAt: date } });
    }
    await ctx.database.appChatConversation.create({ data: { id, grantId, createdAt: date } });
    return { id, grantId, serviceId, scope, binding };
}
async function turn(f: Awaited<ReturnType<typeof fixture>>, data: Record<string, unknown> = {}) {
    return ctx.database.appChatTurn.create({ data: { id: randomUUID(), conversationId: f.id, bindingId: f.binding.id, requestId: randomUUID(), input: 'ciphertext-fixture', output: 'sealed-output', state: 'completed', deadline: new Date(Date.now() + 60000), ...data } as any });
}
it('opts into metadata and mixed conversation history while preserving legacy defaults', async () => {
    const legacy = await fixture(true, new Date('2026-01-01')), shared = await fixture(false, new Date('2026-02-01'));
    await turn(shared);
    expect((await get('/v1/app-authorizations')).json().grants.map((g: any) => g.id)).toEqual([legacy.grantId]);
    const grants = await get('/v1/app-authorizations?includeServices=1');
    expect(grants.json().grants).toContainEqual(expect.objectContaining({ id: shared.grantId, protocol: 'ai-services/1', state: 'redeemed', machineId: machine }));
    expect(grants.body).not.toContain('SECRET'); expect(grants.body).not.toContain('sealed-fixture'); expect(grants.body).not.toContain('scope');
    expect((await get('/v1/app-authorizations/conversations')).json().conversations.map((c: any) => c.id)).toEqual([legacy.id]);
    const directory = await get('/v1/app-authorizations/conversations?includeServices=1');
    expect(directory.json().conversations.map((c: any) => c.id)).toEqual([shared.id, legacy.id]);
    expect(directory.json().conversations[0]).toMatchObject({ protocol: 'ai-services/1', machineId: machine });
    expect(directory.body).not.toContain('ciphertext'); expect(directory.body).not.toContain('SECRET');
    expect((await get(`/v1/app-authorizations/conversations/${legacy.id}/history`)).json()).toMatchObject({ grantProtocol: 3, machineEnvelope: 'legacy-envelope' });
});
it('reads only the latest full transcript with pinned target after revocation, expiry and service deletion', async () => {
    const f = await fixture();
    await turn(f, { createdAt: new Date('2026-01-01'), input: 'old-transcript' });
    const latest = await turn(f, { state: 'running', leaseUntil: new Date(0), actual: { modelId: 'native', reasoning: null } });
    const expiredScope = { ...f.scope, expiresAt: 0 };
    await ctx.database.aIServiceAuthorization.update({ where: { id: f.grantId }, data: { revokedAt: new Date(), expiresAt: new Date(0), scope: expiredScope } });
    await ctx.database.aIService.update({ where: { id: f.serviceId }, data: { enabled: false, deletedAt: new Date() } });
    const response = await get(`/v1/app-authorizations/conversations/${f.id}/history`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ protocol: 'ai-services/1', ownerId: owner, grantId: f.grantId, machineId: machine, scope: expiredScope, binding: f.binding, machineEnvelope: 'sealed-fixture', turns: [{ id: latest.id, state: 'interrupted', actual: { modelId: 'native', reasoning: null } }] });
    expect(response.json().turns).toHaveLength(1); expect(response.body).not.toContain('old-transcript'); expect(response.body).not.toContain('SECRET');
    expect((await ctx.database.appChatTurn.findUniqueOrThrow({ where: { id: latest.id } })).state).toBe('running');
    expect((await get('/v1/app-authorizations/conversations?includeServices=1')).json().conversations[0].turns[0].state).toBe('interrupted');
    expect((await get('/v1/app-authorizations?includeServices=1')).json().grants[0].state).toBe('revoked');
});
it('retains empty conversation rows and fails closed on foreign owners, grants and turn bindings', async () => {
    const f = await fixture();
    expect((await get(`/v1/app-authorizations/conversations/${f.id}/history`)).json().turns).toEqual([]);
    const stranger = 'owner-' + randomUUID(); await ctx.database.account.create({ data: { id: stranger, publicKey: stranger } });
    expect((await get(`/v1/app-authorizations/conversations/${f.id}/history`, stranger)).statusCode).toBe(403);
    expect((await get('/v1/app-authorizations/conversations?includeServices=1', stranger)).json().conversations).toEqual([]);
    const other = await fixture(); await turn(other, { conversationId: f.id });
    expect((await get(`/v1/app-authorizations/conversations/${f.id}/history`)).json().turns).toEqual([]);
    await ctx.database.appChatConversation.update({ where: { id: f.id }, data: { grantId: other.grantId } });
    expect((await get(`/v1/app-authorizations/conversations/${f.id}/history`)).statusCode).toBe(403);
    expect((await get('/v1/app-authorizations/conversations?includeServices=1')).json().conversations.map((c: any) => c.id)).not.toContain(f.id);
    const foreignBinding = await fixture(false, new Date(), stranger);
    expect((await get(`/v1/app-authorizations/conversations/${foreignBinding.id}/history`)).statusCode).toBe(403);
    expect((await get(`/v1/app-authorizations/conversations?includeServices=1&cursor=${foreignBinding.id}`)).statusCode).toBe(403);
    for (const f of [await fixture(false, new Date(), owner, stranger), await fixture(false, new Date(), owner, owner, stranger)]) {
        expect((await get(`/v1/app-authorizations/conversations/${f.id}/history`)).statusCode).toBe(403);
        expect((await get(`/v1/app-authorizations/conversations?includeServices=1&cursor=${f.id}`)).statusCode).toBe(403);
        expect((await get('/v1/app-authorizations?includeServices=1')).json().grants.map((g: any) => g.id)).not.toContain(f.grantId);
    }
});
it('paginates a single ordered mixed directory with deterministic UUID ties', async () => {
    const fixtures = [];
    for (let i = 0; i < 52; i++) fixtures.push(await fixture(i % 2 === 0, new Date('2026-01-01')));
    const expected = fixtures.map(f => f.id).sort().reverse();
    const first = (await get('/v1/app-authorizations/conversations?includeServices=1')).json();
    const next = (await get(`/v1/app-authorizations/conversations?includeServices=1&cursor=${first.nextCursor}`)).json();
    expect(first.conversations).toHaveLength(50); expect(next.conversations).toHaveLength(2);
    expect([...first.conversations, ...next.conversations].map(c => c.id)).toEqual(expected); expect(next.nextCursor).toBeNull();
});
