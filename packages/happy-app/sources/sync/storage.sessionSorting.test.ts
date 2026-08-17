import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
}));

vi.mock('expo-modules-core', () => ({
    Platform: { OS: 'web' },
    requireNativeModule: () => ({}),
    requireOptionalNativeModule: () => ({}),
}));

vi.mock('expo-constants', () => ({
    default: { expoConfig: { extra: {} } },
}));

vi.mock('expo', () => ({}));

vi.mock('expo-secure-store', () => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
}));

vi.mock('./sync', () => ({
    sync: {},
}));

vi.mock('@/modal', () => ({
    Modal: {},
}));

vi.mock('@/realtime/RealtimeSession', () => ({
    getCurrentRealtimeSessionId: () => null,
    getVoiceSession: () => null,
}));

vi.mock('@/components/tools/knownTools', () => ({
    isMutableTool: () => false,
}));

import { storage } from './storage';
import type { Session } from './storageTypes';

function session(id: string, createdAt: number, updatedAt: number, activeAt = updatedAt): Session {
    return {
        id,
        seq: 1,
        createdAt,
        updatedAt,
        active: false,
        activeAt,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: updatedAt,
        presence: updatedAt,
    };
}

describe('storage session ordering', () => {
    beforeEach(() => {
        storage.setState({
            sessions: {},
            sessionsData: null,
            sessionListViewData: null,
            sessionMessages: {},
        });
    });

    it('orders legacy session data by latest activity instead of creation time', () => {
        storage.getState().applySessions([
            session('created-today', 200, 100),
            session('continued-today', 100, 200),
        ], { replace: true });

        const sessionIds = storage.getState().sessionsData
            ?.filter((item): item is Session => typeof item !== 'string')
            .map((item) => item.id);

        expect(sessionIds).toEqual(['continued-today', 'created-today']);
    });

    it('retains a live session activity timestamp for time grouping', () => {
        storage.getState().applySessions([
            {
                ...session('live-today', 100, 150, 200),
                active: true,
                presence: 'online',
            },
        ], { replace: true });

        const activeSessions = storage.getState().sessionListViewData
            ?.find((item) => item.type === 'active-sessions');

        expect(activeSessions).toMatchObject({
            type: 'active-sessions',
            sessions: [{ id: 'live-today', activeAt: 200 }],
        });
    });
});
