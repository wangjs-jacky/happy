import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer does not publish declarations used by this narrow test.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    authQRStart: vi.fn(() => new Promise<boolean>(() => {})),
    replace: vi.fn(),
}));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
    useWindowDimensions: () => ({ width: 390 }),
}));
vi.mock('expo-router', () => ({
    useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
}));
vi.mock('@/auth/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false, login: vi.fn() }),
}));
vi.mock('@/auth/authQRStart', () => ({
    authQRStart: mocks.authQRStart,
    generateAuthKeyPair: () => ({ publicKey: new Uint8Array([1]), secretKey: new Uint8Array([2]) }),
}));
vi.mock('@/auth/authQRWait', () => ({ authQRWait: vi.fn() }));
vi.mock('@/components/qr/QRCode', () => ({ QRCode: 'QRCode' }));
vi.mock('@/components/RoundButton', () => ({ RoundButton: 'RoundButton' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/encryption/base64', () => ({ encodeBase64: () => 'encoded-key' }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/restoreLayout', () => ({ getRestoreLayout: () => 'compact' }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: (theme: object) => object) => factory({
            colors: {
                surface: '#000000',
                surfaceHigh: '#111111',
                text: '#ffffff',
                textSecondary: '#aaaaaa',
            },
        }),
    },
    useUnistyles: () => ({ theme: { colors: { text: '#ffffff' } } }),
}));

import RestoreDeviceScreen from './index';

describe('Restore device scan instructions', () => {
    let renderer: any;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        act(() => {
            renderer = TestRenderer.create(<RestoreDeviceScreen />);
        });
    });

    afterEach(() => {
        act(() => renderer.unmount());
        consoleErrorSpy.mockRestore();
    });

    it('points to the single scanner on the settings home instead of the removed account entry', () => {
        const instructions = renderer.root
            .findByProps({ testID: 'restore-device-instructions' })
            .findAllByType('Text')
            .flatMap((node: any) => node.props.children)
            .filter((value: unknown): value is string => typeof value === 'string')
            .join('');

        expect(instructions).toContain('2. Go to "settings.title"');
        expect(instructions).toContain('3. Tap "settings.scanQrCodeToAuthenticate"');
        expect(instructions).not.toContain('Settings → Account');
        expect(instructions).not.toContain('Link New Device');
    });
});
