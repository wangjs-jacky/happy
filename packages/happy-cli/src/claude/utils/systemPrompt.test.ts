import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemPrompt';
import { BROWSER_OBSERVATION_PROMPT } from '@/browser/browserObservationPrompt';

describe('systemPrompt', () => {
    it('does not add tool or AI attribution to commit messages', () => {
        expect(systemPrompt).not.toMatch(/\bcommit(?:s|ting)?\b/i);
    });

    it('includes the shared Ego browser observation contract', () => {
        expect(systemPrompt).toContain(BROWSER_OBSERVATION_PROMPT);
    });
});
