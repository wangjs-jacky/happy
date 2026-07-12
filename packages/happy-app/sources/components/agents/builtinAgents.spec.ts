import { describe, expect, it } from 'vitest';
import { APP_BUILDER_AGENT_ID, createAppBuilderAgent } from './builtinAgents';
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
        expect(agent?.agentType).toBe('claude');
        expect(agent?.permissionMode).toBe('bypassPermissions');
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
