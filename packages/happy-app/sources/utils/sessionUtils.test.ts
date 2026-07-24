import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/sync/storageTypes';

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({ theme: {} }),
}));
vi.mock('./resumeCommand', () => ({
    buildResumeCommand: vi.fn(),
    buildResumeCommandBlock: vi.fn(),
}));

import { resolveSessionStatus } from './sessionUtils';

const colors = {
    accent: '#accent',
    success: '#success',
    warning: '#warning',
    error: '#error',
};

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        presence: 'online',
        ...overrides,
    };
}

describe('resolveSessionStatus', () => {
    it.each([
        ['completed', 'completed', 'status.taskCompleted', colors.success],
        ['failed', 'failed', 'status.taskFailed', colors.error],
        ['cancelled', 'cancelled', 'status.taskCancelled', colors.warning],
    ] as const)('shows a connected, non-pulsing %s terminal result', (lifecycle, state, label, color) => {
        expect(resolveSessionStatus(createSession(), lifecycle, colors, 'working…')).toEqual({
            state,
            isConnected: true,
            statusText: label,
            shouldShowStatus: true,
            statusColor: color,
            statusDotColor: color,
            isPulsing: false,
        });
    });

    it('prioritizes disconnected over permission, thinking, and terminal lifecycle', () => {
        const result = resolveSessionStatus(createSession({
            presence: 100,
            thinking: true,
            agentState: { requests: { request: { tool: 'x', arguments: {}, createdAt: 1 } } },
        }), 'completed', colors, 'working…');

        expect(result.state).toBe('disconnected');
    });

    it('prioritizes permission over thinking and terminal lifecycle', () => {
        const result = resolveSessionStatus(createSession({
            thinking: true,
            agentState: { requests: { request: { tool: 'x', arguments: {}, createdAt: 1 } } },
        }), 'completed', colors, 'working…');

        expect(result.state).toBe('permission_required');
    });

    it('prioritizes thinking over terminal lifecycle', () => {
        const result = resolveSessionStatus(createSession({ thinking: true }), 'failed', colors, 'working…');

        expect(result).toMatchObject({ state: 'thinking', statusText: 'working…', isPulsing: true });
    });

    it('treats running lifecycle as current thinking or waiting state instead of an old terminal result', () => {
        expect(resolveSessionStatus(createSession({ thinking: true }), 'running', colors, 'working…').state).toBe('thinking');
        expect(resolveSessionStatus(createSession(), 'running', colors, 'working…')).toMatchObject({
            state: 'waiting',
            statusText: 'status.online',
            shouldShowStatus: false,
        });
    });

    it('falls back to waiting when no lifecycle result is available', () => {
        expect(resolveSessionStatus(createSession(), undefined, colors, 'working…')).toMatchObject({
            state: 'waiting',
            statusText: 'status.online',
            shouldShowStatus: false,
            isConnected: true,
        });
    });
});
