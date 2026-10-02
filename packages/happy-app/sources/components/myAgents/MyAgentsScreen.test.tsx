import React, { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no bundled declarations.
import TestRenderer from 'react-test-renderer';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ factoryError: '', push: vi.fn(), list: vi.fn(), params: {} as { agentId?: string }, credentials: { token: 'fixture' } }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', Platform: { select: (options: any) => options.web } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.push }), useLocalSearchParams: () => mocks.params, useFocusEffect: (callback: () => (() => void)) => React.useEffect(callback, [callback]) }));
vi.mock('react-native-unistyles', () => ({ StyleSheet: { create: (fn: any) => fn({ colors: {} }) }, useUnistyles: () => ({ theme: { colors: {} } }) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: mocks.credentials }) }));
vi.mock('./api', () => ({ createMyAgentsApi: () => { if (mocks.factoryError) throw new Error(mocks.factoryError); return ({ list: mocks.list }); } }));
import { MyAgentsScreen } from './MyAgentsScreen';
const profile = { id: 'agent-a', name: '军师', summary: '评估想法', instructions: '先给判断', archived: false };
let renderer: any;
const button = (label: string) => renderer.root.findAllByType('Pressable').find((node: any) => node.props.accessibilityLabel === label);
beforeEach(() => { vi.clearAllMocks(); mocks.factoryError = ''; mocks.params = {}; mocks.list.mockResolvedValue([profile]); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = undefined; });
async function mount() { await act(async () => { renderer = TestRenderer.create(<MyAgentsScreen/>); }); }
it('lists assistants with a single creation entry and no configuration inputs', async () => {
    await mount();
    expect(button('与 军师 对话')).toBeDefined();
    expect(renderer.root.findAllByType('TextInput')).toHaveLength(0);
    await act(async () => button('创建 Agent').props.onPress());
    expect(mocks.push).toHaveBeenCalledWith('/new?myAgentMode=create');
});
it('opens ordinary chat for both work and natural-language editing', async () => {
    await mount();
    await act(async () => button('与 军师 对话').props.onPress());
    expect(mocks.push).toHaveBeenLastCalledWith('/new?myAgentMode=use&myAgentId=agent-a');
    await act(async () => button('修改 军师').props.onPress());
    expect(mocks.push).toHaveBeenLastCalledWith('/new?myAgentMode=edit&myAgentId=agent-a');
});
it('hides archived profiles and exposes creation even when catalog loading fails', async () => {
    mocks.list.mockResolvedValue([{ ...profile, archived: true }]);
    await mount();
    expect(button('与 军师 对话')).toBeUndefined();
    await act(async () => renderer.unmount()); renderer = undefined;
    mocks.list.mockRejectedValue(new Error('offline'));
    await mount();
    expect(button('重试')).toBeDefined();
    expect(button('创建 Agent')).toBeDefined();
});
it('ignores a late account catalog result after unmount', async () => {
    let finish!: (value: unknown) => void;
    mocks.list.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount();
    await act(async () => renderer.unmount()); renderer = undefined;
    await act(async () => finish([profile]));
    expect(mocks.push).not.toHaveBeenCalled();
});

it('shows unsupported account errors inside the catalog instead of throwing from focus', async () => {
    mocks.factoryError = '请切换到 Paws 服务器的账号。';
    await mount();
    expect(renderer.root.findByProps({ accessibilityRole: 'alert' }).props.children).toContain('Paws');
    expect(button('重试')).toBeDefined();
});
