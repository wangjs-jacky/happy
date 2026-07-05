import { describe, expect, it, vi } from 'vitest';

describe('useNewSessionDraft', () => {
    it('restores the saved agent type from the persisted draft', async () => {
        vi.resetModules();
        const saveNewSessionDraft = vi.fn();
        vi.doMock('@/sync/persistence', () => ({
            loadNewSessionDraft: () => ({
                input: '',
                selectedMachineId: null,
                selectedPath: null,
                agentType: 'codex',
                permissionMode: 'yolo',
                modelMode: 'gpt-5.5',
                effortLevel: 'xhigh',
                sessionType: 'simple',
                worktreeKey: null,
                updatedAt: 1,
            }),
            saveNewSessionDraft,
        }));

        const { useNewSessionDraft } = await import('./useNewSessionDraft');

        expect(useNewSessionDraft.getState().agentType).toBe('codex');
    });
});
