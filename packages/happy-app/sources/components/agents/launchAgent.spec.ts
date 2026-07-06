import { describe, it, expect, vi } from 'vitest';
import { launchAgent, type AgentLauncher } from './launchAgent';

const agent: AgentLauncher = {
    id: 'a1', name: '工作日程', glyph: '日', color: '#5e5791',
    machineId: 'm1', path: '~/work/schedule', kind: 'standard',
    imageStyleIds: [], imageVariantsPerStyle: 1, presets: [],
};

describe('launchAgent', () => {
    it('sets machine before path and navigates with agentId', () => {
        const calls: string[] = [];
        const draft = {
            setMachineId: vi.fn(() => calls.push('machine')),
            setPath: vi.fn(() => calls.push('path')),
            setAgentType: vi.fn(() => calls.push('agent')),
            setSessionType: vi.fn(() => calls.push('type')),
            setInput: vi.fn(() => calls.push('input')),
        };
        const navigate = vi.fn();
        launchAgent(agent, draft as any, navigate);
        expect(calls.indexOf('machine')).toBeLessThan(calls.indexOf('path'));
        expect(draft.setMachineId).toHaveBeenCalledWith('m1');
        expect(draft.setPath).toHaveBeenCalledWith('~/work/schedule');
        expect(draft.setInput).toHaveBeenCalledWith('');
        expect(navigate).toHaveBeenCalledWith('/new?agentId=a1');
    });

    it('forces Codex for GPT Image 2 style generator agents', () => {
        const draft = {
            setMachineId: vi.fn(),
            setPath: vi.fn(),
            setAgentType: vi.fn(),
            setSessionType: vi.fn(),
            setInput: vi.fn(),
        };
        const navigate = vi.fn();

        launchAgent({ ...agent, kind: 'image-styles' }, draft as any, navigate);

        expect(draft.setAgentType).toHaveBeenCalledWith('codex');
    });
});
