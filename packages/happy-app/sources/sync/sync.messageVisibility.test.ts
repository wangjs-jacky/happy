import './sessionViewPlatform.testSupport';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiMessage, ApiSessionSnapshot } from './apiTypes';
import type { HydratedSession } from './sessionSnapshotHydration';
import { SessionMessageLoadGate } from './sessionMessageLoadGate';
import { SessionMessageRetention } from './sessionMessageRetention';
import { SessionRouteAbandonedError, SessionRouteOwnership } from './sessionRouteOwnership';
import { SessionEncryption } from './encryption/sessionEncryption';
import { EncryptionCache } from './encryption/encryptionCache';
import { createReducer } from './reducer/reducer';
import { installPhase2Probe } from './phase2Probe.testSupport';
import { markSessionCriticalPathAppStage } from './sessionCriticalPathProbeBridge';
import { normalizeRawMessage, type RawRecord } from './typesRaw';
import { clearSessionWarmCache, loadSessionWarmCache, saveSessionWarmLatestPage, saveSessionWarmSnapshots } from './sessionWarmCache';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openLocalHistory, clearLocalHistoryCaches } from './localHistoryStore';
import * as React from 'react';
import { act } from 'react';
// @ts-expect-error react-test-renderer has no local declarations.
import TestRenderer from 'react-test-renderer';
import { randomUUID } from 'expo-crypto';
import { useSpawnSession } from '@/hooks/useSpawnSession';
import { SessionView } from '@/-session/SessionView';

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
        hooks: null as any,
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
        navigateToSession: vi.fn(),
        machineSpawnNewSession: vi.fn(),
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
vi.mock('./storage', () => ({ storage: mocks.storage,
    useSession: (id: string) => mocks.hooks ? mocks.hooks.useSession(id) : mocks.storage.getState().sessions[id],
    useSessionMessages: (id: string) => mocks.hooks ? mocks.hooks.useSessionMessages(id) : mocks.storage.getState().sessionMessages[id],
    useIsDataReady: () => true,
    useLocalSetting: (key: string) => key === 'sidebarOrganization' ? { lists: [], tags: [], sessions: {} } : false,
    useLocalSettingMutable: () => [false, vi.fn()],
    useMachine: () => null,
    useSessionUsage: () => undefined,
    useSetting: (key: string) => key === 'sidebarOrganization' ? { lists: [], tags: [], sessions: {} } : false,
    useSettingUpdater: () => vi.fn(),
}));
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
        sessionStartupTraceRuntime: actual.createWebStartupTraceRuntime((event) => {
            const recorded = event as { stage: string; sessionId?: string };
            mocks.runtimeEvents.push(recorded);
            if (recorded.stage.startsWith('web.')) markSessionCriticalPathAppStage(recorded.stage as any);
        }),
    };
});
vi.mock('./encryption/encryption', () => ({ Encryption: class {} }));
vi.mock('./revenueCat', () => ({ RevenueCat: {}, LogLevel: {}, PaywallResult: {} }));
vi.mock('./uploadMediaFile', () => ({ uploadMediaFile: vi.fn() }));
vi.mock('./uploadAttachmentForSession', () => ({ uploadAttachmentForSession: vi.fn() }));
vi.mock('./apiAttachments', () => ({ requestAttachmentUpload: vi.fn(), uploadEncryptedBlob: vi.fn() }));
vi.mock('@/utils/readFileBytes', () => ({ readFileBytes: vi.fn() }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: () => false }));
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
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/sync/ops', () => ({ machineSpawnNewSession: mocks.machineSpawnNewSession }));
vi.mock('@/hooks/useNavigateToSession', () => ({ useNavigateToSession: () => mocks.navigateToSession }));
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
vi.mock('@/hooks/useSessionQuickActions', () => ({ useSessionQuickActions: () => ({}) }));
vi.mock('@/components/ChatFooter', () => ({ ChatFooter: 'ChatFooter' }));
vi.mock('@/hooks/useGroupedMessages', () => ({
    useGroupedMessages: (messages: any[]) => messages.map(message => ({ type: 'message', id: message.id, message })),
    isSessionTurnActive: () => false,
}));
vi.mock('@/utils/messageForkPoint', () => ({ getAgentMessageForkTargets: () => new Map() }));
vi.mock('@/modal/components/BaseModal', () => ({ BaseModal: 'BaseModal' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/components/MessageView', () => ({ MessageView: 'MessageView' }));
vi.mock('@/components/ToolGroupView', () => ({ AgentWorkGroupView: 'AgentWorkGroupView', ToolGroupView: 'ToolGroupView' }));
vi.mock('@/components/AttachmentGalleryView', () => ({ AttachmentGalleryView: 'AttachmentGalleryView' }));
vi.mock('@/components/haptics', () => ({ hapticsLight: vi.fn() }));
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

const loadRealMessageModules = () => Promise.all([
        vi.importActual<typeof import('./storage')>('./storage'),
        vi.importActual<typeof import('./encryption/encryption')>('./encryption/encryption'),
    ]);
let realMessageModules: Awaited<ReturnType<typeof loadRealMessageModules>>;
// Module transformation belongs to suite setup, not a 5s test body. A timed-out
// dynamic import previously resumed in the next case and switched its singleton
// storage/encryption owner, making an unrelated socket test observe no session.
beforeAll(async () => { realMessageModules = await loadRealMessageModules(); }, 30000);
async function useRealMessageComposition() {
    const [{ storage }, { Encryption }] = realMessageModules;
    storage.setState({ sessions: {}, sessionMessages: {}, currentViewingSessionId: null });
    mocks.useRealStorage(storage);
    mocks.hooks = realMessageModules[0];
    // Initialize the real manager's runtime caches without deriving device keys.
    // SessionEncryption below holds only the byte crypto boundary for interleaving.
    syncForTest.encryption = Object.assign(Object.create(Encryption.prototype), {
        sessionEncryptions: mocks.sessionEncryptions,
        sessionBlobKeys: new Map(),
        cache: new EncryptionCache(),
    });
    return storage;
}

async function seedDisconnectedMessageRanges(cachedMax = 100) {
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
    await syncForTest.applyLatestMessagePage('range-session', { messages: page(1, cachedMax), hasMore: false },
        syncForTest.sessionMessageLoadGate.begin(lease));
    await syncForTest.applyLatestMessagePage('range-session', { messages: page(151, 250), hasMore: true },
        syncForTest.sessionMessageLoadGate.begin(lease));
    return { storage, page, lease };
}

async function seedLocalProjectionSession() {
    const storage = await useRealMessageComposition();
    storage.getState().applySessions([hydrated(snapshot('spawned-session'))]);
    mocks.sessionEncryptions.set('spawned-session', new SessionEncryption('spawned-session', {
        encrypt: async (records) => records.map(record => new TextEncoder().encode(JSON.stringify(record))),
        decrypt: async (bytes) => bytes.map(value => value[0] === 123
            ? JSON.parse(new TextDecoder().decode(value)) : rawText('hello')),
    }, new EncryptionCache()));
    // Sending is external to the projection contract; retain the real encrypted outbox.
    syncForTest.sendSync.set('spawned-session', { invalidate: vi.fn() });
    return storage;
}

async function localHistoryViewHarness(options: { historical?: boolean; holdLocalApply?: boolean } = {}) {
    globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
    const storage = await useRealMessageComposition();
    storage.getState().applySessions([hydrated(snapshot('paint-history', 40))]);
    const history = (await openLocalHistory('paint-server|paint-account'))!;
    syncForTest.localHistory = history;
    const page = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => ({
        ...apiMessage(min + i), content: { t: 'encrypted' as const,
            c: Buffer.from(JSON.stringify(rawText(`message-${min + i}`))).toString('base64') },
    }));
    const localApply = deferred<void>();
    let localApplyStarted = false;
    mocks.sessionEncryptions.set('paint-history', new SessionEncryption('paint-history', {
        encrypt: async () => [],
        decrypt: async bytes => {
            if (options.holdLocalApply && !localApplyStarted) {
                localApplyStarted = true;
                await localApply.promise;
            }
            return bytes.map(value => JSON.parse(new TextDecoder().decode(value)));
        },
    }, new EncryptionCache()));
    await history.commitPage('paint-history', { direction: 'older', boundary: 2147483647,
        messages: options.historical ? page(1, 400) : page(40, 40), hasMore: false });
    const reading = { version: 1 as const, anchorId: 'message-150', anchorSeq: 150, offset: 12, expandedGroupIds: [] };
    if (options.historical) await history.writeReadingState('paint-history', reading);
    else await history.commitReconciliation({ changes: [{ sessionId: 'paint-history', revision: '1', deleted: false,
        lastMessageSeq: 42, metadataVersion: 0, agentStateVersion: 0 }], nextCursor: '1' });
    const probe = installPhase2Probe('deep-link', { mountsRoute: true });
    const marker = vi.fn(probe.markFreshLatestMessageComplete);
    (globalThis as any).__happySessionCriticalPathProbe = { ...probe, markFreshLatestMessageComplete: marker };
    const frames = new Map<number, FrameRequestCallback>();
    let frame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const open = vi.spyOn(sync, 'openSession');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(React.createElement(SessionView, { id: 'paint-history' })); });
    const opening = open.mock.results[0].value;
    return {
        storage, history, page, marker, probe, renderer, opening, reading, localApply, open,
        localApplyStarted: () => localApplyStarted,
        paint: async () => {
            // Release the production Deferred timer, then its real marker frame.
            await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
            await act(async () => {
                const callbacks = [...frames.values()]; frames.clear();
                callbacks.forEach(callback => callback(0));
            });
        },
        close: () => {
            act(() => renderer.unmount()); open.mockRestore();
            delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
        },
    };
}

