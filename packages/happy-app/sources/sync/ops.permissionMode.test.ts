import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionRPC, refreshSessions } = vi.hoisted(() => ({
    sessionRPC: vi.fn(),
    refreshSessions: vi.fn(),
}));

vi.mock('./apiSocket', () => ({
    apiSocket: { sessionRPC },
}));

vi.mock('./sync', () => ({
    sync: { refreshSessions },
}));

describe('session permission mode ops', () => {
    beforeEach(() => {
        sessionRPC.mockReset();
        refreshSessions.mockReset();
    });

    it('forwards an immediate permission-mode RPC to the running session', async () => {
        sessionRPC.mockResolvedValue(true);

        const { sessionSetPermissionMode } = await import('./ops');
        const result = await sessionSetPermissionMode('session-1', 'yolo');

        expect(result).toBe(true);
        expect(sessionRPC).toHaveBeenCalledWith(
            'session-1',
            'setPermissionMode',
            { mode: 'yolo' },
        );
    });
});
