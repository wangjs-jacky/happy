import { afterEach, describe, expect, it } from 'vitest';
import { clearPersistence, loadLocalSettings, saveLocalSettings } from './persistence';

describe('device-local sidebar expansion persistence', () => {
    afterEach(() => clearPersistence());

    it('round-trips the Unassigned expansion state through MMKV-backed local settings', () => {
        const settings = loadLocalSettings();
        expect(settings.sidebarUnassignedExpanded).toBe(false);

        saveLocalSettings({ ...settings, sidebarUnassignedExpanded: true });
        expect(loadLocalSettings().sidebarUnassignedExpanded).toBe(true);

        saveLocalSettings({ ...settings, sidebarUnassignedExpanded: false });
        expect(loadLocalSettings().sidebarUnassignedExpanded).toBe(false);
    });
});
