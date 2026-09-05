import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiMessage, ApiSessionSnapshot } from './apiTypes';
import type { HydratedSession } from './sessionSnapshotHydration';
import { SessionMessageLoadGate } from './sessionMessageLoadGate';
import { SessionMessageRetention } from './sessionMessageRetention';
import { SessionRouteOwnership } from './sessionRouteOwnership';
import { SessionEncryption } from './encryption/sessionEncryption';
import { EncryptionCache } from './encryption/encryptionCache';

vi.hoisted(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    (globalThis as unknown as { expo?: { EventEmitter: unknown } }).expo = {
        EventEmitter: EventTarget,
    };
});

const mocks = vi.hoisted(() => {
    const state = {
        sessions: {} as Record<string, HydratedSession>,
        sessionMessages: {} as Record<string, any>,
        currentViewingSessionId: null as string | null,
        settings: { expImageUpload: false },
        mutableToolCalls: new Set<string>(),
        getActiveSessions: () => Object.values(state.sessions).filter((session) => session.active),
        applySessions: (sessions: HydratedSession[], options?: { replace?: boolean }) => {
            if (options?.replace) state.sessions = {};
            for (const session of sessions) state.sessions[session.id] = session;
        },
        applyMessages: (sessionId: string, messages: any[]) => {
            const existing = state.sessionMessages[sessionId] ?? {
                messages: [],
                messagesMap: {},
                reducerState: {},
                isLoaded: false,
                hasMoreOlder: false,
                isLoadingOlder: false,
            };
            const messagesMap = { ...existing.messagesMap };
            for (const message of messages) messagesMap[message.id] = message;
            state.sessionMessages[sessionId] = {
                ...existing,
                messagesMap,
                messages: Object.values(messagesMap),
                isLoaded: true,
            };
            return {
                changed: messages.map((message) => message.id),
                hasReadyEvent: messages.some((message) => (
                    message.role === 'event' && message.content?.type === 'ready'
                )),
            };
        },
        applyMessagesLoaded: (sessionId: string) => {
            state.sessionMessages[sessionId] = {
                ...(state.sessionMessages[sessionId] ?? {
                    messages: [],
                    messagesMap: {},
                    reducerState: {},
                    hasMoreOlder: false,
                    isLoadingOlder: false,
                }),
                isLoaded: true,
            };
        },
        applyOlderMessagesPagination: (sessionId: string, info: { hasMore: boolean }) => {
            const existing = state.sessionMessages[sessionId];
            if (existing) existing.hasMoreOlder = info.hasMore;
        },
        applyOlderMessagesLoading: (sessionId: string, loading: boolean) => {
            const existing = state.sessionMessages[sessionId];
            if (existing) existing.isLoadingOlder = loading;
        },
        isMutableToolCall: (sessionId: string, callId: string) => (
            state.mutableToolCalls.has(`${sessionId}:${callId}`)
        ),
    };
    const storage = {
        getState: () => realStorage ? realStorage.getState() : state,
        setState: (update: any) => {
            if (realStorage) return realStorage.setState(update);
            const next = typeof update === 'function' ? update(state) : update;
            Object.assign(state, next);
        },
    };
    let realStorage: any = null;
    return {
        useRealStorage: (value: any) => { realStorage = value; },
        apiRequest: vi.fn(),
        fetchActive: vi.fn(),
        fetchPage: vi.fn(),
        fetchSnapshot: vi.fn(),
        hydrate: vi.fn(),
        hydrateRoute: vi.fn(),
        sessionEncryptions: new Map<string, any>(),
        runtimeEvents: [] as Array<{ stage: string; sessionId?: string }>,
        gitInvalidate: vi.fn(),
        gitOpenInvalidate: vi.fn(),
        gitClear: vi.fn(),
        state,
        storage,
    };
});

vi.mock('./apiSessions', () => ({
    fetchActiveSessionSnapshots: mocks.fetchActive,
    fetchSessionSnapshot: mocks.fetchSnapshot,
    fetchSessionSnapshotPage: mocks.fetchPage,
}));
vi.mock('./sessionSnapshotHydration', () => ({
    hydrateSessionSnapshotForRoute: mocks.hydrateRoute,
    hydrateSessionSnapshots: mocks.hydrate,
}));
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
vi.mock('./gitStatusSync', () => ({
    gitStatusSync: {
        invalidate: mocks.gitInvalidate,
        getSync: vi.fn(() => ({ invalidate: mocks.gitOpenInvalidate })),
        clearForSession: mocks.gitClear,
    },
}));
vi.mock('./pushRegistration', () => ({ syncCurrentPushToken: vi.fn() }));
vi.mock('./sessionStartupTraceRuntime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./sessionStartupTraceRuntime')>();
    return {
        ...actual,
        sessionStartupTraceRuntime: actual.createWebStartupTraceRuntime((event) => mocks.runtimeEvents.push(event as { stage: string; sessionId?: string })),
    };
});
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
vi.mock('expo', () => ({}));
vi.mock('expo-modules-core', () => ({ Platform: { OS: 'web' }, requireNativeModule: () => ({}), requireOptionalNativeModule: () => ({}) }));
vi.mock('@/realtime/RealtimeSession', () => ({ getCurrentRealtimeSessionId: () => null, getVoiceSession: () => null }));
vi.mock('@/components/tools/knownTools', () => ({ isMutableTool: () => false }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'test-uuid') }));
vi.mock('expo-secure-store', () => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
}));

import { sync } from './sync';
import { sessionStartupTraceRuntime } from './sessionStartupTraceRuntime';

const syncForTest = sync as any;

function snapshot(id: string, seq = 3): ApiSessionSnapshot {
    return {
        id,
        seq,
        metadata: `metadata-${id}`,
        metadataVersion: seq,
        agentState: null,
        agentStateVersion: 0,
        dataEncryptionKey: `key-${id}`,
        active: true,
        activeAt: seq * 10,
        createdAt: 10,
        updatedAt: seq * 10,
    };
}

function hydrated(raw: ApiSessionSnapshot): HydratedSession {
    return {
        ...raw,
        metadata: { path: `/${raw.id}`, host: 'test', name: raw.metadata } as any,
        agentState: null,
        thinking: false,
        thinkingAt: 0,
    };
}

function response(body: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { promise, resolve, reject };
}

function rawText(text: string) {
    return { role: 'user', content: { type: 'text', text } } as const;
}

