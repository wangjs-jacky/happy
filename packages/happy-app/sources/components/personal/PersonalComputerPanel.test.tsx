import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { PersonalComputerPanel } from './PersonalComputerPanel';

const mocks = vi.hoisted(() => ({
    rpc: vi.fn(), open: vi.fn(), close: vi.fn(), epoch: vi.fn(), receive: vi.fn(),
    interrupted: false,
    state: {} as Record<string, unknown>,
    frame: null as Record<string, unknown> | null,
}));
vi.mock('react-native', async () => {
    const R = await import('react');
    return { Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default }, View: 'View', TextInput: 'TextInput', Image: 'Image', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
        Pressable: ({ children, ...props }: any) => R.createElement('Pressable', props, typeof children === 'function' ? children({ pressed: false }) : children) };
});
vi.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'this-viewer' }));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/sync/apiSocket', () => ({ apiSocket: { sessionRPC: mocks.rpc } }));
vi.mock('@/sync/personalComputerStream', () => ({
    personalComputerStream: { open: mocks.open, close: mocks.close, epoch: mocks.epoch, receive: mocks.receive },
    usePersonalComputerInterrupted: () => mocks.interrupted,
    usePersonalComputerFrame: () => mocks.frame,
}));
vi.mock('react-native-unistyles', async () => {
    const { appThemes } = await import('@/themePacks');
    return { StyleSheet: { hairlineWidth: 1, create: (fn: any) => fn(appThemes.ginghamDark) }, useUnistyles: () => ({ theme: appThemes.ginghamDark }) };
});

let tree: any;
const label = (suffix: string) => tree.root.findByProps({ accessibilityLabel: `personalAgent.computer.${suffix}` });
const actions = () => mocks.rpc.mock.calls.map((call: any[]) => call[2]);
async function mount() { await act(async () => { tree = TestRenderer.create(<PersonalComputerPanel sessionId="personal-session" onClose={vi.fn()} />); }); }

