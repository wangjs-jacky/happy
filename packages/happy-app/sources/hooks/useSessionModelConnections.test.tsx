import React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ creds: { token: 'owner' }, spawn: vi.fn(), hydrate: vi.fn(async () => true), navigate: vi.fn(),
    models: [{ key: 'deepseek/DeepSeek-V4.1-Flash', name: 'DeepSeek' }], profiles: [], sessions: [],
    updateModel: vi.fn(), updateEffort: vi.fn(), updateFast: vi.fn(), alert: vi.fn(), refresh: vi.fn(), same: vi.fn() }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: mocks.creds }), getCurrentAuth: () => ({ credentials: mocks.creds }) }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://paws' }));
vi.mock('@/sync/storage', () => ({ useSessions: () => mocks.sessions, storage: { getState: () => ({
    updateSessionModelMode: mocks.updateModel, updateSessionEffortLevel: mocks.updateEffort, updateSessionFastMode: mocks.updateFast,
}) } }));
vi.mock('@/sync/ops', () => ({ machineSpawnNewSession: mocks.spawn, sessionRefreshModels: mocks.refresh }));
vi.mock('@/sync/sync', () => ({ sync: { ensureSessionHydrated: mocks.hydrate } }));
vi.mock('@/modal', () => ({ Modal: { alert: mocks.alert } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./useCodexAccounts', () => ({ useCodexAccounts: () => ({ profiles: mocks.profiles }) }));
vi.mock('./useNativeCodexModels', () => ({ useNativeCodexModels: () => ({ models: mocks.models, refresh: mocks.refresh }) }));
vi.mock('./useNavigateToSession', () => ({ useNavigateToSession: () => mocks.navigate }));
import { useSessionModelConnections } from './useSessionModelConnections';
import { connectionModelKey } from '@/utils/modelConnections';
const source = { id: 'source', metadata: { machineId: 'mini', path: '/work', flavor: 'codex', codexAccountProfileId: 'work' } } as any;
const currentModels = [{ key: 'gpt-6.1-sol', name: 'Sol' }];
let picker: ReturnType<typeof useSessionModelConnections>;
function Harness({ active = true }: { active?: boolean }) {
    picker = useSessionModelConnections(source, currentModels, currentModels[0], mocks.same, { active }); return null;
}
let tree: any;
afterEach(() => { if (tree) act(() => tree.unmount()); vi.clearAllMocks(); mocks.hydrate.mockResolvedValue(true); });
describe('retained session connection picker ownership', () => {
    it('permanently invalidates a pending launch after blur even if the original screen refocuses', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        let finish!: (value: unknown) => void;
        mocks.spawn.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        act(() => { tree = TestRenderer.create(<Harness />); });
        let pending!: Promise<void>;
        act(() => { pending = picker.select(connectionModelKey({ type: 'native' }, 'deepseek/DeepSeek-V4.1-Flash')); });
        act(() => tree.update(<Harness active={false} />));
        act(() => tree.update(<Harness active />));
        await act(async () => { finish({ type: 'success', sessionId: 'new' }); await pending; });
        expect(mocks.spawn).toHaveBeenCalledTimes(1);
        expect(mocks.navigate).not.toHaveBeenCalled();
        expect(mocks.updateModel).not.toHaveBeenCalled();
        expect(picker.busy).toBe(false);
    });
    it('does not navigate or alert when a retained route loses focus during hydration', async () => {
        let finish!: (value: boolean) => void;
        mocks.spawn.mockResolvedValue({ type: 'success', sessionId: 'new' });
        mocks.hydrate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        act(() => { tree = TestRenderer.create(<Harness />); });
        let pending!: Promise<void>;
        await act(async () => { pending = picker.select(connectionModelKey({ type: 'native' }, 'deepseek/DeepSeek-V4.1-Flash')); await Promise.resolve(); });
        act(() => tree.update(<Harness active={false} />));
        await act(async () => { finish(true); await pending; });
        expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.alert).not.toHaveBeenCalled();
    });
});