function rawToolResult(uuid: string) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'user',
                uuid,
                message: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'done' }],
                },
            },
        },
    } as const;
}

function apiMessage(seq: number, content: unknown = 'ciphertext'): ApiMessage {
    return {
        id: `message-${seq}`,
        seq,
        localId: null,
        content: { t: 'encrypted', c: String(content) },
        createdAt: seq * 10,
        updatedAt: seq * 10,
    };
}

function newMessageUpdate(sessionId: string, seq: number) {
    return {
        id: `update-${sessionId}-${seq}`,
        seq,
        createdAt: seq * 10,
        body: {
            t: 'new-message',
            sid: sessionId,
            message: apiMessage(seq),
        },
    };
}

function installSession(sessionId: string, decryptMessages?: (messages: ApiMessage[]) => Promise<any[]>) {
    mocks.state.sessions[sessionId] = hydrated(snapshot(sessionId));
    const encryption: any = {
        createDetached() { return this; },
        decryptMessage: vi.fn(async (message: ApiMessage) => ({
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            content: rawText(`realtime-${message.seq}`),
        })),
        decryptMessages: vi.fn(decryptMessages ?? (async (messages: ApiMessage[]) => messages.map((message) => ({
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            content: rawText(`fetched-${message.seq}`),
        })))),
        decryptAgentState: vi.fn(async () => ({ controlledByUser: false, requests: {} })),
        decryptMetadata: vi.fn(async () => ({ name: sessionId })),
    };
    mocks.sessionEncryptions.set(sessionId, encryption);
    return encryption;
}

async function useRealMessageComposition() {
    const [{ storage }, { Encryption }] = await Promise.all([
        vi.importActual<typeof import('./storage')>('./storage'),
        vi.importActual<typeof import('./encryption/encryption')>('./encryption/encryption'),
    ]);
    storage.setState({ sessions: {}, sessionMessages: {}, currentViewingSessionId: null });
    mocks.useRealStorage(storage);
    // Initialize the real manager's runtime caches without deriving device keys.
    // SessionEncryption below holds only the byte crypto boundary for interleaving.
    syncForTest.encryption = Object.assign(Object.create(Encryption.prototype), {
        sessionEncryptions: mocks.sessionEncryptions,
        sessionBlobKeys: new Map(),
        cache: new EncryptionCache(),
    });
    return storage;
}

async function seedDisconnectedMessageRanges() {
    const storage = await useRealMessageComposition();
    storage.getState().applySessions([hydrated(snapshot('range-session', 250))]);
    mocks.sessionEncryptions.set('range-session', new SessionEncryption('range-session', {
        encrypt: async () => [],
        decrypt: async (bytes) => bytes.map(value => rawText(`message-${value[0]}`)),
    }, new EncryptionCache()));
    const page = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => ({
        ...apiMessage(min + i),
        content: { t: 'encrypted' as const, c: Buffer.from([min + i]).toString('base64') },
    }));
    const lease = syncForTest.sessionMessageLoadGate.enter('range-session');
    await syncForTest.applyLatestMessagePage('range-session', { messages: page(1, 100), hasMore: false },
        syncForTest.sessionMessageLoadGate.begin(lease));
    await syncForTest.applyLatestMessagePage('range-session', { messages: page(151, 250), hasMore: true },
        syncForTest.sessionMessageLoadGate.begin(lease));
    return { storage, page, lease };
}

