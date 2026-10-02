import React, { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no bundled declarations.
import TestRenderer from 'react-test-renderer';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ factoryError: '', get: vi.fn(), launch: vi.fn(), navigate: vi.fn(), focus: undefined as any, blur: undefined as any,
    draft: { selectedMachineId: 'm', setAgentType: vi.fn(), setMachineId: vi.fn(), setPath: vi.fn(), setModelMode: vi.fn(), setEffortLevel: vi.fn() } }));
const credentials = { token: 'test' };
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials }) }));
vi.mock('@/auth/accountRuntime', () => ({ accountRuntimeCurrent: () => true }));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void)) => React.useEffect(() => { mocks.focus = callback; const cleanup = callback(); mocks.blur = cleanup; return cleanup; }, [callback]) }));
vi.mock('@/hooks/useNewSessionDraft', () => ({ useNewSessionDraft: { getState: () => mocks.draft } }));
vi.mock('@/hooks/useNavigateToSession', () => ({ useNavigateToSession: () => mocks.navigate }));
vi.mock('./api', () => ({ createMyAgentsApi: () => { if (mocks.factoryError) throw new Error(mocks.factoryError); return ({ get: mocks.get }); } }));
vi.mock('./launch', () => ({ launchMyAgentSession: mocks.launch }));
import { useMyAgentCompose } from './useMyAgentCompose';
const profile = { id: 'agent-a', name: '军师', machineId: 'm', directory: '/original', model: 'gpt-6.1-sol', effort: 'high', archived: false };
let result: ReturnType<typeof useMyAgentCompose>, renderer: any;
function Probe({ mode = 'create', id }: { mode?: string; id?: string }) { result = useMyAgentCompose(mode, id); return null; }
const args = { machine: { id: 'm', active: true, metadata: { homeDir: '/home' } }, path: '/current-project', worktreeKey: null, prompt: '帮我创建一个狗头军师', modelMode: 'gpt-6.1-sol', permissionMode: 'yolo' } as any;
beforeEach(() => { vi.clearAllMocks(); mocks.factoryError = ''; mocks.get.mockResolvedValue(profile); mocks.launch.mockResolvedValue('session'); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = undefined; });
async function mount(mode?: string, id?: string) { await act(async () => { renderer = TestRenderer.create(<Probe mode={mode} id={id}/>); }); }
it('creates only after the user submits natural language and inherits the current project', async () => {
    await mount();
    expect(mocks.launch).not.toHaveBeenCalled();
    const accepted = vi.fn();
    await act(async () => result.submit(args, accepted));
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ builder: true, text: args.prompt, directory: '/current-project', permissionMode: 'yolo' }));
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('session');
});
it('loads an existing profile for editing without a questionnaire or automatic model message', async () => {
    await mount('edit', 'agent-a');
    expect(result.title).toBe('修改 军师');
    expect(mocks.draft.setPath).toHaveBeenCalledWith('/original');
    expect(mocks.launch).not.toHaveBeenCalled();
    await act(async () => result.submit(args, vi.fn()));
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ profile, builder: true }));
});
it('does not clear the draft or navigate after the user leaves a slow launch', async () => {
    let finish!: (value: string) => void;
    mocks.launch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount();
    const accepted = vi.fn();
    await act(async () => { void result.submit(args, accepted); });
    await act(async () => { mocks.blur(); mocks.blur = mocks.focus(); });
    await act(async () => finish('late'));
    expect(accepted).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(result.busy).toBe(false);
});
it('keeps failures in the composer and blocks task mode for an archived assistant', async () => {
    mocks.get.mockResolvedValue({ ...profile, archived: true });
    await mount('use', 'agent-a');
    expect(result.ready).toBe(false);
    expect(result.error).toContain('已归档');
    await act(async () => result.submit(args, vi.fn()));
    expect(mocks.launch).not.toHaveBeenCalled();
});

it('shows a synchronous catalog factory failure in the composer', async () => {
    mocks.factoryError = '请切换到 Paws 服务器的账号。';
    await mount('create');
    expect(result.error).toContain('Paws');
    expect(result.ready).toBe(false);
});
