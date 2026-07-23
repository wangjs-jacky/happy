import { describe, expect, it } from 'vitest';
import { shouldShowOtaFloatingSwitcher } from './otaFloatingSwitcher';

describe('shouldShowOtaFloatingSwitcher', () => {
    it('does not mount the native OTA switcher on web', () => {
        expect(shouldShowOtaFloatingSwitcher({
            platform: 'web',
            appConfigChannel: 'preview',
            updatesChannel: 'preview',
            applicationId: 'build.paws.preview',
            isDev: true,
            devModeEnabled: true,
        })).toBe(false);
    });

    it('shows whenever developer mode is enabled', () => {
        expect(shouldShowOtaFloatingSwitcher({
            appConfigChannel: 'production',
            updatesChannel: 'production',
            applicationId: 'build.paws',
            devModeEnabled: true,
        })).toBe(true);
    });

    it('shows for preview channels from app config or expo-updates', () => {
        expect(shouldShowOtaFloatingSwitcher({ appConfigChannel: 'preview' })).toBe(true);
        expect(shouldShowOtaFloatingSwitcher({ updatesChannel: 'preview' })).toBe(true);
    });

    it('shows for preview and dev app ids even when channel config is unavailable', () => {
        expect(shouldShowOtaFloatingSwitcher({ applicationId: 'build.paws.preview' })).toBe(true);
        expect(shouldShowOtaFloatingSwitcher({ applicationId: 'build.paws.dev' })).toBe(true);
    });

    it('does not show for production builds', () => {
        expect(shouldShowOtaFloatingSwitcher({
            appConfigChannel: 'production',
            updatesChannel: 'production',
            applicationId: 'build.paws',
            isDev: false,
        })).toBe(false);
    });
});
