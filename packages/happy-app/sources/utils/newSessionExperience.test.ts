import { describe, expect, it } from 'vitest';
import { getComposeHomeExperience, getSessionConfigExperience } from './newSessionExperience';

describe('new session experience', () => {
    it('makes ask a lightweight chat mode instead of a coding-agent setup', () => {
        expect(getSessionConfigExperience('ask')).toEqual({
            isAskMode: true,
            showPath: false,
            showModeDetails: false,
            showPermission: false,
            showWorktree: false,
        });
    });

    it('keeps coding agents on the full setup surface', () => {
        expect(getSessionConfigExperience('opencode')).toEqual({
            isAskMode: false,
            showPath: true,
            showModeDetails: true,
            showPermission: true,
            showWorktree: true,
        });
    });

    it('hides creation tools from the ask home composer', () => {
        expect(getComposeHomeExperience({ agentType: 'ask', activeImageAgent: false })).toEqual({
            displayAgentType: 'ask',
            canAttach: false,
            showCreationRail: false,
        });
    });

    it('preserves image-agent routing as a Codex image task', () => {
        expect(getComposeHomeExperience({ agentType: 'ask', activeImageAgent: true })).toEqual({
            displayAgentType: 'codex',
            canAttach: true,
            showCreationRail: false,
        });
    });
});
