import { describe, it, expect, vi, beforeEach } from 'vitest';

// 必须在 import storage 之前 mock 所有会间接引入 react-native 的模块
vi.mock('./sync', () => ({
    sync: {
        refreshSessions: vi.fn(),
        encryption: { getSessionEncryption: vi.fn(() => null) },
    },
}));

vi.mock('@/realtime/RealtimeSession', () => ({
    getCurrentRealtimeSessionId: vi.fn(() => null),
    getVoiceSession: vi.fn(() => null),
}));

vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn() },
}));

vi.mock('@/components/tools/knownTools', () => ({
    isMutableTool: vi.fn(() => true),
}));

vi.mock('@/utils/sessionUtils', () => ({
    getSessionName: vi.fn(() => ''),
    getSessionSubtitle: vi.fn(() => ''),
    getSessionAvatarId: vi.fn(() => ''),
}));

vi.mock('@/utils/machineUtils', () => ({
    isMachineOnline: vi.fn(() => false),
}));

import { storage } from './storage';
import { saveSessionSpawnPaths, loadSessionSpawnPaths } from './persistence';

function baseSession(id: string, overrides: Partial<any> = {}) {
    return {
        id, seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
        metadata: null, metadataVersion: 1, agentState: null, agentStateVersion: 1,
        thinking: false, thinkingAt: 0, ...overrides,
    };
}

describe('session spawnPath', () => {
    beforeEach(() => {
        saveSessionSpawnPaths({});
        storage.setState({ sessions: {} } as any);
    });

    it('updateSessionSpawnPath sets field and persists', () => {
        storage.getState().applySessions([baseSession('s1')]);
        storage.getState().updateSessionSpawnPath('s1', '/vault/健康打卡');
        expect(storage.getState().sessions['s1'].spawnPath).toBe('/vault/健康打卡');
        expect(loadSessionSpawnPaths()['s1']).toBe('/vault/健康打卡');
    });

    it('applySessions restores spawnPath from persistence when metadata absent', () => {
        saveSessionSpawnPaths({ s2: '/vault/健康打卡' });
        // 触发一次"初始加载"（sessions 为空时才读 saved）
        storage.setState({ sessions: {} } as any);
        storage.getState().applySessions([baseSession('s2')]);
        expect(storage.getState().sessions['s2'].spawnPath).toBe('/vault/健康打卡');
    });

    it('metadata.path takes priority over cached spawnPath', () => {
        // 先缓存一个旧的 spawnPath
        saveSessionSpawnPaths({ s3: '/old/cached/path' });
        storage.setState({ sessions: {} } as any);
        // apply 带 metadata.path 的会话，应优先使用 metadata.path
        storage.getState().applySessions([baseSession('s3', { metadata: { path: '/from-meta' } })]);
        expect(storage.getState().sessions['s3'].spawnPath).toBe('/from-meta');
    });
});
