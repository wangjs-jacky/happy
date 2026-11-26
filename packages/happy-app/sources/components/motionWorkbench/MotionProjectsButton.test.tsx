import * as React from 'react';
import { act } from 'react';
// @ts-expect-error react-test-renderer has no declarations.
import TestRenderer from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ current: true, online: true, sessionId: 'session', turn: { status: 'completed', turnId: 'initial', updatedAt: 1 }, rpc: vi.fn(), open: vi.fn(), queue: vi.fn(), prompt: vi.fn() }));
vi.mock('react-native', () => ({ View: 'View', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', TextInput: 'TextInput' }));
vi.mock('react-native-unistyles', () => ({ useUnistyles: () => ({ theme: { colors: { text: 'text', textSecondary: 'secondary', textDestructive: 'error', divider: 'divider', input: { background: 'input', text: 'text' } } } }) }));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@/components/DesktopDialogFrame', () => ({ DesktopDialogFrame: ({ visible, ...props }: any) => visible ? React.createElement('Dialog', props) : null }));
vi.mock('@/components/fileWorkspace/WorkspaceButton', () => ({ WorkspaceButton: 'Button' }));
vi.mock('@/components/fileWorkspace/context', () => ({ useFileWorkspace: () => ({ sessionId: mock.sessionId, root: '/work', enabled: true, openMotionProject: mock.open }) }));
vi.mock('@/auth/accountRuntime', () => ({ accountRuntimeCurrent: () => mock.current, getRuntimeAccountSelection: () => ({ key: 'account' }) }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://paws.test' }));
vi.mock('@/sync/storage', () => ({ useSession: () => ({ metadata: {}, agentState: { turnStatus: mock.turn } }), useSocketStatus: () => ({ status: mock.online ? 'connected' : 'disconnected' }) }));
vi.mock('@/utils/sessionUtils', () => ({ resolveSessionState: () => ({ isConnected: true }) }));
vi.mock('@/sync/motionWorkbench.web', () => ({ motionWorkbenchRequest: mock.rpc }));
vi.mock('@/sync/messageStagingQueueRuntime', () => ({ stageSessionMessage: mock.queue }));
vi.mock('@/modal', () => ({ Modal: { prompt: mock.prompt } }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
import { MotionProjectsButton } from './MotionProjectsButton.web';
const movie = (title: string) => ({ projectPath: '/work/' + title, title, modifiedAt: 1 });
let renderer: any;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mock.current = true; mock.online = true; mock.sessionId = 'session'; mock.turn = { status: 'completed', turnId: 'initial', updatedAt: 1 }; mock.open.mockReset().mockResolvedValue(undefined); mock.queue.mockReset().mockResolvedValue(undefined); mock.prompt.mockReset();
    mock.rpc.mockReset().mockImplementation(async (_session, method, input) => method === 'motionWorkbenchList' ? { projects: [], truncated: false } : movie(input.projectPath.split('/').pop()));
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
async function mount() { await act(async () => { renderer = TestRenderer.create(<MotionProjectsButton />); }); }
const entry = () => renderer.root.findByProps({ testID: 'motion-projects-open' });
it('opens the only discovered project directly and revalidates it before opening', async () => {
    mock.rpc.mockImplementation(async (_s, method) => method === 'motionWorkbenchList' ? { projects: [movie('Paws 宣传片')], truncated: false } : movie('Paws 宣传片'));
    await mount(); await act(async () => entry().props.onPress());
    expect(mock.rpc.mock.calls.map(call => call[1])).toEqual(['motionWorkbenchList', 'motionWorkbenchRegister']);
    expect(mock.open).toHaveBeenCalledExactlyOnceWith('/work/Paws 宣传片'); expect(renderer.root.findAllByType('Dialog')).toHaveLength(0);
});
it('shows several projects by name and opens only the explicitly chosen project', async () => {
    mock.rpc.mockImplementation(async (_s, method) => method === 'motionWorkbenchList' ? { projects: [movie('One'), movie('Two')], truncated: false } : movie('Two'));
    await mount(); await act(async () => entry().props.onPress()); expect(mock.open).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByProps({ testID: 'motion-project:/work/Two' }).props.onPress());
    expect(mock.open).toHaveBeenCalledExactlyOnceWith('/work/Two');
});
it('keeps partial results as a list rather than auto-opening a possibly incomplete single result', async () => {
    mock.rpc.mockResolvedValue({ projects: [movie('One')], truncated: true }); await mount(); await act(async () => entry().props.onPress());
    expect(mock.open).not.toHaveBeenCalled(); expect(JSON.stringify(renderer.toJSON())).toContain('motionWorkbench.limitedProjects');
});
it('provides an empty state and queues creation only after a user action', async () => {
    await mount(); await act(async () => entry().props.onPress()); expect(mock.queue).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('motionWorkbench.emptyProjects');
    await act(async () => renderer.root.findByProps({ label: 'motionWorkbench.createProject' }).props.onPress());
    expect(mock.queue).toHaveBeenCalledExactlyOnceWith('session', 'motionWorkbench.createMessage', undefined, 'queue', expect.any(Object));
});
it('disables the entry offline and drops late discovery from a previous conversation', async () => {
    mock.online = false; await mount(); expect(entry().props.disabled).toBe(true);
    mock.online = true; await act(async () => renderer.update(<MotionProjectsButton />));
    let resolve!: (value: unknown) => void; mock.rpc.mockReturnValue(new Promise(done => { resolve = done; }));
    let pending: Promise<void>; act(() => { pending = entry().props.onPress(); });
    mock.sessionId = 'another'; await act(async () => renderer.update(<MotionProjectsButton />));
    await act(async () => { resolve({ projects: [movie('Old owner')], truncated: false }); await pending; });
    expect(mock.open).not.toHaveBeenCalled(); expect(renderer.root.findAllByType('Dialog')).toHaveLength(0);
});
it('registers an existing project before opening and lets the user cancel or recover from prompt failure', async () => {
    await mount(); await act(async () => entry().props.onPress());
    const add = () => renderer.root.findByProps({ label: 'motionWorkbench.registerProject' });
    mock.prompt.mockResolvedValueOnce(null);
    await act(async () => add().props.onPress());
    expect(mock.open).not.toHaveBeenCalled(); expect(entry().props.disabled).toBe(false);
    mock.prompt.mockRejectedValueOnce(new Error('Prompt unavailable'));
    await act(async () => add().props.onPress());
    expect(JSON.stringify(renderer.toJSON())).toContain('Prompt unavailable'); expect(entry().props.disabled).toBe(false);
    mock.prompt.mockResolvedValueOnce(' /work/imported ');
    await act(async () => add().props.onPress());
    expect(mock.rpc).toHaveBeenCalledWith('session', 'motionWorkbenchRegister', { projectPath: '/work/imported' });
    expect(mock.open).toHaveBeenCalledExactlyOnceWith('/work/imported');
});
it('keeps failed discovery recoverable and cancels a late refresh when its dialog closes', async () => {
    mock.rpc.mockRejectedValueOnce(new Error('Execution machine unavailable'));
    await mount(); await act(async () => entry().props.onPress());
    expect(JSON.stringify(renderer.toJSON())).toContain('Execution machine unavailable');
    let finish!: (value: unknown) => void; mock.rpc.mockReturnValueOnce(new Promise(done => { finish = done; }));
    act(() => { renderer.root.findByProps({ label: 'fileWorkspace.refresh' }).props.onPress(); });
    await act(async () => renderer.root.findByType('Dialog').props.onClose());
    await act(async () => { finish({ projects: [movie('Late')], truncated: false }); });
    expect(renderer.root.findAllByType('Dialog')).toHaveLength(0); expect(mock.open).not.toHaveBeenCalled();
    expect(entry().props.disabled).toBe(false);
});
it.each(['account', 'offline'])('does not open a project when %s changes during its validation', async reason => {
    mock.rpc.mockResolvedValueOnce({ projects: [movie('One')], truncated: false });
    let finish!: (value: unknown) => void; mock.rpc.mockReturnValueOnce(new Promise(done => { finish = done; }));
    await mount(); act(() => { entry().props.onPress(); });
    await act(async () => {});
    if (reason === 'account') mock.current = false;
    else { mock.online = false; await act(async () => renderer.update(<MotionProjectsButton />)); }
    await act(async () => { finish(movie('One')); });
    expect(mock.open).not.toHaveBeenCalled();
});
it('discovers AI-created projects on completion while the library is open without dispatching or polling', async () => {
    await mount(); await act(async () => entry().props.onPress());
    mock.rpc.mockResolvedValueOnce({ projects: [movie('Created by AI')], truncated: false });
    mock.turn = { status: 'completed', turnId: 'new-turn', updatedAt: 2 };
    await act(async () => renderer.update(<MotionProjectsButton />));
    expect(renderer.root.findByProps({ testID: 'motion-project:/work/Created by AI' })).toBeTruthy();
    expect(mock.rpc.mock.calls.filter(call => call[1] === 'motionWorkbenchList')).toHaveLength(2);
    await act(async () => renderer.update(<MotionProjectsButton />));
    expect(mock.rpc.mock.calls.filter(call => call[1] === 'motionWorkbenchList')).toHaveLength(2);
    expect(mock.queue).not.toHaveBeenCalled(); expect(mock.open).not.toHaveBeenCalled();
});
