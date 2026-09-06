import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSessionSnapshot } from './apiTypes';
import { SessionMessageLoadGate } from './sessionMessageLoadGate';
import { SessionMessageRetention } from './sessionMessageRetention';
import { openLocalHistory, subscribeLocalHistoryInvalidation } from './localHistoryStore';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

vi.hoisted(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    (globalThis as unknown as { expo?: { EventEmitter: unknown } }).expo = {
        EventEmitter: EventTarget,
    };
});

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), fetchActive: vi.fn(), fetchPage: vi.fn(), fetchSnapshot: vi.fn() }));
vi.mock('./apiSessions', () => ({
    fetchActiveSessionSnapshots: mocks.fetchActive,
    fetchSessionSnapshot: mocks.fetchSnapshot,
    fetchSessionSnapshotPage: mocks.fetchPage,
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
vi.mock('./pushRegistration', () => ({ syncCurrentPushToken: vi.fn() }));
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
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
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
import { storage } from './storage';
import { Encryption } from './encryption/encryption';
import { EncryptionCache } from './encryption/encryptionCache';
import * as sessionFallbackTitle from './sessionFallbackTitle';

const subject = sync as any;
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}
function snapshot(overrides: Partial<ApiSessionSnapshot> = {}): ApiSessionSnapshot {
    return { id: 'writer-session', seq: 2, metadata: 'AA==', metadataVersion: 1,
        agentState: null, agentStateVersion: 0, dataEncryptionKey: null,
        active: false, activeAt: 10, createdAt: 1, updatedAt: 10, ...overrides };
}
function envelope(body: object, seq = 9000, createdAt = 20) {
    return { id: 'synthetic-event', seq, createdAt, body };
}
function encryption() {
    const value = Object.create(Encryption.prototype) as any;
    value.sessionEncryptions = new Map();
    value.sessionBlobKeys = new Map();
    value.cache = new EncryptionCache();
    value.masterBlobKey = new Uint8Array(32);
    value.openEncryption = async () => ({
        decrypt: async () => [{ path: 'synthetic-directory', host: 'synthetic-host', summary: { text: 'synthetic-title', updatedAt: 1 } }],
        encrypt: async () => [new Uint8Array([0])],
    });
    return value as Encryption;
}
beforeEach(() => {
    vi.clearAllMocks();
    subject.credentials = { token: 'synthetic-auth' };
    subject.encryption = encryption();
    storage.setState({ sessions: {}, sessionMessages: {}, currentViewingSessionId: null });
    subject.sessionMutationGeneration = 0;
    subject.sessionMutationGenerations.clear();
    subject.sessionDeletionMutationGenerations.clear();
    subject.inFlightSessionRefreshes.clear();
    subject.sessionHydrations?.clear();
    subject.sessionEventCursors?.clear();
    subject.pendingOutbox.clear();
    subject.sessionMessageLoadGate = new SessionMessageLoadGate();
    subject.sessionMessageRetention = new SessionMessageRetention(3);
    subject.sessionMessageFrontiers.clear();
    subject.sessionCachedMessageSeqs.clear();
    subject.historyWindows.clear();
    subject.historyWindowLoads.clear();
    subject.localHistory = null;
    subject.sessionsSync = { awaitQueue: async () => undefined };
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    mocks.apiRequest.mockResolvedValue({ ok: true, json: async () => ({ messages: [], hasMore: false }) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('real session writer composition', () => {
    it('keeps a historical send stable through ACK and includes its accepted ciphertext after explicit latest navigation', async () => {
        globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange;
        await sync.ensureSessionHydrated('writer-session');
        const sessionEncryption = subject.encryption.getSessionEncryption('writer-session');
        vi.spyOn(sessionEncryption, 'encryptRawRecord').mockImplementation(async value => JSON.stringify(value));
        vi.spyOn(sessionEncryption, 'createDetached').mockReturnValue({ decryptMessages: async (rows: any[]) => rows.map(row => ({
            ...row, content: JSON.parse(row.content.c),
        })) });
        vi.spyOn(subject, 'getSendSync').mockReturnValue({ invalidate: () => undefined });
        const history = (await openLocalHistory('server|historical-send'))!; subject.localHistory = history;
        const old = { id: 'old-wire', seq: 1, localId: null, createdAt: 1, updatedAt: 1,
            content: { t: 'encrypted' as const, c: JSON.stringify({ role: 'user', content: { type: 'text', text: 'old reading' } }) } };
        await history.commitPage('writer-session', { direction: 'older', boundary: 2, messages: [old], hasMore: false });
        const lease = subject.sessionMessageLoadGate.enter('writer-session');
        await subject.applyHistoryWindow('writer-session', await history.readWindow('writer-session', { anchorSeq: 1 }), subject.sessionMessageLoadGate.begin(lease));
        const historicalRows = storage.getState().sessionMessages['writer-session'].messages;
        const receipt = await sync.sendMessage('writer-session', 'accepted while reading');
        expect(receipt.type).toBe('queued');
        mocks.apiRequest.mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: 'accepted-wire', seq: 2,
            localId: receipt.localIds[0], createdAt: 2, updatedAt: 2 }] }) });
        await subject.flushOutbox('writer-session');
        expect(subject.pendingOutbox.has('writer-session')).toBe(false);
        expect(storage.getState().sessionMessages['writer-session'].messages).toBe(historicalRows);
        expect(subject.historyWindows.get('writer-session').newestSeq).toBe(1);
        const accepted = (await history.readWindow('writer-session', { anchorSeq: 2 }))?.messages.find(row => row.id === 'accepted-wire');
        expect(accepted).toBeDefined();
        // No certified tail existed in the historical-only archive. A real
        // latest-page response must include the server's accepted record.
        mocks.apiRequest.mockImplementation(async (url: string) => ({ ok: true, json: async () => ({
            messages: url.includes('before_seq=') ? [old, accepted] : [], hasMore: false,
        }) }));
        await sync.jumpToLatestMessages('writer-session');
        expect(storage.getState().sessionMessages['writer-session'].isAtLatest).toBe(true);
        expect(storage.getState().sessionMessages['writer-session'].messages.some(row => row.kind === 'user-text' && row.text === 'accepted while reading')).toBe(true);
        expect(subject.historyWindows.get('writer-session').messages.some((row: any) => row.id === 'accepted-wire')).toBe(true);
        history.close();
    });
    it('queues a historical send without inserting current-turn rows into the reading window', async () => {
        await sync.ensureSessionHydrated('writer-session');
        vi.spyOn(subject, 'getSendSync').mockReturnValue({ invalidate: () => undefined });
        const enqueue = vi.spyOn(subject, 'enqueueMessages');
        subject.historyWindows.set('writer-session', { messages: [], isAtLatest: false });
        storage.setState({ sessionMessages: { 'writer-session': { messages: [], isAtLatest: false } as any } });
        expect((await sync.sendMessage('writer-session', 'new turn from historical reading')).type).toBe('queued');
        expect(subject.pendingOutbox.get('writer-session')).toHaveLength(1);
        expect(enqueue).not.toHaveBeenCalled();
        expect(storage.getState().sessionMessages['writer-session']).toMatchObject({ isAtLatest: false, hasMoreNewer: true });
    });

    it('invalidates native decoded attachments on session deletion even without IndexedDB', async () => {
        await sync.ensureSessionHydrated('writer-session');
        subject.localHistory = null; subject.sessionWarmCacheAccountKey = 'https://test|account';
        const invalidated = vi.fn(); const unsubscribe = subscribeLocalHistoryInvalidation(invalidated);
        sync.removeSessionLocally('writer-session');
        expect(invalidated).toHaveBeenCalledWith({ scope: 'https://test|account', sessionId: 'writer-session', kind: 'session-deleted' });
        unsubscribe();
    });

    it('an explicit latest jump waits out an older load, then actually selects latest', async () => {
        const older = deferred<void>(); const history = {}; subject.localHistory = history;
        subject.historyWindowLoads.set('writer-session', older.promise);
        const boundary = vi.spyOn(subject, 'loadHistoryBoundary').mockResolvedValue(undefined);
        const jumping = sync.jumpToLatestMessages('writer-session');
        expect(boundary).not.toHaveBeenCalled();
        subject.historyWindowLoads.delete('writer-session'); older.resolve(); await jumping;
        expect(boundary).toHaveBeenCalledWith('writer-session', 'latest');
        subject.localHistory = null;
    });

    it('does not repeat a latest selection that the awaited load already completed', async () => {
        const pending = deferred<void>(); subject.localHistory = {};
        subject.historyWindowLoads.set('writer-session', pending.promise);
        const boundary = vi.spyOn(subject, 'loadHistoryBoundary').mockResolvedValue(undefined);
        const jumping = sync.jumpToLatestMessages('writer-session');
        subject.historyWindows.set('writer-session', { isAtLatest: true });
        pending.resolve(); await jumping;
        expect(boundary).not.toHaveBeenCalled();
    });

    it('does not start a network request after an awaited archive read loses its account owner', async () => {
        const read = deferred<any>();
        subject.localHistory = { captureSessionFence: () => ({}), isFenceCurrent: () => true, readWindow: () => read.promise };
        const jumping = sync.jumpToLatestMessages('writer-session');
        subject.localHistory = null; read.resolve(null); await jumping;
        expect(mocks.apiRequest).not.toHaveBeenCalled();
    });
    it('ignores an outbox acknowledgement that arrives after session deletion', async () => {
        await sync.ensureSessionHydrated('writer-session');
        vi.spyOn(subject, 'getSendSync').mockReturnValue({ invalidate: () => undefined });
        await sync.sendMessage('writer-session', 'synthetic-message');
        const response = deferred<any>();
        mocks.apiRequest.mockReturnValue(response.promise);
        const flush = subject.flushOutbox('writer-session');
        await subject.handleUpdate(envelope({ t: 'delete-session', sid: 'writer-session' }, 9001));
        response.resolve({ ok: true, json: async () => ({ messages: [{ seq: 3 }] }) });
        await flush;
        expect(subject.sessionMessageFrontiers.has('writer-session')).toBe(false);
    });

    it('cannot apply an old full replacement to a new encryption owner', async () => {
        const response = deferred<any>();
        vi.stubGlobal('fetch', vi.fn(() => response.promise));
        const pending = subject.fetchSessions();
        subject.encryption = encryption();
        await sync.ensureSessionHydrated('writer-session');
        response.resolve({ ok: true, json: async () => ({ sessions: [] }) });
        await pending;
        expect(Boolean(storage.getState().sessions['writer-session'])).toBe(true);
        expect(Boolean(subject.encryption.getSessionEncryption('writer-session'))).toBe(true);
    });

    it.each(['snapshot', 'latest'] as const)('can retry a cold route after transient %s failure without a full-list fallback', async source => {
        const legacy = vi.fn(() => { throw new Error('unexpected-full-list-request'); });
        vi.stubGlobal('fetch', legacy);
        if (source === 'snapshot') mocks.fetchSnapshot.mockRejectedValueOnce(new Error('synthetic-network-failure'));
        else mocks.apiRequest.mockRejectedValueOnce(new Error('synthetic-network-failure'));
        const first = sync.openSession('writer-session');
        await expect(first).rejects.toThrow('synthetic-network-failure');
        sync.abandonSessionRoute('writer-session', first);
        const retry = sync.openSession('writer-session');
        expect(await retry).toBe('ready');
        expect(storage.getState().sessionMessages['writer-session'].isLoaded).toBe(true);
        expect(legacy).not.toHaveBeenCalled();
        sync.abandonSessionRoute('writer-session', retry);
    });

    it('does not lose a second queued send when an already in-flight flush acknowledges the first', async () => {
        await sync.ensureSessionHydrated('writer-session');
        vi.spyOn(subject, 'getSendSync').mockReturnValue({ invalidate: () => undefined });
        await sync.sendMessage('writer-session', 'synthetic-first');
        const response = deferred<any>();
        mocks.apiRequest.mockReturnValue(response.promise);
        const flush = subject.flushOutbox('writer-session');
        await sync.sendMessage('writer-session', 'synthetic-second');
        response.resolve({ ok: true, json: async () => ({ messages: [{ seq: 3 }] }) });
        await flush;
        expect(subject.pendingOutbox.get('writer-session')).toHaveLength(1);
    });

    it('leaves no partial outbox when text encryption fails after an attachment was prepared', async () => {
        await sync.ensureSessionHydrated('writer-session');
        const current = subject.encryption.getSessionEncryption('writer-session') as any;
        let count = 0;
        current.encryptor.encrypt = async () => {
            if (++count > 1) throw new Error('synthetic-encryption-failure');
            return [new Uint8Array([0])];
        };
        vi.spyOn(subject, 'uploadAttachmentsForSession').mockResolvedValue({ failed: 0,
            uploaded: [{ ref: 'synthetic-ref', name: 'synthetic-image', size: 1, width: 1, height: 1 }] });
        await expect(sync.sendMessage('writer-session', 'synthetic-message', { attachments: [{ id: 'a' }] as any })).rejects.toThrow();
        expect(sync.hasPendingOutboxMessagesForSession('writer-session')).toBe(false);
    });

    it('refuses the complete local queue if the session was deleted during encryption', async () => {
        await sync.ensureSessionHydrated('writer-session');
        const gate = deferred<any>();
        const current = subject.encryption.getSessionEncryption('writer-session') as any;
        current.encryptor.encrypt = async () => gate.promise;
        const pending = sync.sendMessage('writer-session', 'synthetic-message');
        await subject.handleUpdate(envelope({ t: 'delete-session', sid: 'writer-session' }, 9001));
        gate.resolve([new Uint8Array([0])]);
        await expect(pending).rejects.toThrow('local-message-session-unavailable');
        expect(sync.hasPendingOutboxMessagesForSession('writer-session')).toBe(false);
    });

    it('returns the committed receipt even when render, flush and title helpers fail', async () => {
        await sync.ensureSessionHydrated('writer-session');
        const fail = () => { throw new Error('synthetic-ancillary-failure'); };
        vi.spyOn(subject, 'enqueueMessages').mockImplementation(fail);
        vi.spyOn(subject, 'getSendSync').mockImplementation(fail);
        vi.spyOn(sessionFallbackTitle, 'deriveSessionFallbackTitle').mockImplementation(fail);
        expect((await sync.sendMessage('writer-session', 'synthetic-message')).type).toBe('queued');
        expect(subject.pendingOutbox.get('writer-session')).toHaveLength(1);
    });

    it.each(['latest', 'incremental'] as const)('discards detached %s message decryption after deletion', async kind => {
        await sync.ensureSessionHydrated('writer-session');
        const current = subject.encryption.getSessionEncryption('writer-session') as any;
        const gate = deferred<any>();
        const started = deferred<void>();
        current.encryptor.decrypt = async () => { started.resolve(); return gate.promise; };
        const operation = subject.sessionMessageLoadGate.begin(subject.sessionMessageLoadGate.enter('writer-session'));
        const messages = [{ id: 'delayed-message', seq: 3, localId: null, createdAt: 20, updatedAt: 20,
            content: { t: 'encrypted', c: 'AA==' } }];
        const pending = kind === 'latest'
            ? subject.applyLatestMessagePage('writer-session', { messages, hasMore: false }, operation)
            : subject.applyFetchedMessages('writer-session', current, messages, operation);
        await started.promise;
        await subject.handleUpdate(envelope({ t: 'delete-session', sid: 'writer-session' }, 9001));
        gate.resolve([{ role: 'user', content: { type: 'text', text: 'synthetic-message' } }]);
        await pending;
        expect(subject.encryption.cache.getCachedMessage('delayed-message')).toBeNull();
        expect(storage.getState().sessionMessages['writer-session']).toBeUndefined();
    });

    it('rejects a send when its session or encryption is missing instead of acknowledging success', async () => {
        let rejected = false;
        try { await sync.sendMessage('missing-session', 'synthetic-message'); } catch { rejected = true; }
        expect(rejected).toBe(true);
        expect(sync.hasPendingOutboxMessagesForSession('missing-session')).toBe(false);
        await sync.ensureSessionHydrated('writer-session');
        subject.encryption.removeSessionEncryption('writer-session');
        await expect(sync.sendMessage('writer-session', 'synthetic-message')).rejects.toThrow('local-message-session-unavailable');
        expect(sync.hasPendingOutboxMessagesForSession('writer-session')).toBe(false);
    });

    it('queues all attachments and text atomically and returns a receipt only after the complete local commit', async () => {
        await sync.ensureSessionHydrated('writer-session');
        vi.spyOn(subject, 'getSendSync').mockReturnValue({ invalidate: () => undefined });
        const upload = vi.spyOn(subject, 'uploadAttachmentsForSession').mockResolvedValue({
            uploaded: [{ ref: 'synthetic-ref', name: 'synthetic-image', size: 1, width: 1, height: 1 }], failed: 1,
        });
        const attachments = [{ id: 'a' }, { id: 'b' }] as any;
        let rejected = false;
        try { await sync.sendMessage('writer-session', 'synthetic-message', { attachments }); } catch { rejected = true; }
        expect(rejected).toBe(true);
        expect(sync.hasPendingOutboxMessagesForSession('writer-session')).toBe(false);
        upload.mockResolvedValue({ uploaded: [{ ref: 'synthetic-ref', name: 'synthetic-image', size: 1, width: 1, height: 1 }], failed: 0 });
        const receipt = await sync.sendMessage('writer-session', 'synthetic-message', { attachments: attachments.slice(0, 1) });
        expect(receipt).toMatchObject({ type: 'queued', sessionId: 'writer-session' });
        expect(subject.pendingOutbox.get('writer-session').length).toBe(2);
    });
    it.each(['active', 'history', 'single', 'event', 'full'] as const)(
    'does not resurrect store or encryption when deletion wins pending %s decryption', async source => {
        const gate = deferred<any>();
        const started = deferred<void>();
        const original = subject.encryption.openEncryption.bind(subject.encryption);
        subject.encryption.openEncryption = async (key: Uint8Array | null) => {
            started.resolve();
            await gate.promise;
            return original(key);
        };
        mocks.fetchActive.mockResolvedValue([snapshot()]);
        mocks.fetchPage.mockResolvedValue({ sessions: [snapshot()], hasNext: false, nextCursor: null });
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [snapshot()] }) })));
        const operation = source === 'active' ? subject.fetchActiveSessions()
            : source === 'history' ? subject.hydrateHistoricalSessionPage()
            : source === 'single' ? sync.ensureSessionHydrated('writer-session')
            : source === 'event' ? subject.handleUpdate(envelope({ ...snapshot(), t: 'new-session' }))
            : subject.fetchSessions();
        await started.promise;
        await subject.handleUpdate(envelope({ t: 'delete-session', sid: 'writer-session' }, 9001));
        gate.resolve(undefined);
        await Promise.allSettled([operation]);
        expect(Boolean(storage.getState().sessions['writer-session'])).toBe(false);
        expect(Boolean(subject.encryption.getSessionEncryption('writer-session'))).toBe(false);
        expect(subject.encryption.sessionBlobKeys.size).toBe(0);
    });

    it('keeps message seq separate from realistic account update seq and accepts fresher HTTP base fields', async () => {
        await sync.ensureSessionHydrated('writer-session');
        await subject.handleUpdate(envelope({ t: 'update-session', id: 'writer-session',
            metadata: { version: 2, value: 'AA==' } }, 9000, 20));
        expect(storage.getState().sessions['writer-session'].seq).toBe(2);
        mocks.fetchActive.mockResolvedValue([snapshot({ seq: 3, updatedAt: 30, active: true,
            activeAt: 30, metadataVersion: 1 })]);
        await subject.fetchActiveSessions();
        expect(storage.getState().sessions['writer-session']).toMatchObject({
            seq: 3, active: true, activeAt: 30, updatedAt: 30, metadataVersion: 2,
        });
        const current = subject.encryption.getSessionEncryption('writer-session') as any;
        current.encryptor.decrypt = async () => [{ role: 'user', content: { type: 'text', text: 'synthetic-message' } }];
        await subject.handleUpdate(envelope({ t: 'new-message', sid: 'writer-session', message: {
            id: 'domain-message', seq: 4, localId: null, createdAt: 40, updatedAt: 40, content: { t: 'encrypted', c: 'AA==' },
        } }, 9001, 40));
        expect(storage.getState().sessions['writer-session'].seq).toBe(4);
    });

    it('lets an event already decrypting satisfy an ACK without a duplicate GET', async () => {
        const gate = deferred<any>();
        const started = deferred<void>();
        const original = subject.encryption.openEncryption.bind(subject.encryption);
        subject.encryption.openEncryption = async (key: Uint8Array | null) => {
            started.resolve(); await gate.promise; return original(key);
        };
        const event = subject.handleUpdate(envelope({ ...snapshot(), t: 'new-session' }));
        await started.promise;
        const ack = sync.ensureSessionHydrated('writer-session');
        gate.resolve(undefined);
        await event;
        expect(await ack).toBe(true);
        expect(mocks.fetchSnapshot.mock.calls.length).toBe(0);
    });

    it('continues a cold route after active hydration wins detached encryption preparation', async () => {
        const gate = deferred<any>();
        const started = deferred<void>();
        const original = subject.encryption.openEncryption.bind(subject.encryption);
        let first = true;
        subject.encryption.openEncryption = async (key: Uint8Array | null) => {
            if (first) { first = false; started.resolve(); await gate.promise; }
            return original(key);
        };
        const opening = sync.openSession('writer-session');
        void opening.catch(() => undefined);
        await started.promise;
        mocks.fetchActive.mockResolvedValue([snapshot()]);
        await subject.fetchActiveSessions();
        gate.resolve(undefined);
        expect(await opening).toBe('ready');
        expect(storage.getState().sessionMessages['writer-session'].isLoaded).toBe(true);
        sync.abandonSessionRoute('writer-session', opening);
    });

    it('does not resurrect an update-session whose field decryption finishes after delete', async () => {
        await sync.ensureSessionHydrated('writer-session');
        const gate = deferred<any>();
        const started = deferred<void>();
        const current = subject.encryption.getSessionEncryption('writer-session') as any;
        current.encryptor.decrypt = async () => { started.resolve(); return gate.promise; };
        const pending = subject.handleUpdate(envelope({ t: 'update-session', id: 'writer-session',
            metadata: { version: 9, value: 'AA==' } }, 9001));
        await started.promise;
        await subject.handleUpdate(envelope({ t: 'delete-session', sid: 'writer-session' }, 9002));
        gate.resolve([{ path: 'synthetic-directory', host: 'synthetic-host' }]);
        await pending;
        expect(Boolean(storage.getState().sessions['writer-session'])).toBe(false);
        expect(Boolean(subject.encryption.getSessionEncryption('writer-session'))).toBe(false);
        expect(subject.encryption.cache.getCachedMetadata('writer-session', 9)).toBeNull();
    });

    it('holds a deletion boundary across overlapping HTTP writers before responses arrive', async () => {
        const first = deferred<ApiSessionSnapshot[]>();
        const second = deferred<ApiSessionSnapshot>();
        mocks.fetchActive.mockReturnValue(first.promise);
        mocks.fetchSnapshot.mockReturnValue(second.promise);
        const active = subject.fetchActiveSessions();
        const single = sync.ensureSessionHydrated('writer-session');
        await subject.handleUpdate(envelope({ t: 'delete-session', sid: 'writer-session' }, 9001));
        first.resolve([snapshot()]);
        await active;
        await subject.handleUpdate(envelope({ t: 'delete-session', sid: 'writer-session' }, 9002));
        second.resolve(snapshot());
        expect(await single).toBe(false);
        expect(Boolean(subject.encryption.getSessionEncryption('writer-session'))).toBe(false);
        expect(subject.sessionDeletionMutationGenerations.size).toBe(0);
    });
});
