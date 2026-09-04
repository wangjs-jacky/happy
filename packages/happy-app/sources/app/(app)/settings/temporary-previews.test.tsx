import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    credentials: { token: 'account-token' },
    status: vi.fn(),
    connectUrl: vi.fn(),
    disconnect: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
    external: vi.fn(),
}));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'web' },
    Text: 'Text',
    View: 'View',
}));
vi.mock('expo-router', () => ({ Stack: { Screen: 'StackScreen' } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: mocks.credentials }) }));
vi.mock('@/components/Item', () => ({ Item: (props: any) => React.createElement('Item', props) }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: (props: any) => React.createElement('ItemGroup', props) }));
vi.mock('@/components/ItemList', () => ({ ItemList: (props: any) => React.createElement('ItemList', props) }));
vi.mock('@/modal', () => ({ Modal: { confirm: mocks.confirm, alert: mocks.alert } }));
vi.mock('@/utils/openExternalUrl', () => ({ openExternalUrl: mocks.external }));
vi.mock('@/sync/apiInteractivePreviews', () => ({
    getVercelPreviewStatus: mocks.status,
    getVercelPreviewConnectUrl: mocks.connectUrl,
    disconnectVercelPreview: mocks.disconnect,
    VercelPreviewApiError: class VercelPreviewApiError extends Error {},
}));
vi.mock('@/text', () => ({
    t: (key: string, params?: { name?: string }) => ({
        'interactivePreviews.title': 'Temporary previews',
        'interactivePreviews.connection': 'Connection',
        'interactivePreviews.loading': 'Loading connection…',
        'interactivePreviews.unavailable': 'Temporary previews are unavailable on this Happy Server.',
        'interactivePreviews.disconnected': 'Not connected',
        'interactivePreviews.connected': `Connected to ${params?.name ?? 'Vercel'}`,
        'interactivePreviews.connect': 'Connect Vercel',
        'interactivePreviews.reconnect': 'Reconnect Vercel',
        'interactivePreviews.disconnect': 'Disconnect Vercel',
        'interactivePreviews.disconnectTitle': 'Disconnect Vercel?',
        'interactivePreviews.disconnectBody': 'New previews will stop immediately.',
        'interactivePreviews.disconnectWarning': 'Some published previews could not be removed. Remove them from Vercel.',
        'interactivePreviews.popupBlocked': 'Allow pop-ups for Happy, then try connecting again.',
        'interactivePreviews.safeError': 'Unable to update temporary previews. Please retry.',
        'interactivePreviews.disclosure': 'Preview links are public and are scheduled for deletion after 24 hours.',
    })[key] ?? key,
}));
vi.mock('react-native-unistyles', () => {
    const theme = { colors: { accent: '#4af', text: '#fff', textSecondary: '#aaa', status: { connected: '#4f4' } } };
    return { StyleSheet: { create: (factory: (theme: any) => object) => factory(theme) }, useUnistyles: () => ({ theme }) };
});

import TemporaryPreviewsSettings from './temporary-previews';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => { resolve = next; });
    return { promise, resolve };
}

async function renderScreen() {
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(<TemporaryPreviewsSettings />); });
    return renderer;
}

