import { describe, expect, it, vi } from 'vitest';

describe('useNewSessionDraft', () => {
    it('keeps a per-launch connection when re-selecting the same machine and after remount', async () => {
        vi.resetModules(); let saved: any = { selectedMachineId: 'mini', codexConnection: { type: 'native' }, modelMode: 'deepseek/DeepSeek-V4.1-Flash' };
        vi.doMock('@/sync/persistence', () => ({ loadNewSessionDraft: () => saved, saveNewSessionDraft: (value: unknown) => { saved = value; } }));
        const { useNewSessionDraft } = await import('./useNewSessionDraft');
        useNewSessionDraft.getState().setMachineId('mini');
        expect(useNewSessionDraft.getState().codexConnection).toEqual({ type: 'native' });
        vi.resetModules(); const remounted = (await import('./useNewSessionDraft')).useNewSessionDraft;
        expect(remounted.getState().codexConnection).toEqual(useNewSessionDraft.getState().codexConnection);
        expect(remounted.getState().modelMode).toBe('deepseek/DeepSeek-V4.1-Flash');
    });

    it('restores a launch connection and clears it on machine switch without a binding mutation', async () => {
        vi.resetModules(); const saveNewSessionDraft = vi.fn();
        vi.doMock('@/sync/persistence', () => ({ loadNewSessionDraft: () => ({ selectedMachineId: 'mini', codexConnection: { type: 'native' }, modelMode: 'deepseek/DeepSeek-V4.1-Flash' }), saveNewSessionDraft }));
        const { useNewSessionDraft } = await import('./useNewSessionDraft');
        expect(useNewSessionDraft.getState().codexConnection).toEqual({ type: 'native' });
        useNewSessionDraft.getState().setMachineId('air');
        expect(useNewSessionDraft.getState().codexConnection).toBeNull();
        expect(saveNewSessionDraft).toHaveBeenLastCalledWith(expect.objectContaining({ selectedMachineId: 'air', codexConnection: null }));
    });
    it('restores model, effort and Fast together after leaving and recreating the screen', async () => {
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
                fastMode: true,
                sessionType: 'simple',
                worktreeKey: null,
                updatedAt: 1,
            }),
            saveNewSessionDraft,
        }));

        const { useNewSessionDraft } = await import('./useNewSessionDraft');

        expect(useNewSessionDraft.getState()).toMatchObject({ agentType: 'codex', effortLevel: 'xhigh', fastMode: true });
        useNewSessionDraft.getState().setFastMode(false);
        expect(saveNewSessionDraft).toHaveBeenLastCalledWith(expect.objectContaining({ fastMode: false, effortLevel: 'xhigh' }));
        useNewSessionDraft.getState().setFastMode(true);
        useNewSessionDraft.getState().setModelMode('gpt-6.1-terra');
        expect(saveNewSessionDraft).toHaveBeenLastCalledWith(expect.objectContaining({ fastMode: true, effortLevel: 'xhigh', modelMode: 'gpt-6.1-terra' }));
    });
});