describe('Personal computer viewer control', () => {
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        vi.clearAllMocks(); mocks.interrupted = false;
        mocks.state = { available: true, phase: 'ready', control: 'human', controllerId: 'this-viewer', epoch: 3, width: 1280, height: 720 };
        mocks.frame = { type: 'personal-computer-frame', viewerId: 'this-viewer', epoch: 3, sequence: 1, data: 'YWJj', width: 1280, height: 720 };
        mocks.rpc.mockImplementation(async () => ({ state: { ...mocks.state } }));
    });
    afterEach(async () => { if (tree) { await act(async () => { tree.unmount(); }); tree = null; } });

    it('keeps start and refresh disabled until the initial status request resolves', async () => {
        let resolveStatus!: (value: unknown) => void;
        mocks.rpc.mockImplementationOnce(() => new Promise(resolve => { resolveStatus = resolve; }));
        await mount();
        const loading = tree.root.findByProps({ accessibilityLabel: 'common.loading' });
        expect(loading.props.disabled).toBe(true);
        expect(label('refresh').props.disabled).toBe(true);
        expect(tree.root.findAllByProps({ accessibilityLabel: 'personalAgent.computer.start' })).toHaveLength(0);
        await act(async () => { loading.props.onPress(); label('refresh').props.onPress(); });
        expect(actions()).toEqual([{ action: 'status' }]);
        await act(async () => { resolveStatus({ state: { ...mocks.state } }); });
        expect(actions()).toEqual([{ action: 'status' }, { action: 'view', viewerId: 'this-viewer' }]);
        expect(label('refresh').props.disabled).toBe(false);
        expect(tree.root.findByProps({ testID: 'personal-computer-control' }).props.disabled).toBe(false);
    });

    it('shows a known computer state error beneath the generic failure without hiding the retry action', async () => {
        const reason = 'Docker network address pool exhausted';
        mocks.state = { ...mocks.state, phase: 'error', error: reason };
        await mount();
        expect(tree.root.findByProps({ accessibilityRole: 'alert' }).children).toContain('personalAgent.computer.failed');
        const explanation = tree.root.findAllByType('Text').find((node: any) => node.children.includes(reason));
        expect(explanation).toBeTruthy();
        expect(explanation.props.selectable).toBe(true);
        expect(label('start').props.disabled).toBe(false);
        expect(actions()).toEqual([{ action: 'status' }]);
    });

    it('does not display arbitrary rejected RPC diagnostics as a known state error', async () => {
        const privateDiagnostic = 'synthetic internal transport details';
        mocks.rpc.mockRejectedValueOnce(new Error(privateDiagnostic));
        await mount();
        expect(tree.root.findByProps({ accessibilityRole: 'alert' }).children).toContain('personalAgent.computer.failed');
        const text = tree.root.findAllByType('Text').flatMap((node: any) => node.children).filter((value: unknown) => typeof value === 'string').join(' ');
        expect(text).not.toContain(privateDiagnostic);
        expect(label('start').props.disabled).toBe(false);
    });

    it('subscribes with its own viewer and only sends input with the matching controller and epoch', async () => {
        await mount();
        expect(actions()).toEqual([{ action: 'status' }, { action: 'view', viewerId: 'this-viewer' }]);
        expect(mocks.open).toHaveBeenCalledWith('personal-session', 'this-viewer');
        expect(mocks.open).toHaveBeenLastCalledWith('personal-session', 'this-viewer', 3);
        expect(tree.root.findByProps({ testID: 'personal-computer-address' }).props.editable).toBe(true);
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-address' }).props.onChangeText('https://example.com/'); });
        await act(async () => { label('go').props.onPress(); });
        expect(actions()).toContainEqual({ action: 'input', viewerId: 'this-viewer', epoch: 3, input: { kind: 'navigate', url: 'https://example.com/' } });
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-control' }).props.onPress(); });
        expect(actions()).toContainEqual({ action: 'release', viewerId: 'this-viewer', epoch: 3 });
    });

    it('labels expand and collapse accessibly while retaining the viewer subscription and human control', async () => {
        const toggle = vi.fn(), close = vi.fn();
        await act(async () => { tree = TestRenderer.create(<PersonalComputerPanel sessionId="personal-session" onClose={close} expanded={false} onToggleExpand={toggle} />); });
        const requestCount = mocks.rpc.mock.calls.length;
        const openCount = mocks.open.mock.calls.length;
        let button = tree.root.findByProps({ testID: 'personal-computer-expand' });
        expect(button.props.accessibilityRole).toBe('button');
        expect(button.props.accessibilityLabel).toBe('personalAgent.computer.expand');
        expect(button.props.accessibilityState.expanded).toBe(false);
        await act(async () => { button.props.onPress(); });
        expect(toggle).toHaveBeenCalledTimes(1);
        await act(async () => { tree.update(<PersonalComputerPanel sessionId="personal-session" onClose={close} expanded onToggleExpand={toggle} />); });
        button = tree.root.findByProps({ testID: 'personal-computer-expand' });
        expect(button.props.accessibilityLabel).toBe('personalAgent.computer.collapse');
        expect(button.props.accessibilityState.expanded).toBe(true);
        await act(async () => { button.props.onPress(); });
        expect(toggle).toHaveBeenCalledTimes(2);
        expect(mocks.open).toHaveBeenCalledTimes(openCount);
        expect(mocks.close).not.toHaveBeenCalled();
        expect(mocks.rpc).toHaveBeenCalledTimes(requestCount);
        expect(actions().some((request: any) => request.action === 'takeover' || request.action === 'release' || request.action === 'unview')).toBe(false);
        expect(tree.root.findByProps({ testID: 'personal-computer-address' }).props.editable).toBe(true);
    });

    it('preserves text after an input RPC fails, then clears only the text acknowledged by a successful retry', async () => {
        await mount();
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-text' }).props.onChangeText('unfinished text'); });
        mocks.rpc.mockRejectedValueOnce(new Error('input failed'));
        await act(async () => { label('type').props.onPress(); });
        expect(tree.root.findByProps({ testID: 'personal-computer-text' }).props.value).toBe('unfinished text');
        expect(tree.root.findByProps({ accessibilityRole: 'alert' }).children).toContain('personalAgent.computer.failed');
        await act(async () => { label('type').props.onPress(); });
        expect(tree.root.findByProps({ testID: 'personal-computer-text' }).props.value).toBe('');
        expect(actions().filter((request: any) => request.action === 'input')).toEqual([
            { action: 'input', viewerId: 'this-viewer', epoch: 3, input: { kind: 'text', text: 'unfinished text' } },
            { action: 'input', viewerId: 'this-viewer', epoch: 3, input: { kind: 'text', text: 'unfinished text' } },
        ]);
    });

    it('keeps newer text typed while an older input is in flight', async () => {
        await mount();
        let complete!: (value: unknown) => void;
        mocks.rpc.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-text' }).props.onChangeText('first'); });
        await act(async () => { label('type').props.onPress(); });
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-text' }).props.onChangeText('next'); complete({ state: { ...mocks.state } }); });
        expect(tree.root.findByProps({ testID: 'personal-computer-text' }).props.value).toBe('next');
    });

    it.each(['other-viewer', undefined])('rejects input when human control belongs to %s rather than this viewer', async controllerId => {
        mocks.state.controllerId = controllerId;
        await mount();
        expect(tree.root.findByProps({ testID: 'personal-computer-address' }).props.editable).toBe(false);
        expect(tree.root.findByProps({ testID: 'personal-computer-canvas' }).props.disabled).toBe(true);
        expect(tree.root.findAllByProps({ testID: 'personal-computer-text' })).toHaveLength(0);
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-address' }).props.onChangeText('https://example.com/'); });
        await act(async () => { label('go').props.onPress(); });
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-canvas' }).props.onLayout({ nativeEvent: { layout: { width: 640 } } }); });
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-canvas' }).props.onPress({ nativeEvent: { locationX: 30, locationY: 20 } }); });
        expect(actions().filter((request: any) => request.action === 'input')).toEqual([]);
    });

    it('drops input while disconnected even if its previous controller is this viewer', async () => {
        mocks.interrupted = true;
        await mount();
        expect(tree.root.findByProps({ testID: 'personal-computer-canvas' }).props.disabled).toBe(true);
        expect(tree.root.findByProps({ testID: 'personal-computer-control' }).props.disabled).toBe(true);
        expect(tree.root.findAllByProps({ testID: 'personal-computer-text' })).toHaveLength(0);
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-address' }).props.onChangeText('https://example.com/'); });
        await act(async () => { label('go').props.onPress(); });
        expect(actions().filter((request: any) => request.action === 'input')).toEqual([]);
    });

    it.each([null, 2, 4])('does not show or act on a missing/mismatched frame with epoch %s', async frameEpoch => {
        mocks.frame = frameEpoch === null ? null : { ...mocks.frame, epoch: frameEpoch };
        await mount();
        expect(tree.root.findByProps({ testID: 'personal-computer-address' }).props.editable).toBe(false);
        expect(tree.root.findByProps({ testID: 'personal-computer-canvas' }).props.disabled).toBe(true);
        expect(tree.root.findAllByProps({ testID: 'personal-computer-text' })).toHaveLength(0);
        expect(tree.root.findAllByType('Image')).toHaveLength(0);
        // Exercise callbacks too: a disabled surface must not be the only fence.
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-address' }).props.onChangeText('https://example.com/'); });
        await act(async () => { label('go').props.onPress(); });
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-canvas' }).props.onLayout({ nativeEvent: { layout: { width: 640 } } }); });
        await act(async () => { tree.root.findByProps({ testID: 'personal-computer-canvas' }).props.onPress({ nativeEvent: { locationX: 30, locationY: 20 } }); });
        expect(actions().filter((request: any) => request.action === 'input')).toEqual([]);
        // A new frame for the acknowledged control epoch restores input.
        mocks.frame = { type: 'personal-computer-frame', viewerId: 'this-viewer', epoch: 3, sequence: 2, data: 'ZGVm', width: 1280, height: 720 };
        await act(async () => { tree.update(<PersonalComputerPanel sessionId="personal-session" onClose={vi.fn()} />); });
        expect(tree.root.findByProps({ testID: 'personal-computer-address' }).props.editable).toBe(true);
        expect(tree.root.findAllByType('Image')).toHaveLength(1);
        await act(async () => { label('go').props.onPress(); });
        expect(actions().filter((request: any) => request.action === 'input')).toEqual([
            { action: 'input', viewerId: 'this-viewer', epoch: 3, input: { kind: 'navigate', url: 'https://example.com/' } },
        ]);
    });

    it('unsubscribes on unmount without returning human control to the agent', async () => {
        await mount();
        await act(async () => { tree.unmount(); }); tree = null;
        expect(mocks.close).toHaveBeenCalledWith('this-viewer');
        expect(actions()).toContainEqual({ action: 'unview', viewerId: 'this-viewer' });
        expect(actions().filter((request: any) => request.action === 'release')).toEqual([]);
    });

    it.each(['this-viewer', 'other-viewer'])('reports a stopped computer as stopped even when its retained human controller is %s', async controllerId => {
        await mount();
        mocks.rpc.mockResolvedValueOnce({ state: { ...mocks.state, phase: 'stopped', control: 'human', controllerId } });
        await act(async () => { label('stop').props.onPress(); });
        expect(actions()).toContainEqual({ action: 'stop', epoch: 3 });
        const caption = tree.root.findByProps({ accessibilityLiveRegion: 'polite' });
        expect(caption.children).toContain('personalAgent.computer.stopped');
        expect(caption.children).not.toContain('personalAgent.computer.otherHuman');
        expect(caption.children).not.toContain('personalAgent.computer.human');
        expect(label('start')).toBeTruthy();
        expect(tree.root.findAllByProps({ testID: 'personal-computer-canvas' })).toHaveLength(0);
    });

    it('does not reopen a view when a status response arrives after the panel was unmounted', async () => {
        let resolveStatus!: (value: unknown) => void;
        mocks.rpc.mockImplementationOnce(() => new Promise(resolve => { resolveStatus = resolve; }));
        await mount();
        await act(async () => { tree.unmount(); }); tree = null;
        await act(async () => { resolveStatus({ state: { ...mocks.state } }); });
        expect(actions()).toEqual([{ action: 'status' }, { action: 'unview', viewerId: 'this-viewer' }]);
        expect(mocks.open).toHaveBeenCalledTimes(1);
        expect(mocks.epoch).not.toHaveBeenCalled();
        expect(mocks.receive).not.toHaveBeenCalled();
    });

    it('ignores the first mount’s delayed status after StrictMode cleans up and mounts a new viewer generation', async () => {
        let resolveOldStatus!: (value: unknown) => void;
        mocks.state = { ...mocks.state, epoch: 4, url: 'https://current.example/' };
        mocks.frame = { ...mocks.frame, epoch: 4 };
        mocks.rpc.mockImplementationOnce(() => new Promise(resolve => { resolveOldStatus = resolve; }));
        await act(async () => { tree = TestRenderer.create(<React.StrictMode><PersonalComputerPanel sessionId="personal-session" onClose={vi.fn()} /></React.StrictMode>); });
        expect(actions().filter((request: any) => request.action === 'status')).toHaveLength(2);
        expect(actions().filter((request: any) => request.action === 'view')).toHaveLength(1);
        expect(tree.root.findByProps({ testID: 'personal-computer-address' }).props.placeholder).toBe('https://current.example/');
        await act(async () => { resolveOldStatus({ state: { ...mocks.state, epoch: 3, url: 'https://stale.example/' } }); });
        expect(actions().filter((request: any) => request.action === 'view')).toHaveLength(1);
        expect(mocks.epoch).not.toHaveBeenCalledWith('this-viewer', 3);
        expect(tree.root.findByProps({ testID: 'personal-computer-address' }).props.placeholder).toBe('https://current.example/');
        expect(tree.root.findByProps({ testID: 'personal-computer-address' }).props.editable).toBe(true);
    });
});
