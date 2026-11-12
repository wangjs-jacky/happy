import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error renderer harness has no separate typings
import TestRenderer from 'react-test-renderer';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), credentials: { token: 'test' }, server: 'https://test' }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'web', select: (v: any) => v.web ?? v.default } }));
vi.mock('react-native-unistyles', async () => { const { appThemes } = await import('@/themePacks'); return {
    StyleSheet: { hairlineWidth: 1, create: (f: any) => f(appThemes.ginghamDark) }, useUnistyles: () => ({ theme: appThemes.ginghamDark }),
}; });
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: mocks.credentials }), getCurrentAuth: () => ({ credentials: mocks.credentials }) }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => mocks.server }));
vi.mock('@/sync/apiSocket', () => ({ apiSocket: { machineRPC: mocks.rpc } }));
vi.mock('@/modal', () => ({ Modal: { prompt: mocks.prompt, confirm: mocks.confirm } }));
vi.mock('@/text', async () => { const { en } = await import('@/text/_default'); return { t: (key: string, params: unknown) => {
    const value = key.split('.').reduce((v: any, part) => v?.[part], en); return typeof value === 'function' ? value(params) : value ?? key;
} }; });
import { MagpieSection } from './MagpieSection';

const id = 'a'.repeat(64);
const data = (name = 'Work') => ({ status: 'ready', version: null, error: null, changed: false, observedAt: '2026-11-11T10:00:00Z', accounts: [{
    id, name, user: 'user@example.test', agent: 'codex', plan: 'pro', active: false, enabled: true, needsLogin: false, quotaError: false,
    readAt: '2026-11-11T10:00:00Z', windows: [{ name: '7 days', remaining: 42, resetsAt: null }], canSwitch: true, canRename: true,
}] });
const machines = [{ id: 'a', name: 'Mac', active: true }, { id: 'b', name: 'Other', active: true }, { id: 'c', name: 'Offline', active: false }];
const textOf = (node: any): string => typeof node === 'string' ? node : (Array.isArray(node) ? node : node?.children ?? []).map(textOf).join(' ');
describe('Magpie panel over device RPC', () => {
    let renderer: any;
    beforeEach(() => {
        vi.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        mocks.credentials = { token: 'test' }; mocks.rpc.mockResolvedValue(data()); mocks.confirm.mockResolvedValue(true); mocks.prompt.mockResolvedValue('Renamed');
    });
    afterEach(() => { act(() => renderer?.unmount()); });
    const render = async (connected = true) => { await act(async () => { renderer = TestRenderer.create(<MagpieSection machines={machines} connected={connected} />); }); };
    const press = async (testID: string) => { await act(async () => { await renderer.root.findByProps({ testID }).props.onPress(); }); };
    it('loads the selected online device once and renders quota plus its reading time', async () => {
        await render(); expect(mocks.rpc).toHaveBeenCalledOnce();
        expect(mocks.rpc).toHaveBeenCalledWith('a', 'magpie-control', { action: 'inspect' }, expect.any(Object));
        expect(textOf(renderer.toJSON())).toContain('42% left'); expect(textOf(renderer.toJSON())).toContain('Read ');
    });
    it('refreshes exactly the selected account', async () => {
        await render(); await press(`magpie-refresh-${id}`);
        expect(mocks.rpc.mock.calls[1].slice(0, 3)).toEqual(['a', 'magpie-control', { action: 'refresh', accountId: id }]);
    });
    it('switches only after confirmation and shows success from verified device state', async () => {
        await render(); await press(`magpie-switch-${id}`);
        expect(mocks.confirm.mock.calls[0][1]).toContain('Happy’s account bindings and isolated sessions');
        expect(mocks.rpc.mock.calls[1][2]).toEqual({ action: 'switch', accountId: id, confirmed: true });
        expect(textOf(renderer.toJSON())).toContain('switched and verified');
    });
    it('cancel leaves the device untouched', async () => {
        mocks.confirm.mockResolvedValue(false); await render(); await press(`magpie-switch-${id}`);
        expect(mocks.rpc).toHaveBeenCalledOnce();
    });
    it('renames via the device with a trimmed name', async () => {
        mocks.prompt.mockResolvedValue(' Renamed '); await render(); await press(`magpie-rename-${id}`);
        expect(mocks.rpc.mock.calls[1][2]).toEqual({ action: 'rename', accountId: id, name: 'Renamed' });
    });
    it.each(['--clear', 'x'.repeat(81), 'a\nb'])('keeps accounts visible and sends no RPC for an invalid alias', async name => {
        mocks.prompt.mockResolvedValue(name); await render(); await press(`magpie-rename-${id}`);
        expect(mocks.rpc).toHaveBeenCalledOnce(); expect(textOf(renderer.toJSON())).toContain('42% left');
        expect(textOf(renderer.toJSON())).toContain('cannot start with a dash');
        expect(textOf(renderer.toJSON())).not.toContain('Could not reach');
    });
    it('never queries an offline or disconnected device and hides stale accounts', async () => {
        await render(); await press('magpie-device-c'); expect(mocks.rpc).toHaveBeenCalledOnce();
        expect(textOf(renderer.toJSON())).not.toContain('42% left');
        await act(async () => renderer.update(<MagpieSection machines={machines} connected={false} />));
        expect(renderer.root.findByProps({ testID: 'magpie-reload' }).props.disabled).toBe(true);
    });
    it('drops a late response from the previously selected device', async () => {
        let resolve!: (value: unknown) => void;
        mocks.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        await render(); await press('magpie-device-b');
        await act(async () => resolve(data('Old machine')));
        expect(textOf(renderer.toJSON())).not.toContain('Old machine');
        expect(mocks.rpc.mock.calls[1][0]).toBe('b');
    });
    it('drops a confirmation that resolves after disconnection', async () => {
        let finish!: (value: boolean) => void;
        mocks.confirm.mockImplementation(() => new Promise(r => { finish = r; }));
        await render(); let action!: Promise<void>;
        act(() => { action = renderer.root.findByProps({ testID: `magpie-switch-${id}` }).props.onPress(); });
        await act(async () => renderer.update(<MagpieSection machines={machines} connected={false} />));
        await act(async () => { finish(true); await action; });
        expect(mocks.rpc).toHaveBeenCalledOnce();
    });
    it('does not show success for an uncertain write; it offers a single reload', async () => {
        await render(); mocks.rpc.mockResolvedValue({ ...data(), accounts: [], status: 'error', error: 'verification-failed', changed: true });
        await press(`magpie-switch-${id}`);
        expect(textOf(renderer.toJSON())).toContain('may have changed'); expect(textOf(renderer.toJSON())).not.toContain('switched and verified');
    });
    it('shows a missing installation separately from an old/unreachable Paws CLI', async () => {
        mocks.rpc.mockResolvedValue({ ...data(), accounts: [], status: 'not-installed' }); await render();
        expect(textOf(renderer.toJSON())).toContain('not found on this device');
        mocks.rpc.mockRejectedValue(new Error('sensitive raw backend error')); await press('magpie-reload');
        expect(textOf(renderer.toJSON())).toContain('Update the Paws CLI'); expect(textOf(renderer.toJSON())).not.toContain('sensitive');
    });
});
