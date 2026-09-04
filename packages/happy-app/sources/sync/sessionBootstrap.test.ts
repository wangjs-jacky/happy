import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSessionSnapshot } from './apiTypes';
import type { HydratedSession } from './sessionSnapshotHydration';

vi.hoisted(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    (globalThis as unknown as { expo?: { EventEmitter: unknown } }).expo = {
        EventEmitter: EventTarget,
    };
});

const mocks = vi.hoisted(() => {
    const state = {
        sessions: {} as Record<string, HydratedSession>,
        sessionMessages: {} as Record<string, {
            isLoaded: boolean;
            hasMoreOlder: boolean;
            isLoadingOlder: boolean;
        }>,
        readyCount: 0,
        settings: { expImageUpload: false },
        getActiveSessions: () => Object.values(state.sessions).filter((session) => session.active),
        applyReady: () => { state.readyCount += 1; },
        applySessions: (sessions: HydratedSession[], options?: { replace?: boolean }) => {
            if (options?.replace) state.sessions = {};
            for (const session of sessions) state.sessions[session.id] = session;
        },
        applyMessages: (sessionId: string) => {
            state.sessionMessages[sessionId] ??= {
                isLoaded: true,
                hasMoreOlder: false,
                isLoadingOlder: false,
            };
            return { changed: [], hasReadyEvent: false };
        },
        applyMessagesLoaded: (sessionId: string) => {
            state.sessionMessages[sessionId] = {
                ...(state.sessionMessages[sessionId] ?? {
                    hasMoreOlder: false,
                    isLoadingOlder: false,
                }),
                isLoaded: true,
            };
        },
        applyOlderMessagesPagination: (sessionId: string, info: { hasMore: boolean }) => {
            state.sessionMessages[sessionId] = {
                ...(state.sessionMessages[sessionId] ?? {
                    isLoaded: true,
                    isLoadingOlder: false,
                }),
                hasMoreOlder: info.hasMore,
            };
        },
        applyOlderMessagesLoading: (sessionId: string, loading: boolean) => {
            const existing = state.sessionMessages[sessionId];
            if (existing) existing.isLoadingOlder = loading;
        },
        isMutableToolCall: () => false,
    };
    return {
        apiRequest: vi.fn(),
        fetchActive: vi.fn(),
        fetchPage: vi.fn(),
        fetchSnapshot: vi.fn(),
        hydrate: vi.fn(),
        state,
        storage: { getState: () => state },
    };
});

vi.mock('./apiSessions', () => ({
    fetchActiveSessionSnapshots: mocks.fetchActive,
    fetchSessionSnapshot: mocks.fetchSnapshot,
    fetchSessionSnapshotPage: mocks.fetchPage,
}));
vi.mock('./sessionSnapshotHydration', () => ({ hydrateSessionSnapshots: mocks.hydrate }));
vi.mock('./storage', () => ({ storage: mocks.storage }));
vi.mock('./apiSocket', () => ({
    apiSocket: {
        onMessage: vi.fn(),
        onReconnected: vi.fn(),
        request: mocks.apiRequest,
        sendAppState: vi.fn(),
    },
    getCurrentAppState: vi.fn(() => 'active'),
    getHappyClientId: vi.fn(() => 'test-client'),
}));
vi.mock('./pushRegistration', () => ({ syncCurrentPushToken: vi.fn() }));
vi.mock('./encryption/encryption', () => ({ Encryption: class {} }));
vi.mock('./revenueCat', () => ({ RevenueCat: {}, LogLevel: {}, PaywallResult: {} }));
vi.mock('./uploadMediaFile', () => ({ uploadMediaFile: vi.fn() }));
vi.mock('./uploadAttachmentForSession', () => ({ uploadAttachmentForSession: vi.fn() }));
vi.mock('./apiAttachments', () => ({ requestAttachmentUpload: vi.fn(), uploadEncryptedBlob: vi.fn() }));
vi.mock('@/utils/readFileBytes', () => ({ readFileBytes: vi.fn() }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: false }));
vi.mock('@/config', () => ({ config: {} }));
vi.mock('@/track', () => ({
    initializeTracking: vi.fn(),
    trackGitHubConnected: vi.fn(),
    trackMessageSent: vi.fn(),
    tracking: null,
    trackPaywallCancelled: vi.fn(),
    trackPaywallError: vi.fn(),
    trackPaywallPresented: vi.fn(),
    trackPaywallPurchased: vi.fn(),
    trackPaywallRestored: vi.fn(),
}));
vi.mock('@/modal', () => ({ Modal: {} }));
vi.mock('@/realtime/hooks/voiceHooks', () => ({
    voiceHooks: {
        onSessionOffline: vi.fn(),
        onSessionOnline: vi.fn(),
        onPermissionRequested: vi.fn(),
        onMessages: vi.fn(),
        onReady: vi.fn(),
        onSessionFocus: vi.fn(),
    },
}));
vi.mock('react-native', () => ({
    AppState: { currentState: 'active', addEventListener: vi.fn() },
    Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
vi.mock('expo-notifications', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'test-uuid') }));
vi.mock('expo-secure-store', () => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
}));

