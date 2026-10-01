import React, { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no bundled declarations.
import TestRenderer from 'react-test-renderer';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
    focus: undefined as undefined | (() => (() => void)), blur: undefined as undefined | (() => void),
    push: vi.fn(), get: vi.fn(), list: vi.fn(), request: vi.fn(), launch: vi.fn(), scan: vi.fn(), exists: vi.fn(),
    params: { agentId: 'agent-a' }, credentials: { token: 'fixture' },
}));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.push }), useLocalSearchParams: () => mocks.params, useFocusEffect: (callback: () => (() => void)) => React.useEffect(() => { mocks.focus = callback; const cleanup = callback(); mocks.blur = cleanup; return cleanup; }, [callback]) }));
vi.mock('react-native-unistyles', () => ({ StyleSheet: { create: (fn: any) => fn({ colors: {} }) }, useUnistyles: () => ({ theme: { colors: {} } }) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: mocks.credentials }) }));
vi.mock('@/auth/accountRuntime', () => ({ accountRuntimeCurrent: () => true }));
const machine = { id: 'm', active: true, metadata: { homeDir: '/work' } };
vi.mock('@/sync/storage', () => ({ useAllMachines: () => [machine] }));
vi.mock('@/sync/ops', () => ({ machineListAgentSkills: mocks.scan }));
vi.mock('@/sync/sync', () => ({ sync: { checkSessionExists: mocks.exists } }));
vi.mock('@/modal', () => ({ Modal: { confirm: async () => true } }));
vi.mock('./api', () => ({ createMyAgentsApi: () => ({ list: mocks.list, get: mocks.get, request: mocks.request }) }));
vi.mock('./launch', () => ({ launchMyAgentSession: mocks.launch, missingMyAgentSkills: () => [], selectMyAgentMachine: () => machine }));
import { MyAgentsScreen } from './MyAgentsScreen';
const profile = { id: 'agent-a', name: '军师', summary: '评估想法', instructions: '先给判断', skills: [], preferences: '直接表达', setupNotes: '', machineId: 'm', directory: '/work', model: 'gpt-6.1-sol', effort: 'high', updatedAt: 2, sessions: [{ sessionId: 's', title: '上次' }] };
let renderer: any;
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
const button = (label: string) => renderer.root.findAllByType('Pressable').find((node: any) => node.props.accessibilityLabel === label);
beforeEach(() => { vi.clearAllMocks(); mocks.params.agentId = 'agent-a'; mocks.list.mockResolvedValue([profile]); mocks.get.mockResolvedValue(profile); mocks.scan.mockResolvedValue([]); mocks.exists.mockResolvedValue(true); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = undefined; });
async function mount() { await act(async () => { renderer = TestRenderer.create(<MyAgentsScreen/>); }); await settle(); }
it('restores controls after blur and rejects a late navigation from the old focus', async () => {
    let finish!: (value: string) => void;
    mocks.launch.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    await mount();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Agent 任务' }).props.onChangeText('评估计划'));
    await act(async () => button('开始对话').props.onPress());
    expect(button('开始对话').props.disabled).toBe(true);
    await act(async () => { mocks.blur!(); mocks.blur = mocks.focus!(); });
    await settle();
    expect(button('开始对话').props.disabled).toBe(false);
    await act(async () => finish('late-session'));
    expect(mocks.push).not.toHaveBeenCalled();
});
it('does not navigate when an old continue operation finishes after refocus', async () => {
    let finish!: (value: boolean) => void;
    mocks.exists.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    await mount();
    await act(async () => button('继续上次').props.onPress());
    await act(async () => { mocks.blur!(); mocks.blur = mocks.focus!(); });
    await settle();
    await act(async () => finish(true));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(button('继续上次').props.disabled).toBe(false);
});
it('clears explicit preferences directly while preserving the latest role and revision', async () => {
    await mount();
    mocks.get.mockResolvedValue({ ...profile, instructions: '另一端的新职责', updatedAt: 3 });
    await act(async () => button('清除长期偏好').props.onPress());
    expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toMatchObject({ preferences: '', instructions: '另一端的新职责', expectedUpdatedAt: 3 });
    expect(mocks.launch).not.toHaveBeenCalled();
});

it('does not hijack navigation when the user selects another Agent during a slow start', async () => {
    let finish!: (value: string) => void;
    mocks.launch.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    await mount();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Agent 任务' }).props.onChangeText('慢任务'));
    await act(async () => button('开始对话').props.onPress());
    mocks.params.agentId = 'agent-b';
    await act(async () => renderer.update(<MyAgentsScreen/>));
    await act(async () => finish('late-session'));
    expect(mocks.push).not.toHaveBeenCalled();
});
