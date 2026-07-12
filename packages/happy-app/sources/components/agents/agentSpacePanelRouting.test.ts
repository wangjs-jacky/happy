import { describe, expect, it } from 'vitest';
import type { AgentLauncher } from './launchAgent';
import { matchAgentForSession } from '@/utils/agentSpaceIdentity';
import { selectSessionRightPanel } from './agentSpacePanelRouting';

function makeAgent(overrides: Partial<AgentLauncher> = {}): AgentLauncher {
    return {
        id: 'agent-1',
        name: 'Agent',
        glyph: 'A',
        color: '#5e5791',
        machineId: 'm1',
        path: '~/health',
        presets: [],
        kind: 'standard',
        spaceType: 'default',
        imageStyleIds: [],
        imageVariantsPerStyle: 1,
        ...overrides,
    };
}

describe('selectSessionRightPanel', () => {
    it('keeps the capability hub for an unmatched session', () => {
        expect(selectSessionRightPanel({ spaceAgent: null })).toBe('capability-hub');
    });

    it.each(['health', 'default'] as const)('uses the companion panel for a %s Agent space', (spaceType) => {
        expect(selectSessionRightPanel({ spaceAgent: makeAgent({ spaceType }) })).toBe('companion');
    });

    it('routes a tilde Agent after canonical matching finds its absolute session cwd', () => {
        const spaceAgent = matchAgentForSession({
            agents: [makeAgent()],
            agentSpaceId: null,
            machineId: 'm1',
            sessionPath: '/Users/jacky/health',
            homeDir: '/Users/jacky',
        });

        expect(selectSessionRightPanel({ spaceAgent })).toBe('companion');
    });
});