import { sync } from './sync';

const syncForTest = sync as any;
const originalSessionsSync = syncForTest.sessionsSync;
const originalFetchSessions = syncForTest.fetchSessions;

function snapshot(id: string, overrides: Partial<ApiSessionSnapshot> = {}): ApiSessionSnapshot {
    return {
        id,
        seq: 3,
        metadata: `metadata-${id}`,
        metadataVersion: 3,
        agentState: null,
        agentStateVersion: 0,
        dataEncryptionKey: `key-${id}`,
        active: true,
        activeAt: 30,
        createdAt: 10,
        updatedAt: 30,
        ...overrides,
    };
}

function hydrated(raw: ApiSessionSnapshot): HydratedSession {
    return {
        ...raw,
        metadata: { path: `/${raw.id}`, host: 'test', name: raw.metadata } as any,
        agentState: raw.agentState
            ? { controlledByUser: false, marker: raw.agentState } as any
            : null,
        thinking: false,
        thinkingAt: 0,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    let settled = false;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = (value) => { settled = true; resolvePromise(value); };
        reject = (error) => { settled = true; rejectPromise(error); };
    });
    return { promise, resolve, reject, get settled() { return settled; } };
}

function response(body: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('active-first session bootstrap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.sessions = {};
        mocks.state.sessionMessages = {};
        mocks.state.readyCount = 0;
        mocks.fetchActive.mockResolvedValue([]);
        mocks.fetchPage.mockResolvedValue({ sessions: [], nextCursor: null, hasNext: false });
        mocks.fetchSnapshot.mockResolvedValue(null);
        mocks.apiRequest.mockResolvedValue(response({ messages: [], hasMore: false }));
        syncForTest.credentials = { token: 'test-token', secret: 'test-secret' };
        const sessionEncryptions = new Map<string, {
            decryptMessage: ReturnType<typeof vi.fn>;
            decryptMessages: ReturnType<typeof vi.fn>;
            decryptMetadata: ReturnType<typeof vi.fn>;
            decryptAgentState: ReturnType<typeof vi.fn>;
        }>();
        syncForTest.encryption = {
            getSessionEncryption: vi.fn((id: string) => sessionEncryptions.get(id) ?? null),
            removeSessionEncryption: vi.fn(),
        };
        mocks.hydrate.mockImplementation(async (snapshots: ApiSessionSnapshot[]) => {
            for (const item of snapshots) {
                sessionEncryptions.set(item.id, {
                    decryptMessage: vi.fn(async (message) => ({
                        id: message.id,
                        localId: message.localId,
                        createdAt: message.createdAt,
                        content: { role: 'user', content: { type: 'text', text: 'Realtime message' } },
                    })),
                    decryptMessages: vi.fn(async () => []),
                    decryptMetadata: vi.fn(async () => ({ name: 'Realtime title' })),
                    decryptAgentState: vi.fn(async () => null),
                });
            }
            return snapshots.map(hydrated);
        });
        syncForTest.sessionLastSeq.clear();
        syncForTest.sessionOldestSeq.clear();
        syncForTest.activeOpenSession = null;
    });

    afterEach(() => {
        syncForTest.sessionsSync = originalSessionsSync;
        syncForTest.fetchSessions = originalFetchSessions;
        vi.unstubAllGlobals();
    });

    it('marks the app ready after active sessions without awaiting history pages', async () => {
        const active = snapshot('active-session');
        mocks.state.sessions['cached-session'] = hydrated(snapshot('cached-session', { active: false }));
        const history = deferred<{ sessions: ApiSessionSnapshot[]; nextCursor: string | null; hasNext: boolean }>();
        mocks.fetchActive.mockResolvedValue([active]);
        mocks.fetchPage.mockReturnValue(history.promise);

        await syncForTest.bootstrapSessions();

        expect(mocks.state.readyCount).toBe(1);
        expect(mocks.state.sessions['active-session']).toMatchObject({ id: 'active-session' });
        expect(mocks.state.sessions['cached-session']).toMatchObject({ id: 'cached-session' });
        expect(history.settled).toBe(false);
    });

    it('does not call the legacy session list during bootstrap', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await syncForTest.bootstrapSessions();

        expect(fetchMock).not.toHaveBeenCalledWith(
            expect.stringMatching(/\/v1\/sessions$/),
            expect.anything(),
        );
    });

    it('deduplicates active snapshots and preserves the newest snapshot versions', async () => {
        mocks.fetchActive.mockResolvedValue([
            snapshot('same-session', { seq: 8, metadata: 'new metadata', metadataVersion: 8 }),
            snapshot('same-session', { seq: 4, metadata: 'old metadata', metadataVersion: 4 }),
        ]);

        await syncForTest.bootstrapSessions();

        expect(Object.keys(mocks.state.sessions)).toEqual(['same-session']);
        expect(mocks.state.sessions['same-session']).toMatchObject({
            seq: 8,
            metadataVersion: 8,
            metadata: { name: 'new metadata' },
        });
    });

    it('loads exactly one background history page after the route becomes interactive', async () => {
        mocks.fetchPage.mockResolvedValue({
            sessions: [snapshot('historical-session', { active: false })],
            nextCursor: 'cursor_v1_next',
            hasNext: true,
        });
        await syncForTest.bootstrapSessions();

        await syncForTest.sessionRouteBecameInteractive();
        await Promise.resolve();

        expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
        expect(mocks.fetchPage).toHaveBeenCalledWith(syncForTest.credentials, { limit: 50 });
        expect(mocks.state.sessions['historical-session']).toBeDefined();
    });

    it('coalesces pending history requests without automatically consuming the next cursor', async () => {
        const firstPage = deferred<{ sessions: ApiSessionSnapshot[]; nextCursor: string | null; hasNext: boolean }>();
        const secondPage = deferred<{ sessions: ApiSessionSnapshot[]; nextCursor: string | null; hasNext: boolean }>();
        mocks.fetchPage
            .mockReturnValueOnce(firstPage.promise)
            .mockReturnValueOnce(secondPage.promise);
        await syncForTest.bootstrapSessions();

        const initial = syncForTest.sessionRouteBecameInteractive();
        const repeatedInteractive = syncForTest.sessionRouteBecameInteractive();
        const repeatedNearEnd = [
            syncForTest.loadNextSessionHistoryPage(),
            syncForTest.loadNextSessionHistoryPage(),
        ];
        expect(mocks.fetchPage).toHaveBeenCalledTimes(1);

        firstPage.resolve({
            sessions: [snapshot('history-page-1', { active: false })],
            nextCursor: 'cursor-page-2',
            hasNext: true,
        });
        await vi.waitFor(() => {
            expect(mocks.state.sessions['history-page-1']).toBeDefined();
        });
        const callsAfterFirstPage = mocks.fetchPage.mock.calls.length;
        secondPage.resolve({
            sessions: [snapshot('history-page-2', { active: false })],
            nextCursor: null,
            hasNext: false,
        });
        await Promise.all([initial, repeatedInteractive, ...repeatedNearEnd]);

        expect(callsAfterFirstPage).toBe(1);
        expect(mocks.state.sessions['history-page-2']).toBeUndefined();

        await Promise.all([
            syncForTest.loadNextSessionHistoryPage(),
            syncForTest.loadNextSessionHistoryPage(),
        ]);

        expect(mocks.fetchPage).toHaveBeenCalledTimes(2);
        expect(mocks.fetchPage).toHaveBeenLastCalledWith(syncForTest.credentials, {
            cursor: 'cursor-page-2',
            limit: 50,
        });
        expect(mocks.state.sessions['history-page-2']).toBeDefined();
    });

    it('keeps newer store fields when an older history page arrives', async () => {
        mocks.state.sessions['same-session'] = hydrated(snapshot('same-session', {
            seq: 9,
            metadata: 'current metadata',
            metadataVersion: 9,
            agentState: 'current agent state',
            agentStateVersion: 7,
        }));
        mocks.fetchPage.mockResolvedValue({
            sessions: [snapshot('same-session', {
                seq: 5,
                metadata: 'stale metadata',
                metadataVersion: 5,
                agentState: 'stale agent state',
                agentStateVersion: 3,
            })],
            nextCursor: null,
            hasNext: false,
        });

        await syncForTest.hydrateHistoricalSessionPage(undefined);

        expect(mocks.state.sessions['same-session']).toMatchObject({
            seq: 9,
            metadataVersion: 9,
            metadata: { name: 'current metadata' },
            agentStateVersion: 7,
        });
    });

    it('merges duplicate sessions independently by seq, metadata version, and agent-state version in either order', () => {
        const baseWinner = hydrated(snapshot('mixed-session', {
            seq: 20,
            updatedAt: 200,
            metadata: 'base metadata',
            metadataVersion: 2,
            agentState: 'base agent state',
            agentStateVersion: 3,
        }));
        const metadataWinner = hydrated(snapshot('mixed-session', {
            seq: 5,
            updatedAt: 50,
            metadata: 'winning metadata',
            metadataVersion: 30,
            agentState: 'middle agent state',
            agentStateVersion: 10,
        }));
        const agentStateWinner = hydrated(snapshot('mixed-session', {
            seq: 7,
            updatedAt: 70,
            metadata: 'middle metadata',
            metadataVersion: 11,
            agentState: 'winning agent state',
            agentStateVersion: 40,
        }));

        for (const incoming of [
            [metadataWinner, agentStateWinner],
            [agentStateWinner, metadataWinner],
        ]) {
            mocks.state.sessions = { 'mixed-session': baseWinner };

            syncForTest.applySessions(incoming, { replace: false });

            expect(mocks.state.sessions['mixed-session']).toMatchObject({
                seq: 20,
                updatedAt: 200,
                metadataVersion: 30,
                metadata: { name: 'winning metadata' },
                agentStateVersion: 40,
                agentState: { marker: 'winning agent state' },
            });
        }
    });

    it('continues startup realtime events after their active-session bootstrap resolves', async () => {
        const active = deferred<ApiSessionSnapshot[]>();
        const legacyAwait = vi.fn(async () => undefined);
        const legacyFetch = vi.fn();
        const onSessionVisible = vi.spyOn(syncForTest, 'onSessionVisible').mockImplementation(() => undefined);
        mocks.fetchActive.mockReturnValue(active.promise);
        syncForTest.sessionsSync = { awaitQueue: legacyAwait };
        syncForTest.fetchSessions = legacyFetch;

        const bootstrapping = syncForTest.bootstrapSessions();
        const messageUpdate = syncForTest.handleUpdate({
            id: 'message-update',
            seq: 11,
            createdAt: 110,
            body: {
                t: 'new-message',
                sid: 'startup-session',
                message: {
                    id: 'message-11',
                    seq: 11,
                    localId: null,
                    content: { t: 'encrypted', c: 'message-ciphertext' },
                    createdAt: 110,
                    updatedAt: 110,
                },
            },
        });
        const sessionUpdate = syncForTest.handleUpdate({
            id: 'session-update',
            seq: 12,
            createdAt: 120,
            body: {
                t: 'update-session',
                id: 'startup-session',
                metadata: { version: 4, value: 'metadata-ciphertext' },
                agentState: null,
            },
        });
        await Promise.resolve();

        expect(mocks.state.sessions['startup-session']).toBeUndefined();
        active.resolve([snapshot('startup-session')]);
        await Promise.all([bootstrapping, messageUpdate, sessionUpdate]);

        const encryption = syncForTest.encryption.getSessionEncryption('startup-session');
        expect(encryption.decryptMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'message-11' }));
        expect(encryption.decryptMetadata).toHaveBeenCalledWith(4, 'metadata-ciphertext');
        expect(mocks.state.sessions['startup-session']).toMatchObject({
            seq: 12,
            metadataVersion: 4,
            metadata: { name: 'Realtime title' },
        });
        expect(legacyAwait).not.toHaveBeenCalled();
        expect(legacyFetch).not.toHaveBeenCalled();
        onSessionVisible.mockRestore();
    });

    it('target-hydrates a startup realtime session once when active bootstrap does not contain it', async () => {
        const active = deferred<ApiSessionSnapshot[]>();
        const legacyAwait = vi.fn(async () => undefined);
        const legacyFetch = vi.fn();
        const onSessionVisible = vi.spyOn(syncForTest, 'onSessionVisible').mockImplementation(() => undefined);
        mocks.fetchActive.mockReturnValue(active.promise);
        mocks.fetchSnapshot.mockResolvedValue(snapshot('late-session'));
        syncForTest.sessionsSync = { awaitQueue: legacyAwait };
        syncForTest.fetchSessions = legacyFetch;

        const bootstrapping = syncForTest.bootstrapSessions();
        const handling = syncForTest.handleUpdate({
            id: 'late-session-update',
            seq: 8,
            createdAt: 80,
            body: {
                t: 'update-session',
                id: 'late-session',
                metadata: { version: 5, value: 'metadata-ciphertext' },
                agentState: null,
            },
        });
        await Promise.resolve();
        expect(mocks.fetchSnapshot).not.toHaveBeenCalled();

        active.resolve([]);
        await Promise.all([bootstrapping, handling]);

        expect(mocks.fetchSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.fetchSnapshot).toHaveBeenCalledWith(syncForTest.credentials, 'late-session');
        expect(mocks.state.sessions['late-session']).toMatchObject({
            seq: 8,
            metadataVersion: 5,
            metadata: { name: 'Realtime title' },
        });
        expect(legacyAwait).not.toHaveBeenCalled();
        expect(legacyFetch).not.toHaveBeenCalled();
        onSessionVisible.mockRestore();
    });
});

