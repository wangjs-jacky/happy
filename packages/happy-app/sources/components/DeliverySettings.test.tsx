import React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error untyped test renderer
import TestRenderer from 'react-test-renderer';
const mocks = vi.hoisted(() => ({ credentials: { token: 'test' }, settings: { awayFromComputer: false, previewDeliveryMode: 'tunnel' }, update: vi.fn(), show: vi.fn(), push: vi.fn(), getStatus: vi.fn() }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'web', select: (v: any) => v.web ?? v.default }, AppState: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ width: 430, height: 932 }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/components/Item', () => ({ Item: (props: any) => React.createElement('Item', props) }));
vi.mock('@/components/Switch', () => ({ Switch: 'Switch' }));
vi.mock('@/sync/storage', () => ({ useSetting: (key: keyof typeof mocks.settings) => mocks.settings[key], useSettingMutable: (key: keyof typeof mocks.settings) => [mocks.settings[key], (value: unknown) => mocks.update(key, value)] }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: mocks.credentials }) }));
vi.mock('@/sync/apiInteractivePreviews', () => ({ getCloudflarePreviewStatus: mocks.getStatus }));
vi.mock('@/modal', () => ({ Modal: { show: mocks.show } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('react-native-unistyles', async () => {
    const { appThemes } = await vi.importActual<typeof import('@/themePacks')>('@/themePacks');
    const theme = appThemes.ginghamDark;
    return { StyleSheet: { create: (fn: any) => fn(theme) }, useUnistyles: () => ({ theme }) };
});
import { DeliveryModeButton, DeliverySettingsRows, openDeliverySettings } from './DeliverySettings';
describe('global delivery settings', () => {
    beforeEach(() => { vi.clearAllMocks(); mocks.settings.awayFromComputer = false; mocks.settings.previewDeliveryMode = 'tunnel'; });
    it('opens the panel without toggling the global setting', () => {
        let r: any;
        act(() => { r = TestRenderer.create(<DeliveryModeButton />); });
        const button = r.root.findByType('Pressable');
        expect(button.props.accessibilityLabel).toBe('delivery.disabledLabel');
        act(() => button.props.onPress());
        expect(mocks.show).toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
        act(() => r.unmount());
    });
    it('shares the switch and hides the mode row when disabled', () => {
        let r: any;
        act(() => { r = TestRenderer.create(<DeliverySettingsRows />); });
        expect(r.root.findAllByProps({ testID: 'delivery-settings-mode' })).toHaveLength(0);
        act(() => r.root.findByType('Item').props.rightElement.props.onValueChange(true));
        expect(mocks.update).toHaveBeenCalledWith('awayFromComputer', true);
        act(() => r.unmount());
    });
    it('routes unconfigured hosted selection without changing the saved mode', async () => {
        mocks.settings.awayFromComputer = true;
        mocks.getStatus.mockResolvedValue({ available: true, connected: false });
        openDeliverySettings();
        const Panel = mocks.show.mock.calls[0][0].component;
        let r: any;
        const close = vi.fn();
        await act(async () => { r = TestRenderer.create(<Panel onClose={close} />); });
        const hosted = r.root.findAllByType('Item').find((n: any) => n.props.testID === 'delivery-mode-hosted');
        act(() => hosted.props.onPress());
        expect(mocks.update).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
        expect(mocks.push).toHaveBeenCalledWith('/settings/temporary-previews?selectHosted=1');
        act(() => r.unmount());
    });
});
