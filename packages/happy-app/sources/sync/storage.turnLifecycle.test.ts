import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

vi.mock('react-native', () => ({
    AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
    NativeModules: {},
    StyleSheet: { create: (styles: unknown) => styles },
    View: () => null,
    Text: () => null,
    Pressable: () => null,
    Modal: () => null,
    useWindowDimensions: () => ({ width: 1000, height: 1000 }),
}));
vi.mock('./apiSocket', () => ({ apiSocket: {} }));
vi.mock('@/realtime/RealtimeSession', () => ({ getCurrentRealtimeSessionId: () => null, getVoiceSession: () => null }));
vi.mock('@/components/tools/knownTools', () => ({ isMutableTool: () => false }));
vi.mock('./sync', () => ({
    sync: { assumeUsers: vi.fn(), applySettings: vi.fn() },
}));
vi.mock('expo-modules-core', () => ({
    requireNativeModule: vi.fn(() => ({})),
    requireOptionalNativeModule: vi.fn(() => null),
    EventEmitter: class {},
    Platform: { OS: 'web' },
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('expo-router', () => ({ router: {}, useRouter: () => ({}) }));
vi.mock('expo-updates', () => ({}));
import { storage } from './storage';
import type { NormalizedMessage } from './typesRaw';

const lifecycle = (id: string, status: 'running' | 'completed' | 'failed', seq: number): NormalizedMessage => ({
    id,
    localId: null,
    createdAt: seq,
    role: 'event',
    content: { type: 'turn-lifecycle', status, seq },
    isSidechain: false,
});

describe('storage root turn lifecycle', () => {
    beforeEach(() => {
        storage.setState({ sessions: {}, sessionMessages: {} });
    });

    it('restores an initial lifecycle batch atomically and rejects older replay', () => {
        const result = storage.getState().applyMessages('session-1', [
            lifecycle('start', 'running', 10),
            lifecycle('end', 'completed', 11),
        ]);
        expect(result.hasReadyEvent).toBe(true);
        expect(storage.getState().sessionMessages['session-1'].reducerState.rootTurnLifecycle)
            .toMatchObject({ status: 'completed', seq: 11 });

        const replay = storage.getState().applyMessages('session-1', [lifecycle('older-end', 'failed', 9)]);
        expect(replay.hasReadyEvent).toBe(false);
        expect(storage.getState().sessionMessages['session-1'].reducerState.rootTurnLifecycle)
            .toMatchObject({ status: 'completed', seq: 11 });
    });

    it('preserves reducer-owned lifecycle across a server session snapshot', () => {
        storage.getState().applyMessages('session-1', [lifecycle('end', 'completed', 11)]);
        storage.getState().applySessions([{
            id: 'session-1', seq: 12, createdAt: 1, updatedAt: 2,
            active: true, activeAt: 2, metadata: null, metadataVersion: 0,
            agentState: null, agentStateVersion: 0, thinking: false, thinkingAt: 2,
            presence: 'online',
        }]);
        expect(storage.getState().sessionMessages['session-1'].reducerState.rootTurnLifecycle)
            .toMatchObject({ status: 'completed', seq: 11 });
    });
});
