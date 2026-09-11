import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC, refreshSessions } = vi.hoisted(() => ({
    machineRPC: vi.fn(),
    refreshSessions: vi.fn(),
}));

vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC }, getHappyClientId: () => 'web' }));
vi.mock('./sync', () => ({ sync: { refreshSessions } }));
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://test' }));
vi.mock('@/auth/tokenStorage', () => ({ TokenStorage: { getCredentials: async () => ({ token: 'bearer', secret: 'secret' }) } }));
const fetchGrant = vi.fn();

import {
    attachCodexCandidate,
    dismissCodexCandidate,
    filterCodexAttachCandidates,
    listCodexAttachCandidates,
} from './codexAttachCandidates';

describe('Codex attach candidate operations', () => {
    beforeEach(() => {
        machineRPC.mockReset();
        refreshSessions.mockReset();
        fetchGrant.mockReset().mockImplementation(async () => new Response(JSON.stringify({ grant: 'a'.repeat(43),
            expiresAt: '2026-09-11T00:01:00Z', profile: { id: '00000000-0000-4000-8000-000000000001', displayName: 'Work', credentialVersion: 1 } })));
        vi.stubGlobal('fetch', fetchGrant);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('lists candidates with existing mappings so the daemon can de-duplicate', async () => {
        machineRPC.mockResolvedValue({ candidates: [] });

        await listCodexAttachCandidates('machine-1', ['thread-already-synced']);

        expect(machineRPC).toHaveBeenCalledWith('machine-1', 'codex-list-attach-candidates', {
            existingThreadIds: ['thread-already-synced'],
        });
    });

    it('attaches and dismisses through machine-scoped RPCs', async () => {
        machineRPC.mockResolvedValueOnce({ type: 'success', sessionId: 'paws-session' });
        machineRPC.mockResolvedValueOnce({ type: 'success' });

        await expect(attachCodexCandidate('machine-1', 'thread-1', 'paws-source')).resolves.toEqual({
            type: 'success',
            sessionId: 'paws-session',
        });
        expect(refreshSessions).toHaveBeenCalledTimes(1);
        expect(machineRPC).toHaveBeenNthCalledWith(1, 'machine-1', 'codex-attach-candidate', {
            threadId: 'thread-1', sourceSessionId: 'paws-source', codexSessionGrant: 'a'.repeat(43),
        }, { timeoutMs: 140_000 });
        expect(fetchGrant).toHaveBeenCalledTimes(1);

        await dismissCodexCandidate('machine-1', 'thread-2');
        expect(machineRPC).toHaveBeenLastCalledWith('machine-1', 'codex-dismiss-attach-candidate', {
            threadId: 'thread-2',
        });
    });

    it('rejects unmapped Desktop history before obtaining a grant or issuing RPC', async () => {
        await expect(attachCodexCandidate('machine-1', 'desktop-thread')).rejects.toThrow(/source.*history.*unavailable/i);
        expect(fetchGrant).not.toHaveBeenCalled();
        expect(machineRPC).not.toHaveBeenCalled();
        expect(refreshSessions).not.toHaveBeenCalled();
    });

    it('rejects a failed attachment without refreshing sessions or exposing its grant', async () => {
        machineRPC.mockResolvedValue({ error: `Attachment failed: ${'a'.repeat(43)}` });
        await expect(attachCodexCandidate('machine-1', 'thread-1', 'paws-source')).rejects.toThrow('Attachment failed: [redacted]');
        expect(refreshSessions).not.toHaveBeenCalled();
    });

    it('filters candidates by title, directory, or machine name without case sensitivity', () => {
        const candidates = [
            {
                threadId: 'title-match',
                title: 'Investigate Chrome freeze',
                directory: '/Users/test/browser',
                createdAt: 1,
                updatedAt: 3,
                machineId: 'machine-1',
                machineName: 'Mac mini',
            },
            {
                threadId: 'path-match',
                title: 'Prepare release',
                directory: '/Users/test/Photo Wall',
                createdAt: 1,
                updatedAt: 2,
                machineId: 'machine-2',
                machineName: 'MacBook Air',
            },
        ];

        expect(filterCodexAttachCandidates(candidates, 'CHROME').map((candidate) => candidate.threadId)).toEqual([
            'title-match',
        ]);
        expect(filterCodexAttachCandidates(candidates, 'photo wall').map((candidate) => candidate.threadId)).toEqual([
            'path-match',
        ]);
        expect(filterCodexAttachCandidates(candidates, 'macbook').map((candidate) => candidate.threadId)).toEqual([
            'path-match',
        ]);
        expect(filterCodexAttachCandidates(candidates, '   ')).toEqual(candidates);
    });
});
