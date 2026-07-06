import { describe, it, expect } from 'vitest';
import { localSettingsDefaults, localSettingsParse } from './localSettings';

describe('localSettings hapticFeedbackEnabled', () => {
    it('defaults to true', () => {
        expect(localSettingsDefaults.hapticFeedbackEnabled).toBe(true);
    });

    it('falls back to default when absent in stored data', () => {
        const parsed = localSettingsParse({ themePreference: 'dark' });
        expect(parsed.hapticFeedbackEnabled).toBe(true);
    });

    it('respects a stored false value', () => {
        const parsed = localSettingsParse({ hapticFeedbackEnabled: false });
        expect(parsed.hapticFeedbackEnabled).toBe(false);
    });
});

describe('localSettings ask API config', () => {
    it('defaults to an unconfigured ask API', () => {
        expect(localSettingsDefaults.askApi).toEqual({
            apiKey: '',
            baseUrl: '',
        });
    });

    it('preserves stored ask API credentials locally', () => {
        const parsed = localSettingsParse({
            askApi: {
                apiKey: ' sk-deepseek ',
                baseUrl: ' https://api.deepseek.com ',
            },
        });

        expect(parsed.askApi).toEqual({
            apiKey: ' sk-deepseek ',
            baseUrl: ' https://api.deepseek.com ',
        });
    });
});