describe('message visibility synchronization', () => {
    let consoleError: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        mocks.useRealStorage(null);
        mocks.hooks = null;
        syncForTest.sessionEventCursors.clear();
        syncForTest.sessionHydrations.clear();
        syncForTest.inFlightSessionRefreshes.clear();
        syncForTest.sessionDeletionMutationGenerations.clear();
        vi.clearAllMocks();
        const originalConsoleError = console.error;
        consoleError = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
        mocks.state.sessions = {};
        mocks.state.sessionMessages = {};
        mocks.state.currentViewingSessionId = null;
        mocks.state.mutableToolCalls.clear();
        mocks.sessionEncryptions.clear();
        mocks.runtimeEvents = [];
        mocks.apiRequest.mockReset().mockResolvedValue(response({ messages: [], hasMore: false }));
        mocks.fetchSnapshot.mockResolvedValue(null);
        mocks.fetchPage.mockResolvedValue({ sessions: [], hasNext: false, nextCursor: null });
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
        syncForTest.acceptedLocalMessageReceipts = new Map();
        syncForTest.observedLocalMessageIds = new Map();
        syncForTest.sessionMessageLoadGate = new SessionMessageLoadGate();
        syncForTest.sessionMessageRetention = new SessionMessageRetention(3);
        syncForTest.activeOpenSession = null;
        syncForTest.sessionRouteOwnership = new SessionRouteOwnership();
        syncForTest.sessionWarmCacheAccountKey = null;
        syncForTest.localHistory = null;
        syncForTest.historyWindows = new Map();
        syncForTest.historyWindowLoads = new Map();
        syncForTest.historyBoundaryLoadingTokens = new Map();
        syncForTest.pendingHistoryTargets = new Map();
        syncForTest.changesInFlight = null;
        syncForTest.changesSupported = null;
        syncForTest.pendingOutbox = new Map();
        syncForTest.sendSync = new Map();
    });

    afterEach(() => {
        consoleError.mockRestore();
        vi.unstubAllGlobals();
        syncForTest.localHistory?.close();
        syncForTest.localHistory = null;
        clearSessionWarmCache();
        syncForTest.serverID = undefined;
        syncForTest.sessionWarmCacheAccountKey = null;
        delete (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe;
        mocks.useRealStorage(null);
        for (const messageSync of syncForTest.messagesSync.values()) {
            messageSync.stop();
        }
    });

    it('renders anchored local history through Deferred without a verified-latest marker', async () => {
        const view = await localHistoryViewHarness({ historical: true });
        try {
            await act(async () => { await expect(view.opening).resolves.toBe('ready'); });
            await view.paint();
            expect(view.renderer.root.findAllByType('FlatList')).toHaveLength(1);
            expect(view.renderer.root.findByType('FlatList').props.data).toContainEqual(expect.objectContaining({
                message: expect.objectContaining({ kind: 'user-text', text: 'message-150' }),
            }));
            expect(view.storage.getState().sessionMessages['paint-history']).toMatchObject({
                isAtLatest: false, latestVerifiedOwnerEpoch: null,
            });
            expect(view.storage.getState().sessionMessages['paint-history'].messages.some(message =>
                message.kind === 'user-text' && message.text === 'message-150')).toBe(true);
            expect(await view.history.readReadingState('paint-history')).toEqual(view.reading);
            expect(view.marker).not.toHaveBeenCalled();
            expect(mocks.apiRequest).not.toHaveBeenCalled();
        } finally { view.close(); }
    });

    it('updates the retained Deferred consumer only after failed stale-tail verification is retried and committed', async () => {
        const tail = deferred<Response>();
        mocks.apiRequest.mockReturnValueOnce(tail.promise);
        const view = await localHistoryViewHarness();
        try {
            await act(async () => { await expect(view.opening).resolves.toBe('ready'); });
            await view.paint();
            await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/v3/sessions/paint-history/messages?after_seq=40&limit=100'));
            const chat = view.renderer.root.findByType('FlatList');
            expect(chat.props.data).toContainEqual(expect.objectContaining({
                message: expect.objectContaining({ kind: 'user-text', text: 'message-40' }),
            }));
            expect(view.storage.getState().sessionMessages['paint-history'].latestVerifiedOwnerEpoch).toBeNull();
            expect(view.storage.getState().sessionMessages['paint-history'].messages).toContainEqual(expect.objectContaining({ text: 'message-40' }));
            expect(view.marker).not.toHaveBeenCalled();
            await act(async () => {
                const pending = syncForTest.historyWindowLoads.get('paint-history');
                tail.resolve(response({}, 503)); await pending;
            });
            await view.paint();
            expect(view.renderer.root.findByType('FlatList')).toBe(chat);
            expect(view.marker).not.toHaveBeenCalled();
            expect(view.storage.getState().sessionMessages['paint-history'].latestVerifiedOwnerEpoch).toBeNull();
            mocks.apiRequest.mockResolvedValueOnce(response({ messages: view.page(41, 42), hasMore: false }));
            await act(async () => { await sync.jumpToLatestMessages('paint-history'); });
            expect(view.storage.getState().sessionMessages['paint-history']).toMatchObject({
                isAtLatest: true, latestVerifiedOwnerEpoch: syncForTest.activeOpenSession.owner.ownerEpoch,
            });
            await view.paint(); await view.paint();
            expect(view.renderer.root.findByType('FlatList')).toBe(chat);
            expect(view.marker).toHaveBeenCalledTimes(1);
            expect(view.open).toHaveBeenCalledTimes(1);
            expect(view.probe.collect().samples).toHaveLength(1);
        } finally { tail.resolve(response({}, 503)); view.close(); }
    });

    it.each(['latest', 'stale', 'historical', 'abandoned'] as const)('rejects a superseded local apply at the real paint boundary (winner: %s)', async winner => {
        const view = await localHistoryViewHarness({ holdLocalApply: true, historical: winner === 'historical' });
        const tail = deferred<Response>();
        try {
            await vi.waitFor(() => expect(view.localApplyStarted()).toBe(true));
            mocks.apiRequest.mockReturnValueOnce(tail.promise);
            let catchingUp!: Promise<void>;
            if (winner === 'historical') {
                const window = await view.history.readWindow('paint-history', { anchorSeq: 150 });
                const lease = syncForTest.sessionMessageLoadGate.currentLease('paint-history');
                await act(async () => {
                    catchingUp = syncForTest.applyHistoryWindow('paint-history', window, syncForTest.sessionMessageLoadGate.begin(lease));
                    await catchingUp;
                });
            } else {
                await act(async () => { catchingUp = sync.jumpToLatestMessages('paint-history'); });
                await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
            }
            if (winner === 'stale') await view.history.commitReconciliation({ changes: [{
                sessionId: 'paint-history', revision: '2', deleted: false, lastMessageSeq: 45,
                metadataVersion: 0, agentStateVersion: 0,
            }], nextCursor: '2' });
            if (winner === 'abandoned') sync.leaveSessionRoute(syncForTest.activeOpenSession.owner);
            await act(async () => {
                tail.resolve(response({ messages: view.page(41, 42), hasMore: false })); await catchingUp;
            });
            await view.paint();
            expect(view.marker).not.toHaveBeenCalled();
            const winningCache = view.storage.getState().sessionMessages['paint-history'];
            await act(async () => {
                view.localApply.resolve();
                if (winner === 'abandoned') await expect(view.opening).rejects.toThrow('abandoned');
                else await expect(view.opening).resolves.toBe('ready');
            });
            await view.paint(); await view.paint();
            if (winner !== 'abandoned') {
                expect(view.storage.getState().sessionMessages['paint-history'].messages).toContainEqual(expect.objectContaining({
                    text: winner === 'historical' ? 'message-150' : 'message-42',
                }));
            }
            expect(view.marker).toHaveBeenCalledTimes(winner === 'latest' ? 1 : 0);
            if (winner === 'stale') expect(winningCache.latestVerifiedOwnerEpoch).toBeNull();
            if (winner === 'historical') expect(await view.history.readReadingState('paint-history')).toEqual(view.reading);
        } finally { tail.resolve(response({}, 503)); view.localApply.resolve(); view.close(); }
    });

    it('restores an archived reading window and navigates cached history with zero body requests', async () => {
        globalThis.indexedDB = new IDBFactory();
        globalThis.IDBKeyRange = IDBKeyRange;
        installSession('archive');
        const history = await openLocalHistory('server|account');
        await history!.commitPage('archive', { direction: 'older', boundary: 2147483647,
            messages: Array.from({ length: 400 }, (_, i) => apiMessage(i + 1)), hasMore: false });
        await history!.writeReadingState('archive', { version: 1, anchorId: 'message-150',
            anchorSeq: 150, offset: 12, expandedGroupIds: [] });
        syncForTest.localHistory = history;
        await expect(syncForTest.openSession('archive')).resolves.toBe('ready');
        expect(mocks.state.sessionMessages.archive.isAtLatest).toBe(false);
        expect(mocks.state.sessionMessages.archive.messages.length).toBeLessThanOrEqual(300);
        await syncForTest.loadNewerMessages('archive');
        await syncForTest.jumpToLatestMessages('archive');
        expect(mocks.state.sessionMessages.archive.isAtLatest).toBe(true);
        await syncForTest.loadOlderMessages('archive');
        expect(mocks.apiRequest).not.toHaveBeenCalled();
        expect(mocks.state.sessionMessages.archive.messages.length).toBeLessThanOrEqual(300);
    }, 20000);

    it('jumps from a stale cached tail by requesting only newer records', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        installSession('archive');
        const history = (await openLocalHistory('server|account'))!;
        await history.commitPage('archive', { direction: 'older', boundary: 2147483647, messages: [apiMessage(40)], hasMore: false });
        await history.commitReconciliation({ changes: [{ sessionId: 'archive', revision: '1', deleted: false,
            lastMessageSeq: 42, metadataVersion: 1, agentStateVersion: 0 }], nextCursor: '1' });
        syncForTest.localHistory = history;
        await syncForTest.openSession('archive');
        mocks.apiRequest.mockResolvedValue(response({ messages: [apiMessage(41), apiMessage(42)], hasMore: false }));
        await syncForTest.jumpToLatestMessages('archive');
        expect(mocks.apiRequest).toHaveBeenCalledWith('/v3/sessions/archive/messages?after_seq=40&limit=100');
        expect(mocks.state.sessionMessages.archive.isAtLatest).toBe(true);
        expect(syncForTest.historyWindows.get('archive').messages.map((m: ApiMessage) => m.seq)).toEqual([40, 41, 42]);
        expect(mocks.state.sessionMessages.archive.latestVerifiedOwnerEpoch).not.toBeNull();
    });

    it('does not certify a stale tail when reconciliation advances during catch-up', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        installSession('advancing-tail');
        const history = (await openLocalHistory('server|account'))!;
        await history.commitPage('advancing-tail', { direction: 'older', boundary: 2147483647,
            messages: [apiMessage(40)], hasMore: false });
        await history.commitReconciliation({ changes: [{ sessionId: 'advancing-tail', revision: '1', deleted: false,
            lastMessageSeq: 42, metadataVersion: 1, agentStateVersion: 0 }], nextCursor: '1' });
        syncForTest.localHistory = history;
        await expect(syncForTest.openSession('advancing-tail')).resolves.toBe('ready');
        const tail = deferred<Response>();
        mocks.apiRequest.mockReturnValueOnce(tail.promise);
        const catchingUp = syncForTest.jumpToLatestMessages('advancing-tail');
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
            '/v3/sessions/advancing-tail/messages?after_seq=40&limit=100',
        ));
        await history.commitReconciliation({ changes: [{ sessionId: 'advancing-tail', revision: '2', deleted: false,
            lastMessageSeq: 45, metadataVersion: 1, agentStateVersion: 0 }], nextCursor: '2' });
        tail.resolve(response({ messages: [apiMessage(41), apiMessage(42)], hasMore: false }));
        await catchingUp;
        expect(mocks.state.sessionMessages['advancing-tail']).toMatchObject({ isAtLatest: false, latestVerifiedOwnerEpoch: null });
    });

    it('does not certify a tail when its catch-up request fails', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        installSession('failed-tail');
        const history = (await openLocalHistory('server|account'))!;
        await history.commitPage('failed-tail', { direction: 'older', boundary: 2147483647,
            messages: [apiMessage(40)], hasMore: false });
        await history.commitReconciliation({ changes: [{ sessionId: 'failed-tail', revision: '1', deleted: false,
            lastMessageSeq: 42, metadataVersion: 1, agentStateVersion: 0 }], nextCursor: '1' });
        syncForTest.localHistory = history;
        await expect(syncForTest.openSession('failed-tail')).resolves.toBe('ready');
        mocks.apiRequest.mockResolvedValueOnce(response({}, 503));
        await syncForTest.jumpToLatestMessages('failed-tail');
        expect(mocks.state.sessionMessages['failed-tail'].latestVerifiedOwnerEpoch).toBeNull();
    });

    it('drops corrupt archived page coverage and retries from the network', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        const encryption = installSession('archive');
        encryption.decryptMessages.mockResolvedValueOnce([null]);
        const history = (await openLocalHistory('server|account'))!;
        await history.commitPage('archive', { direction: 'older', boundary: 2147483647, messages: [apiMessage(40)], hasMore: false });
        syncForTest.localHistory = history;
        mocks.apiRequest.mockResolvedValue(response({ messages: [apiMessage(40)], hasMore: false }));
        await expect(syncForTest.openSession('archive')).resolves.toBe('ready');
        expect(mocks.apiRequest.mock.calls.map(([url]) => url)).toEqual(['/v3/sessions/archive/messages?before_seq=2147483647&limit=100']);
        expect(mocks.state.sessionMessages.archive.isLoaded).toBe(true);
    });

    it('makes zero body requests across ten cached opens, visibility signals and unchanged reconnect reconciliations', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        installSession('budget');
        const history = (await openLocalHistory('server|account'))!;
        await history.writeSnapshots([snapshot('budget')]);
        await history.commitPage('budget', { direction: 'older', boundary: 2147483647, messages: [apiMessage(40)], hasMore: false });
        await history.commitReconciliation({ changes: [{ sessionId: 'budget', revision: '1', deleted: false,
            lastMessageSeq: 40, metadataVersion: 0, agentStateVersion: 0 }], nextCursor: '1' });
        let reconciliations = 0;
        vi.stubGlobal('fetch', async (url: string) => {
            expect(url).toContain('/v3/sessions/changes?');
            reconciliations++;
            return new Response(JSON.stringify({ changes: [], nextCursor: '1', hasMore: false }));
        });
        syncForTest.localHistory = history;
        mocks.state.currentViewingSessionId = 'budget';
        for (let i = 0; i < 10; i++) {
            await syncForTest.openSession('budget');
            syncForTest.onSessionVisible('budget');
            await syncForTest.getMessagesSync('budget').awaitQueue();
            await syncForTest.fetchSessions(); // reconnect's existing invalidator target
        }
        expect(reconciliations).toBe(10);
        expect(mocks.apiRequest).not.toHaveBeenCalled();
        expect(mocks.fetchSnapshot).not.toHaveBeenCalled();
        expect(mocks.state.sessionMessages.budget.isLoaded).toBe(true);
        syncForTest.releaseSessionMessageCache('budget');
        await syncForTest.ensureMessagesLoaded('budget');
        expect(mocks.apiRequest).not.toHaveBeenCalled();
    });

    it('keeps realtime tail windows bounded and gives replayed rows stable wire identity', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        installSession('bounded');
        const history = (await openLocalHistory('server|account'))!;
        await history.commitPage('bounded', { direction: 'older', boundary: 2147483647,
            messages: Array.from({ length: 300 }, (_, i) => apiMessage(i + 1)), hasMore: false });
        syncForTest.localHistory = history;
        await syncForTest.jumpToLatestMessages('bounded');
        const lease = syncForTest.sessionMessageLoadGate.currentLease('bounded');
        await syncForTest.applyHistoryWindow('bounded', await history.readWindow('bounded', { limit: 300 }), syncForTest.sessionMessageLoadGate.begin(lease));
        const rendered = syncForTest.resolveRenderedMessageId('bounded', 'message-300');
        expect(syncForTest.getMessageWireSeq('bounded', rendered)).toBe(300);
        await syncForTest.handleUpdate(newMessageUpdate('bounded', 301));
        await syncForTest.handleUpdate(newMessageUpdate('bounded', 302));
        expect(syncForTest.historyWindows.get('bounded').messages.length).toBeLessThanOrEqual(300);
        expect(mocks.state.sessionMessages.bounded.messages.length).toBeLessThanOrEqual(300);
        expect(mocks.apiRequest).not.toHaveBeenCalled();
    }, 20000);

    it('assigns stable source-block identities to same-wire text and thinking rows across replay', async () => {
        const encryption = installSession('blocks');
        encryption.decryptMessages.mockImplementation(async (rows: ApiMessage[]) => rows.map(row => ({ ...row, content: {
            role: 'agent', content: { type: 'output', data: { type: 'assistant', uuid: 'assistant-wire', message: {
                role: 'assistant', model: 'test', content: [{ type: 'text', text: 'first long block' }, { type: 'thinking', thinking: 'second long block' }],
            } } },
        } })));
        const lease = syncForTest.sessionMessageLoadGate.enter('blocks');
        const window = { messages: [apiMessage(1)], oldestSeq: 1, newestSeq: 1, hasMoreOlder: false, hasMoreNewer: false, isAtLatest: true };
        await syncForTest.applyHistoryWindow('blocks', window, syncForTest.sessionMessageLoadGate.begin(lease));
        const oldRows = mocks.state.sessionMessages.blocks.messages;
        expect(oldRows).toHaveLength(2);
        const keys = oldRows.map((row: any) => syncForTest.getMessageWireBlockKey('blocks', row.id));
        expect(new Set(keys).size).toBe(2);
        await syncForTest.applyHistoryWindow('blocks', window, syncForTest.sessionMessageLoadGate.begin(lease));
        const newRows = mocks.state.sessionMessages.blocks.messages;
        expect(newRows.map((row: any) => row.id)).not.toEqual(oldRows.map((row: any) => row.id));
        expect(newRows.map((row: any) => syncForTest.getMessageWireBlockKey('blocks', row.id))).toEqual(keys);
    });

    it('persists encrypted metadata updates received while the session is off screen', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        installSession('metadata');
        const history = (await openLocalHistory('server|account'))!;
        await history.writeSnapshots([snapshot('metadata')]);
        syncForTest.localHistory = history;
        await syncForTest.handleUpdate({ id: 'event', seq: 100, createdAt: 100, body: {
            t: 'update-session', id: 'metadata', metadata: { value: 'new-cipher', version: 99 },
        } });
        expect((await history.readSnapshot('metadata'))?.metadata).toBe('new-cipher');
        expect((await history.readSnapshot('metadata'))?.metadataVersion).toBe(99);
    });

    it('archives acknowledged outbound ciphertext without certifying an unseen sequence gap', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        installSession('outbound');
        const history = (await openLocalHistory('server|account'))!;
        syncForTest.localHistory = history;
        syncForTest.pendingOutbox.set('outbound', [{ localId: 'local', content: 'sent-cipher' }]);
        mocks.apiRequest.mockResolvedValue(response({ messages: [{ id: 'ack', seq: 5, localId: 'local', createdAt: 5, updatedAt: 5 }] }));
        await syncForTest.flushOutbox('outbound');
        expect((await history.readWindow('outbound', { anchorSeq: 5 }))?.messages[0].content.c).toBe('sent-cipher');
        expect(await history.readNewerPage('outbound', 0)).toBeNull();
    });

    it('falls back to the point snapshot when a cached encryption key cannot be hydrated', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        installSession('bad-key');
        delete mocks.state.sessions['bad-key'];
        const history = (await openLocalHistory('server|account'))!;
        await history.writeSnapshots([snapshot('bad-key')]);
        syncForTest.localHistory = history;
        mocks.hydrateRoute.mockResolvedValueOnce(null);
        mocks.fetchSnapshot.mockResolvedValue(snapshot('bad-key'));
        await expect(syncForTest.ensureSessionHydrated('bad-key')).resolves.toBe(true);
        expect(mocks.fetchSnapshot).toHaveBeenCalledOnce();
    });

    it('keeps new network content readable when persistence fails at a stale tail', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        installSession('quota');
        const history = (await openLocalHistory('server|account'))!;
        await history.commitPage('quota', { direction: 'older', boundary: 2147483647, messages: [apiMessage(40)], hasMore: false });
        await history.commitReconciliation({ changes: [{ sessionId: 'quota', revision: '1', deleted: false,
            lastMessageSeq: 41, metadataVersion: 1, agentStateVersion: 0 }], nextCursor: '1' });
        syncForTest.localHistory = history;
        await syncForTest.openSession('quota');
        vi.spyOn(history, 'commitPage').mockResolvedValue(false);
        mocks.apiRequest.mockResolvedValue(response({ messages: [apiMessage(41)], hasMore: false }));
        await syncForTest.jumpToLatestMessages('quota');
        expect(syncForTest.historyWindows.get('quota').newestSeq).toBe(41);
        expect(mocks.state.sessionMessages.quota.isAtLatest).toBe(true);
        expect((await history.readWindow('quota'))?.newestSeq).toBe(40);
    });

    it('keeps live permission updates outside a historical window and preserves its boundary flags', async () => {
        const actual = await useRealMessageComposition();
        actual.getState().applySessions([hydrated(snapshot('past'))]);
        actual.getState().applyMessagesLoaded('past');
        actual.setState(state => ({ sessionMessages: { ...state.sessionMessages, past: {
            ...state.sessionMessages.past, isAtLatest: false, hasMoreNewer: true,
        } } }));
        actual.getState().applySessions([{ ...actual.getState().sessions.past, agentStateVersion: 99,
            agentState: { controlledByUser: false, requests: { request: { tool: 'Bash', arguments: { command: 'pwd' }, createdAt: 100 } } },
        }]);
        expect(actual.getState().sessionMessages.past.isAtLatest).toBe(false);
        expect(actual.getState().sessionMessages.past.hasMoreNewer).toBe(true);
        expect(actual.getState().sessionMessages.past.messages).toEqual([]);
    });

    it.each(['account', 'reset', 'logout', 'session-delete'] as const)(
        'fences delayed forward JSON before persistence after %s', async transition => {
            globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
            const encryption = installSession('delayed');
            const original = (await openLocalHistory('server|original'))!;
            await original.commitPage('delayed', { direction: 'older', boundary: 2147483647, messages: [apiMessage(40)], hasMore: false });
            syncForTest.localHistory = original;
            const body = deferred<{ messages: ApiMessage[]; hasMore: boolean }>();
            const parsing = deferred<void>();
            mocks.apiRequest.mockResolvedValue({ ok: true, status: 200,
                json: () => { parsing.resolve(); return body.promise; } });
            const lease = syncForTest.sessionMessageLoadGate.enter('delayed');
            const pending = syncForTest.fetchForwardSince('delayed', encryption, 40, syncForTest.sessionMessageLoadGate.begin(lease));
            await parsing.promise;
            if (transition === 'reset') await syncForTest.resetLocalHistory();
            if (transition === 'logout') await clearLocalHistoryCaches();
            if (transition === 'session-delete') await original.deleteSession('delayed');
            const replacement = transition === 'session-delete' ? original
                : (await openLocalHistory(transition === 'reset' ? 'server|original' : 'server|next'))!;
            syncForTest.localHistory = replacement;
            body.resolve({ messages: [apiMessage(41)], hasMore: false });
            await pending;
            expect(await replacement.readWindow('delayed')).toBeNull();
            if (transition === 'account') {
                expect((await original.readWindow('delayed'))?.newestSeq).toBe(40);
                original.close();
            }
        });

    it.each(['socket', 'socket-recovery', 'forward'] as const)('retains new %s records in a full window when persistence fails', async source => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        const encryption = installSession('failed-write');
        const history = (await openLocalHistory('server|quota'))!;
        await history.commitPage('failed-write', { direction: 'older', boundary: 2147483647,
            messages: Array.from({ length: 300 }, (_, i) => apiMessage(i + 1)), hasMore: false });
        syncForTest.localHistory = history;
        const lease = syncForTest.sessionMessageLoadGate.enter('failed-write');
        await syncForTest.applyHistoryWindow('failed-write', await history.readWindow('failed-write', { limit: 300 }), syncForTest.sessionMessageLoadGate.begin(lease));
        if (source !== 'forward') {
            const append = vi.spyOn(history, 'appendMessages');
            if (source === 'socket-recovery') append.mockResolvedValueOnce(false);
            else append.mockResolvedValue(false);
            await syncForTest.handleUpdate(newMessageUpdate('failed-write', 301));
            await syncForTest.handleUpdate(newMessageUpdate('failed-write', 302));
        } else {
            vi.spyOn(history, 'commitPage').mockResolvedValue(false);
            mocks.apiRequest.mockResolvedValue(response({ messages: [apiMessage(301), apiMessage(302)], hasMore: false }));
            await syncForTest.fetchForwardSince('failed-write', encryption, 300, syncForTest.sessionMessageLoadGate.begin(lease));
        }
        const window = syncForTest.historyWindows.get('failed-write');
        expect(window.newestSeq).toBe(302);
        expect(window.messages.map((message: ApiMessage) => message.seq)).toContain(301);
        expect(window.messages.length).toBeLessThanOrEqual(300);
        expect(mocks.state.sessionMessages['failed-write'].messages.length).toBeLessThanOrEqual(300);
        expect(syncForTest.resolveRenderedMessageId('failed-write', 'message-302')).not.toBeNull();
        expect((await history.readWindow('failed-write'))?.newestSeq).toBe(300);
        expect(await history.readWindow('failed-write', { anchorSeq: 301 })).toBeNull();
    }, 20000);

    it('projects every accepted local receipt ID while HTTP owns the message lock, without consuming unrelated queued messages', async () => {
        const storage = await seedLocalProjectionSession();
        const http = deferred<Response>();
        mocks.apiRequest.mockReturnValueOnce(http.promise);
        const loading = syncForTest.ensureMessagesLoaded('spawned-session');
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
        const unrelated = normalizeRawMessage('remote-1', null, 1, rawText('remote'))!;
        syncForTest.enqueueMessages('spawned-session', [unrelated]);
        vi.mocked(randomUUID).mockReturnValueOnce('local-a').mockReturnValueOnce('local-b');
        const first = await sync.sendMessage('spawned-session', 'hello', { source: 'new_session' });
        const second = await sync.sendMessage('spawned-session', 'next', { source: 'new_session' });
        expect(storage.getState().sessionMessages['spawned-session']?.messages).toBeUndefined();
        try {
            let projected: boolean | undefined;
            const projection = sync.awaitLocalMessageProjection(first.sessionId, [...first.localIds, ...second.localIds])
                .then(value => { projected = value; });
            for (let i = 0; i < 10; i++) await Promise.resolve();
            expect(projected).toBe(true);
            await projection;
            const cache = storage.getState().sessionMessages['spawned-session'];
            expect(Object.values(cache.messagesMap).map(message => message.kind === 'user-text' ? message.localId : null)).toEqual(['local-a', 'local-b']);
            for (const id of [...first.localIds, ...second.localIds]) {
                expect(cache.messagesMap[cache.reducerState.localIds.get(id)!]).toMatchObject({ localId: id });
            }
            expect(syncForTest.sessionMessageQueue.get('spawned-session').map((message: any) => message.id)).toEqual(['remote-1']);
            expect(syncForTest.pendingOutbox.get('spawned-session').map((message: any) => message.localId)).toEqual(['local-a', 'local-b']);
            expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
        } finally {
            http.resolve(response({ messages: [], hasMore: false }));
            await loading;
            await syncForTest.getSessionMessageLock('spawned-session').inLock(() => undefined);
        }
        expect(storage.getState().sessionMessages['spawned-session'].messages.some(message => message.kind === 'user-text' && message.text === 'remote')).toBe(true);
    });

    it.each(['deleted', 'evicted'] as const)('projects attachment and text receipts once and rejects a subsequently %s cache', async (terminal) => {
        const storage = await seedLocalProjectionSession();
        const http = deferred<Response>();
        mocks.apiRequest.mockReturnValueOnce(http.promise);
        const loading = syncForTest.ensureMessagesLoaded('spawned-session');
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
        const upload = vi.spyOn(syncForTest, 'uploadAttachmentsForSession').mockResolvedValue({
            uploaded: [{ ref: 'encrypted-file', name: 'photo.png', size: 1, width: 10, height: 10, thumbhash: 'thumbhash' }], failed: 0,
        });
        vi.mocked(randomUUID).mockReturnValueOnce('00000000-0000-4000-8000-000000000001').mockReturnValueOnce('local-file').mockReturnValueOnce('local-text');
        try {
            const receipt = await sync.sendMessage('spawned-session', 'hello', {
                source: 'new_session', attachments: [{ id: 'attachment' }] as any,
            });
            expect(receipt.localIds).toEqual(['local-file', 'local-text']);
            await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds)).resolves.toBe(true);
            await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds)).resolves.toBe(true);
            const cache = storage.getState().sessionMessages['spawned-session'];
            expect(cache.messages).toHaveLength(2);
            const fileId = cache.reducerState.toolIdToMessageId.get('00000000-0000-4000-8000-000000000001')!;
            expect(cache.reducerState.messages.get(fileId)?.realID).toBe('00000000-0000-4000-8000-000000000001');
            expect(cache.messagesMap[fileId]).toMatchObject({ kind: 'tool-call', tool: { name: 'file', state: 'completed' } });
            expect(cache.messagesMap[cache.reducerState.localIds.get('local-text')!]).toMatchObject({ localId: 'local-text', text: 'hello' });
            expect(syncForTest.pendingOutbox.get('spawned-session')).toHaveLength(2);
            expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
            const pending = sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds);
            if (terminal === 'deleted') sync.removeSessionLocally(receipt.sessionId);
            else syncForTest.releaseSessionMessageCache(receipt.sessionId);
            await expect(pending).resolves.toBe(false);
            expect(storage.getState().sessionMessages[receipt.sessionId]).toBeUndefined();
        } finally {
            upload.mockRestore();
            http.resolve(response({ messages: [], hasMore: false }));
            await loading;
        }
    });

    it('keeps an accepted text and attachment receipt across an empty latest history replacement', async () => {
        // Catches a live/latest archive rebuild replacing the reducer with only
        // pre-ACK rows, which must not erase the already accepted local receipt.
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        const storage = await seedLocalProjectionSession();
        const history = (await openLocalHistory('server|account'))!;
        syncForTest.localHistory = history;
        const upload = vi.spyOn(syncForTest, 'uploadAttachmentsForSession').mockResolvedValue({
            uploaded: [{ ref: 'encrypted-file', name: 'photo.png', size: 1, width: 10, height: 10 }], failed: 0,
        });
        vi.mocked(randomUUID).mockReturnValueOnce('00000000-0000-4000-8000-000000000001').mockReturnValueOnce('local-file').mockReturnValueOnce('local-text');
        try {
            const receipt = await sync.sendMessage('spawned-session', 'hello', {
                source: 'new_session', attachments: [{ id: 'attachment' }] as any,
            });
            await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds, receipt)).resolves.toBe(true);
            const lease = syncForTest.sessionMessageLoadGate.enter(receipt.sessionId);
            await syncForTest.applyLatestMessagePage(receipt.sessionId, { messages: [], hasMore: false },
                syncForTest.sessionMessageLoadGate.begin(lease));

            const cache = storage.getState().sessionMessages[receipt.sessionId];
            expect(cache.messages).toHaveLength(2);
            expect(cache.messagesMap[cache.reducerState.localIds.get('local-text')!]).toMatchObject({
                kind: 'user-text', localId: 'local-text', text: 'hello',
            });
            expect(cache.messagesMap[cache.reducerState.toolIdToMessageId.get('00000000-0000-4000-8000-000000000001')!]).toMatchObject({
                kind: 'tool-call', tool: { name: 'file' },
            });
            await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds, receipt)).resolves.toBe(true);
        } finally {
            upload.mockRestore();
        }
    });

    it.each([false, true])('recovers a real echoed text/file spawn after full release with one handoff (fresh retain: %s)', async (retain) => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        const storage = await seedLocalProjectionSession();
        syncForTest.localHistory = (await openLocalHistory('server|account'))!;
        syncForTest.sendSync.delete('spawned-session');
        mocks.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'spawned-session' });
        const acknowledgement = deferred<Response>();
        mocks.apiRequest.mockReturnValueOnce(acknowledgement.promise);
        const upload = vi.spyOn(syncForTest, 'uploadAttachmentsForSession').mockResolvedValue({
            uploaded: [{ ref: 'encrypted-file', name: 'photo.png', size: 1, width: 10, height: 10 }], failed: 0,
        });
        vi.mocked(randomUUID).mockReturnValueOnce('trace-id').mockReturnValueOnce('00000000-0000-4000-8000-000000000001').mockReturnValueOnce('local-file').mockReturnValueOnce('local-text');
        const send = vi.spyOn(sync, 'sendMessage');
        const project = sync.awaitLocalMessageProjection.bind(sync);
        let receipt!: Awaited<ReturnType<typeof sync.sendMessage>>;
        let echoed: ApiMessage[] = [];
        const assertTextAndFile = () => {
            const cache = storage.getState().sessionMessages['spawned-session'];
            expect(cache.messages).toHaveLength(2);
            expect(cache.messages.filter(message => message.kind === 'user-text')).toHaveLength(1);
            expect(cache.messagesMap[cache.reducerState.localIds.get('local-text')!]).toMatchObject({
                kind: 'user-text', localId: 'local-text', text: 'hello',
            });
            const fileId = cache.reducerState.toolIdToMessageId.get('00000000-0000-4000-8000-000000000001')!;
            expect(cache.reducerState.messages.get(fileId)?.realID).toBe('00000000-0000-4000-8000-000000000001');
            expect(cache.messagesMap[fileId]).toMatchObject({ kind: 'tool-call', tool: { name: 'file', state: 'completed' } });
        };
        const projection = vi.spyOn(sync, 'awaitLocalMessageProjection').mockImplementationOnce(async (...args) => {
            receipt = args[2]!;
            await expect(project(...args)).resolves.toBe(true);
            await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
            // Echo the exact encrypted outbox contents, including the session/file
            // envelope. A text-only decryptor would fail the file identity checks.
            echoed = syncForTest.pendingOutbox.get(receipt.sessionId).map((entry: any, i: number) => ({
                ...apiMessage(10 + i), id: i === 0 ? 'remote-file' : 'remote-text',
                localId: entry.localId, content: { t: 'encrypted', c: entry.content },
            }));
            const lease = syncForTest.sessionMessageLoadGate.currentLease(receipt.sessionId)
                ?? syncForTest.sessionMessageLoadGate.enter(receipt.sessionId);
            await syncForTest.applyLatestMessagePage(receipt.sessionId, { messages: [], hasMore: false },
                syncForTest.sessionMessageLoadGate.begin(lease));
            assertTextAndFile();
            const generation = syncForTest.sessionMessageCacheGenerations.get(receipt.sessionId);
            // Inject loss of the display reducer while retaining the live
            // generation and receipt, so retry must execute actual recovery.
            storage.setState(state => ({ sessionMessages: { ...state.sessionMessages, [receipt.sessionId]: {
                ...state.sessionMessages[receipt.sessionId], messages: [], messagesMap: {}, reducerState: createReducer(),
            } } }));
            expect(storage.getState().sessionMessages[receipt.sessionId].messages).toHaveLength(0);
            expect(storage.getState().sessionMessages[receipt.sessionId].isAtLatest).toBe(true);
            expect(syncForTest.sessionMessageCacheGenerations.get(receipt.sessionId)).toBe(generation);
            await expect(project(...args)).resolves.toBe(true);
            assertTextAndFile();
            acknowledgement.resolve(response({ messages: [
                { id: 'remote-file', seq: 10, localId: 'local-file', createdAt: 100, updatedAt: 100 },
                { id: 'remote-text', seq: 11, localId: 'local-text', createdAt: 110, updatedAt: 110 },
            ] }));
            await vi.waitFor(() => expect(syncForTest.pendingOutbox.get(receipt.sessionId)).toBeUndefined());
            expect(generation.pendingLocalMessages.size).toBe(2);
            await syncForTest.applyLatestMessagePage(receipt.sessionId, { messages: echoed, hasMore: false },
                syncForTest.sessionMessageLoadGate.begin(lease));
            assertTextAndFile();
            const echoedCache = storage.getState().sessionMessages[receipt.sessionId];
            const textId = echoedCache.reducerState.localIds.get('local-text')!;
            expect(echoedCache.reducerState.messageIds.get('remote-text')).toBe(textId);
            expect(echoedCache.reducerState.messages.get(textId)?.realID).toBe('remote-text');
            expect(generation.pendingLocalMessages.size).toBe(0);
            expect(syncForTest.observedLocalMessageIds.get(receipt.sessionId).size).toBe(2);
            // The projection is unfinished when full cache loss crosses its
            // settlement boundary. The hook must keep the original receipt.
            const pending = project(...args);
            syncForTest.releaseSessionMessageCache(receipt.sessionId);
            if (retain) syncForTest.retainSessionMessageCache(receipt.sessionId);
            return pending;
        });
        const transferred = vi.fn();
        let hook!: ReturnType<typeof useSpawnSession>;
        function Harness() { hook = useSpawnSession(); return null; }
        let renderer: any;
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        try {
            await act(async () => { renderer = TestRenderer.create(React.createElement(Harness)); });
            await act(async () => {
                expect(await hook.spawn({
                    machineId: 'machine', machine: { id: 'machine', active: true, metadata: { homeDir: '/test' } } as any,
                    path: '/test', agent: 'codex', worktreeKey: null, prompt: 'hello',
                    images: [{ id: 'attachment' }] as any,
                }, false, transferred)).toBe(false);
            });
            expect(transferred).not.toHaveBeenCalled();
            expect(mocks.navigateToSession).not.toHaveBeenCalled();
            await expect(projection.mock.results[0].value).resolves.toBe(false);
            expect(storage.getState().sessionMessages[receipt.sessionId]).toBeUndefined();
            await act(async () => { expect(await hook.retryHydration()).toBe(true); });
            assertTextAndFile();
            expect(projection.mock.calls[1][2]).toBe(receipt);
            await act(async () => { expect(await hook.retryHydration()).toBe(false); });
            expect(send).toHaveBeenCalledTimes(1);
            expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
            expect(transferred).toHaveBeenCalledTimes(1);
            expect(mocks.navigateToSession.mock.calls).toEqual([['spawned-session']]);
            expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
            expect(syncForTest.pendingOutbox.get(receipt.sessionId)).toBeUndefined();

            const lease = syncForTest.sessionMessageLoadGate.enter(receipt.sessionId);
            await act(async () => {
                await syncForTest.applyLatestMessagePage(receipt.sessionId, { messages: echoed, hasMore: false },
                    syncForTest.sessionMessageLoadGate.begin(lease));
                assertTextAndFile();
                await syncForTest.applyLatestMessagePage(receipt.sessionId, {
                    messages: Array.from({ length: 300 }, (_, index) => apiMessage(index + 100)), hasMore: false,
                }, syncForTest.sessionMessageLoadGate.begin(lease));
            });
            const assertEvicted = () => {
                const cache = storage.getState().sessionMessages[receipt.sessionId];
                expect(cache.reducerState.localIds.has('local-text')).toBe(false);
                expect(cache.messages.some(message => message.kind === 'user-text' && message.localId === 'local-text')).toBe(false);
                expect(cache.reducerState.toolIdToMessageId.has('00000000-0000-4000-8000-000000000001')).toBe(false);
                expect(cache.messages.some(message => message.kind === 'tool-call' && message.tool.name === 'file')).toBe(false);
            };
            assertEvicted();
            await expect(project(receipt.sessionId, receipt.localIds, receipt)).resolves.toBe(false);
            assertEvicted();
            expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
        } finally {
            act(() => renderer?.unmount());
            acknowledgement.resolve(response({ messages: [] }));
            upload.mockRestore(); projection.mockRestore(); send.mockRestore();
            delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
        }
    });

    it.each([[], [''], [' '], ['missing'], ['test-uuid', 'missing'], ['__proto__'], ['constructor']].map(ids => ({ ids })))(
        'rejects unprojected or malformed literal receipt IDs $ids', async ({ ids }) => {
            const storage = await seedLocalProjectionSession();
            await sync.sendMessage('spawned-session', 'hello', { source: 'new_session' });
            await expect(sync.awaitLocalMessageProjection('spawned-session', ids)).resolves.toBe(false);
            expect(storage.getState().sessionMessages['spawned-session']?.messages.some(message => message.kind === 'user-text' && message.localId === 'test-uuid')).toBe(true);
            expect(mocks.apiRequest).not.toHaveBeenCalled();
        },
    );

    it.each(['before', 'during'] as const)('rejects deletion %s projection without recreating the cache', async (when) => {
        const storage = await seedLocalProjectionSession();
        const receipt = await sync.sendMessage('spawned-session', 'hello', { source: 'new_session' });
        if (when === 'before') sync.removeSessionLocally('spawned-session');
        const projection = sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds);
        if (when === 'during') sync.removeSessionLocally('spawned-session');
        await expect(projection).resolves.toBe(false);
        expect(storage.getState().sessionMessages['spawned-session']).toBeUndefined();
        expect(storage.getState().sessions['spawned-session']).toBeUndefined();
        expect(mocks.apiRequest).not.toHaveBeenCalled();
    });

    it('rejects a cache generation replaced during projection even if the same IDs reappear', async () => {
        const storage = await seedLocalProjectionSession();
        const receipt = await sync.sendMessage('spawned-session', 'hello', { source: 'new_session' });
        const projection = sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds);
        syncForTest.releaseSessionMessageCache('spawned-session');
        syncForTest.retainSessionMessageCache('spawned-session');
        storage.getState().applyMessages('spawned-session', [normalizeRawMessage('test-uuid', 'test-uuid', 1, rawText('replacement'))!]);
        await expect(projection).resolves.toBe(false);
    });

    it('restores an accepted receipt into a fresh empty generation without another send', async () => {
        const storage = await seedLocalProjectionSession();
        const receipt = await sync.sendMessage('spawned-session', 'hello', { source: 'new_session' });
        syncForTest.releaseSessionMessageCache(receipt.sessionId);
        syncForTest.retainSessionMessageCache(receipt.sessionId);

        await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds, receipt)).resolves.toBe(true);
        expect(storage.getState().sessionMessages[receipt.sessionId].messages).toHaveLength(1);
        expect(mocks.apiRequest).not.toHaveBeenCalled();
        expect(syncForTest.pendingOutbox.get(receipt.sessionId)).toHaveLength(1);
    });

    it.each([false, true])('restores accepted attachment and text receipts after eviction (remote acknowledgement: %s)', async (acknowledged) => {
        // Losing generation-local provenance must not strand an accepted spawn.
        const storage = await seedLocalProjectionSession();
        const upload = vi.spyOn(syncForTest, 'uploadAttachmentsForSession').mockResolvedValue({
            uploaded: [{ ref: 'encrypted-file', name: 'photo.png', size: 1, width: 10, height: 10 }], failed: 0,
        });
        vi.mocked(randomUUID).mockReturnValueOnce('00000000-0000-4000-8000-000000000001').mockReturnValueOnce('local-file').mockReturnValueOnce('local-text');
        try {
            const receipt = await sync.sendMessage('spawned-session', 'hello', {
                source: 'new_session', attachments: [{ id: 'attachment' }] as any,
            });
            const accepted = [...syncForTest.pendingOutbox.get(receipt.sessionId)];
            const gap = newMessageUpdate(receipt.sessionId, 7);
            gap.body.message.content = { t: 'encrypted', c: 'AQ==' };
            await syncForTest.handleUpdate(gap);
            expect(storage.getState().sessionMessages[receipt.sessionId]).toBeUndefined();
            await expect(sync.awaitLocalMessageProjection(receipt.sessionId, ['local-file', 'local-file'], receipt)).resolves.toBe(false);
            expect(storage.getState().sessionMessages[receipt.sessionId]).toBeUndefined();
            if (acknowledged) {
                syncForTest.pendingOutbox.get(receipt.sessionId).splice(0);
                // The remote echo can use a different transport ID, but keeps
                // the exact accepted local ID and file envelope identity.
                storage.getState().applyMessages(receipt.sessionId, [
                    normalizeRawMessage('remote-text', 'local-text', 20, rawText('hello'))!,
                ]);
            }
            await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds, receipt)).resolves.toBe(true);
            await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds, receipt)).resolves.toBe(true);
            const cache = storage.getState().sessionMessages[receipt.sessionId];
            expect(cache.messages).toHaveLength(2);
            expect(cache.messagesMap[cache.reducerState.localIds.get('local-text')!]).toMatchObject({ kind: 'user-text', localId: 'local-text', text: 'hello' });
            expect(cache.messagesMap[cache.reducerState.toolIdToMessageId.get('00000000-0000-4000-8000-000000000001')!]).toMatchObject({ kind: 'tool-call', tool: { name: 'file' } });
            expect(syncForTest.pendingOutbox.get(receipt.sessionId)).toEqual(acknowledged ? [] : accepted);
            expect(mocks.apiRequest).not.toHaveBeenCalled();
        } finally {
            upload.mockRestore();
        }
    });

    it('does not recover a forged receipt or revive a deleted receipt after the same session ID returns', async () => {
        const storage = await seedLocalProjectionSession();
        const receipt = await sync.sendMessage('spawned-session', 'hello', { source: 'new_session' });
        syncForTest.releaseSessionMessageCache(receipt.sessionId);
        await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds, { ...receipt })).resolves.toBe(false);
        sync.removeSessionLocally(receipt.sessionId);
        storage.getState().applySessions([hydrated(snapshot(receipt.sessionId))]);
        await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds, receipt)).resolves.toBe(false);
        expect(storage.getState().sessionMessages[receipt.sessionId]).toBeUndefined();
        expect(mocks.apiRequest).not.toHaveBeenCalled();
    });

    it('retries an evicted accepted spawn with one real send, one accepted message and one navigation', async () => {
        const storage = await seedLocalProjectionSession();
        mocks.machineSpawnNewSession.mockResolvedValue({ type: 'success', sessionId: 'spawned-session' });
        const send = vi.spyOn(sync, 'sendMessage');
        const project = sync.awaitLocalMessageProjection.bind(sync);
        const projection = vi.spyOn(sync, 'awaitLocalMessageProjection').mockImplementationOnce((...args) => {
            const pending = project(...args);
            syncForTest.releaseSessionMessageCache('spawned-session');
            return pending;
        });
        const transferred = vi.fn();
        let hook!: ReturnType<typeof useSpawnSession>;
        function Harness() { hook = useSpawnSession(); return null; }
        let renderer: any;
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const originalConsoleError = console.error;
        const consoleError = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
        try {
            await act(async () => { renderer = TestRenderer.create(React.createElement(Harness)); });
            await act(async () => {
                expect(await hook.spawn({
                    machineId: 'machine', machine: { id: 'machine', active: true, metadata: { homeDir: '/test' } } as any,
                    path: '/test', agent: 'codex', worktreeKey: null, prompt: 'hello',
                }, false, transferred)).toBe(false);
            });
            expect(mocks.navigateToSession).not.toHaveBeenCalled();
            expect(transferred).not.toHaveBeenCalled();
            expect(storage.getState().sessionMessages['spawned-session']).toBeUndefined();
            await act(async () => { expect(await hook.retryHydration()).toBe(true); });
            await act(async () => { expect(await hook.retryHydration()).toBe(false); });
            expect(send).toHaveBeenCalledTimes(1);
            expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
            expect(mocks.navigateToSession.mock.calls).toEqual([['spawned-session']]);
            expect(transferred).toHaveBeenCalledTimes(1);
            expect(syncForTest.pendingOutbox.get('spawned-session')).toHaveLength(1);
            expect(storage.getState().sessionMessages['spawned-session'].messages).toHaveLength(1);
            expect(mocks.apiRequest).not.toHaveBeenCalled();
        } finally {
            act(() => renderer?.unmount());
            projection.mockRestore();
            send.mockRestore();
            consoleError.mockRestore();
            delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
        }
    });

    it('emits one final store milestone for snapshot plus latest-page opening, after both complete', async () => {
        installSession('attribution-session');
        delete mocks.state.sessions['attribution-session'];
        mocks.state.currentViewingSessionId = 'attribution-session';
        mocks.fetchSnapshot.mockResolvedValue(snapshot('attribution-session'));
        mocks.apiRequest.mockResolvedValue(response({ messages: [apiMessage(1)], hasMore: false }));
        const stages: string[] = [];
        (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe = {
            markAppStage: (stage: string) => stages.push(stage),
        };

        await expect(syncForTest.openSession('attribution-session')).resolves.toBe('ready');
        expect(mocks.state.sessionMessages['attribution-session'].messagesMap['message-1']).toBeDefined();
        expect(stages).toEqual([
            'web.messages.latest_started',
            'web.session.snapshot_started',
            'web.session.snapshot_completed',
            'web.messages.latest_completed',
            'web.session.store_committed',
        ]);
    });

    it('revalidates an already loaded route incrementally instead of downloading the latest page again', async () => {
        installSession('warm-route');
        mocks.state.sessionMessages['warm-route'] = {
            messages: [], messagesMap: {}, reducerState: {}, isLoaded: true,
            hasMoreOlder: false, isLoadingOlder: false,
        };
        syncForTest.sessionMessageFrontiers.set('warm-route', {
            latestSeq: 42, olderBeforeSeq: 1, hasMoreOlder: false,
        });
        mocks.apiRequest.mockResolvedValue(response({ messages: [], hasMore: false }));

        await expect(syncForTest.openSession('warm-route')).resolves.toBe('ready');

        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
        expect(mocks.apiRequest).toHaveBeenCalledWith(
            '/v3/sessions/warm-route/messages?after_seq=42&limit=100',
        );
        expect(mocks.state.sessionMessages['warm-route'].latestVerifiedOwnerEpoch).not.toBeNull();
    });

    it('removes an offline-deleted cached session when incremental sync returns 404', async () => {
        const storage = await useRealMessageComposition();
        syncForTest.serverID = 'account';
        syncForTest.sessionWarmCacheAccountKey = 'account';
        mocks.sessionEncryptions.set('gone', new SessionEncryption('gone', {
            encrypt: async () => [], decrypt: async () => [],
        }, new EncryptionCache()));
        storage.getState().applySessions([hydrated(snapshot('gone'))]);
        storage.getState().applyMessagesLoaded('gone');
        syncForTest.sessionMessageFrontiers.set('gone', { latestSeq: 42, olderBeforeSeq: 1, hasMoreOlder: false });
        saveSessionWarmSnapshots('account', [snapshot('gone')]);
        saveSessionWarmLatestPage('account', 'gone', { messages: [apiMessage(42)], hasMore: false });
        mocks.apiRequest.mockResolvedValue({ ok: false, status: 404 });

        await expect(syncForTest.openSession('gone')).rejects.toBeInstanceOf(SessionRouteAbandonedError);
        expect(storage.getState().sessions.gone).toBeUndefined();
        expect(loadSessionWarmCache('account')).toEqual({ snapshots: [], latestPages: {} });
        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    });

    it('persists multiple incremental pages and restores their latest frontier', async () => {
        installSession('warm');
        syncForTest.serverID = 'account';
        syncForTest.sessionWarmCacheAccountKey = 'account';
        saveSessionWarmLatestPage('account', 'warm', { messages: [apiMessage(40)], hasMore: true });
        const lease = syncForTest.sessionMessageLoadGate.enter('warm');
        mocks.apiRequest
            .mockResolvedValueOnce(response({ messages: [apiMessage(41)], hasMore: true }))
            .mockResolvedValueOnce(response({ messages: [apiMessage(42)], hasMore: false }));
        await syncForTest.fetchForwardSince('warm', mocks.sessionEncryptions.get('warm'), 40,
            syncForTest.sessionMessageLoadGate.begin(lease));
        const page = loadSessionWarmCache('account').latestPages.warm;
        expect(page.messages.map(message => message.seq)).toEqual([40, 41, 42]);
        delete mocks.state.sessionMessages.warm;
        syncForTest.sessionMessageFrontiers.clear();
        await syncForTest.applyLatestMessagePage('warm', page, syncForTest.sessionMessageLoadGate.begin(lease));
        expect(syncForTest.getSessionLastMessageSeq('warm')).toBe(42);
    });

    it.each(['cached', 'shared'] as const)('attributes a route snapshot satisfied by %s hydration exactly once', async (source) => {
        installSession('prehydrated-session');
        mocks.state.currentViewingSessionId = 'prehydrated-session';
        const stages: string[] = [];
        (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe = {
            markAppStage: (stage: string) => stages.push(stage),
        };
        const shared = deferred<ApiSessionSnapshot | null>();
        let hydrating: Promise<boolean> | undefined;
        if (source === 'shared') {
            delete mocks.state.sessions['prehydrated-session'];
            mocks.fetchSnapshot.mockReturnValue(shared.promise);
            hydrating = syncForTest.ensureSessionHydrated('prehydrated-session');
        }
        const opening = syncForTest.openSession('prehydrated-session');
        if (source === 'shared') {
            await Promise.resolve();
            expect(stages).toEqual(['web.messages.latest_started', 'web.session.snapshot_started']);
            shared.resolve(snapshot('prehydrated-session'));
            await hydrating;
        }
        await expect(opening).resolves.toBe('ready');
        expect(mocks.fetchSnapshot).toHaveBeenCalledTimes(source === 'shared' ? 1 : 0);
        expect(stages).toEqual([
            'web.messages.latest_started', 'web.session.snapshot_started', 'web.session.snapshot_completed',
            'web.messages.latest_completed', 'web.session.store_committed',
        ]);
    });

    it('does not complete the snapshot span when a route awaiting shared hydration is abandoned', async () => {
        installSession('abandoned-hydration');
        delete mocks.state.sessions['abandoned-hydration'];
        const shared = deferred<ApiSessionSnapshot | null>();
        mocks.fetchSnapshot.mockReturnValue(shared.promise);
        const stages: string[] = [];
        (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe = {
            markAppStage: (stage: string) => stages.push(stage),
        };
        const hydrating = syncForTest.ensureSessionHydrated('abandoned-hydration');
        const opening = syncForTest.openSession('abandoned-hydration');
        const rejected = expect(opening).rejects.toBeInstanceOf(SessionRouteAbandonedError);
        syncForTest.abandonSessionRoute('abandoned-hydration', opening);
        shared.resolve(snapshot('abandoned-hydration'));
        await hydrating;
        await rejected;
        expect(stages).toEqual(['web.messages.latest_started', 'web.session.snapshot_started']);
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

    it('advances through sparse older pages and exhausts without skipping a cached island gap', async () => {
        const { storage, page } = await seedDisconnectedMessageRanges(20);
        mocks.apiRequest
            .mockResolvedValueOnce(response({ messages: page(50, 149), hasMore: true }))
            .mockResolvedValueOnce(response({ messages: page(21, 48), hasMore: false }));

        await syncForTest.loadOlderMessages('range-session');

        expect(mocks.apiRequest).toHaveBeenNthCalledWith(1, '/v3/sessions/range-session/messages?before_seq=151&limit=100');
        expect(syncForTest.sessionMessageFrontiers.get('range-session')).toEqual({
            latestSeq: 250, olderBeforeSeq: 50, hasMoreOlder: true,
        });
        await syncForTest.loadOlderMessages('range-session');
        expect(mocks.apiRequest).toHaveBeenNthCalledWith(2, '/v3/sessions/range-session/messages?before_seq=50&limit=100');
        expect(syncForTest.sessionMessageFrontiers.get('range-session')).toEqual({
            latestSeq: 250, olderBeforeSeq: 1, hasMoreOlder: false,
        });
        const messages = storage.getState().sessionMessages['range-session'];
        expect(messages.messages).toHaveLength(248);
        expect(new Set(messages.messages.map(message => message.id)).size).toBe(248);
        expect([...messages.reducerState.messageIds.keys()].sort()).toEqual([
            ...Array.from({ length: 48 }, (_, i) => `message-${i + 1}`),
            ...Array.from({ length: 100 }, (_, i) => `message-${i + 50}`),
            ...Array.from({ length: 100 }, (_, i) => `message-${i + 151}`),
        ].sort());
        expect(messages.hasMoreOlder).toBe(false);
        await syncForTest.loadOlderMessages('range-session');
        expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
    });

    it.each(['evicted', 'remounted'] as const)(
        'completes a deferred acknowledgement without changing the %s message cache', async (terminal) => {
            const { storage, page } = await seedDisconnectedMessageRanges();
            syncForTest.onSessionVisible('range-session', { loadMessages: false });
            syncForTest.pendingOutbox.set('range-session', [{ localId: 'deferred-send', content: 'ciphertext' }]);
            const acknowledgement = deferred<Response>();
            mocks.apiRequest.mockReturnValueOnce(acknowledgement.promise);
            const sending = syncForTest.flushOutbox('range-session');
            await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
            syncForTest.releaseSessionMessageCache('range-session');
            if (terminal === 'remounted') {
                syncForTest.onSessionVisible('range-session', { loadMessages: false });
                const lease = syncForTest.sessionMessageLoadGate.enter('range-session');
                await syncForTest.applyLatestMessagePage('range-session', { messages: page(301, 400), hasMore: false },
                    syncForTest.sessionMessageLoadGate.begin(lease));
            }

            acknowledgement.resolve(response({ messages: [{ seq: 500 }] }));
            await sending;

            expect(syncForTest.pendingOutbox.has('range-session')).toBe(false);
            expect(syncForTest.sendAbortControllers.has('range-session')).toBe(false);
            if (terminal === 'evicted') {
                expect(syncForTest.sessionMessageFrontiers.has('range-session')).toBe(false);
                expect(syncForTest.sessionMessageCacheGenerations.has('range-session')).toBe(false);
                expect(storage.getState().sessionMessages['range-session']).toBeUndefined();
            } else {
                expect(syncForTest.sessionMessageFrontiers.get('range-session')).toEqual({
                    latestSeq: 400, olderBeforeSeq: 301, hasMoreOlder: false,
                });
                expect(storage.getState().sessionMessages['range-session']).toMatchObject({
                    isLoaded: true, hasMoreOlder: false, isLoadingOlder: false,
                });
            }
        },
    );

    it('keeps a sparse older response bound to its requested frontier after an acknowledgement advances it', async () => {
        const { page } = await seedDisconnectedMessageRanges();
        const olderPage = deferred<Response>();
        mocks.apiRequest.mockReturnValueOnce(olderPage.promise);
        const loading = syncForTest.loadOlderMessages('range-session');
        await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith(
            '/v3/sessions/range-session/messages?before_seq=151&limit=100',
        ));
        syncForTest.pendingOutbox.set('range-session', [{ localId: 'during-older', content: 'ciphertext' }]);
        mocks.apiRequest.mockResolvedValueOnce(response({ messages: [{ seq: 350 }] }));
        await syncForTest.flushOutbox('range-session');

        olderPage.resolve(response({ messages: page(50, 149), hasMore: false }));
        await loading;

        expect(syncForTest.sessionMessageFrontiers.get('range-session')).toEqual({
            latestSeq: 350, olderBeforeSeq: 350, hasMoreOlder: true,
        });
    });

    it.each([
        { order: 'latest-first', cold: false, terminal: '' },
        { order: 'catch-up-first', cold: false, terminal: '' },
        { order: 'latest-first', cold: true, terminal: '' },
        { order: 'catch-up-first', cold: true, terminal: '' },
        { order: 'latest-first', cold: false, terminal: '', retryCatchUp: true },
        { order: 'latest-first', cold: false, terminal: 'abandoned' },
        { order: 'catch-up-first', cold: false, terminal: 'deleted' },
    ])(
        'waits for a committed foreground page while opening ($order, cold=$cold, terminal=$terminal, retry=$retryCatchUp)', async ({ order, cold, terminal, retryCatchUp = false }) => {
            const probe = installPhase2Probe('deep-link');
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
            let forwardRequests = 0;
            mocks.apiRequest.mockImplementation(async (url: string) => {
                if (url.includes('before_seq=')) {
                    latestRequests++;
                    return response({ messages: [encrypted(7)], hasMore: true });
                }
                if (retryCatchUp && forwardRequests++ === 0) throw new Error('synthetic catch-up failure');
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
            await vi.waitFor(() => expect(forwardStarted).toBe(true), { timeout: 3000 });
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
            expect(storage.getState().sessionMessages['opening-session'].latestVerifiedOwnerEpoch).not.toBeNull();
            expect(storage.getState().currentViewingSessionId).toBeNull();
            probe.markFreshLatestMessageComplete();
            expect(probe.collect().samples).toHaveLength(1);
            expect(probe.collect().samples[0].retryCount).toBe(retryCatchUp ? 1 : 0);
        },
    );

    it.each(['ready', 'exhausted', 'abandoned', 'deleted', 'abandoned-network', 'deleted-network'] as const)(
        'bounds latest-page recovery under the same live owner (%s)', async (result) => {
            const probe = installPhase2Probe('spawn');
            probe.startNewTextSession();
            probe.markNewSessionEvent(); probe.markLocalQueue(); probe.markAppStage('web.session.navigated');
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
                probe.markRouteNavigation(); probe.markProcessorReady(); probe.markFirstAgentEvent(); probe.markTurnCompletion();
                expect(probe.collect().samples[0].retryCount).toBe(1);
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

    it('exports the actual failed latest request and succeeding target-route retry as nonzero spawn evidence', async () => {
        const probe = installPhase2Probe('spawn');
        probe.startNewTextSession();
        probe.markNewSessionEvent(); probe.markLocalQueue(); probe.markAppStage('web.session.navigated');
        installSession('retry-target');
        mocks.apiRequest.mockRejectedValueOnce(new Error('synthetic-network-failure'))
            .mockResolvedValueOnce(response({ messages: [apiMessage(1)], hasMore: false }));
        const first = syncForTest.beginSessionRoute('retry-target');
        await expect(syncForTest.openSession('retry-target', first)).rejects.toThrow('synthetic-network-failure');
        syncForTest.leaveSessionRoute(first);
        const retry = syncForTest.beginSessionRoute('retry-target');
        await expect(syncForTest.openSession('retry-target', retry, { retry: true })).resolves.toBe('ready');
        probe.markRouteNavigation(); probe.markProcessorReady(); probe.markFirstAgentEvent(); probe.markTurnCompletion();
        const evidence = JSON.parse(JSON.stringify(probe.collect()));
        expect(evidence.samples[0].retryCount).toBe(1);
        expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
        const { evaluatePhase2CriticalPath } = await vi.importActual<any>('../../scripts/check-session-critical-path.mjs');
        expect(() => evaluatePhase2CriticalPath(evidence)).toThrow('RETRY_DETECTED');
    });

    it('keeps unrelated message fetches out of the measured route milestone set', async () => {
        const probe = installPhase2Probe('deep-link');
        installSession('unrelated'); installSession('measured');
        const lease = syncForTest.sessionMessageLoadGate.enter('unrelated');
        await syncForTest.fetchMessages('unrelated', syncForTest.sessionMessageLoadGate.begin(lease));
        await expect(syncForTest.openSession('measured')).resolves.toBe('ready');
        probe.markFreshLatestMessageComplete();
        const stages = probe.collect().samples[0].stages.map((entry: any) => entry.stage);
        expect(stages.filter((stage: string) => stage === 'web.messages.latest_started')).toHaveLength(1);
        expect(stages.filter((stage: string) => stage === 'web.session.store_committed')).toHaveLength(1);
    });

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

    it('receives encrypted startup ready before unowned spawn hydration finishes and never replays history as receipt', async () => {
        const probe = installPhase2Probe('spawn');
        const handle = sessionStartupTraceRuntime.begin('00000000-0000-4000-8000-000000000012', 0);
        sessionStartupTraceRuntime.mark(handle, 'web.spawn.clicked');
        sessionStartupTraceRuntime.bindSession(handle, 'pending-spawn');
        const encryption = installSession('pending-spawn');
        // Compose has bound the RPC result but is still waiting for encryption/hydration.
        delete mocks.state.sessions['pending-spawn'];
        const hydration = deferred<ApiSessionSnapshot | null>();
        mocks.fetchSnapshot.mockReturnValue(hydration.promise);
        const hydrating = syncForTest.ensureSessionHydrated('pending-spawn');
        await vi.waitFor(() => expect(mocks.fetchSnapshot).toHaveBeenCalled());
        // Realtime bootstrap has independently supplied the minimum decryption context.
        mocks.state.sessions['pending-spawn'] = hydrated(snapshot('pending-spawn'));
        const ready: RawRecord = { role: 'agent', content: { type: 'event', id: 'ready', data: { type: 'ready' } } };
        encryption.decryptMessage.mockResolvedValue({ id: 'ready', localId: null, createdAt: 50, content: ready });
        await syncForTest.handleUpdate(newMessageUpdate('pending-spawn', 1));
        expect(mocks.state.currentViewingSessionId).toBeNull();
        expect(syncForTest.sessionRouteOwnership.current()).toBeNull();
        expect(mocks.runtimeEvents.filter(event => event.stage === 'web.processor.ready_received')).toHaveLength(1);
        hydration.resolve(snapshot('pending-spawn'));
        await hydrating;
        sessionStartupTraceRuntime.mark(handle, 'web.session.hydrated');
        sessionStartupTraceRuntime.mark(handle, 'web.first_message.queued');
        sessionStartupTraceRuntime.mark(handle, 'web.session.navigated');
        probe.markRouteNavigation();
        sessionStartupTraceRuntime.markSessionStage('pending-spawn', 'web.first_agent_event_received');
        sessionStartupTraceRuntime.markSessionStage('pending-spawn', 'web.turn.completed');
        expect(probe.collect().samples).toHaveLength(1);

        delete (globalThis as any).__happySessionCriticalPathProbe;
        const replay = sessionStartupTraceRuntime.begin('00000000-0000-4000-8000-000000000013', 0);
        sessionStartupTraceRuntime.bindSession(replay, 'pending-spawn');
        mocks.runtimeEvents = [];
        syncForTest.applyMessages('pending-spawn', [normalizeRawMessage('ready', null, 50, ready)]);
        expect(mocks.runtimeEvents).toEqual([]);
        sessionStartupTraceRuntime.finish(replay);
    });

    it('records first agent activity before a combined catch-up batch closes the real runtime/probe', async () => {
        const probe = installPhase2Probe('spawn');
        const handle = sessionStartupTraceRuntime.begin('00000000-0000-4000-8000-000000000014', 0);
        for (const stage of ['web.spawn.clicked', 'web.session.hydrated', 'web.first_message.queued', 'web.session.navigated'] as const) {
            sessionStartupTraceRuntime.mark(handle, stage);
        }
        sessionStartupTraceRuntime.bindSession(handle, 'batch-session');
        probe.markRouteNavigation();
        const encryption = installSession('batch-session');
        const ready: RawRecord = { role: 'agent', content: { type: 'event', id: 'ready', data: { type: 'ready' } } };
        encryption.decryptMessage.mockResolvedValue({ id: 'ready', localId: null, createdAt: 1, content: ready });
        // A real realtime receipt is required; the same ready packet may also occur in catch-up.
        mocks.state.currentViewingSessionId = 'batch-session';
        syncForTest.sessionMessageFrontiers.set('batch-session', { latestSeq: 0, olderBeforeSeq: null, hasMoreOlder: false });
        await syncForTest.handleUpdate(newMessageUpdate('batch-session', 1));
        await vi.waitFor(() => expect(mocks.runtimeEvents.some(e => e.stage === 'web.processor.ready_received')).toBe(true));
        const agent: RawRecord = { role: 'agent', content: { type: 'output', data: { type: 'assistant', uuid: 'agent', message: { role: 'assistant', model: 'test-model', content: [{ type: 'text', text: 'test output' }] } } } };
        const terminal: RawRecord = { role: 'agent', content: { type: 'session', data: { id: 'end', time: 3, role: 'agent', turn: 'turn', ev: { t: 'turn-end', status: 'completed' } } } };
        syncForTest.applyMessages('batch-session', [ready, agent, terminal].map((raw, i) => normalizeRawMessage(`batch-${i}`, null, i, raw)));
        expect(mocks.runtimeEvents.map(e => e.stage).slice(-3)).toEqual([
            'web.processor.ready_received', 'web.first_agent_event_received', 'web.turn.completed',
        ]);
        expect(probe.collect().samples).toHaveLength(1);
    });

    it.each(['before', 'after'] as const)('collects one queued realtime ready/agent/terminal batch when route paint is %s completion', async (paint) => {
        const probe = installPhase2Probe('spawn');
        const handle = sessionStartupTraceRuntime.begin('00000000-0000-4000-8000-000000000015', 0);
        for (const stage of ['web.spawn.clicked', 'web.session.hydrated', 'web.first_message.queued', 'web.session.navigated'] as const) {
            sessionStartupTraceRuntime.mark(handle, stage);
        }
        sessionStartupTraceRuntime.bindSession(handle, 'queued-batch');
        const encryption = installSession('queued-batch');
        mocks.state.currentViewingSessionId = 'queued-batch';
        syncForTest.sessionMessageFrontiers.set('queued-batch', { latestSeq: 0, olderBeforeSeq: null, hasMoreOlder: false });
        const packets = [
            { role: 'agent', content: { type: 'event', id: 'ready', data: { type: 'ready' } } },
            { role: 'agent', content: { type: 'output', data: { type: 'assistant', uuid: 'output', message: { role: 'assistant', model: 'test', content: [{ type: 'text', text: 'test output' }] } } } },
            { role: 'agent', content: { type: 'session', data: { id: 'end', time: 3, role: 'agent', turn: 'turn', ev: { t: 'turn-end', status: 'completed' } } } },
        ];
        encryption.decryptMessage.mockImplementation(async (message: ApiMessage) => ({
            id: message.id, localId: null, createdAt: message.createdAt, content: packets[message.seq - 1],
        }));
        const release = deferred<void>();
        const holding = syncForTest.getSessionMessageLock('queued-batch').inLock(() => release.promise);
        if (paint === 'before') probe.markRouteNavigation();
        for (let seq = 1; seq <= 3; seq++) await syncForTest.handleUpdate(newMessageUpdate('queued-batch', seq));
        expect(syncForTest.sessionMessageQueue.get('queued-batch')).toHaveLength(3);
        expect(mocks.runtimeEvents.at(-1)?.stage).toBe('web.processor.ready_received');
        release.resolve(); await holding;
        await vi.waitFor(() => expect(mocks.runtimeEvents.at(-1)?.stage).toBe('web.turn.completed'));
        if (paint === 'after') probe.markRouteNavigation();
        expect(mocks.runtimeEvents.map(event => event.stage).slice(-3)).toEqual([
            'web.processor.ready_received', 'web.first_agent_event_received', 'web.turn.completed',
        ]);
        expect(probe.collect().samples).toHaveLength(1);
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
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        const firstFailedPageRefresh = deferred<void>();
        mocks.gitInvalidate.mockImplementationOnce(() => { firstFailedPageRefresh.resolve(); });
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
            // Observe the first failure's finally boundary before any retry.
            // Polling can miss exactly-two requests when random backoff is 0ms.
            await firstFailedPageRefresh.promise;
            expect(mocks.apiRequest).toHaveBeenCalledTimes(2);

            expect(mocks.state.sessionMessages['visible-session']?.messagesMap['message-5']).toBeDefined();
            expect(syncForTest.getSessionLastMessageSeq('visible-session')).toBe(5);
            expect(mocks.gitInvalidate).toHaveBeenCalledTimes(1);
        } finally {
            syncForTest.releaseSessionMessageCache('visible-session');
            await messageSync.awaitQueue();
            random.mockRestore();
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

    async function installHistoricalBoundary(scope: string, retainedHistory?: NonNullable<Awaited<ReturnType<typeof openLocalHistory>>>) {
        const history = retainedHistory ?? (await openLocalHistory(scope))!;
        syncForTest.localHistory = history;
        installSession('visible-session');
        await history.commitPage('visible-session', { direction: 'older', boundary: 103,
            messages: [apiMessage(100), apiMessage(101), apiMessage(102)], hasMore: true });
        const lease = syncForTest.sessionMessageLoadGate.currentLease('visible-session') ?? syncForTest.sessionMessageLoadGate.enter('visible-session');
        await syncForTest.applyHistoryWindow('visible-session', await history.readWindow('visible-session', { anchorSeq: 101 }),
            syncForTest.sessionMessageLoadGate.begin(lease));
        return history;
    }

    async function mountBoundaryChat(direction: 'older' | 'newer') {
        const { ChatList } = await import('@/components/ChatList');
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        // The store double exposes sync's actual writes. Re-render publishes
        // each settled write to the mounted ChatList, without mocking paging.
        const render = () => React.createElement(ChatList, { session: { ...mocks.state.sessions['visible-session'] } as any });
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render()); });
        return {
            renderer,
            update: async () => { await act(async () => { renderer.update(render()); }); },
            reach: () => act(() => renderer.root.findByType('FlatList').props.onScroll({ nativeEvent: {
                contentOffset: { y: direction === 'older' ? 4500 : 0 }, contentSize: { height: 5000 }, layoutMeasurement: { height: 500 },
            } })),
            retry: () => act(() => renderer.root.findByProps({ testID: `history-${direction}-retry` }).props.onPress()),
            unmount: () => act(() => renderer.unmount()),
        };
    }

    it.each(['older', 'newer'] as const)('releases superseded Web %s loading and retries the same boundary through mounted ChatList', async direction => {
        vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
        await installHistoricalBoundary(`server|web-${direction}`);
        const originalRows = mocks.state.sessionMessages['visible-session'].messages;
        const firstPage = deferred<Response>();
        mocks.apiRequest.mockReturnValueOnce(firstPage.promise)
            .mockResolvedValueOnce(response({ messages: [apiMessage(direction === 'older' ? 99 : 103)], hasMore: false }));
        const chat = await mountBoundaryChat(direction);
        try {
            chat.reach();
            await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
            const first = syncForTest.historyWindowLoads.get('visible-session');
            const field = direction === 'older' ? 'isLoadingOlder' : 'isLoadingNewer';
            expect(mocks.state.sessionMessages['visible-session'][field]).toBe(true);
            await chat.update();
            syncForTest.onSessionVisible('visible-session');
            await syncForTest.messagesSync.get('visible-session').awaitQueue(); // historical foreground no-op, but new loadEpoch
            firstPage.resolve(response({ messages: [], hasMore: true }));
            await first;
            expect(mocks.state.sessionMessages['visible-session'][field]).toBe(false);
            expect(mocks.state.sessionMessages['visible-session'].messages).toBe(originalRows);
            await chat.update();
            // Normal repeated scrolling is bounded; explicit Retry bypasses the
            // transcript's attempted-boundary latch for the identical edge.
            chat.reach(); expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
            chat.retry();
            await syncForTest.historyWindowLoads.get('visible-session');
            await chat.update();
            expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
            expect(mocks.apiRequest.mock.calls[1][0]).toBe(mocks.apiRequest.mock.calls[0][0]);
            expect(mocks.state.sessionMessages['visible-session'][field]).toBe(false);
            expect(mocks.state.sessionMessages['visible-session'][`${direction}Error`] ?? null).toBeNull();
            expect(syncForTest.historyWindows.get('visible-session').messages.some((row: ApiMessage) => row.seq === (direction === 'older' ? 99 : 103))).toBe(true);
            expect(chat.renderer.root.findAllByProps({ testID: `history-${direction}-retry` })).toHaveLength(0);
        } finally { chat.unmount(); }
    });

    it.each([['older', 'remount'], ['newer', 'remount'], ['older', 'account'], ['newer', 'account']] as const)(
        'does not let stale Web %s cleanup alter a %s replacement cache', async (direction, replacement) => {
            vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
            const oldHistory = await installHistoricalBoundary('server|old-boundary');
            const oldPage = deferred<Response>(); const newPage = deferred<Response>();
            mocks.apiRequest.mockReturnValueOnce(oldPage.promise).mockReturnValueOnce(newPage.promise);
            const load = () => direction === 'older' ? sync.loadOlderMessages('visible-session') : sync.loadNewerMessages('visible-session');
            const oldLoading = load(); await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(1));
            if (replacement === 'remount') syncForTest.releaseSessionMessageCache('visible-session');
            else syncForTest.encryption = { ...syncForTest.encryption };
            await installHistoricalBoundary(`server|${replacement}-replacement`, replacement === 'remount' ? oldHistory : undefined);
            const newLoading = load(); await vi.waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledTimes(2));
            oldPage.reject(new Error('stale owner failed'));
            await oldLoading;
            const field = direction === 'older' ? 'isLoadingOlder' : 'isLoadingNewer';
            expect(mocks.state.sessionMessages['visible-session'][field]).toBe(true);
            expect(mocks.state.sessionMessages['visible-session'][`${direction}Error`]).toBeNull();
            newPage.resolve(response({ messages: [apiMessage(direction === 'older' ? 99 : 103)], hasMore: false }));
            await newLoading;
            expect(mocks.state.sessionMessages['visible-session'][field]).toBe(false);
            expect(syncForTest.historyWindows.get('visible-session').messages.some((row: ApiMessage) => row.seq === (direction === 'older' ? 99 : 103))).toBe(true);
            oldHistory.close();
        });

    it.each(['web', 'android'] as const)('renders a retryable no-IDB older failure on %s through mounted ChatList and clears it after retry', async platform => {
        const { Platform } = await import('react-native');
        const previousPlatform = Platform.OS;
        (Platform as any).OS = platform;
        vi.stubGlobal('indexedDB', undefined);
        expect(await openLocalHistory('server|unavailable')).toBeNull();
        installSession('visible-session');
        const readingMessage = { id: 'message-103', kind: 'user-text', text: 'reading', createdAt: 1, localId: null };
        const originalRows = [readingMessage];
        mocks.state.sessionMessages['visible-session'] = {
            messages: originalRows,
            messagesMap: { 'message-103': readingMessage }, isLoaded: true, hasMoreOlder: true, isLoadingOlder: false, isAtLatest: true,
        };
        syncForTest.sessionMessageFrontiers.set('visible-session', { latestSeq: 109, olderBeforeSeq: 103, hasMoreOlder: true });
        mocks.apiRequest.mockRejectedValueOnce(new Error('offline older page'))
            .mockResolvedValueOnce(response({ messages: [apiMessage(90)], hasMore: false }));
        const chat = await mountBoundaryChat('older');
        try {
            chat.reach();
            await vi.waitFor(() => expect(mocks.state.sessionMessages['visible-session'].isLoadingOlder).toBe(false));
            await chat.update();
            expect(chat.renderer.root.findAllByProps({ testID: 'history-older-retry' })).toHaveLength(1);
            expect(mocks.state.sessionMessages['visible-session'].messages).toBe(originalRows);
            chat.reach(); expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
            chat.retry();
            await vi.waitFor(() => expect(mocks.state.sessionMessages['visible-session'].messagesMap['message-90']).toBeDefined());
            await chat.update();
            expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
            expect(mocks.apiRequest.mock.calls[1][0]).toBe('/v3/sessions/visible-session/messages?before_seq=103&limit=100');
            expect(mocks.state.sessionMessages['visible-session'].olderError).toBeNull();
            expect(mocks.state.sessionMessages['visible-session'].messagesMap['message-103']).toBe(readingMessage);
            expect(chat.renderer.root.findAllByProps({ testID: 'history-older-retry' })).toHaveLength(0);
        } finally { chat.unmount(); (Platform as any).OS = previousPlatform; }
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
        mocks.apiRequest.mockResolvedValue(response({ messages: [apiMessage(90)], hasMore: true }));

        await syncForTest.loadOlderMessages('visible-session');

        expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
        expect(mocks.apiRequest).toHaveBeenCalledWith(
            '/v3/sessions/visible-session/messages?before_seq=103&limit=100',
        );
        expect(mocks.state.sessionMessages['visible-session'].messagesMap['message-90']).toBeDefined();
        expect(syncForTest.sessionMessageFrontiers.get('visible-session')?.olderBeforeSeq).toBe(90);
    });
});
