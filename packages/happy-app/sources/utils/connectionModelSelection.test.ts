import { describe, expect, it, vi } from 'vitest';
import { createConnectionModelSelection } from './connectionModelSelection';
const selected = { key: 'native-deepseek', name: 'DeepSeek', modelKey: 'deepseek/DeepSeek-V4.1-Flash', connection: { type: 'native' as const } };
function setup() {
    const deps = { currentConnection: { type: 'account' as const, profileId: 'work' }, machineId: 'mini', directory: '/repo',
        isCurrent: vi.fn(() => true), sameConnection: vi.fn(), spawn: vi.fn(async (_: unknown) => ({ type: 'success', sessionId: 'new' })),
        hydrate: vi.fn(async (_: string) => true), configure: vi.fn(), navigate: vi.fn() };
    return { deps, select: createConnectionModelSelection(deps) };
}
describe('cross-connection model selection', () => {
    it('starts a fresh exact-model native session, configuring only the new session', async () => {
        const { deps, select } = setup();
        await select(selected);
        expect(deps.spawn).toHaveBeenCalledExactlyOnceWith({ machineId: 'mini', directory: '/repo', agent: 'codex',
            approvedNewDirectoryCreation: false, model: selected.modelKey, codexConnection: { type: 'native' } });
        expect(deps.configure).toHaveBeenCalledExactlyOnceWith('new', selected.modelKey);
        expect(deps.navigate).toHaveBeenCalledExactlyOnceWith('new');
        expect(deps.sameConnection).not.toHaveBeenCalled();
    });
    it('updates the original selection only when the connection matches', async () => {
        const { deps, select } = setup();
        await select({ ...selected, connection: deps.currentConnection, modelKey: 'gpt-6.1-sol' });
        expect(deps.sameConnection).toHaveBeenCalledExactlyOnceWith('gpt-6.1-sol');
        expect(deps.spawn).not.toHaveBeenCalled();
        expect(deps.navigate).not.toHaveBeenCalled();
    });
    it('coalesces concurrent selection clicks and preserves the original route on failure', async () => {
        const { deps, select } = setup();
        let release!: (v: any) => void;
        deps.spawn.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const first = select(selected); const second = select(selected);
        release({ type: 'error', errorMessage: 'offline' });
        await expect(first).rejects.toThrow('offline'); await second;
        expect(deps.spawn).toHaveBeenCalledTimes(1);
        expect(deps.configure).not.toHaveBeenCalled();
        expect(deps.sameConnection).not.toHaveBeenCalled();
        expect(deps.navigate).not.toHaveBeenCalled();
    });
    it('does not dispatch stale selections or navigate after the owner changes during spawn', async () => {
        const { deps, select } = setup();
        deps.isCurrent.mockReturnValue(false); await select(selected);
        expect(deps.spawn).not.toHaveBeenCalled();
        deps.isCurrent.mockReturnValue(true);
        deps.spawn.mockImplementation(async () => { deps.isCurrent.mockReturnValue(false); return { type: 'success', sessionId: 'new' }; });
        await select(selected);
        expect(deps.navigate).not.toHaveBeenCalled();
        expect(deps.configure).not.toHaveBeenCalled();
    });
    it('preserves the source route and draft if hydration fails', async () => {
        const { deps, select } = setup(); deps.hydrate.mockResolvedValue(false);
        await expect(select(selected)).rejects.toThrow('session-hydration-failed');
        expect(deps.navigate).not.toHaveBeenCalled();
        expect(deps.sameConnection).not.toHaveBeenCalled();
    });
});
