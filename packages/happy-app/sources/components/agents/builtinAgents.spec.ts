import { describe, expect, it } from 'vitest';
import { APP_BUILDER_AGENT_ID, createAppBuilderAgent, createScheduleManagerAgent } from './builtinAgents';
import { SCHEDULE_AGENT_ID } from './scheduleAgentModel';
import type { Machine } from '@/sync/storageTypes';

function machine(id: string, active: boolean, homeDir?: string): Machine {
    return {
        id,
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active,
        activeAt: 0,
        metadata: {
            host: id,
            homeDir,
        } as any,
        metadataVersion: 0,
        daemonState: null,
        daemonStateVersion: 0,
    };
}

describe('createAppBuilderAgent', () => {
    const labels = {
        title: 'App Builder',
        presetBuildLabel: 'Build app',
        presetBugfixLabel: 'Fix bug',
    };

    it('uses the preferred machine and path when available', () => {
        const agent = createAppBuilderAgent({
            machines: [machine('m1', true, '/Users/a'), machine('m2', true, '/Users/b')],
            preferredMachineId: 'm2',
            preferredPath: '~/work/app',
            ...labels,
        });

        expect(agent?.id).toBe(APP_BUILDER_AGENT_ID);
        expect(agent?.machineId).toBe('m2');
        expect(agent?.path).toBe('~/work/app');
        expect(agent?.agentType).toBe('codex');
        expect(agent?.permissionMode).toBe('yolo');
        expect(agent?.presets).toHaveLength(2);
    });

    it('falls back to the first online machine', () => {
        const agent = createAppBuilderAgent({
            machines: [machine('offline', false, '/Users/offline'), machine('online', true, '/Users/online')],
            ...labels,
        });

        expect(agent?.machineId).toBe('online');
        expect(agent?.path).toBe('/Users/online');
    });

    it('returns null without machines', () => {
        expect(createAppBuilderAgent({ machines: [], ...labels })).toBeNull();
    });
});

describe('createScheduleManagerAgent', () => {
    it('creates a TT-first Codex agent on the preferred machine', () => {
        const agent = createScheduleManagerAgent({
            machines: [machine('m1', true, '/Users/a')],
            preferredPath: '~/jacky-obsidian',
            title: '日程管理专家',
            presetPlanLabel: '生成今日作战图',
            presetPoolLabel: '整理任务池',
            presetResetLabel: '本周重置',
        });

        expect(agent?.id).toBe(SCHEDULE_AGENT_ID);
        expect(agent?.machineId).toBe('m1');
        expect(agent?.path).toBe('~/jacky-obsidian');
        expect(agent?.agentType).toBe('codex');
        expect(agent?.permissionMode).toBe('yolo');
        expect(agent?.presets[0]?.prompt).toContain('TT');
        expect(agent?.presets[1]?.prompt).toContain('任务池');
    });
});
