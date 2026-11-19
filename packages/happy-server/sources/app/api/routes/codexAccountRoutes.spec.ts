import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { Prisma6PGlite as PrismaPGlite } from '@/storage/pgliteAdapter';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';
import { decryptString, encryptString, initEncrypt } from '@/modules/encrypt';
import { log } from '@/utils/log';
import { enableErrorHandlers } from '../utils/enableErrorHandlers';

const state = vi.hoisted(() => ({ database: null as unknown as PrismaClient }));
vi.mock('@/storage/db', () => ({ db: new Proxy({}, { get: (_, key) => {
    const value = (state.database as any)[key];
    return typeof value === 'function' ? value.bind(state.database) : value;
} }) }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
import { codexAccountRoutes } from './codexAccountRoutes';
import { codexAccountStore } from './codexAccountStore';

const fakeAuth = (account = 'openai-private-account') => ({
    OPENAI_API_KEY: null,
    tokens: { id_token: 'fake-id-token', access_token: 'fake-access-token', refresh_token: 'fake-refresh-token', account_id: account },
    last_refresh: '2026-09-11T00:00:00.000Z',
});

describe('Codex account security against migrated PostgreSQL and real encryption', () => {
    let pg: PGlite;
    let app: Fastify;
    let accountId: string;
    let machineId: string;
    let sequence = 0;
    const request = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, user = accountId) => app.inject({
        method, url, payload, headers: user ? { authorization: `Bearer ${user}` } : {},
    });
    const upload = async (account?: string) => {
        const res = await request('POST', '/v1/codex-accounts/upload', { auth: fakeAuth(account) });
        expect(res.statusCode, res.body).toBe(200);
        return res.json().profile;
    };
    const bind = (profileId: string | null, expectedVersion = 0, target = machineId) => request('PUT', `/v1/machines/${target}/codex-account`, { profileId, expectedVersion });
    const issue = async (profileId?: string) => {
        const res = await request('POST', '/v1/codex-session-grants', { machineId, ...(profileId ? { profileId } : {}) });
        expect(res.statusCode, res.body).toBe(200);
        return res.json();
    };
    const redeem = (grant: string, target = machineId, user = accountId) => request('POST', '/v1/codex-session-grants/redeem', { grant, machineId: target }, user);
    const launch = async () => {
        const profile = await upload();
        expect((await bind(profile.id)).statusCode).toBe(200);
        const grant = await issue();
        const res = await redeem(grant.grant);
        expect(res.statusCode, res.body).toBe(200);
        const sourceSessionId = `${accountId}-session`;
        await state.database.session.create({ data: { id: sourceSessionId, accountId, tag: sourceSessionId, metadata: 'encrypted' } });
        const audit = await request('POST', `/v1/codex-session-grants/${res.json().launchId}/session`, { machineId, sourceSessionId });
        expect(audit.statusCode, audit.body).toBe(200);
        return { profile, sourceSessionId, launchId: res.json().launchId };
    };

    beforeAll(async () => {
        process.env.HANDY_MASTER_SECRET = 'codex-account-tests-fixed-not-a-production-secret';
        await initEncrypt();
        pg = new PGlite();
        state.database = new PrismaClient({ adapter: new PrismaPGlite(pg) } as never);
        const directory = resolve('prisma/migrations');
        for (const name of readdirSync(directory).filter((name) => /^\d/.test(name)).sort()) {
            await pg.exec(readFileSync(resolve(directory, name, 'migration.sql'), 'utf8'));
        }
        app = fastify().withTypeProvider<ZodTypeProvider>() as Fastify;
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        enableErrorHandlers(app);
        app.decorate('authenticate', async (req: any, reply: any) => {
            const bearer = req.headers.authorization;
            if (!bearer?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' });
            req.userId = bearer.slice(7);
        });
        codexAccountRoutes(app);
        await app.ready();
    }, 120_000);
    beforeEach(async () => {
        vi.mocked(log).mockClear();
        accountId = `codex-user-${++sequence}`;
        machineId = `${accountId}-machine`;
        await state.database.account.create({ data: { id: accountId, publicKey: accountId } });
        await state.database.machine.create({ data: { id: machineId, accountId, metadata: 'encrypted', active: false } });
    });
    afterAll(async () => { await app?.close(); await state.database?.$disconnect(); await pg?.close(); });

    it('stores encrypted credentials, deduplicates by provider account, and preserves a rename on upload', async () => {
        const first = await upload();
        expect(first.displayName).toMatch(/^Codex · [A-F0-9]{4}(?:-\d+)?$/);
        expect(first).toMatchObject({ credentialVersion: 1, status: 'available' });
        expect((await request('PATCH', `/v1/codex-accounts/${first.id}`, { displayName: 'Work' })).statusCode).toBe(200);
        expect(await upload()).toMatchObject({ id: first.id, displayName: 'Work', credentialVersion: 2 });
        const second = await upload('another-private-account');
        expect(second.id).not.toBe(first.id);
        const list = await request('GET', '/v1/codex-accounts');
        expect(list.json().profiles).toHaveLength(2);
        for (const secret of ['fake-access-token', 'fake-refresh-token', 'fake-id-token', 'openai-private-account', 'externalAccountFingerprint', 'credential"']) expect(list.body).not.toContain(secret);
        const row = await (state.database as any).codexAccountProfile.findUnique({ where: { id: first.id } });
        expect(Buffer.from(row.credential).toString()).not.toContain('fake-access-token');
        expect(JSON.parse(decryptString(['user', accountId, 'codex-accounts', first.id, 'credential'], row.credential))).toEqual(fakeAuth());
        expect(() => decryptString(['user', accountId, 'codex-accounts', second.id, 'credential'], row.credential)).toThrow();
        expect(() => decryptString(['user', 'another-user', 'codex-accounts', first.id, 'credential'], row.credential)).toThrow();
    });

    it('requires bearer authentication and isolates foreign profile and machine operations', async () => {
        const profile = await upload();
        const foreign = 'foreign-user';
        await state.database.account.create({ data: { id: foreign, publicKey: foreign } });
        expect((await request('GET', '/v1/codex-accounts', undefined, '')).statusCode).toBe(401);
        expect((await request('GET', '/v1/codex-accounts', undefined, foreign)).json().profiles).toEqual([]);
        for (const method of ['PATCH', 'DELETE'] as const) expect((await request(method, `/v1/codex-accounts/${profile.id}`, method === 'PATCH' ? { displayName: 'stolen' } : undefined, foreign)).statusCode).toBe(404);
        expect((await request('PUT', `/v1/machines/${machineId}/codex-account`, { profileId: profile.id, expectedVersion: 0 }, foreign)).statusCode).toBe(404);
    });

    it('rejects unknown auth fields, API-key auth, blank OAuth values, missing identity, and oversized bodies without echoing secrets', async () => {
        for (const auth of [{ ...fakeAuth(), surprise: 'secret-extra' }, { ...fakeAuth(), OPENAI_API_KEY: 'secret-api-key' }, { ...fakeAuth(), tokens: { ...fakeAuth().tokens, refresh_token: ' ' } }, { tokens: { access_token: 'secret-access' } }]) {
            const res = await request('POST', '/v1/codex-accounts/upload', { auth });
            expect(res.statusCode).toBe(400);
            expect(res.body).not.toContain('secret');
        }
        const tooLarge = await request('POST', '/v1/codex-accounts/upload', { auth: { ...fakeAuth(), last_refresh: 'x'.repeat(70_000) } });
        expect(tooLarge.statusCode).toBe(413);
    });

    it('updates only the selected offline machine and rejects stale binding versions', async () => {
        const a = await upload();
        const b = await upload('second-account');
        const other = `${accountId}-other-machine`;
        await state.database.machine.create({ data: { id: other, accountId, metadata: 'encrypted', active: false } });
        expect((await bind(a.id)).json()).toMatchObject({ binding: { machineId, profileId: a.id, version: 1 } });
        expect((await bind(b.id, 0, other)).statusCode).toBe(200);
        expect((await bind(b.id, 0)).statusCode).toBe(409);
        expect((await request('GET', '/v1/codex-accounts')).json().bindings).toEqual(expect.arrayContaining([
            expect.objectContaining({ machineId, profileId: a.id, version: 1 }),
            expect.objectContaining({ machineId: other, profileId: b.id, version: 1 }),
        ]));
    });

    it('deletes credentials and quota, clears bindings with version increments, and rejects outstanding grants', async () => {
        const { profile } = await launch();
        const pending = await issue();
        expect((await request('DELETE', `/v1/codex-accounts/${profile.id}`)).statusCode).toBe(200);
        const list = (await request('GET', '/v1/codex-accounts')).json();
        expect(list.profiles).toEqual([]);
        expect(list.bindings).toContainEqual({ machineId, profileId: null, version: 2 });
        expect((await redeem(pending.grant)).statusCode).toBe(409);
        expect((await request('POST', '/v1/codex-session-grants', { machineId })).statusCode).toBe(409);
    });

    it('launches an explicit owned account independently of the default and redeems it once after rebinding', async () => {
        const original = await upload();
        const selected = await upload('selected-account');
        await bind(original.id);
        const issued = await issue(selected.id);
        expect(issued.profile).toMatchObject({ id: selected.id, credentialVersion: 1 });
        expect(issued).not.toHaveProperty('auth');
        expect((await request('GET', '/v1/codex-accounts')).json().bindings)
            .toContainEqual({ machineId, profileId: original.id, version: 1 });
        expect((await issue()).profile.id).toBe(original.id);

        await bind(null, 1);
        expect((await redeem(issued.grant, 'wrong-machine')).statusCode).toBe(409);
        expect((await redeem(issued.grant, machineId, 'foreign-user')).statusCode).toBe(409);
        const results = await Promise.all([redeem(issued.grant), redeem(issued.grant)]);
        expect(results.map((res) => res.statusCode).sort()).toEqual([200, 409]);
        const success = results.find((res) => res.statusCode === 200)!;
        expect(success.json()).toMatchObject({ auth: fakeAuth('selected-account'), profile: { id: selected.id, credentialVersion: 1 } });
        expect((await request('GET', '/v1/codex-accounts')).json().bindings)
            .toContainEqual({ machineId, profileId: null, version: 2 });
        expect(JSON.stringify(await state.database.codexSessionGrant.findMany({ where: { accountId } })))
            .not.toContain(issued.grant);
    });

    it('keeps an unbound device unchanged without triggering legacy migration for an explicit grant', async () => {
        const selected = await upload('selected-account');
        await state.database.serviceAccountToken.create({ data: { accountId, vendor: 'openai', token: encryptString(['user', accountId, 'vendors', 'openai', 'token'], JSON.stringify({ oauth: fakeAuth().tokens })) } });
        const before = await state.database.machine.findUniqueOrThrow({ where: { id: machineId } });
        const issued = await issue(selected.id);
        expect((await redeem(issued.grant)).json()).toMatchObject({ auth: fakeAuth('selected-account'), profile: { id: selected.id } });
        expect(await state.database.machine.findUniqueOrThrow({ where: { id: machineId } })).toEqual(before);
        expect(await state.database.codexAccountAudit.findMany({ where: { accountId, machineId } }))
            .toEqual(expect.arrayContaining([expect.objectContaining({ action: 'grant-create-explicit', profileId: selected.id })]));
        // The unchanged implicit path can still perform the compatibility migration.
        expect((await issue()).profile.id).not.toBe(selected.id);
    });

    it('requires an owned machine and available owned profile for explicit account grants', async () => {
        const own = await upload();
        const foreign = `${accountId}-foreign`;
        const foreignMachine = `${foreign}-machine`;
        await state.database.account.create({ data: { id: foreign, publicKey: foreign } });
        await state.database.machine.create({ data: { id: foreignMachine, accountId: foreign, metadata: 'encrypted' } });
        const other = await request('POST', '/v1/codex-accounts/upload', { auth: fakeAuth('foreign-account') }, foreign);
        expect(other.statusCode).toBe(200);
        for (const payload of [
            { machineId, profileId: other.json().profile.id },
            { machineId, profileId: '00000000-0000-4000-8000-000000000001' },
            { machineId: foreignMachine, profileId: own.id },
        ]) expect((await request('POST', '/v1/codex-session-grants', payload)).statusCode).toBe(404);
        for (const status of ['invalid', 'needs-refresh']) {
            await state.database.codexAccountProfile.update({ where: { id: own.id }, data: { status } });
            expect((await request('POST', '/v1/codex-session-grants', { machineId, profileId: own.id })).statusCode).toBe(409);
        }
        expect(await state.database.codexSessionGrant.count({ where: { accountId } })).toBe(0);
    });

    it('rejects explicit profiles combined with resume authority or malformed profile IDs', async () => {
        const original = await launch();
        for (const payload of [
            { machineId, profileId: original.profile.id, sourceSessionId: original.sourceSessionId },
            { machineId, profileId: 'not-a-uuid' },
            { machineId, profileId: null },
        ]) {
            const response = await request('POST', '/v1/codex-session-grants', payload);
            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual({ error: 'invalid-request' });
        }
    });

    it.each(['expired', 'credential-change', 'invalid', 'needs-refresh', 'profile-delete', 'machine-delete', 'profile-owner-change', 'machine-owner-change'])('rejects an explicit grant after %s', async (reason) => {
        const profile = await upload();
        const issued = await issue(profile.id);
        if (reason === 'expired') await state.database.codexSessionGrant.updateMany({ where: { accountId }, data: { expiresAt: new Date(0) } });
        if (reason === 'credential-change') await upload();
        if (reason === 'invalid' || reason === 'needs-refresh') await state.database.codexAccountProfile.update({ where: { id: profile.id }, data: { status: reason } });
        if (reason === 'profile-delete') await request('DELETE', `/v1/codex-accounts/${profile.id}`);
        if (reason === 'machine-delete') await state.database.machine.delete({ where: { id: machineId } });
        if (reason.endsWith('owner-change')) {
            const foreign = `${accountId}-foreign`;
            await state.database.account.create({ data: { id: foreign, publicKey: foreign } });
            if (reason === 'profile-owner-change') await state.database.codexAccountProfile.update({ where: { id: profile.id }, data: { accountId: foreign } });
            else await state.database.machine.update({ where: { id: machineId }, data: { accountId: foreign } });
        }
        expect((await redeem(issued.grant)).statusCode).toBe(409);
    });

    it('registers an explicit launch only to a fresh account session and pins later resumes to that account', async () => {
        const original = await launch();
        const selected = await upload('selected-account');
        const issued = await issue(selected.id);
        const redeemed = await redeem(issued.grant);
        expect(redeemed.statusCode).toBe(200);
        const url = `/v1/codex-session-grants/${redeemed.json().launchId}/session`;
        expect((await request('POST', url, { machineId, sourceSessionId: original.sourceSessionId })).statusCode).toBe(409);
        const freshSessionId = `${accountId}-fresh-session`;
        await state.database.session.create({ data: { id: freshSessionId, accountId, tag: freshSessionId, metadata: 'encrypted' } });
        for (let i = 0; i < 2; i++) expect((await request('POST', url, { machineId, sourceSessionId: freshSessionId })).statusCode).toBe(200);
        const resumed = await request('POST', '/v1/codex-session-grants', { machineId, sourceSessionId: freshSessionId });
        expect(resumed.statusCode).toBe(200);
        expect(resumed.json().profile.id).toBe(selected.id);
        expect((await redeem(resumed.json().grant)).json().auth).toEqual(fakeAuth('selected-account'));
        expect((await request('POST', '/v1/codex-session-grants', { machineId, sourceSessionId: original.sourceSessionId })).json().profile.id)
            .toBe(original.profile.id);
        expect((await request('GET', '/v1/codex-accounts')).json().bindings)
            .toContainEqual({ machineId, profileId: original.profile.id, version: 1 });
    });

    it('rejects attaching an explicit account launch to an older native session without an account audit', async () => {
        const nativeSessionId = `${accountId}-native-session`;
        const native = await state.database.session.create({ data: {
            id: nativeSessionId, accountId, tag: nativeSessionId, metadata: 'encrypted', createdAt: new Date(0),
        } });
        const profile = await upload();
        const issued = await issue(profile.id);
        const redeemed = await redeem(issued.grant);
        expect(redeemed.statusCode).toBe(200);
        const launchId = redeemed.json().launchId;
        const url = `/v1/codex-session-grants/${launchId}/session`;
        expect(await state.database.codexSessionGrant.count({ where: { accountId, sourceSessionId: nativeSessionId } })).toBe(0);
        expect((await request('POST', url, { machineId, sourceSessionId: nativeSessionId })).statusCode).toBe(409);
        expect(await state.database.session.findUniqueOrThrow({ where: { id: nativeSessionId } })).toEqual(native);
        expect(await state.database.codexSessionGrant.findUniqueOrThrow({ where: { id: launchId } }))
            .toMatchObject({ sourceSessionId: null });

        const freshSessionId = `${accountId}-fresh-session`;
        await state.database.session.create({ data: { id: freshSessionId, accountId, tag: freshSessionId, metadata: 'encrypted' } });
        for (let i = 0; i < 2; i++) expect((await request('POST', url, { machineId, sourceSessionId: freshSessionId })).statusCode).toBe(200);
    });

    it('preserves an already recorded explicit launch registration retry for an older session', async () => {
        const sourceSessionId = `${accountId}-recorded-session`;
        await state.database.session.create({ data: { id: sourceSessionId, accountId, tag: sourceSessionId, metadata: 'encrypted', createdAt: new Date(0) } });
        const profile = await upload();
        const redeemed = await redeem((await issue(profile.id)).grant);
        expect(redeemed.statusCode).toBe(200);
        const launchId = redeemed.json().launchId;
        // A persisted registration from before this guard must stay idempotent.
        await state.database.codexSessionGrant.update({ where: { id: launchId }, data: { sourceSessionId } });
        expect((await request('POST', `/v1/codex-session-grants/${launchId}/session`, { machineId, sourceSessionId })).statusCode).toBe(200);
    });

    it('does not treat an unknown negative binding version as explicit account authority', async () => {
        const profile = await upload();
        const issued = await issue(profile.id);
        await state.database.codexSessionGrant.updateMany({ where: { accountId }, data: { bindingVersion: -2 } });
        expect((await redeem(issued.grant)).statusCode).toBe(409);
    });

    it('resumes with the recorded session account without changing the machine binding', async () => {
        const original = await launch();
        const current = await upload('second-account');
        await bind(current.id, 1);
        const issued = await request('POST', '/v1/codex-session-grants', { machineId, sourceSessionId: original.sourceSessionId });
        expect(issued.statusCode, issued.body).toBe(200);
        expect(issued.json().profile.id).toBe(original.profile.id);
        const resumed = await redeem(issued.json().grant);
        expect(resumed.statusCode, resumed.body).toBe(200);
        expect(resumed.json().auth).toEqual(fakeAuth());
        expect((await request('POST', `/v1/codex-session-grants/${resumed.json().launchId}/session`, { machineId, sourceSessionId: 'another-session' })).statusCode).toBe(409);
        expect((await request('POST', `/v1/codex-session-grants/${resumed.json().launchId}/session`, { machineId, sourceSessionId: original.sourceSessionId })).statusCode).toBe(200);
        expect((await request('GET', '/v1/codex-accounts')).json().bindings).toContainEqual({ machineId, profileId: current.id, version: 2 });
        expect((await issue()).profile.id).toBe(current.id);
    });

    it('lets only the attached old session adopt a reuploaded credential for its original account', async () => {
        const { profile, launchId, sourceSessionId } = await launch();
        const url = `/v1/codex-session-grants/${launchId}/credential`;
        const read = (knownVersion: number, override: Record<string, unknown> = {}) =>
            request('POST', url, { machineId, sourceSessionId, knownVersion, ...override });
        expect((await read(1)).json()).toMatchObject({ profileId: profile.id, status: 'available', credentialVersion: 1 });
        expect((await read(1)).json()).not.toHaveProperty('auth');
        for (const override of [{ sourceSessionId: 'other-session' }, { machineId: 'other-machine' }]) {
            expect((await read(1, override)).statusCode).toBe(409);
        }
        const other = await upload('another-private-account');
        await bind(other.id, 1);
        const refreshed = { ...fakeAuth(), tokens: { ...fakeAuth().tokens, refresh_token: 'new-refresh-token' } };
        expect((await request('POST', '/v1/codex-accounts/upload', { auth: refreshed })).json().profile)
            .toMatchObject({ id: profile.id, credentialVersion: 2, status: 'available' });
        expect((await read(1)).json()).toMatchObject({ profileId: profile.id, credentialVersion: 2, auth: refreshed });
        expect((await read(2)).json()).not.toHaveProperty('auth');
        const laterRotation = { ...refreshed, tokens: { ...refreshed.tokens, refresh_token: 'later-refresh-token' } };
        expect((await request('PUT', `/v1/codex-accounts/${profile.id}/credential`, {
            machineId, launchId, expectedVersion: 2, auth: laterRotation,
        })).json().profile).toMatchObject({ credentialVersion: 3 });
        expect((await read(2)).json()).toMatchObject({ credentialVersion: 3, auth: laterRotation });
        const foreign = `${accountId}-foreign`;
        await state.database.account.create({ data: { id: foreign, publicKey: foreign } });
        expect((await request('POST', url, { machineId, sourceSessionId, knownVersion: 1 }, foreign)).statusCode).toBe(409);
    });

    it('does not issue session account grants for missing audit, foreign sessions, or another machine', async () => {
        const original = await launch();
        const other = `${accountId}-other-machine`;
        await state.database.machine.create({ data: { id: other, accountId, metadata: 'encrypted' } });
        for (const payload of [{ machineId, sourceSessionId: 'unknown' }, { machineId: other, sourceSessionId: original.sourceSessionId }]) {
            const response = await request('POST', '/v1/codex-session-grants', payload);
            expect(response.statusCode).toBe(409);
        }
        const foreign = 'resume-foreign-user';
        await state.database.account.create({ data: { id: foreign, publicKey: foreign } });
        expect((await request('POST', '/v1/codex-session-grants', { machineId, sourceSessionId: original.sourceSessionId }, foreign)).statusCode).toBe(404);
        const issued = await request('POST', '/v1/codex-session-grants', { machineId, sourceSessionId: original.sourceSessionId });
        expect(issued.statusCode).toBe(200);
        await state.database.session.delete({ where: { id: original.sourceSessionId } });
        expect((await redeem(issued.json().grant)).statusCode).toBe(409);
    });

    it('atomically redeems a high entropy grant once and never persists its raw value', async () => {
        const profile = await upload();
        await bind(profile.id);
        const issued = await issue();
        expect(issued.grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(issued).not.toHaveProperty('auth');
        const [one, two] = await Promise.all([redeem(issued.grant), redeem(issued.grant)]);
        expect([one.statusCode, two.statusCode].sort()).toEqual([200, 409]);
        const success = one.statusCode === 200 ? one : two;
        expect(success.json()).toMatchObject({ auth: fakeAuth(), profile: { id: profile.id, credentialVersion: 1 } });
        const rows = await (state.database as any).codexSessionGrant.findMany({ where: { accountId } });
        expect(JSON.stringify(rows)).not.toContain(issued.grant);
    });

    it('rejects cross-account and cross-machine redemption without consuming the valid grant', async () => {
        const profile = await upload(); await bind(profile.id);
        const issued = await issue();
        expect((await redeem(issued.grant, 'wrong-machine')).statusCode).toBe(409);
        expect((await redeem(issued.grant, machineId, 'foreign-user')).statusCode).toBe(409);
        expect((await redeem(issued.grant)).statusCode).toBe(200);
    });

    it.each(['expired', 'binding-change', 'credential-change', 'invalid', 'needs-refresh'])('rejects a grant after %s', async (reason) => {
        const profile = await upload(); await bind(profile.id);
        const issued = await issue();
        if (reason === 'expired') await (state.database as any).codexSessionGrant.updateMany({ where: { accountId }, data: { expiresAt: new Date(0) } });
        if (reason === 'binding-change') { await bind(null, 1); await bind(profile.id, 2); }
        if (reason === 'credential-change') await upload();
        if (reason === 'invalid' || reason === 'needs-refresh') await (state.database as any).codexAccountProfile.update({ where: { id: profile.id }, data: { status: reason } });
        expect((await redeem(issued.grant)).statusCode).toBe(409);
    });

    it('CAS refresh rejects a losing writer and wrong profile identity while preserving the original quota audit version', async () => {
        const { profile, launchId } = await launch();
        const update = (expectedVersion: number, auth = fakeAuth()) => request('PUT', `/v1/codex-accounts/${profile.id}/credential`, { machineId, launchId, expectedVersion, auth });
        expect((await update(1, fakeAuth('wrong-profile'))).statusCode).toBe(400);
        const [a, b] = await Promise.all([update(1), update(1, { ...fakeAuth(), tokens: { ...fakeAuth().tokens, refresh_token: 'competing-refresh' } })]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
        expect((await update(2)).statusCode).toBe(200);
        const row = await (state.database as any).codexSessionGrant.findUnique({ where: { id: launchId } });
        expect(row.credentialVersion).toBe(1);
        expect(row.lastCredentialVersion).toBe(3);
    });

    it('acknowledges an identical committed refresh retry without rotating the version or duplicating its audit', async () => {
        const { profile, launchId } = await launch();
        const auth = { ...fakeAuth(), tokens: { ...fakeAuth().tokens, refresh_token: 'rotated-refresh' } };
        const body = { machineId, launchId, expectedVersion: 1, auth };
        const url = `/v1/codex-accounts/${profile.id}/credential`;
        expect((await request('PUT', url, body)).statusCode).toBe(200);
        const laterLaunch = await redeem((await issue()).grant);
        expect((await request('PUT', url, { ...body, launchId: laterLaunch.json().launchId })).statusCode).toBe(409);
        const before = await state.database.codexAccountProfile.findUniqueOrThrow({ where: { id: profile.id } });
        for (let i = 0; i < 2; i++) {
            const retry = await request('PUT', url, body);
            expect(retry.statusCode, retry.body).toBe(200);
            expect(retry.json().profile.credentialVersion).toBe(2);
            expect(retry.body).not.toContain('rotated-refresh');
        }
        expect(await state.database.codexAccountProfile.findUniqueOrThrow({ where: { id: profile.id } })).toEqual(before);
        expect(await state.database.codexAccountAudit.count({ where: { accountId, action: 'credential-refresh' } })).toBe(1);
        expect((await request('PUT', url, { ...body, expectedVersion: 2, auth: { ...auth, tokens: { ...auth.tokens, refresh_token: 'next-generation' } } })).statusCode).toBe(200);
        expect((await request('PUT', url, body)).statusCode).toBe(409);
    });

    it('does not acknowledge a retry from another launch or with different credentials', async () => {
        const { profile, launchId } = await launch();
        const other = await redeem((await issue()).grant);
        const auth = { ...fakeAuth(), tokens: { ...fakeAuth().tokens, refresh_token: 'committed-refresh' } };
        const body = { machineId, launchId, expectedVersion: 1, auth };
        const url = `/v1/codex-accounts/${profile.id}/credential`;
        expect((await request('PUT', url, body)).statusCode).toBe(200);
        for (const override of [
            { launchId: other.json().launchId },
            { machineId: 'wrong-machine' },
            { auth: fakeAuth() },
            { auth: { ...auth, tokens: { ...auth.tokens, access_token: 'different-access' } } },
        ]) expect((await request('PUT', url, { ...body, ...override })).statusCode).toBe(409);
        expect((await request('POST', '/v1/codex-accounts/upload', { auth })).statusCode).toBe(200);
        expect((await request('PUT', url, body)).statusCode).toBe(409);
    });

    it('accepts only newer quota observations attributed to the redeemed and registered session', async () => {
        const { profile, launchId, sourceSessionId } = await launch();
        const now = Date.now();
        const body = { launchId, machineId, sourceSessionId, credentialVersion: 1, weeklyUsedPercent: 32, weeklyResetsAt: new Date(now + 7 * 86400_000).toISOString(), observedAt: new Date(now - 1000).toISOString() };
        const report = (override = {}) => request('PUT', `/v1/codex-accounts/${profile.id}/quota-snapshot`, { ...body, ...override });
        expect((await report()).json()).toMatchObject({ accepted: true });
        expect((await report({ weeklyUsedPercent: 90, observedAt: new Date(now - 2000).toISOString() })).json()).toMatchObject({ accepted: false });
        for (const override of [{ sourceSessionId: 'wrong-session' }, { machineId: 'wrong-machine' }, { credentialVersion: 2 }]) expect((await report(override)).statusCode).toBe(409);
        for (const override of [{ weeklyUsedPercent: 101 }, { weeklyUsedPercent: -1 }, { observedAt: new Date(now + 86400_000).toISOString() }, { rawEvent: 'secret' }]) expect((await report(override)).statusCode).toBe(400);
        const list = await request('GET', '/v1/codex-accounts');
        expect(list.json().profiles[0].quota).toMatchObject({ state: 'current', remainingPercent: 68 });
        expect(list.body).not.toContain(sourceSessionId);
        expect(list.body).not.toContain(launchId);
    });

    it('accepts a quota probe only from the redeemed bound-account grant, without creating a session', async () => {
        const profile = await upload();
        expect((await bind(profile.id)).statusCode).toBe(200);
        const issued = await issue();
        const redeemed = await redeem(issued.grant);
        expect(redeemed.statusCode).toBe(200);
        const now = Date.now();
        const body = { launchId: redeemed.json().launchId, machineId, credentialVersion: 1, weeklyUsedPercent: 19,
            weeklyResetsAt: new Date(now + 7 * 86400_000).toISOString(), observedAt: new Date(now - 1000).toISOString() };
        const report = (override = {}) => request('PUT', `/v1/codex-accounts/${profile.id}/quota-probe`, { ...body, ...override });
        expect((await report()).json()).toEqual({ accepted: true });
        expect((await report({ launchId: '00000000-0000-4000-8000-000000000001' })).statusCode).toBe(409);
        const list = await request('GET', '/v1/codex-accounts');
        expect(list.json().profiles[0].quota).toMatchObject({ state: 'current', remainingPercent: 81 });
        expect(list.body).not.toContain('quota-probe:');
    });

    it('renders unknown, stale, reset and invalid-profile quota without inventing fresh remaining values', async () => {
        const { profile, launchId, sourceSessionId } = await launch();
        const get = async () => (await request('GET', '/v1/codex-accounts')).json().profiles[0];
        expect((await get()).quota).toMatchObject({ state: 'unknown', remainingPercent: null });
        const now = Date.now();
        const report = { launchId, machineId, sourceSessionId, credentialVersion: 1, weeklyUsedPercent: 32, weeklyResetsAt: new Date(now + 86400_000).toISOString(), observedAt: new Date(now - 25 * 3600_000).toISOString() };
        expect((await request('PUT', `/v1/codex-accounts/${profile.id}/quota-snapshot`, report)).statusCode).toBe(200);
        expect((await get()).quota).toMatchObject({ state: 'stale', remainingPercent: 68 });
        await (state.database as any).codexAccountProfile.update({ where: { id: profile.id }, data: { status: 'invalid' } });
        expect(await get()).toMatchObject({ status: 'invalid', quota: { state: 'stale', remainingPercent: 68 } });
        await (state.database as any).codexQuotaSnapshot.update({ where: { codexAccountProfileId: profile.id }, data: { weeklyResetsAt: new Date(now - 1) } });
        expect((await get()).quota).toMatchObject({ state: 'reset', remainingPercent: null });
    });

    it('cannot reassign a launch audit to another session or register a session owned by another account', async () => {
        const { launchId } = await launch();
        const other = `${accountId}-other-session`;
        await state.database.session.create({ data: { id: other, accountId, tag: other, metadata: 'encrypted' } });
        expect((await request('POST', `/v1/codex-session-grants/${launchId}/session`, { machineId, sourceSessionId: other })).statusCode).toBe(409);
    });

    it('lists the read-only account directory without migrating legacy credentials or changing untouched bindings', async () => {
        const profile = await upload('selected-account');
        await state.database.serviceAccountToken.create({ data: { accountId, vendor: 'openai', token: encryptString(['user', accountId, 'vendors', 'openai', 'token'], JSON.stringify({ oauth: fakeAuth().tokens })) } });
        const snapshot = async () => ({
            account: await state.database.account.findUniqueOrThrow({ where: { id: accountId } }),
            machines: await state.database.machine.findMany({ where: { accountId } }),
            profiles: await state.database.codexAccountProfile.findMany({ where: { accountId } }),
            legacy: await state.database.serviceAccountToken.findMany({ where: { accountId } }),
            audits: await state.database.codexAccountAudit.findMany({ where: { accountId } }),
        });
        const before = await snapshot();
        const response = await request('GET', '/v1/codex-accounts/directory');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            profiles: [{ id: profile.id, credentialVersion: 1 }],
            bindings: [{ machineId, profileId: null, version: 0 }],
            migration: 'none',
        });
        expect(response.json().profiles).toHaveLength(1);
        expect(await snapshot()).toEqual(before);

        // The compatibility endpoint retains its existing migration behavior.
        const migrated = await request('GET', '/v1/codex-accounts');
        expect(migrated.statusCode).toBe(200);
        expect(migrated.json().migration).toBe('completed');
        expect(migrated.json().profiles).toHaveLength(2);
        expect(migrated.json().bindings[0]).toMatchObject({ machineId, version: 1 });
        expect(migrated.json().bindings[0].profileId).not.toBe(profile.id);
        expect((await request('GET', '/v1/codex-accounts/directory')).json().migration).toBe('completed');
    });

    it('returns 404 for the new directory on a legacy-only server without running the legacy migration endpoint', async () => {
        await state.database.serviceAccountToken.create({ data: { accountId, vendor: 'openai', token: encryptString(['user', accountId, 'vendors', 'openai', 'token'], JSON.stringify({ oauth: fakeAuth().tokens })) } });
        const beforeMachine = await state.database.machine.findUniqueOrThrow({ where: { id: machineId } });
        const beforeLegacy = await state.database.serviceAccountToken.findMany({ where: { accountId } });
        const legacyApp = fastify();
        legacyApp.get('/v1/codex-accounts', () => codexAccountStore.list(accountId));
        try {
            const response = await legacyApp.inject({ method: 'GET', url: '/v1/codex-accounts/directory' });
            expect(response.statusCode).toBe(404);
            expect(await state.database.codexAccountProfile.count({ where: { accountId } })).toBe(0);
            expect(await state.database.machine.findUniqueOrThrow({ where: { id: machineId } })).toEqual(beforeMachine);
            expect(await state.database.serviceAccountToken.findMany({ where: { accountId } })).toEqual(beforeLegacy);
            expect(await state.database.codexAccountAudit.count({ where: { accountId } })).toBe(0);
            const legacyResponse = await legacyApp.inject({ method: 'GET', url: '/v1/codex-accounts' });
            expect(legacyResponse.statusCode).toBe(200);
            expect(legacyResponse.json().migration).toBe('completed');
            expect(legacyResponse.json().bindings[0]).toMatchObject({ machineId, version: 1 });
        } finally { await legacyApp.close(); }
    });

    it('migrates the legacy OAuth record once, binds untouched existing machines, and preserves explicit unbinding', async () => {
        const explicit = `${accountId}-explicit-unbound`;
        await state.database.machine.create({ data: { id: explicit, accountId, metadata: 'encrypted', codexAccountBindingVersion: 1 } });
        await state.database.serviceAccountToken.create({ data: { accountId, vendor: 'openai', token: encryptString(['user', accountId, 'vendors', 'openai', 'token'], JSON.stringify({ oauth: fakeAuth().tokens })) } });
        const first = (await request('GET', '/v1/codex-accounts')).json();
        expect(first.migration).toBe('completed');
        expect(first.profiles).toHaveLength(1);
        expect(first.bindings).toEqual(expect.arrayContaining([
            { machineId, profileId: first.profiles[0].id, version: 1 },
            { machineId: explicit, profileId: null, version: 1 },
        ]));
        const second = (await request('GET', '/v1/codex-accounts')).json();
        expect(second).toEqual(first);
        expect(await state.database.serviceAccountToken.count({ where: { accountId, vendor: 'openai' } })).toBe(1);
        await request('DELETE', `/v1/codex-accounts/${first.profiles[0].id}`);
        expect((await request('GET', '/v1/codex-accounts')).json().profiles).toEqual([]);
    });

    it('does not overwrite a newer uploaded credential during legacy migration', async () => {
        const profile = await upload();
        await state.database.serviceAccountToken.create({ data: { accountId, vendor: 'openai', token: encryptString(['user', accountId, 'vendors', 'openai', 'token'], JSON.stringify({ oauth: { ...fakeAuth().tokens, access_token: 'old-access-token' } })) } });
        const list = (await request('GET', '/v1/codex-accounts')).json();
        expect(list.migration).toBe('completed');
        expect(list.profiles).toHaveLength(1);
        expect(list.profiles[0]).toMatchObject({ id: profile.id, credentialVersion: 1 });
        const res = await redeem((await issue()).grant);
        expect(res.json().auth.tokens.access_token).toBe('fake-access-token');
    });

    it('keeps an invalid legacy credential and returns a non-secret needs-upload migration state', async () => {
        await state.database.serviceAccountToken.create({ data: { accountId, vendor: 'openai', token: encryptString(['user', accountId, 'vendors', 'openai', 'token'], 'invalid-secret-credential') } });
        const response = await request('GET', '/v1/codex-accounts');
        expect(response.json()).toMatchObject({ profiles: [], migration: 'needs-upload' });
        expect(response.body).not.toContain('invalid-secret-credential');
        expect(await state.database.serviceAccountToken.count({ where: { accountId, vendor: 'openai' } })).toBe(1);
    });

    it('never exposes malformed credential JSON in framework errors or logs', async () => {
        const res = await app.inject({ method: 'POST', url: '/v1/codex-accounts/upload', headers: { authorization: `Bearer ${accountId}`, 'content-type': 'application/json' }, payload: '{"auth":"malformed-secret-token" BROKEN}' });
        expect(res.statusCode).toBe(400);
        expect(res.body).not.toContain('malformed-secret-token');
        expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain('malformed-secret-token');
    });

    it('accepts only current attached-launch status reports and blocks grants without erasing quota', async () => {
        const { profile, launchId, sourceSessionId } = await launch();
        expect((await request('PUT', `/v1/codex-accounts/${profile.id}/quota-snapshot`, {
            launchId, machineId, sourceSessionId, credentialVersion: 1, weeklyUsedPercent: 32,
            observedAt: new Date().toISOString(), weeklyResetsAt: new Date(Date.now() + 86400_000).toISOString(),
        })).statusCode).toBe(200);
        const report = (override = {}) => request('PUT', `/v1/codex-accounts/${profile.id}/status`, { machineId, launchId, credentialVersion: 1, status: 'invalid', ...override });
        expect((await report({ status: 'available' })).statusCode).toBe(400);
        expect((await report({ rawError: 'secret-provider-error' })).statusCode).toBe(400);
        expect((await report({ machineId: 'foreign-machine' })).statusCode).toBe(409);
        const pending = await issue();
        expect((await report()).json()).toMatchObject({ profile: { status: 'invalid', quota: { state: 'current', remainingPercent: 68 } } });
        expect((await redeem(pending.grant)).statusCode).toBe(409);
        expect((await request('POST', '/v1/codex-session-grants', { machineId })).statusCode).toBe(409);
        await upload();
        expect((await report()).statusCode).toBe(409);
        expect((await request('GET', '/v1/codex-accounts')).json().profiles[0].status).toBe('available');
    });

    it('rejects status reports before a redeemed launch is attached to its owned session', async () => {
        const profile = await upload(); await bind(profile.id);
        const grant = await issue();
        const redeemed = (await redeem(grant.grant)).json();
        const report = await request('PUT', `/v1/codex-accounts/${profile.id}/status`, { machineId, launchId: redeemed.launchId, credentialVersion: 1, status: 'needs-refresh' });
        expect(report.statusCode).toBe(409);
    });

    it('serializes concurrent duplicate uploads and resolves automatic-name collisions', async () => {
        const [a, b] = await Promise.all([upload(), upload()]);
        expect(a.id).toBe(b.id);
        expect([a.credentialVersion, b.credentialVersion].sort()).toEqual([1, 2]);
        const second = await upload('collision-account');
        await request('DELETE', `/v1/codex-accounts/${second.id}`);
        await request('PATCH', `/v1/codex-accounts/${a.id}`, { displayName: second.displayName });
        const replacement = await upload('collision-account');
        expect(replacement.displayName).toBe(`${second.displayName}-2`);
        expect((await request('PATCH', `/v1/codex-accounts/${replacement.id}`, { displayName: second.displayName })).statusCode).toBe(409);
    });

    it('rolls back profile deletion, binding cleanup and grant revocation if its audit cannot commit', async () => {
        const profile = await upload(); await bind(profile.id);
        const grant = await issue();
        await pg.exec(`ALTER TABLE "CodexAccountAudit" ADD CONSTRAINT reject_test_delete CHECK (NOT ("accountId" = '${accountId}' AND "action" = 'delete'))`);
        try {
            expect((await request('DELETE', `/v1/codex-accounts/${profile.id}`)).statusCode).toBe(500);
            const list = (await request('GET', '/v1/codex-accounts')).json();
            expect(list.profiles).toHaveLength(1);
            expect(list.bindings).toContainEqual({ machineId, profileId: profile.id, version: 1 });
            expect((await redeem(grant.grant)).statusCode).toBe(200);
        } finally { await pg.exec('ALTER TABLE "CodexAccountAudit" DROP CONSTRAINT reject_test_delete'); }
    });

    it('refuses attaching a launch to a foreign session and accepts an owned one idempotently', async () => {
        const profile = await upload(); await bind(profile.id);
        const redeemed = (await redeem((await issue()).grant)).json();
        const foreignId = `${accountId}-foreign`;
        await state.database.account.create({ data: { id: foreignId, publicKey: foreignId } });
        await state.database.session.create({ data: { id: foreignId, accountId: foreignId, tag: foreignId, metadata: 'encrypted' } });
        const url = `/v1/codex-session-grants/${redeemed.launchId}/session`;
        expect((await request('POST', url, { machineId, sourceSessionId: foreignId })).statusCode).toBe(409);
        const ownId = `${accountId}-own`;
        await state.database.session.create({ data: { id: ownId, accountId, tag: ownId, metadata: 'encrypted' } });
        for (let i = 0; i < 2; i++) expect((await request('POST', url, { machineId, sourceSessionId: ownId })).statusCode).toBe(200);
    });

    it('rejects quota cross-profile attribution and keeps running-launch attribution after rebinding', async () => {
        const { profile, launchId, sourceSessionId } = await launch();
        const other = await upload('another-account');
        const snapshot = {
            launchId, machineId, sourceSessionId, credentialVersion: 1, weeklyUsedPercent: 32,
            observedAt: new Date().toISOString(), weeklyResetsAt: new Date(Date.now() + 86400_000).toISOString(),
        };
        expect((await request('PUT', `/v1/codex-accounts/${other.id}/quota-snapshot`, snapshot)).statusCode).toBe(409);
        expect((await bind(other.id, 1)).statusCode).toBe(200);
        expect((await request('PUT', `/v1/codex-accounts/${profile.id}/quota-snapshot`, snapshot)).json()).toEqual({ accepted: true });
        const list = (await request('GET', '/v1/codex-accounts')).json();
        expect(list.profiles.find((p: any) => p.id === profile.id).quota.remainingPercent).toBe(68);
        expect(list.profiles.find((p: any) => p.id === other.id).quota.remainingPercent).toBeNull();
    });

    it('migrates a legacy binding on the first launch without requiring a prior account-list request', async () => {
        await state.database.serviceAccountToken.create({ data: { accountId, vendor: 'openai', token: encryptString(['user', accountId, 'vendors', 'openai', 'token'], JSON.stringify({ oauth: fakeAuth().tokens })) } });
        const grant = await issue();
        expect((await redeem(grant.grant)).json().auth.tokens).toEqual(fakeAuth().tokens);
        expect((await request('GET', '/v1/codex-accounts')).json()).toMatchObject({ migration: 'completed', profiles: [{ credentialVersion: 1 }] });
    });
});
