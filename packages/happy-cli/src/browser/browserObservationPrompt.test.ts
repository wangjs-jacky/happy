import { describe, expect, it } from 'vitest';

import {
    BROWSER_OBSERVATION_PROMPT,
    isBrowserObservationPromptEnabled,
} from './browserObservationPrompt';

describe('browserObservationPrompt', () => {
    it('defines the ordered Ego screenshot reporting contract', () => {
        expect(BROWSER_OBSERVATION_PROMPT).toContain('ego-browser');
        expect(BROWSER_OBSERVATION_PROMPT).toContain('mcp__happy__report_browser_step');
        expect(BROWSER_OBSERVATION_PROMPT).toContain('verify');
        expect(BROWSER_OBSERVATION_PROMPT).toContain('absolute');
        expect(BROWSER_OBSERVATION_PROMPT).toContain('Do not use mcp__happy__send_image');
        expect(BROWSER_OBSERVATION_PROMPT).toContain('Wait for a successful');
        expect(BROWSER_OBSERVATION_PROMPT).toContain('before completing or closing the Ego task space');
    });

    it('is enabled by default and supports an emergency kill switch', () => {
        expect(isBrowserObservationPromptEnabled({})).toBe(true);
        expect(isBrowserObservationPromptEnabled({ HAPPY_BROWSER_OBSERVATION_PROMPT: '1' })).toBe(true);
        expect(isBrowserObservationPromptEnabled({ HAPPY_BROWSER_OBSERVATION_PROMPT: '0' })).toBe(false);
    });
});
