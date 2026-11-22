import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth/tokenStorage', () => ({ TokenStorage: { getCredentials: vi.fn() } }));
vi.mock('./apiSessions', async importOriginal => ({ ...await importOriginal<typeof import('./apiSessions')>(), fetchSessionSnapshotPage: vi.fn() }));
vi.mock('./apiSocket', () => ({ getHappyClientId: () => 'test-client' }));
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://api.test' }));
vi.mock('./projectGoals', () => ({ projectGoalRequest: vi.fn() }));
import { TokenStorage } from '@/auth/tokenStorage';
import { fetchSessionSnapshotPage, SessionRequestError } from './apiSessions';
import { projectGoalRequest } from './projectGoals';
import { readProjectConversationManifestHeaders } from './projectConversationManifest.web';

const header = (id: string, metadataVersion = 1) => ({ id, metadataVersion, metadata: btoa(`cipher-${id}`), dataEncryptionKey: null });
const manifest = (ids: string[]) => ({ projectPath: '/project', snapshotId: 'fixed-snapshot', catalogFingerprint: 'a'.repeat(64),
    total: ids.length, expiresAt: Date.now() + 60000, sessions: ids.map(id => ({ id, metadataVersion: 1 })) });
const page = (rows: ReturnType<typeof header>[], extra = {}) => ({ sessions: rows, nextCursor: null, hasNext: false, ...extra });
const rawPage = (m: ReturnType<typeof manifest>, ids: string[], extra = {}) => ({ ...m, total: ids.length,
    sessions: ids.map(id => header(id)), nextCursor: null, hasNext: false, ...extra });
beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(TokenStorage.getCredentials).mockResolvedValue({ token: 'private-token', secret: 'private-secret' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('HTTP acceleration of an immutable project catalog', () => {
    it('reads every pinned identity with at most three concurrent ID-range requests, without relaying metadata', async () => {
        const ids = Array.from({ length: 76 }, (_, i) => `s${String(i).padStart(4, '0')}`).reverse();
        const m = manifest(ids);
        let active = 0, maximum = 0;
        vi.mocked(fetchSessionSnapshotPage).mockImplementation(async (_credentials, options) => {
            active++; maximum = Math.max(maximum, active);
            await Promise.resolve();
            const start = options.cursor ? ids.indexOf(options.cursor.slice('cursor_v1_'.length)) + 1 : 0;
            active--;
            return page(ids.slice(start, start + options.limit!).map(id => header(id))) as any;
        });
        const result = await readProjectConversationManifestHeaders('machine', '/project', m, { current() {} });
        expect(result).toEqual(ids.map(id => header(id)));
        expect(maximum).toBe(3);
        expect(fetchSessionSnapshotPage).toHaveBeenCalledTimes(4);
        expect(projectGoalRequest).not.toHaveBeenCalled();
        expect(vi.mocked(fetchSessionSnapshotPage).mock.calls.every(([, options]) => options.limit === 25)).toBe(true);
    });

    it('fills changed, deleted and displaced rows from the same snapshot, excluding new sessions', async () => {
        const m = manifest(['c', 'b', 'a']);
        vi.mocked(fetchSessionSnapshotPage).mockResolvedValue(page([header('new'), header('c', 2), header('a')]) as any);
        vi.mocked(projectGoalRequest).mockResolvedValue(rawPage(m, ['c', 'b']));
        const result = await readProjectConversationManifestHeaders('machine', '/project', m, { current() {}, version: 'read-1' });
        expect(result).toEqual(['c', 'b', 'a'].map(id => header(id)));
        expect(projectGoalRequest).toHaveBeenCalledExactlyOnceWith('machine', 'goalProjectConversationCatalog', {
            projectPath: '/project', snapshotId: m.snapshotId, sessionIds: ['c', 'b'],
        }, 'read-1');
    });

    it('exhausts byte-limited missing-row pages rather than treating one page as complete', async () => {
        const m = manifest(['c', 'b', 'a']);
        vi.mocked(fetchSessionSnapshotPage).mockResolvedValue(page([]) as any);
        vi.mocked(projectGoalRequest).mockResolvedValueOnce(rawPage(m, ['c'], { total: 3, hasNext: true, nextCursor: '1' }))
            .mockResolvedValueOnce(rawPage(m, ['b', 'a'], { total: 3 }));
        expect((await readProjectConversationManifestHeaders('machine', '/project', m, { current() {} })).map(row => row.id)).toEqual(['c', 'b', 'a']);
        expect(projectGoalRequest).toHaveBeenLastCalledWith('machine', 'goalProjectConversationCatalog', {
            projectPath: '/project', snapshotId: m.snapshotId, sessionIds: ['c', 'b', 'a'], cursor: '1',
        });
    });

    it.each([
        ['snapshot', { snapshotId: 'other' }], ['digest', { catalogFingerprint: 'b'.repeat(64) }],
        ['project', { projectPath: '/other' }], ['total', { total: 2 }], ['version', { sessions: [header('a', 2)] }],
        ['foreign identity', { sessions: [header('foreign')] }], ['incomplete', { sessions: [] }],
    ])('rejects a mismatching fallback %s', async (_name, extra) => {
        const m = manifest(['a']);
        vi.mocked(fetchSessionSnapshotPage).mockResolvedValue(page([]) as any);
        vi.mocked(projectGoalRequest).mockResolvedValue(rawPage(m, ['a'], extra));
        await expect(readProjectConversationManifestHeaders('machine', '/project', m, { current() {} })).rejects.toThrow();
    });

    it('stops scheduling requests when the account or cancellation fence changes', async () => {
        const ids = Array.from({ length: 801 }, (_, i) => `s${i.toString().padStart(4, '0')}`);
        let changed = false;
        vi.mocked(fetchSessionSnapshotPage).mockImplementation(async () => { changed = true; return page([]) as any; });
        await expect(readProjectConversationManifestHeaders('machine', '/project', manifest(ids), {
            current() { if (changed) throw new Error('Account changed or history cancelled'); },
        })).rejects.toThrow(/changed|cancelled/);
        expect(vi.mocked(fetchSessionSnapshotPage).mock.calls.length).toBeLessThanOrEqual(3);
        expect(projectGoalRequest).not.toHaveBeenCalled();
    });

    it('does not call authenticated HTTP or RPC for an empty complete directory', async () => {
        expect(await readProjectConversationManifestHeaders('machine', '/project', manifest([]), { current() {} })).toEqual([]);
        expect(TokenStorage.getCredentials).not.toHaveBeenCalled();
        expect(fetchSessionSnapshotPage).not.toHaveBeenCalled();
    });

    it.each([
        new SessionRequestError('timeout'), new SessionRequestError('network'),
        ...[408, 429, 500, 503, 599].map(status => new SessionRequestError('http', status)),
    ])('repairs a retryable HTTP failure from the same snapshot (%s)', async failure => {
        const m = manifest(['c', 'b', 'a']);
        vi.mocked(fetchSessionSnapshotPage).mockRejectedValue(failure);
        vi.mocked(projectGoalRequest).mockResolvedValue(rawPage(m, ['c', 'b', 'a']));
        expect(await readProjectConversationManifestHeaders('machine', '/project', m, { current() {}, version: 'read-1' }))
            .toEqual(['c', 'b', 'a'].map(id => header(id)));
        expect(projectGoalRequest).toHaveBeenCalledExactlyOnceWith('machine', 'goalProjectConversationCatalog', {
            projectPath: '/project', snapshotId: m.snapshotId, sessionIds: ['c', 'b', 'a'],
        }, 'read-1');
    });

    it.each([
        new SessionRequestError('http', 401), new SessionRequestError('http', 403),
        new SessionRequestError('invalid-response'), new Error('Unexpected failure'),
    ])('does not repair a permanent or unknown HTTP failure (%s)', async failure => {
        vi.mocked(fetchSessionSnapshotPage).mockRejectedValue(failure);
        await expect(readProjectConversationManifestHeaders('machine', '/project', manifest(['a']), { current() {} })).rejects.toBe(failure);
        expect(projectGoalRequest).not.toHaveBeenCalled();
    });

    it('does not let a concurrent transient error mask a permanent response failure', async () => {
        const ids = Array.from({ length: 26 }, (_, i) => `s${i.toString().padStart(4, '0')}`), failure = new SessionRequestError('http', 403);
        vi.mocked(fetchSessionSnapshotPage).mockRejectedValueOnce(new SessionRequestError('timeout')).mockRejectedValueOnce(failure);
        await expect(readProjectConversationManifestHeaders('machine', '/project', manifest(ids), { current() {} })).rejects.toBe(failure);
        expect(projectGoalRequest).not.toHaveBeenCalled();
    });

    it('checks account ownership again before recovering a transient HTTP error', async () => {
        let changed = false;
        vi.mocked(fetchSessionSnapshotPage).mockImplementation(async () => { changed = true; throw new SessionRequestError('timeout'); });
        await expect(readProjectConversationManifestHeaders('machine', '/project', manifest(['a']), {
            current() { if (changed) throw new Error('Account changed'); },
        })).rejects.toThrow('Account changed');
        expect(projectGoalRequest).not.toHaveBeenCalled();
    });

    it('recovers a real HTTP body deadline, preserving successful ranges and cancelling another stalled body', async () => {
        vi.useFakeTimers();
        const actual = await vi.importActual<typeof import('./apiSessions')>('./apiSessions');
        vi.mocked(fetchSessionSnapshotPage).mockImplementation(actual.fetchSessionSnapshotPage);
        const ids = Array.from({ length: 76 }, (_, i) => `s${i.toString().padStart(4, '0')}`).reverse(), m = manifest(ids);
        const signals: AbortSignal[] = [];
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
            const call = calls++; signals.push(options.signal);
            if (call < 2) return { ok: true, json: () => new Promise(() => {}) };
            const rows = ids.slice(call * 25, (call + 1) * 25).map(id => ({ ...header(id), seq: 1, agentState: null,
                agentStateVersion: 0, active: false, activeAt: 1, createdAt: 1, updatedAt: 1 }));
            return new Response(JSON.stringify(page(rows)), { status: 200 });
        }));
        vi.mocked(projectGoalRequest).mockImplementation(async (_machine, _method, input) => rawPage(m, (input as { sessionIds: string[] }).sessionIds));
        const request = readProjectConversationManifestHeaders('machine', '/project', m, { current() {} });
        await vi.advanceTimersByTimeAsync(0);
        expect(calls).toBe(4);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(await request).toEqual(ids.map(id => header(id)));
        expect(projectGoalRequest).toHaveBeenCalledExactlyOnceWith('machine', 'goalProjectConversationCatalog', {
            projectPath: '/project', snapshotId: m.snapshotId, sessionIds: ids.slice(0, 50),
        });
        expect(signals.every(signal => signal.aborted)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts snapshot repair immediately after a network failure and ignores late aborted bodies', async () => {
        vi.useFakeTimers();
        const actual = await vi.importActual<typeof import('./apiSessions')>('./apiSessions');
        vi.mocked(fetchSessionSnapshotPage).mockImplementation(actual.fetchSessionSnapshotPage);
        const ids = Array.from({ length: 76 }, (_, i) => `s${i.toString().padStart(4, '0')}`).reverse(), m = manifest(ids);
        const signals: AbortSignal[] = [], lateBodies: Array<(body: unknown) => void> = [];
        vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
            const call = signals.length; signals.push(options.signal);
            if (!call) return new Response(JSON.stringify(page(ids.slice(0, 25).map(id => ({ ...header(id), seq: 1,
                agentState: null, agentStateVersion: 0, active: false, activeAt: 1, createdAt: 1, updatedAt: 1 })))), { status: 200 });
            if (call === 1) return { ok: true, json: () => new Promise((_resolve, reject) => {
                setTimeout(() => reject(new TypeError('Body connection failed')), 1_000);
            }) };
            return { ok: true, json: () => new Promise(resolve => { lateBodies.push(resolve); }) };
        }));
        vi.mocked(projectGoalRequest).mockImplementation(async (_machine, _method, input) => rawPage(m, (input as { sessionIds: string[] }).sessionIds));
        let outcome: unknown = 'pending';
        const request = readProjectConversationManifestHeaders('machine', '/project', m, { current() {} })
            .then(result => { outcome = result; });
        await vi.advanceTimersByTimeAsync(0);
        expect(signals).toHaveLength(4);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(outcome).toEqual(ids.map(id => header(id)));
        await request;
        expect(signals.every(signal => signal.aborted)).toBe(true);
        expect(projectGoalRequest).toHaveBeenCalledExactlyOnceWith('machine', 'goalProjectConversationCatalog', {
            projectPath: '/project', snapshotId: m.snapshotId, sessionIds: ids.slice(25),
        });
        lateBodies.forEach(resolve => resolve(page([header('foreign')])));
        await vi.advanceTimersByTimeAsync(0);
        expect(signals).toHaveLength(4);
        expect(projectGoalRequest).toHaveBeenCalledTimes(1);
        expect(outcome).toEqual(ids.map(id => header(id)));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('aborts all pending HTTP bodies on caller cancellation without repair or later scheduling', async () => {
        vi.useFakeTimers();
        const actual = await vi.importActual<typeof import('./apiSessions')>('./apiSessions');
        vi.mocked(fetchSessionSnapshotPage).mockImplementation(actual.fetchSessionSnapshotPage);
        const ids = Array.from({ length: 76 }, (_, i) => `s${i}`), controller = new AbortController(), reason = new Error('History closed');
        const signals: AbortSignal[] = [];
        vi.stubGlobal('fetch', vi.fn(async (_url, options) => { signals.push(options.signal); return { ok: true, json: () => new Promise(() => {}) }; }));
        let outcome: unknown = 'pending';
        const request = readProjectConversationManifestHeaders('machine', '/project', manifest(ids), { current() {}, signal: controller.signal })
            .catch(error => { outcome = error; });
        await vi.advanceTimersByTimeAsync(0);
        expect(signals).toHaveLength(3);
        controller.abort(reason);
        await vi.advanceTimersByTimeAsync(0);
        expect(outcome).toBe(reason);
        await request;
        expect(signals.every(signal => signal.aborted)).toBe(true);
        expect(projectGoalRequest).not.toHaveBeenCalled();
        expect(fetchSessionSnapshotPage).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(0);
    });
});
