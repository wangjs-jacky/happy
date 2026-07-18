import { describe, expect, it, vi } from 'vitest';
import { createReducer, reducer } from './reducer/reducer';
import type { NormalizedMessage } from './typesRaw';

const onReady = vi.hoisted(() => vi.fn());
const reducerState = createReducer();
const sessionMessages = { 'session-1': { messagesMap: {} } };

vi.mock('./storage', () => ({
    storage: {
        getState: () => ({
            sessionMessages,
            applyMessages: (_sessionId: string, messages: NormalizedMessage[]) => {
                const result = reducer(reducerState, messages);
                return { changed: [], hasReadyEvent: result.hasReadyEvent ?? false };
            },
        }),
    },
}));
vi.mock('@/realtime/hooks/voiceHooks', () => ({
    voiceHooks: { onMessages: vi.fn(), onReady, onSessionOnline: vi.fn(), onSessionOffline: vi.fn(), onSessionFocus: vi.fn() },
}));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('@/sync/apiSocket', () => ({ apiSocket: { sendAppState: vi.fn() }, getCurrentAppState: () => 'active', getHappyClientId: () => 'test' }));
vi.mock('@/sync/webTabTitle', () => ({ notifyUnreadMessage: vi.fn() }));
vi.mock('@/sync/encryption/encryption', () => ({ Encryption: class {} }));
vi.mock('@/encryption/base64', () => ({ decodeBase64: vi.fn(), encodeBase64: vi.fn() }));
vi.mock('./apiTypes', () => ({ ApiEphemeralUpdateSchema: {}, ApiUpdateContainerSchema: {} }));
vi.mock('@/utils/sync', () => ({ InvalidateSync: class { constructor(_fn: unknown) {} } }));
vi.mock('./reducer/activityUpdateAccumulator', () => ({ ActivityUpdateAccumulator: class { constructor(_fn: unknown, _delay: number) {} } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
vi.mock('expo-notifications', () => ({}));
vi.mock('./pushRegistration', () => ({ syncCurrentPushToken: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'native' }, AppState: { currentState: 'active', addEventListener: vi.fn() } }));
vi.mock('@/utils/platform', () => ({ isRunningOnMac: false }));
vi.mock('./settings', () => ({
    applySettings: vi.fn(), mergeServerSettings: vi.fn(), settingsDefaults: {},
    settingsParse: vi.fn(), settingsToSyncPayload: vi.fn(), SUPPORTED_SCHEMA_VERSION: 1,
}));
vi.mock('./profile', () => ({ profileParse: vi.fn() }));
vi.mock('./persistence', () => ({ loadPendingSettings: () => ({}), savePendingSettings: vi.fn() }));
vi.mock('@/track', () => ({
    tracking: {}, initializeTracking: vi.fn(), trackGitHubConnected: vi.fn(), trackMessageSent: vi.fn(),
    trackPaywallCancelled: vi.fn(), trackPaywallError: vi.fn(), trackPaywallPresented: vi.fn(),
    trackPaywallPurchased: vi.fn(), trackPaywallRestored: vi.fn(),
}));
vi.mock('./revenueCat', () => ({ RevenueCat: {}, LogLevel: {}, PaywallResult: {} }));
vi.mock('./serverConfig', () => ({ getServerUrl: () => '' }));
vi.mock('@/config', () => ({ config: {} }));
vi.mock('@/log', () => ({ log: { log: vi.fn() } }));
vi.mock('./gitStatusSync', () => ({ gitStatusSync: {} }));
vi.mock('./foregroundResync', () => ({ resyncOnForeground: vi.fn() }));
vi.mock('@/utils/lock', () => ({ AsyncLock: class {} }));
vi.mock('./encryption/encryptionCache', () => ({ EncryptionCache: class {} }));
vi.mock('./prompt/systemPrompt', () => ({ systemPrompt: '' }));
vi.mock('./apiArtifacts', () => ({ fetchArtifact: vi.fn(), fetchArtifacts: vi.fn(), createArtifact: vi.fn(), updateArtifact: vi.fn() }));
vi.mock('./encryption/artifactEncryption', () => ({ ArtifactEncryption: class {} }));
vi.mock('./apiFriends', () => ({ getFriendsList: vi.fn(), getUserProfile: vi.fn() }));
vi.mock('./apiFeed', () => ({ fetchFeed: vi.fn() }));
vi.mock('./messageMeta', () => ({ resolveMessageModeMeta: vi.fn() }));
vi.mock('./apiAttachments', () => ({ requestAttachmentUpload: vi.fn(), uploadEncryptedBlob: vi.fn() }));
vi.mock('@/encryption/blob', () => ({ encryptBlob: vi.fn() }));
vi.mock('@/utils/readFileBytes', () => ({ readFileBytes: vi.fn() }));
vi.mock('./sessionEventLocalNotification', () => ({
    getInitialSessionEventLocalNotificationsEnabled: () => false,
    maybeScheduleSessionEventLocalNotification: vi.fn(),
    shouldEnableSessionEventLocalNotifications: () => false,
}));
vi.mock('@/modal', () => ({ Modal: {} }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { Sync } from './sync';

const terminal = (id: string, seq: number): NormalizedMessage => ({
    id,
    localId: null,
    createdAt: seq,
    role: 'event',
    content: { type: 'turn-lifecycle', status: 'completed', seq },
    isSidechain: false,
});

describe('Sync root lifecycle ready callback', () => {
    it('calls voiceHooks.onReady with the real session id once and ignores stale replay', () => {
        const sync = new Sync();

        sync.applyMessages('session-1', [terminal('current', 2)]);
        sync.applyMessages('session-1', [terminal('stale', 1)]);

        expect(onReady).toHaveBeenCalledTimes(1);
        expect(onReady).toHaveBeenCalledWith('session-1');
    });
});
