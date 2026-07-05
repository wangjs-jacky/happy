import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({
    request: vi.fn(),
}));

vi.mock('./apiSocket', () => ({
    apiSocket: { request },
}));

vi.mock('./sync', () => ({
    sync: {},
}));

describe('sessionDelete', () => {
    beforeEach(() => {
        request.mockReset();
    });

    it('treats a missing session as already deleted', async () => {
        request.mockResolvedValue(new Response(
            JSON.stringify({ error: 'Session not found or not owned by user' }),
            { status: 404 },
        ));

        const { sessionDelete } = await import('./ops');
        const result = await sessionDelete('session-1');

        expect(result).toEqual({ success: true });
    });
});
