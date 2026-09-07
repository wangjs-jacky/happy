import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const state = vi.hoisted(() => ({ database: null as unknown as PrismaClient }));
vi.mock('@/storage/db', () => ({ db: new Proxy({}, { get: (_, key) => {
    const value = (state.database as any)[key];
    return typeof value === 'function' ? value.bind(state.database) : value;
} }) }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: { emitUpdate: vi.fn() }, buildNewMessageUpdate: vi.fn() }));
vi.mock('@/app/monitoring/metrics2', () => ({ getMetricsLabelsFromSocket: () => ({}), sessionAliveEventsCounter: { inc: vi.fn() }, websocketEventsCounter: { inc: vi.fn() } }));
vi.mock('@/app/presence/sessionCache', () => ({ activityCache: {} }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
import { v3SessionRoutes } from './v3SessionRoutes';
import { sessionUpdateHandler } from '../socket/sessionUpdateHandler';

describe('durable session changes against migrated PostgreSQL (PGlite)', () => {
    let pg: PGlite;
    let app: Fastify;
    const createAccount = (id: string) => state.database.account.create({ data: { id, publicKey: id } });
    const createSession = (id: string, accountId: string) => state.database.session.create({ data: { id, accountId, tag: id, metadata: 'private metadata' } });
    const append = (sessionId: string, seq: number) => state.database.sessionMessage.create({ data: { sessionId, seq, localId: `local-${seq}`, content: { t: 'encrypted', c: 'private body' } } });
    const changes = async (account: string, cursor?: string, limit = 200) => app.inject({
        method: 'GET', url: '/v3/sessions/changes', headers: { 'x-account': account },
        query: { limit: String(limit), ...(cursor ? { cursor } : {}) },
    });

    beforeAll(async () => {
        pg = new PGlite();
        state.database = new PrismaClient({ adapter: new PrismaPGlite(pg) } as never);
        const directory = resolve('prisma/migrations');
        for (const name of readdirSync(directory).filter((name) => /^\d/.test(name)).sort()) {
            if (name === '20260907000000_session_changes') {
                await createAccount('legacy');
                await createSession('legacy-session', 'legacy');
                await append('legacy-session', 7);
            }
            await pg.exec(readFileSync(resolve(directory, name, 'migration.sql'), 'utf8'));
        }
        app = fastify().withTypeProvider<ZodTypeProvider>() as Fastify;
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate('authenticate', async (request: any, reply: any) => {
            if (!request.headers['x-account']) return reply.code(401).send({ error: 'unauthorized' });
            request.userId = request.headers['x-account'];
        });
        v3SessionRoutes(app);
        await app.ready();
    }, 120_000);

    afterAll(async () => { await app?.close(); await state.database?.$disconnect(); await pg?.close(); });

    it('backfills existing identities with the committed message frontier and no private payload', async () => {
        const response = await changes('legacy');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ changes: [{ sessionId: 'legacy-session', lastMessageSeq: 7, deleted: false }], hasMore: false });
        expect(response.body).not.toContain('private');
    });

    it('an unchanged cursor returns no history or identities and requires authentication', async () => {
        await createAccount('unchanged');
        await createSession('unchanged-session', 'unchanged');
        const initial = await changes('unchanged');
        expect(initial.statusCode).toBe(200);
        const cursor = initial.json().nextCursor;
        const result = await changes('unchanged', cursor);
        expect(result.json()).toEqual({ changes: [], nextCursor: cursor, hasMore: false });
        expect((await app.inject('/v3/sessions/changes')).statusCode).toBe(401);
    });

    it('replays offline deletion without inferring deletion from partial pages', async () => {
        await createAccount('delete');
        await createSession('delete-one', 'delete');
        await createSession('delete-two', 'delete');
        const initial = await changes('delete');
        expect(initial.statusCode).toBe(200);
        await state.database.session.delete({ where: { id: 'delete-one' } });
        const replay = await changes('delete', initial.json().nextCursor, 1);
        expect(replay.json()).toMatchObject({ changes: [{ sessionId: 'delete-one', deleted: true }], hasMore: false });
        const partial = await changes('delete', undefined, 1);
        expect(partial.json()).toMatchObject({ changes: [{ sessionId: 'delete-two', deleted: false }], hasMore: true });
        expect((await changes('delete', partial.json().nextCursor, 1)).json()).toMatchObject({ changes: [{ sessionId: 'delete-one', deleted: true }], hasMore: false });
    });

    it('isolates accounts and rejects malformed, foreign and future cursors', async () => {
        await createAccount('isolated-a');
        await createAccount('isolated-b');
        await createSession('isolated-session', 'isolated-a');
        const a = await changes('isolated-a');
        expect(a.statusCode).toBe(200);
        expect((await changes('isolated-b')).json().changes).toEqual([]);
        for (const cursor of [a.json().nextCursor, 'garbage', Buffer.from(JSON.stringify({ v: 1, accountId: 'isolated-b', revision: '999' })).toString('base64url')]) {
            const result = await changes('isolated-b', cursor);
            expect(result.statusCode).toBe(409);
            expect(result.json()).toEqual({ error: 'reset-required' });
        }
    });

    it('does not skip a row moved by a concurrent append between pages or repeated pages', async () => {
        await createAccount('pages');
        for (const id of ['page-a', 'page-b', 'page-c']) await createSession(id, 'pages');
        const first = await changes('pages', undefined, 1);
        expect(first.statusCode).toBe(200);
        expect(first.json().changes[0].sessionId).toBe('page-a');
        await append('page-b', 4);
        await append('page-a', 8);
        const second = await changes('pages', first.json().nextCursor, 1);
        expect(second.json().changes[0].sessionId).toBe('page-c');
        expect((await changes('pages', first.json().nextCursor, 1)).json()).toEqual(second.json());
        const last = await changes('pages', second.json().nextCursor);
        expect(last.json()).toMatchObject({ changes: [{ sessionId: 'page-b', lastMessageSeq: 4 }, { sessionId: 'page-a', lastMessageSeq: 8 }], hasMore: false });
    });

    it('rolls back the change with its mutation and ignores allocated-but-uncommitted body sequences', async () => {
        await createAccount('rollback');
        await createSession('rollback-session', 'rollback');
        const initial = await changes('rollback');
        expect(initial.statusCode).toBe(200);
        await state.database.session.update({ where: { id: 'rollback-session' }, data: { seq: 20 } });
        expect((await changes('rollback', initial.json().nextCursor)).json().changes).toEqual([]);
        await expect(state.database.$transaction(async (tx) => {
            await tx.sessionMessage.create({ data: { sessionId: 'rollback-session', seq: 9, content: { t: 'encrypted', c: 'rolled back' } } });
            throw new Error('abort');
        })).rejects.toThrow('abort');
        expect((await changes('rollback', initial.json().nextCursor)).json().changes).toEqual([]);
        await append('rollback-session', 21);
        expect((await changes('rollback', initial.json().nextCursor)).json().changes).toMatchObject([{ lastMessageSeq: 21 }]);
    });

    it('records metadata versions without changing the message frontier or tracking heartbeat churn', async () => {
        await createAccount('metadata');
        await createSession('metadata-session', 'metadata');
        const initial = await changes('metadata');
        expect(initial.statusCode).toBe(200);
        await state.database.session.update({ where: { id: 'metadata-session' }, data: { active: false, lastActiveAt: new Date() } });
        expect((await changes('metadata', initial.json().nextCursor)).json().changes).toEqual([]);
        await state.database.session.update({ where: { id: 'metadata-session' }, data: { metadataVersion: 1, metadata: 'new private metadata' } });
        expect((await changes('metadata', initial.json().nextCursor)).json().changes).toMatchObject([{ metadataVersion: 1, lastMessageSeq: 0 }]);
    });

    it('commits socket sequence allocation with the body and deduplicates REST/socket retries', async () => {
        await createAccount('socket');
        await createSession('socket-session', 'socket');
        const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
        sessionUpdateHandler('socket', { id: 'socket-id', on: (name: string, handler: any) => handlers.set(name, handler) } as any, { connectionType: 'user-scoped' } as any);
        // Simulate a storage failure after sequence allocation: the whole write
        // must roll back, so subsequent writers cannot overtake an absent body.
        await pg.exec(`ALTER TABLE "SessionMessage" ADD CONSTRAINT reject_test_message CHECK ("localId" IS DISTINCT FROM 'reject-message')`);
        await handlers.get('message')!({ sid: 'socket-session', message: 'ciphertext', localId: 'reject-message' });
        expect((await state.database.session.findUniqueOrThrow({ where: { id: 'socket-session' } })).seq).toBe(0);
        await handlers.get('message')!({ sid: 'socket-session', message: 'ciphertext', localId: 'accepted-message' });
        const initial = await changes('socket');
        expect(initial.json().changes).toMatchObject([{ lastMessageSeq: 1 }]);
        await handlers.get('message')!({ sid: 'socket-session', message: 'duplicate', localId: 'accepted-message' });
        const response = await app.inject({ method: 'POST', url: '/v3/sessions/socket-session/messages', headers: { 'x-account': 'socket' }, payload: { messages: [{ localId: 'accepted-message', content: 'duplicate' }, { localId: 'rest-message', content: 'rest ciphertext' }] } });
        expect(response.statusCode).toBe(200);
        expect(response.json().messages.map((message: any) => message.seq)).toEqual([1, 2]);
        expect((await changes('socket', initial.json().nextCursor)).json().changes).toMatchObject([{ lastMessageSeq: 2 }]);
    }, 30_000);
});