describe('message visibility synchronization', () => {
    beforeEach(() => {
        mocks.useRealStorage(null);
        syncForTest.sessionEventCursors.clear();
        syncForTest.sessionHydrations.clear();
        syncForTest.inFlightSessionRefreshes.clear();
        syncForTest.sessionDeletionMutationGenerations.clear();
        vi.clearAllMocks();
        mocks.state.sessions = {};
        mocks.state.sessionMessages = {};
        mocks.state.currentViewingSessionId = null;
        mocks.state.mutableToolCalls.clear();
        mocks.sessionEncryptions.clear();
        mocks.runtimeEvents = [];
        mocks.apiRequest.mockResolvedValue(response({ messages: [], hasMore: false }));
        mocks.fetchSnapshot.mockResolvedValue(null);
        mocks.hydrate.mockImplementation(async (items: ApiSessionSnapshot[]) => items.map(hydrated));
        mocks.hydrateRoute.mockImplementation(async (raw: ApiSessionSnapshot) => ({
            session: hydrated(raw),
            commitEncryption: () => true,
        }));
        syncForTest.credentials = { token: 'test-token', secret: 'test-secret' };
        syncForTest.encryption = {
            getSessionEncryption: vi.fn((id: string) => mocks.sessionEncryptions.get(id) ?? null),
            removeSessionEncryption: vi.fn(),
        };
        syncForTest.messagesSync = new Map();
        syncForTest.sessionMessageFrontiers = new Map();
        syncForTest.sessionCachedMessageSeqs = new Map();
        syncForTest.sessionMessageLocks = new Map();
        syncForTest.sessionMessageQueue = new Map();
        syncForTest.sessionQueueProcessing = new Set();
        syncForTest.sessionOlderLoadingTokens = new Map();
        syncForTest.sessionMessageCacheGenerations = new Map();
        syncForTest.sessionMessageLoadGate = new SessionMessageLoadGate();
        syncForTest.sessionMessageRetention = new SessionMessageRetention(3);
        syncForTest.activeOpenSession = null;
        syncForTest.sessionRouteOwnership = new SessionRouteOwnership();
    });

    afterEach(() => {
        mocks.useRealStorage(null);
        for (const messageSync of syncForTest.messagesSync.values()) {
            messageSync.stop();
        }
    });

    it('reaches a gap between cached history and the latest page exactly once', async () => {
        const { storage, page } = await seedDisconnectedMessageRanges();
        expect(Object.keys(storage.getState().sessionMessages['range-session'].messagesMap)).toHaveLength(200);
        mocks.apiRequest.mockResolvedValue(response({ messages: page(51, 150), hasMore: true }));

        await syncForTest.loadOlderMessages('range-session');

        expect(mocks.apiRequest).toHaveBeenCalledWith('/v3/sessions/range-session/messages?before_seq=151&limit=100');
        const ids = storage.getState().sessionMessages['range-session'].messages.map(message => message.id);
        expect(ids).toHaveLength(250);
        expect(new Set(ids).size).toBe(250);
        const normalizedIds = [...storage.getState().sessionMessages['range-session'].reducerState.messageIds.keys()];
        expect(normalizedIds.sort()).toEqual(Array.from({ length: 250 }, (_, i) => `message-${i + 1}`).sort());
        expect(storage.getState().sessionMessages['range-session'].hasMoreOlder).toBe(false);
        expect(syncForTest.getSessionLastMessageSeq('range-session')).toBe(250);
        await syncForTest.loadOlderMessages('range-session');
        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    });

    it.each(['superseded', 'evicted', 'deleted'] as const)(
        'rejects a %s older response before bridging cached ranges', async (terminal) => {
            const { storage, page, lease } = await seedDisconnectedMessageRanges();
            const olderPage = deferred<Response>();
            mocks.apiRequest.mockReturnValueOnce(olderPage.promise);
            const loading = syncForTest.loadOlderMessages('range-session');
            await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
                '/v3/sessions/range-session/messages?before_seq=151&limit=100',
            ));
            if (terminal === 'superseded') {
                await syncForTest.applyLatestMessagePage('range-session', { messages: page(151, 250), hasMore: true },
                    syncForTest.sessionMessageLoadGate.begin(lease));
            } else if (terminal === 'evicted') {
                syncForTest.releaseSessionMessageCache('range-session');
            } else {
                await syncForTest.handleUpdate({ id: 'delete-range', seq: 9000, createdAt: 9000,
                    body: { t: 'delete-session', sid: 'range-session' } });
            }
            olderPage.resolve(response({ messages: page(51, 150), hasMore: true }));
            await loading;
            if (terminal === 'superseded') {
                expect(syncForTest.sessionMessageFrontiers.get('range-session')).toEqual({
                    latestSeq: 250, olderBeforeSeq: 151, hasMoreOlder: true,
                });
                expect(storage.getState().sessionMessages['range-session'].messages).toHaveLength(200);
                expect(storage.getState().sessionMessages['range-session'].isLoadingOlder).toBe(false);
                expect(syncForTest.sessionCachedMessageSeqs.get('range-session').has(101)).toBe(false);
            } else {
                expect(storage.getState().sessionMessages['range-session']).toBeUndefined();
                expect(syncForTest.sessionMessageFrontiers.has('range-session')).toBe(false);
                expect(syncForTest.sessionCachedMessageSeqs.has('range-session')).toBe(false);
            }
        },
    );

    it('does not let a send acknowledgement bridge an unseen message gap', async () => {
        const { page, lease } = await seedDisconnectedMessageRanges();
        syncForTest.pendingOutbox.set('range-session', [{ localId: 'sent-message', content: 'ciphertext' }]);
        mocks.apiRequest.mockResolvedValueOnce(response({ messages: [{ seq: 350 }] }));
        await syncForTest.flushOutbox('range-session');
        await syncForTest.applyLatestMessagePage('range-session', { messages: page(301, 400), hasMore: true },
            syncForTest.sessionMessageLoadGate.begin(lease));
        mocks.apiRequest.mockResolvedValueOnce(response({ messages: page(201, 300), hasMore: true }));

        await syncForTest.loadOlderMessages('range-session');

        expect(mocks.apiRequest).toHaveBeenLastCalledWith('/v3/sessions/range-session/messages?before_seq=301&limit=100');
        expect(syncForTest.getSessionLastMessageSeq('range-session')).toBe(400);
    });

    it.each([
        { order: 'latest-first', cold: false, terminal: '' },
        { order: 'catch-up-first', cold: false, terminal: '' },
        { order: 'latest-first', cold: true, terminal: '' },
        { order: 'catch-up-first', cold: true, terminal: '' },
        { order: 'latest-first', cold: false, terminal: 'abandoned' },
        { order: 'catch-up-first', cold: false, terminal: 'deleted' },
    ])(
        'waits for a committed foreground page while opening ($order, cold=$cold, terminal=$terminal)', async ({ order, cold, terminal }) => {
            // Real storage/reducer + SessionEncryption; only the byte decrypt boundary is held.
            const storage = await useRealMessageComposition();
            storage.getState().applySessions([hydrated(snapshot('opening-session'))]);
            if (!cold) syncForTest.sessionMessageFrontiers.set('opening-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
            const latestDecrypt = deferred<void>();
            const forwardDecrypt = deferred<void>();
            let latestStarted = false;
            let forwardStarted = false;
            const encryption = new SessionEncryption('opening-session', {
                encrypt: async () => [],
                decrypt: async (bytes) => {
                    const seqs = bytes.map(value => value[0]);
                    if (seqs[0] === 7) {
                        if (!latestStarted) { latestStarted = true; await latestDecrypt.promise; }
                        else { forwardStarted = true; await forwardDecrypt.promise; }
                    }
                    if (seqs[0] === 5) { forwardStarted = true; await forwardDecrypt.promise; }
                    return seqs.map(seq => rawText(`message-${seq}`));
                },
            }, new EncryptionCache());
            mocks.sessionEncryptions.set('opening-session', encryption);
            const encrypted = (seq: number, id = `message-${seq}`): ApiMessage => ({
                ...apiMessage(seq), id,
                content: { t: 'encrypted', c: Buffer.from([seq]).toString('base64') },
            });
            let latestRequests = 0;
            mocks.apiRequest.mockImplementation(async (url: string) => {
                if (url.includes('before_seq=')) {
                    latestRequests++;
                    return response({ messages: [encrypted(7)], hasMore: true });
                }
                return response({ messages: [encrypted(5), encrypted(9, 'latest-visible-message')], hasMore: false });
            });
            const oldOwner = syncForTest.beginSessionRoute('opening-session');
            const owner = syncForTest.beginSessionRoute('opening-session');
            let outcome = 'pending';
            const opening = syncForTest.openSession('opening-session', owner);
            void opening.then((value: string) => { outcome = value; }, () => { outcome = 'rejected'; });
            await vi.waitFor(() => expect(latestStarted).toBe(true));
            const event = newMessageUpdate('opening-session', 9);
            event.body.message = encrypted(9);
            await syncForTest.handleUpdate(event);
            // Without opening ownership realtime drops this cache as background.
            await vi.waitFor(() => expect(forwardStarted).toBe(true));
            expect(storage.getState().currentViewingSessionId).toBeNull();
            // A cleanup belonging to the previous same-ID mount cannot stop this catch-up.
            expect(syncForTest.leaveSessionRoute(oldOwner)).toBe(false);
            const foregroundSync = syncForTest.messagesSync.get('opening-session');
            if (terminal === 'abandoned') syncForTest.leaveSessionRoute(owner);
            if (terminal === 'deleted') {
                await syncForTest.handleUpdate({ id: 'delete', seq: 10, createdAt: 100, body: { t: 'delete-session', sid: 'opening-session' } });
                expect(syncForTest.promoteSessionRoute(owner)).toBeNull();
            }
            if (order === 'latest-first') {
                latestDecrypt.resolve();
                await new Promise(resolve => setTimeout(resolve, 0));
                if (!terminal) expect(outcome).toBe('pending');
                forwardDecrypt.resolve();
            } else {
                forwardDecrypt.resolve();
                await foregroundSync.awaitQueue();
                latestDecrypt.resolve();
            }
            if (terminal) {
                await expect(opening).rejects.toThrow('abandoned');
                await foregroundSync.awaitQueue();
                expect(outcome).toBe('rejected');
                if (terminal === 'deleted') {
                    expect(storage.getState().sessionMessages['opening-session']).toBeUndefined();
                    expect(syncForTest.getSessionLastMessageSeq('opening-session')).toBeNull();
                }
                return;
            }
            await expect(opening).resolves.toBe('ready');
            expect(latestRequests).toBe(1);
            expect(storage.getState().sessionMessages['opening-session'].isLoaded).toBe(true);
            expect(storage.getState().sessionMessages['opening-session'].messages).toContainEqual(
                expect.objectContaining({ kind: 'user-text', text: 'message-9' }),
            );
            expect(storage.getState().sessionMessages['opening-session'].reducerState.messageIds.has('latest-visible-message')).toBe(true);
            expect(storage.getState().currentViewingSessionId).toBeNull();
        },
    );

    it.each(['ready', 'exhausted', 'abandoned', 'deleted', 'abandoned-network', 'deleted-network'] as const)(
        'bounds latest-page recovery under the same live owner (%s)', async (result) => {
            const storage = await useRealMessageComposition();
            storage.getState().applySessions([hydrated(snapshot('recovering-session'))]);
            syncForTest.sessionMessageFrontiers.set('recovering-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
            const latestDecrypt = deferred<void>();
            const forwardDecrypt = deferred<void>();
            const recoveryPage = deferred<Response>();
            let latestStarted = false;
            let forwardStarted = false;
            const encryption = new SessionEncryption('recovering-session', {
                encrypt: async () => [],
                decrypt: async (bytes) => {
                    const seqs = bytes.map(value => value[0]);
                    if (seqs[0] === 7) { latestStarted = true; await latestDecrypt.promise; }
                    if (seqs[0] === 8) { forwardStarted = true; await forwardDecrypt.promise; }
                    return seqs.map(seq => rawText(`message-${seq}`));
                },
            }, new EncryptionCache());
            mocks.sessionEncryptions.set('recovering-session', encryption);
            const encrypted = (seq: number): ApiMessage => ({
                ...apiMessage(seq), content: { t: 'encrypted', c: Buffer.from([seq]).toString('base64') },
            });
            let latestRequests = 0;
            mocks.apiRequest.mockImplementation((url: string) => {
                if (url.includes('before_seq=')) {
                    latestRequests++;
                    return latestRequests === 1
                        ? Promise.resolve(response({ messages: [encrypted(7)], hasMore: true }))
                        : recoveryPage.promise;
                }
                return Promise.resolve(response({ messages: url.includes('after_seq=4&') ? [encrypted(8)] : [], hasMore: false }));
            });
            const owner = syncForTest.beginSessionRoute('recovering-session');
            const opening = syncForTest.openSession('recovering-session', owner);
            const operation = syncForTest.activeOpenSession;
            const lease = syncForTest.sessionMessageLoadGate.currentLease('recovering-session');
            let outcome = 'pending';
            void opening.then(() => { outcome = 'ready'; }, () => { outcome = 'rejected'; });
            await vi.waitFor(() => expect(latestStarted).toBe(true));
            const update = newMessageUpdate('recovering-session', 9);
            update.body.message = encrypted(9);
            await syncForTest.handleUpdate(update);
            await vi.waitFor(() => expect(forwardStarted).toBe(true));
            latestDecrypt.resolve();
            forwardDecrypt.resolve();
            await vi.waitFor(() => expect(latestRequests).toBe(2));
            expect(outcome).toBe('pending');
            expect(syncForTest.sessionRouteOwnership.current()).toBe(owner);
            expect(syncForTest.activeOpenSession).toBe(operation);
            expect(syncForTest.sessionMessageLoadGate.currentLease('recovering-session')).toBe(lease);
            expect(storage.getState().currentViewingSessionId).toBeNull();
            if (result.startsWith('abandoned')) syncForTest.leaveSessionRoute(owner);
            if (result.startsWith('deleted')) {
                await syncForTest.handleUpdate({ id: 'delete', seq: 10, createdAt: 100, body: { t: 'delete-session', sid: 'recovering-session' } });
            }
            if (result.endsWith('-network')) recoveryPage.reject(new Error('recovery network unavailable'));
            else recoveryPage.resolve(response({ messages: [encrypted(result === 'exhausted' ? 8 : 9)], hasMore: false }));
            if (result === 'ready') {
                await expect(opening).resolves.toBe('ready');
                expect(storage.getState().sessionMessages['recovering-session'].messages).toContainEqual(
                    expect.objectContaining({ kind: 'user-text', text: 'message-9' }),
                );
            } else if (result === 'exhausted') {
                await expect(opening).rejects.toMatchObject({ name: 'SessionRouteCoordinationError' });
            } else {
                await expect(opening).rejects.toThrow('abandoned');
                expect(storage.getState().sessionMessages['recovering-session']?.reducerState.messageIds.has('message-9')).not.toBe(true);
            }
            if (result === 'ready' || result === 'exhausted') {
                expect(syncForTest.sessionRouteOwnership.current()).toBe(owner);
                expect(syncForTest.activeOpenSession).toBe(operation);
            }
            expect(latestRequests).toBe(2);
            expect(storage.getState().currentViewingSessionId).toBeNull();
        },
    );

    it('does not fetch messages or git for an off-screen new-message event', async () => {
        installSession('visible-session');
        installSession('background-session');
        mocks.state.currentViewingSessionId = 'visible-session';

        await syncForTest.handleUpdate(newMessageUpdate('background-session', 8));
        await Promise.resolve();

        expect(mocks.apiRequest).not.toHaveBeenCalled();
        expect(mocks.gitInvalidate).not.toHaveBeenCalled();
        expect(mocks.gitOpenInvalidate).not.toHaveBeenCalled();
        expect(mocks.state.sessions['background-session']).toMatchObject({ updatedAt: 80, seq: 8 });
    });

    it('clears viewing on deletion even after route ownership is revoked', async () => {
        const storage = await useRealMessageComposition();
        const encryption = new SessionEncryption('deleted-route', {
            encrypt: async () => [], decrypt: async () => [],
        }, new EncryptionCache());
        mocks.sessionEncryptions.set('deleted-route', encryption);
        storage.getState().applySessions([hydrated(snapshot('deleted-route'))]);
        const owner = syncForTest.beginSessionRoute('deleted-route');
        await syncForTest.openSession('deleted-route', owner);
        syncForTest.promoteSessionRoute(owner);
        storage.getState().setCurrentViewingSession('deleted-route');
        await syncForTest.handleUpdate({ id: 'delete', seq: 10, createdAt: 100, body: { t: 'delete-session', sid: 'deleted-route' } });
        expect(syncForTest.leaveSessionRoute(owner)).toBe(false);
        expect(storage.getState().currentViewingSessionId).toBeNull();
    });

    it('appends a consecutive visible message without an HTTP refresh', async () => {
        installSession('visible-session');
        mocks.state.currentViewingSessionId = 'visible-session';
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 5));
        await vi.waitFor(() => {
            expect(mocks.state.sessionMessages['visible-session']?.messagesMap['message-5']).toBeDefined();
        });

        expect(mocks.apiRequest).not.toHaveBeenCalled();
        expect(syncForTest.getSessionLastMessageSeq('visible-session')).toBe(5);
    });

    it('marks only processor readiness for a normalized encrypted ready event', async () => {
        // Catches a terminal lifecycle event being mistaken for startup processor readiness.
        const encryption = installSession('trace-session');
        mocks.state.currentViewingSessionId = 'trace-session';
        syncForTest.sessionMessageFrontiers.set('trace-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        const handle = sessionStartupTraceRuntime.begin('00000000-0000-4000-8000-000000000010', 0);
        sessionStartupTraceRuntime.bindSession(handle, 'trace-session');
        encryption.decryptMessage.mockResolvedValue({
            id: 'message-5',
            localId: null,
            createdAt: 50,
            content: {
                role: 'agent',
                content: {
                    type: 'event',
                    id: 'processor-ready',
                    data: { type: 'ready' },
                },
            },
        });

        await syncForTest.handleUpdate(newMessageUpdate('trace-session', 5));
        await vi.waitFor(() => {
            expect(mocks.runtimeEvents.map((event) => event.stage)).toContain('web.processor.ready_received');
        });
        expect(mocks.runtimeEvents.map((event) => event.stage)).not.toContain('web.turn.completed');

        await syncForTest.handleUpdate(newMessageUpdate('trace-session', 6));
        expect(mocks.runtimeEvents.filter((event) => event.stage === 'web.processor.ready_received')).toHaveLength(1);
        sessionStartupTraceRuntime.finish(handle);
    });

    it('marks turn completion without consuming a processor-ready milestone', async () => {
        // Catches a terminal turn-end falsely satisfying processor-ready startup latency.
        const encryption = installSession('terminal-session');
        mocks.state.currentViewingSessionId = 'terminal-session';
        syncForTest.sessionMessageFrontiers.set('terminal-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        const handle = sessionStartupTraceRuntime.begin('00000000-0000-4000-8000-000000000011', 0);
        sessionStartupTraceRuntime.bindSession(handle, 'terminal-session');
        encryption.decryptMessage.mockResolvedValue({
            id: 'message-5',
            localId: null,
            createdAt: 50,
            content: {
                role: 'agent',
                content: {
                    type: 'session',
                    data: {
                        id: 'turn-end-envelope',
                        time: 50,
                        role: 'agent',
                        turn: 'turn-1',
                        ev: { t: 'turn-end', status: 'completed' },
                    },
                },
            },
        });

        await syncForTest.handleUpdate(newMessageUpdate('terminal-session', 5));
        await vi.waitFor(() => {
            expect(mocks.runtimeEvents.map((event) => event.stage)).toContain('web.turn.completed');
        });
        expect(mocks.runtimeEvents.map((event) => event.stage)).not.toContain('web.processor.ready_received');
    });

    it('fills one sequence gap only for the visible session', async () => {
        installSession('visible-session');
        mocks.state.currentViewingSessionId = 'visible-session';
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        mocks.apiRequest.mockResolvedValue(response({
            messages: [apiMessage(5), apiMessage(6), apiMessage(7)],
            hasMore: false,
        }));

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 7));
        await vi.waitFor(() => {
            expect(mocks.state.sessionMessages['visible-session']?.messagesMap['message-7']).toBeDefined();
        });

        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
        expect(mocks.apiRequest).toHaveBeenCalledWith(
            '/v3/sessions/visible-session/messages?after_seq=4&limit=100',
        );
    });

    it('coalesces concurrent visible gaps into one forward operation', async () => {
        installSession('visible-session');
        mocks.state.currentViewingSessionId = 'visible-session';
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        const firstPage = deferred<Response>();
        mocks.apiRequest
            .mockReturnValueOnce(firstPage.promise)
            .mockResolvedValue(response({ messages: [], hasMore: false }));

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 7));
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 8));
        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);

        firstPage.resolve(response({
            messages: [apiMessage(5), apiMessage(6), apiMessage(7), apiMessage(8)],
            hasMore: false,
        }));
        await syncForTest.messagesSync.get('visible-session').awaitQueue();

        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
        expect(syncForTest.getSessionLastMessageSeq('visible-session')).toBe(8);
    });

    it('runs one follow-up forward operation when an in-flight response misses a newer gap target', async () => {
        installSession('visible-session');
        mocks.state.currentViewingSessionId = 'visible-session';
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        const firstPage = deferred<Response>();
        mocks.apiRequest
            .mockReturnValueOnce(firstPage.promise)
            .mockResolvedValueOnce(response({ messages: [apiMessage(8)], hasMore: false }));

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 7));
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 8));
        firstPage.resolve(response({
            messages: [apiMessage(5), apiMessage(6), apiMessage(7)],
            hasMore: false,
        }));

        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(2));
        await syncForTest.messagesSync.get('visible-session').awaitQueue();

        expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
        expect(mocks.apiRequest).toHaveBeenNthCalledWith(
            2,
            '/v3/sessions/visible-session/messages?after_seq=7&limit=100',
        );
        expect(mocks.state.sessionMessages['visible-session']?.messagesMap['message-8']).toBeDefined();
        expect(syncForTest.getSessionLastMessageSeq('visible-session')).toBe(8);
    });

    it.each([
        ['equal duplicate', 8],
        ['lower out-of-order', 7],
    ])('ignores a visible %s without history or git refresh', async (_label, incomingSeq) => {
        installSession('visible-session');
        mocks.state.currentViewingSessionId = 'visible-session';
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 8, olderBeforeSeq: null, hasMoreOlder: false });

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', incomingSeq));
        await Promise.resolve();

        expect(mocks.apiRequest).not.toHaveBeenCalled();
        expect(mocks.gitInvalidate).not.toHaveBeenCalled();
        expect(syncForTest.getSessionLastMessageSeq('visible-session')).toBe(8);
        expect(mocks.state.sessionMessages['visible-session']).toBeUndefined();
    });

    it('keeps the newest realtime anchor when an older forward page returns later', async () => {
        installSession('visible-session');
        mocks.state.currentViewingSessionId = 'visible-session';
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        const page = deferred<Response>();
        mocks.apiRequest
            .mockReturnValueOnce(page.promise)
            .mockResolvedValue(response({ messages: [], hasMore: false }));

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 7));
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 5));
        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 6));
        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 7));
        page.resolve(response({ messages: [apiMessage(5)], hasMore: false }));
        await syncForTest.messagesSync.get('visible-session').awaitQueue();

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 8));
        await Promise.resolve();

        expect(syncForTest.getSessionLastMessageSeq('visible-session')).toBe(8);
        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    });

    it('does not fill a background gap and releases only its message cache', async () => {
        installSession('visible-session');
        const backgroundEncryption = installSession('background-session');
        mocks.state.currentViewingSessionId = 'visible-session';
        mocks.state.sessionMessages['background-session'] = {
            messages: [{ id: 'cached' }],
            messagesMap: { cached: { id: 'cached' } },
            isLoaded: true,
            hasMoreOlder: true,
            isLoadingOlder: false,
        };
        syncForTest.sessionMessageFrontiers.set('background-session', { latestSeq: 4, olderBeforeSeq: 2, hasMoreOlder: true });

        await syncForTest.handleUpdate(newMessageUpdate('background-session', 7));
        await Promise.resolve();

        expect(mocks.apiRequest).not.toHaveBeenCalled();
        expect(mocks.state.sessionMessages['background-session']).toBeUndefined();
        expect(syncForTest.getSessionLastMessageSeq('background-session')).toBeNull();
        expect(syncForTest.sessionMessageFrontiers.has('background-session')).toBe(false);
        expect(mocks.state.sessions['background-session']).toBeDefined();
        expect(syncForTest.encryption.getSessionEncryption('background-session')).toBe(backgroundEncryption);
    });

    it('refreshes git for a mutable tool result only while its session is visible', async () => {
        const visibleEncryption = installSession('visible-session');
        const backgroundEncryption = installSession('background-session');
        visibleEncryption.decryptMessage.mockImplementation(async (message: ApiMessage) => ({
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            content: rawToolResult('uuid-visible-session'),
        }));
        backgroundEncryption.decryptMessage.mockImplementation(async (message: ApiMessage) => ({
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            content: rawToolResult('uuid-background-session'),
        }));
        mocks.state.mutableToolCalls.add('visible-session:call-1');
        mocks.state.mutableToolCalls.add('background-session:call-1');
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        syncForTest.sessionMessageFrontiers.set('background-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        mocks.state.currentViewingSessionId = 'visible-session';

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 5));
        await syncForTest.handleUpdate(newMessageUpdate('background-session', 5));

        expect(mocks.gitInvalidate).toHaveBeenCalledTimes(1);
        expect(mocks.gitInvalidate).toHaveBeenCalledWith('visible-session');
    });

    it('refreshes git once when a visible gap contains a fetched mutable tool result', async () => {
        installSession('visible-session', async (messages) => messages.map((message) => ({
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            content: message.seq === 5 ? rawToolResult('uuid-gap-tool') : rawText(`fetched-${message.seq}`),
        })));
        mocks.state.currentViewingSessionId = 'visible-session';
        mocks.state.mutableToolCalls.add('visible-session:call-1');
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        mocks.apiRequest.mockResolvedValue(response({
            messages: [apiMessage(5), apiMessage(6), apiMessage(7)],
            hasMore: false,
        }));

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 7));
        await vi.waitFor(() => {
            expect(mocks.state.sessionMessages['visible-session']?.messagesMap['message-7']).toBeDefined();
        });

        expect(mocks.gitInvalidate).toHaveBeenCalledTimes(1);
        expect(mocks.gitInvalidate).toHaveBeenCalledWith('visible-session');
    });

    it('refreshes git once when a later forward page fails after a mutable page was applied', async () => {
        installSession('visible-session', async (messages) => messages.map((message) => ({
            id: message.id,
            localId: message.localId,
            createdAt: message.createdAt,
            content: rawToolResult(`uuid-partial-${message.seq}`),
        })));
        mocks.state.currentViewingSessionId = 'visible-session';
        mocks.state.mutableToolCalls.add('visible-session:call-1');
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        mocks.apiRequest
            .mockResolvedValueOnce(response({ messages: [apiMessage(5)], hasMore: true }))
            .mockRejectedValueOnce(new Error('second page unavailable'));

        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 7));
        const messageSync = syncForTest.messagesSync.get('visible-session');
        try {
            await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(2));

            expect(mocks.state.sessionMessages['visible-session']?.messagesMap['message-5']).toBeDefined();
            expect(syncForTest.getSessionLastMessageSeq('visible-session')).toBe(5);
            expect(mocks.gitInvalidate).toHaveBeenCalledTimes(1);
        } finally {
            syncForTest.releaseSessionMessageCache('visible-session');
            await messageSync.awaitQueue();
        }
    });

    it('does not refresh git for an agent-state update without message tool-result semantics', async () => {
        installSession('visible-session');
        mocks.state.currentViewingSessionId = 'visible-session';

        await syncForTest.handleUpdate({
            id: 'agent-state-update',
            seq: 8,
            createdAt: 80,
            body: {
                t: 'update-session',
                id: 'visible-session',
                metadata: null,
                agentState: { version: 8, value: 'agent-state-ciphertext' },
            },
        });

        expect(mocks.gitInvalidate).not.toHaveBeenCalled();
    });

    it('refreshes git when the user explicitly opens a session', () => {
        installSession('visible-session');

        syncForTest.onSessionVisible('visible-session', { loadMessages: false });

        expect(mocks.gitOpenInvalidate).toHaveBeenCalledTimes(1);
    });

    it('evicts exactly the least recently viewed message cache and all of its message runtime', () => {
        installSession('session-a');
        const evictedEncryption = installSession('session-b');
        installSession('session-c');
        installSession('session-d');
        for (const sessionId of ['session-a', 'session-b', 'session-c', 'session-d']) {
            mocks.state.sessionMessages[sessionId] = { messages: [], messagesMap: {}, isLoaded: true };
            syncForTest.sessionMessageFrontiers.set(sessionId, { latestSeq: 9, olderBeforeSeq: 2, hasMoreOlder: true });
            syncForTest.sessionMessageLocks.set(sessionId, {});
            syncForTest.sessionMessageQueue.set(sessionId, []);
        }
        const evictedLease = syncForTest.sessionMessageLoadGate.enter('session-b');
        const evictedOperation = syncForTest.sessionMessageLoadGate.begin(evictedLease);
        const evictedSync = { stop: vi.fn() };
        syncForTest.messagesSync.set('session-b', evictedSync);
        syncForTest.sessionQueueProcessing.add('session-b');

        syncForTest.onSessionVisible('session-a', { loadMessages: false });
        syncForTest.onSessionVisible('session-b', { loadMessages: false });
        syncForTest.onSessionVisible('session-c', { loadMessages: false });
        syncForTest.onSessionVisible('session-a', { loadMessages: false });
        syncForTest.onSessionVisible('session-d', { loadMessages: false });

        expect(mocks.state.sessionMessages['session-b']).toBeUndefined();
        expect(syncForTest.sessionMessageFrontiers.has('session-b')).toBe(false);
        expect(syncForTest.sessionCachedMessageSeqs.has('session-b')).toBe(false);
        expect(syncForTest.sessionMessageLocks.has('session-b')).toBe(false);
        expect(syncForTest.sessionMessageQueue.has('session-b')).toBe(false);
        expect(syncForTest.sessionQueueProcessing.has('session-b')).toBe(false);
        expect(syncForTest.messagesSync.has('session-b')).toBe(false);
        expect(evictedSync.stop).toHaveBeenCalledTimes(1);
        expect(mocks.state.sessionMessages['session-a']).toBeDefined();
        expect(mocks.state.sessionMessages['session-c']).toBeDefined();
        expect(mocks.state.sessionMessages['session-d']).toBeDefined();
        expect(mocks.state.sessions['session-b']).toBeDefined();
        expect(syncForTest.encryption.getSessionEncryption('session-b')).toBe(evictedEncryption);
        expect(syncForTest.sessionMessageLoadGate.isCurrent(evictedOperation)).toBe(false);
    });

    it('ignores an initial response invalidated while message decryption is in flight', async () => {
        const decrypted = deferred<any[]>();
        const encryption = installSession('stale-session', async () => decrypted.promise);
        mocks.state.currentViewingSessionId = 'stale-session';
        mocks.apiRequest.mockResolvedValue(response({ messages: [apiMessage(9)], hasMore: true }));

        const loading = syncForTest.ensureMessagesLoaded('stale-session');
        await vi.waitFor(() => expect(encryption.decryptMessages).toHaveBeenCalledTimes(1));
        syncForTest.releaseSessionMessageCache('stale-session');
        decrypted.resolve([{
            id: 'message-9',
            localId: null,
            createdAt: 90,
            content: rawText('stale'),
        }]);
        await loading;
        await Promise.resolve();

        expect(mocks.state.sessionMessages['stale-session']).toBeUndefined();
        expect(syncForTest.getSessionLastMessageSeq('stale-session')).toBeNull();
        expect(syncForTest.sessionMessageFrontiers.has('stale-session')).toBe(false);
    });

    it('invalidates a route-owned forward decrypt when that mount leaves', async () => {
        const encryption = installSession('leased-session');
        mocks.state.currentViewingSessionId = 'leased-session';
        mocks.apiRequest.mockResolvedValue(response({ messages: [], hasMore: false }));
        const opening = syncForTest.openSession('leased-session');
        await expect(opening).resolves.toBe('ready');
        syncForTest.sessionMessageFrontiers.set('leased-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        mocks.apiRequest.mockClear();
        const decrypted = deferred<any[]>();
        encryption.decryptMessages.mockImplementation(async () => decrypted.promise);
        mocks.state.mutableToolCalls.add('leased-session:call-1');
        mocks.apiRequest.mockResolvedValue(response({ messages: [apiMessage(5), apiMessage(6), apiMessage(7)], hasMore: false }));

        await syncForTest.handleUpdate(newMessageUpdate('leased-session', 7));
        await vi.waitFor(() => expect(encryption.decryptMessages).toHaveBeenCalledTimes(1));
        await syncForTest.handleUpdate(newMessageUpdate('leased-session', 8));
        const messageSync = syncForTest.messagesSync.get('leased-session');
        syncForTest.abandonSessionRoute('leased-session', opening);
        mocks.state.currentViewingSessionId = null;
        decrypted.resolve([{
            id: 'message-5',
            localId: null,
            createdAt: 50,
            content: rawToolResult('uuid-stale-route'),
        }]);
        await messageSync.awaitQueue();

        expect(mocks.state.sessionMessages['leased-session']?.messagesMap['message-5']).toBeUndefined();
        expect(syncForTest.getSessionLastMessageSeq('leased-session')).toBe(4);
        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
        expect(mocks.gitInvalidate).not.toHaveBeenCalled();
    });

    it('keeps a newer same-id open owned when an older route cleanup runs', async () => {
        const oldSnapshot = deferred<ApiSessionSnapshot | null>();
        mocks.fetchSnapshot
            .mockReturnValueOnce(oldSnapshot.promise)
            .mockResolvedValueOnce(snapshot('same-session', 20));
        mocks.apiRequest.mockResolvedValue(response({ messages: [], hasMore: false }));
        mocks.hydrateRoute.mockImplementation(async (raw: ApiSessionSnapshot) => {
            const encryption = {
                createDetached() { return this; },
                decryptMessage: vi.fn(async (message: ApiMessage) => ({
                    id: message.id,
                    localId: message.localId,
                    createdAt: message.createdAt,
                    content: rawText(`realtime-${message.seq}`),
                })),
                decryptMessages: vi.fn(async (messages: ApiMessage[]) => messages.map((message) => ({
                    id: message.id,
                    localId: message.localId,
                    createdAt: message.createdAt,
                    content: rawText(`fetched-${message.seq}`),
                }))),
            };
            return {
                session: hydrated(raw),
                commitEncryption: () => {
                    mocks.sessionEncryptions.set(raw.id, encryption);
                    return true;
                },
            };
        });

        const oldOpening = syncForTest.openSession('same-session');
        const newOpening = syncForTest.openSession('same-session');
        await expect(newOpening).resolves.toBe('ready');
        syncForTest.sessionMessageFrontiers.set('same-session', { latestSeq: 4, olderBeforeSeq: null, hasMoreOlder: false });
        mocks.state.currentViewingSessionId = 'same-session';
        const forwardPage = deferred<Response>();
        mocks.apiRequest.mockClear();
        mocks.apiRequest.mockReturnValue(forwardPage.promise);
        await syncForTest.handleUpdate(newMessageUpdate('same-session', 7));
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
        const messageSync = syncForTest.messagesSync.get('same-session');
        syncForTest.abandonSessionRoute('same-session', oldOpening);
        forwardPage.resolve(response({
            messages: [apiMessage(5), apiMessage(6), apiMessage(7)],
            hasMore: false,
        }));
        await messageSync.awaitQueue();
        oldSnapshot.resolve(snapshot('same-session', 2));

        await expect(oldOpening).rejects.toThrow('abandoned');
        expect(mocks.state.sessions['same-session']).toMatchObject({ seq: 20 });
        expect(mocks.state.sessionMessages['same-session']).toMatchObject({ isLoaded: true });
        expect(mocks.state.sessionMessages['same-session'].messagesMap['message-7']).toBeDefined();
        expect(syncForTest.getSessionLastMessageSeq('same-session')).toBe(7);
    });

    it('releases an older-page loading lock when a forward load supersedes it in the same cache', async () => {
        installSession('visible-session');
        mocks.state.currentViewingSessionId = 'visible-session';
        mocks.state.sessionMessages['visible-session'] = {
            messages: [],
            messagesMap: {},
            isLoaded: true,
            hasMoreOlder: true,
            isLoadingOlder: false,
        };
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 109, olderBeforeSeq: 103, hasMoreOlder: true });
        const firstOlderPage = deferred<Response>();
        let olderRequests = 0;
        mocks.apiRequest.mockImplementation((url: string) => {
            if (url.includes('before_seq=')) {
                olderRequests += 1;
                return olderRequests === 1
                    ? firstOlderPage.promise
                    : Promise.resolve(response({ messages: [apiMessage(90)], hasMore: false }));
            }
            return Promise.resolve(response({
                messages: [apiMessage(110), apiMessage(111), apiMessage(112)],
                hasMore: false,
            }));
        });

        const olderLoading = syncForTest.loadOlderMessages('visible-session');
        await vi.waitFor(() => expect(olderRequests).toBe(1));
        await syncForTest.handleUpdate(newMessageUpdate('visible-session', 112));
        firstOlderPage.resolve(response({ messages: [], hasMore: true }));
        await olderLoading;
        await syncForTest.messagesSync.get('visible-session').awaitQueue();

        expect(mocks.state.sessionMessages['visible-session'].isLoadingOlder).toBe(false);
        await syncForTest.loadOlderMessages('visible-session');
        expect(olderRequests).toBe(2);
        expect(mocks.state.sessionMessages['visible-session'].messagesMap['message-90']).toBeDefined();
    });

    it('does not let an evicted older-page cleanup clear a remounted cache loading lock', async () => {
        installSession('same-session');
        mocks.state.currentViewingSessionId = 'same-session';
        const installMessageCache = () => {
            mocks.state.sessionMessages['same-session'] = {
                messages: [],
                messagesMap: {},
                isLoaded: true,
                hasMoreOlder: true,
                isLoadingOlder: false,
            };
            syncForTest.sessionMessageFrontiers.set('same-session', { latestSeq: 109, olderBeforeSeq: 103, hasMoreOlder: true });
        };
        installMessageCache();
        const oldPage = deferred<Response>();
        const newPage = deferred<Response>();
        mocks.apiRequest
            .mockReturnValueOnce(oldPage.promise)
            .mockReturnValueOnce(newPage.promise);

        const oldLoading = syncForTest.loadOlderMessages('same-session');
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
        syncForTest.releaseSessionMessageCache('same-session');
        installMessageCache();
        syncForTest.onSessionVisible('same-session', { loadMessages: false });
        const newLoading = syncForTest.loadOlderMessages('same-session');
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(2));

        oldPage.resolve(response({ messages: [], hasMore: true }));
        await oldLoading;
        expect(mocks.state.sessionMessages['same-session'].isLoadingOlder).toBe(true);

        newPage.resolve(response({ messages: [apiMessage(90)], hasMore: false }));
        await newLoading;
        expect(mocks.state.sessionMessages['same-session'].isLoadingOlder).toBe(false);
    });

    it('keeps explicit scroll-to-top pagination as the only older-page entry point', async () => {
        installSession('visible-session');
        mocks.state.currentViewingSessionId = 'visible-session';
        mocks.state.sessionMessages['visible-session'] = {
            messages: [],
            messagesMap: {},
            isLoaded: true,
            hasMoreOlder: true,
            isLoadingOlder: false,
        };
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 109, olderBeforeSeq: 103, hasMoreOlder: true });
        mocks.apiRequest.mockResolvedValue(response({
            messages: Array.from({ length: 13 }, (_, index) => apiMessage(90 + index)), hasMore: true,
        }));

        await syncForTest.loadOlderMessages('visible-session');

        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
        expect(mocks.apiRequest).toHaveBeenCalledWith(
            '/v3/sessions/visible-session/messages?before_seq=103&limit=100',
        );
        expect(mocks.state.sessionMessages['visible-session'].messagesMap['message-90']).toBeDefined();
        expect(syncForTest.sessionMessageFrontiers.get('visible-session')?.olderBeforeSeq).toBe(90);
    });
});
