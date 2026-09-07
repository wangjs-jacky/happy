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
    Text: 'Text', TextInput: 'TextInput',
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
    isCloudflareConnectionSecure: () => true,
    getCloudflarePreviewStatus: mocks.status,
    connectCloudflarePreview: mocks.connectUrl,
    disconnectCloudflarePreview: mocks.disconnect,
    CloudflarePreviewApiError: class CloudflarePreviewApiError extends Error {},
}));
vi.mock('@/text', () => ({
    t: (key: string, params?: { name?: string }) => ({
        'interactivePreviews.title': 'Temporary previews',
        'interactivePreviews.connection': 'Connection',
        'interactivePreviews.loading': 'Loading connection…',
        'interactivePreviews.unavailable': 'Temporary previews are unavailable on this Happy Server.',
        'interactivePreviews.disconnected': 'Not connected',
        'interactivePreviews.connected': `Connected to ${params?.name ?? 'Cloudflare'}`,
        'interactivePreviews.connect': 'Connect Cloudflare',
        'interactivePreviews.reconnect': 'Reconnect Cloudflare',
        'interactivePreviews.disconnect': 'Disconnect Cloudflare',
        'interactivePreviews.disconnectTitle': 'Disconnect Cloudflare?',
        'interactivePreviews.disconnectBody': 'New previews will stop immediately.',
        'interactivePreviews.disconnectWarning': 'Some published previews could not be removed. Remove them from Cloudflare.',
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

async function renderScreen() {
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(<TemporaryPreviewsSettings />); });
    return renderer;
}
describe('Cloudflare temporary preview settings', () => {
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        vi.clearAllMocks();
        mocks.status.mockResolvedValue({ available: true, connected: false });
        mocks.connectUrl.mockResolvedValue(undefined);
        mocks.confirm.mockResolvedValue(true);
        mocks.disconnect.mockResolvedValue({});
    });
    afterEach(() => vi.unstubAllGlobals());
    it('keeps the anonymous tunnel available when cloud hosting is unavailable', async () => {
        mocks.status.mockResolvedValue({ available: false, connected: false });
        const renderer = await renderScreen();
        expect(renderer.root.findByProps({ testID: 'temporary-previews-cloudflare' })).toBeTruthy();
        expect(renderer.root.findAllByProps({ testID: 'temporary-previews-connect' })).toHaveLength(0);
        act(() => renderer.unmount());
    });
    it('connects using a masked token form, clears the secret and refreshes status', async () => {
        const renderer = await renderScreen();
        await act(async () => renderer.root.findByProps({ testID: 'temporary-previews-connect' }).props.onPress());
        expect(renderer.root.findByProps({ testID: 'temporary-previews-api-token' }).props.secureTextEntry).toBe(true);
        act(() => {
            renderer.root.findByProps({ testID: 'temporary-previews-account-id' }).props.onChangeText('a'.repeat(32));
            renderer.root.findByProps({ testID: 'temporary-previews-api-token' }).props.onChangeText('secret'.repeat(8));
        });
        mocks.status.mockResolvedValue({ available: true, connected: true, account: { accountId: 'a'.repeat(32), projectId: 'project' } });
        await act(async () => renderer.root.findByProps({ testID: 'temporary-previews-save' }).props.onPress());
        expect(mocks.connectUrl).toHaveBeenCalledWith(mocks.credentials, 'a'.repeat(32), 'secret'.repeat(8));
        expect(renderer.root.findAllByProps({ testID: 'temporary-previews-api-token' })).toHaveLength(0);
        expect(renderer.root.findByProps({ testID: 'temporary-previews-project' })).toBeTruthy();
        act(() => renderer.unmount());
    });
    it('rejects invalid account input before calling the server', async () => {
        const renderer = await renderScreen();
        await act(async () => renderer.root.findByProps({ testID: 'temporary-previews-connect' }).props.onPress());
        await act(async () => renderer.root.findByProps({ testID: 'temporary-previews-save' }).props.onPress());
        expect(mocks.connectUrl).not.toHaveBeenCalled();
        expect(mocks.alert).toHaveBeenCalled();
        act(() => renderer.unmount());
    });
    it('keeps deletion warnings visible after disconnect', async () => {
        mocks.status.mockResolvedValue({ available: true, connected: true, account: { accountId: 'a'.repeat(32) } });
        mocks.disconnect.mockResolvedValue({ warning: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' });
        const renderer = await renderScreen();
        await act(async () => renderer.root.findByProps({ testID: 'temporary-previews-disconnect' }).props.onPress());
        expect(mocks.confirm).toHaveBeenCalled();
        expect(mocks.disconnect).toHaveBeenCalledWith(mocks.credentials);
        expect(mocks.alert).toHaveBeenCalled();
        act(() => renderer.unmount());
    });
    it('allows retry after a safe status error', async () => {
        mocks.status.mockRejectedValueOnce(new Error('secret'));
        const renderer = await renderScreen();
        expect(renderer.root.findByProps({ testID: 'temporary-previews-error' })).toBeTruthy();
        await act(async () => renderer.root.findByProps({ testID: 'temporary-previews-retry' }).props.onPress());
        expect(renderer.root.findByProps({ testID: 'temporary-previews-status' })).toBeTruthy();
        act(() => renderer.unmount());
    });
});