describe('TemporaryPreviewsSettings', () => {
    let originalWindow: unknown;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        originalWindow = globalThis.window;
        mocks.status.mockReset();
        mocks.connectUrl.mockReset();
        mocks.disconnect.mockReset();
        mocks.confirm.mockReset();
        mocks.alert.mockReset();
        mocks.external.mockReset();
        mocks.credentials = { token: 'account-token' };
        mocks.confirm.mockResolvedValue(true);
    });

    afterEach(() => { vi.unstubAllGlobals(); });

    it('shows initial loading and then an unavailable capability without treating it as a network error', async () => {
        const request = deferred<any>();
        mocks.status.mockReturnValueOnce(request.promise);
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<TemporaryPreviewsSettings />); });
        expect(renderer.root.findByProps({ testID: 'temporary-previews-status-loading' })).toBeTruthy();

        await act(async () => { request.resolve({ available: false, connected: false }); });
        const item = renderer.root.findByProps({ testID: 'temporary-previews-status' });
        expect(item.props.subtitle).toBe('Temporary previews are unavailable on this Happy Server.');
        expect(item.props.disabled).toBe(true);
        act(() => renderer.unmount());
    });

    it('renders a disconnected account and opens the managed web popup flow', async () => {
        const popup: any = { location: { href: '' }, close: vi.fn() };
        vi.stubGlobal('window', { open: vi.fn(() => popup), addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { search: '' } });
        mocks.status.mockResolvedValue({ available: true, connected: false });
        mocks.connectUrl.mockResolvedValue('https://vercel.com/integrations/happy/new');
        const renderer = await renderScreen();

        await act(async () => { renderer.root.findByProps({ testID: 'temporary-previews-connect' }).props.onPress(); });
        expect(window.open).toHaveBeenCalledWith('about:blank', 'happy-vercel-connect', 'popup,width=720,height=760');
        expect(popup.location.href).toBe('https://vercel.com/integrations/happy/new');
        expect(mocks.external).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('reports a blocked popup safely rather than opening OAuth in the current app', async () => {
        vi.stubGlobal('window', { open: vi.fn(() => null), addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { search: '' } });
        mocks.status.mockResolvedValue({ available: true, connected: false });
        const renderer = await renderScreen();
        await act(async () => { renderer.root.findByProps({ testID: 'temporary-previews-connect' }).props.onPress(); });

        expect(mocks.connectUrl).not.toHaveBeenCalled();
        expect(mocks.alert).toHaveBeenCalledWith('Temporary previews', 'Allow pop-ups for Happy, then try connecting again.');
        expect(mocks.external).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('shows the connected team and project, reconnects with the same flow, and warns after a safe disconnect', async () => {
        const popup: any = { location: { href: '' }, close: vi.fn() };
        vi.stubGlobal('window', { open: vi.fn(() => popup), addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { search: '' } });
        mocks.status.mockResolvedValue({ available: true, connected: true, account: { teamName: 'Acme', projectId: 'happy-previews' } });
        mocks.connectUrl.mockResolvedValue('https://vercel.com/integrations/happy/new');
        mocks.disconnect.mockResolvedValue({ warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' });
        const renderer = await renderScreen();

        expect(renderer.root.findByProps({ testID: 'temporary-previews-status' }).props.subtitle).toContain('Acme');
        expect(renderer.root.findByProps({ testID: 'temporary-previews-project' }).props.subtitle).toBe('happy-previews');
        await act(async () => { renderer.root.findByProps({ testID: 'temporary-previews-reconnect' }).props.onPress(); });
        expect(popup.location.href).toBe('https://vercel.com/integrations/happy/new');
        await act(async () => { renderer.root.findByProps({ testID: 'temporary-previews-disconnect' }).props.onPress(); });
        expect(mocks.disconnect).toHaveBeenCalledWith(mocks.credentials);
        expect(mocks.alert).toHaveBeenCalledWith('Temporary previews', 'Some published previews could not be removed. Remove them from Vercel.');
        act(() => renderer.unmount());
    });

    it('refreshes after an OAuth callback query, a focus return, and a trusted completion message', async () => {
        const listeners = new Map<string, Function>();
        vi.stubGlobal('window', {
            open: vi.fn(),
            location: { search: '?vercel=connected' },
            addEventListener: vi.fn((name: string, handler: Function) => listeners.set(name, handler)),
            removeEventListener: vi.fn((name: string) => listeners.delete(name)),
        });
        mocks.status.mockResolvedValue({ available: true, connected: false });
        const renderer = await renderScreen();
        expect(mocks.status.mock.calls.length).toBeGreaterThanOrEqual(2);
        await act(async () => { listeners.get('focus')?.(); });
        await act(async () => { listeners.get('message')?.({ origin: undefined, data: { type: 'happy-vercel-connected' } }); });
        expect(mocks.status.mock.calls.length).toBeGreaterThanOrEqual(4);
        act(() => renderer.unmount());
    });

    it('shows safe errors for expired credentials and other refresh failures', async () => {
        mocks.status.mockRejectedValue(new Error('expired token secret=not-for-ui'));
        const renderer = await renderScreen();
        expect(renderer.root.findByProps({ testID: 'temporary-previews-error' }).props.children).toBe('Unable to update temporary previews. Please retry.');
        act(() => renderer.unmount());
    });
});
