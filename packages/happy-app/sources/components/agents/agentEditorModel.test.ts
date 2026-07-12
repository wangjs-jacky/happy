import { describe, expect, it } from 'vitest';
import { buildAgentForSave } from './agentEditorModel';
import type { AgentLauncher } from './launchAgent';

function makeAgent(overrides: Partial<AgentLauncher> = {}): AgentLauncher {
    return {
        id: 'agent-1',
        name: 'Agent',
        glyph: 'A',
        color: '#5e5791',
        machineId: 'machine-1',
        path: '~/work',
        kind: 'standard',
        spaceType: 'default',
        imageStyleIds: [],
        imageVariantsPerStyle: 1,
        presets: [],
        ...overrides,
    };
}

describe('buildAgentForSave', () => {
    it('preserves an existing space type even when the edited path looks like health', () => {
        const existing = makeAgent({ spaceType: 'default', path: '~/work' });
        const agent = buildAgentForSave({
            existing,
            agent: { ...existing, path: '~/健康打卡' },
        });

        expect(agent.spaceType).toBe('default');
    });

    it('infers the space type once when creating a new Agent', () => {
        const healthAgent = makeAgent({ path: '~/健康打卡' });
        const workAgent = makeAgent({ id: 'agent-2', path: '~/work' });

        expect(buildAgentForSave({ existing: null, agent: healthAgent }).spaceType).toBe('health');
        expect(buildAgentForSave({ existing: null, agent: workAgent }).spaceType).toBe('default');
    });
});
