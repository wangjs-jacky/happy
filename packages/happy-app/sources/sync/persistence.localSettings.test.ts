import { afterEach, describe, expect, it } from 'vitest';
import { clearPersistence, loadLocalSettings, saveLocalSettings } from './persistence';

describe('device-local sidebar group expansion persistence', () => {
    afterEach(() => clearPersistence());

    it('round-trips project and List expansion states through MMKV-backed local settings', () => {
        const settings = loadLocalSettings();
        expect(settings.sidebarGroupExpansion).toEqual({});

        saveLocalSettings({
            ...settings,
            sidebarGroupExpansion: {
                'lists:unassigned': true,
                'lists:happy': true,
                'projects:mac--%2Frepo': false,
            },
        });

        expect(loadLocalSettings().sidebarGroupExpansion).toEqual({
            'lists:unassigned': true,
            'lists:happy': true,
            'projects:mac--%2Frepo': false,
        });
    });
});
