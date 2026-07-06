import { describe, expect, it } from 'vitest';
import { getSettingsFeatureEntries } from './settingsFeatureEntries';

describe('settingsFeatureEntries', () => {
    it('exposes a direct GPT Image 2 agent entry before generic agent management', () => {
        const entries = getSettingsFeatureEntries({ experiments: false });
        const imageEntryIndex = entries.findIndex((entry) => entry.key === 'image-style-agent');
        const agentEntryIndex = entries.findIndex((entry) => entry.key === 'my-agents');

        expect(imageEntryIndex).toBeGreaterThanOrEqual(0);
        expect(imageEntryIndex).toBeLessThan(agentEntryIndex);
        expect(entries[imageEntryIndex]).toMatchObject({
            titleKey: 'agents.imageStyleAgent',
            subtitleKey: 'agents.imageStyleAgentEntrySubtitle',
            route: '/settings/my-agent-edit?kind=image-styles',
        });
    });
});
