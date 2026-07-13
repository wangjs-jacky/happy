import { describe, expect, it } from 'vitest';
import { localSettingsParse } from './localSettings';

function makeAgent(overrides: Record<string, unknown> = {}) {
    return {
        id: 'agent-1',
        name: 'Agent',
        glyph: 'A',
        color: '#5e5791',
        machineId: 'machine-1',
        path: '~/work',
        kind: 'standard',
        imageStyleIds: [],
        imageVariantsPerStyle: 1,
        presets: [],
        ...overrides,
    };
}

describe('localSettingsParse agents migration', () => {
    it('migrates only legacy local health agents to the health space type', () => {
        const result = localSettingsParse({
            agents: [
                makeAgent({ id: 'health', path: '~/人生辅助系统/健康打卡' }),
                makeAgent({ id: 'work', path: '~/work' }),
            ],
        });

        expect(result.agents.map((agent) => agent.spaceType)).toEqual(['health', 'default']);
    });

    it('preserves an explicit space type instead of re-inferring it', () => {
        const result = localSettingsParse({
            agents: [makeAgent({ path: '~/健康打卡', spaceType: 'default' })],
        });

        expect(result.agents[0]?.spaceType).toBe('default');
    });

    it('does not mutate the caller input while migrating legacy agents', () => {
        const legacyAgent = makeAgent({ path: '~/健康打卡' });
        const input = { agents: [legacyAgent] };

        const result = localSettingsParse(input);

        expect(result.agents[0]?.spaceType).toBe('health');
        expect(input.agents[0]).toBe(legacyAgent);
        expect(input.agents[0]).not.toHaveProperty('spaceType');
    });
});