describe('deep-link session opening', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.sessions = {};
        mocks.state.sessionMessages = {};
        mocks.fetchSnapshot.mockResolvedValue(null);
        syncForTest.credentials = { token: 'test-token', secret: 'test-secret' };
        const sessionEncryptions = new Map<string, { decryptMessages: ReturnType<typeof vi.fn> }>();
        syncForTest.encryption = {
            getSessionEncryption: vi.fn((id: string) => sessionEncryptions.get(id) ?? null),
            removeSessionEncryption: vi.fn(),
        };
        mocks.hydrate.mockImplementation(async (snapshots: ApiSessionSnapshot[]) => {
            for (const item of snapshots) {
                sessionEncryptions.set(item.id, { decryptMessages: vi.fn(async () => []) });
            }
            return snapshots.map(hydrated);
        });
        syncForTest.sessionLastSeq.clear();
        syncForTest.sessionOldestSeq.clear();
        syncForTest.activeOpenSession = null;
    });

    it('starts the target snapshot and latest raw message transfers before either resolves', async () => {
        const target = deferred<ApiSessionSnapshot | null>();
        const latest = deferred<Response>();
        mocks.fetchSnapshot.mockReturnValue(target.promise);
        mocks.apiRequest.mockReturnValue(latest.promise);

        const opening = syncForTest.openSession('deep-session');
        await Promise.resolve();

        expect(mocks.fetchSnapshot).toHaveBeenCalledWith(syncForTest.credentials, 'deep-session');
        expect(mocks.apiRequest).toHaveBeenCalledWith(
            '/v3/sessions/deep-session/messages?before_seq=2147483647&limit=100',
        );
        target.resolve(snapshot('deep-session'));
        latest.resolve(response({
            messages: [
                { id: 'message-109', seq: 109, localId: null, createdAt: 109, updatedAt: 109, content: 'ciphertext' },
                { id: 'message-103', seq: 103, localId: null, createdAt: 103, updatedAt: 103, content: 'ciphertext' },
            ],
            hasMore: true,
        }));

        await expect(opening).resolves.toBe('ready');
        expect(syncForTest.getSessionLastMessageSeq('deep-session')).toBe(109);
        expect(syncForTest.sessionOldestSeq.get('deep-session')).toBe(103);
        expect(mocks.state.sessionMessages['deep-session']).toMatchObject({
            isLoaded: true,
            hasMoreOlder: true,
        });
        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    });

    it('returns not-found without falling back to the legacy session list', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        mocks.fetchSnapshot.mockResolvedValue(null);
        mocks.apiRequest.mockResolvedValue(response({ error: 'not found' }, 404));

        await expect(syncForTest.openSession('missing-session')).resolves.toBe('not-found');

        expect(fetchMock).not.toHaveBeenCalledWith(
            expect.stringMatching(/\/v1\/sessions$/),
            expect.anything(),
        );
    });

    it('rejects an abandoned route response before it can mark messages loaded', async () => {
        const latest = deferred<Response>();
        mocks.fetchSnapshot.mockResolvedValue(snapshot('abandoned-session'));
        mocks.apiRequest.mockReturnValue(latest.promise);

        const opening = syncForTest.openSession('abandoned-session');
        await vi.waitFor(() => {
            expect(mocks.state.sessions['abandoned-session']).toBeDefined();
        });
        syncForTest.abandonSessionRoute('abandoned-session', opening);
        latest.resolve(response({ messages: [], hasMore: false }));

        await expect(opening).rejects.toThrow('abandoned');
        expect(mocks.state.sessionMessages['abandoned-session']).toBeUndefined();
        expect(syncForTest.getSessionLastMessageSeq('abandoned-session')).toBeNull();
    });

    it('does not mutate session state when the route is abandoned before its snapshot resolves', async () => {
        const target = deferred<ApiSessionSnapshot | null>();
        mocks.fetchSnapshot.mockReturnValue(target.promise);
        mocks.apiRequest.mockResolvedValue(response({
            messages: [
                { id: 'message-4', seq: 4, localId: null, createdAt: 40, updatedAt: 40, content: 'ciphertext' },
            ],
            hasMore: true,
        }));

        const opening = syncForTest.openSession('cancelled-session');
        syncForTest.abandonSessionRoute('cancelled-session', opening);
        target.resolve(snapshot('cancelled-session'));

        await expect(opening).rejects.toThrow('abandoned');
        expect(mocks.state.sessions['cancelled-session']).toBeUndefined();
        expect(syncForTest.encryption.getSessionEncryption('cancelled-session')).toBeNull();
        expect(mocks.state.sessionMessages['cancelled-session']).toBeUndefined();
        expect(syncForTest.getSessionLastMessageSeq('cancelled-session')).toBeNull();
        expect(syncForTest.sessionOldestSeq.has('cancelled-session')).toBe(false);
    });

    it('does not let an old same-session cleanup cancel a newer open operation', async () => {
        const oldTarget = deferred<ApiSessionSnapshot | null>();
        const newLatest = deferred<Response>();
        mocks.fetchSnapshot
            .mockReturnValueOnce(oldTarget.promise)
            .mockResolvedValueOnce(snapshot('same-session'));
        mocks.apiRequest
            .mockResolvedValueOnce(response({ messages: [], hasMore: false }))
            .mockReturnValueOnce(newLatest.promise);

        const oldOpening = syncForTest.openSession('same-session');
        const newOpening = syncForTest.openSession('same-session');
        await vi.waitFor(() => {
            expect(mocks.state.sessions['same-session']).toBeDefined();
        });

        syncForTest.abandonSessionRoute('same-session', oldOpening);
        newLatest.resolve(response({ messages: [], hasMore: false }));

        await expect(newOpening).resolves.toBe('ready');
        oldTarget.resolve(snapshot('same-session', { seq: 1 }));
        await expect(oldOpening).rejects.toThrow('abandoned');
        expect(mocks.state.sessionMessages['same-session']).toMatchObject({ isLoaded: true });
    });
});
