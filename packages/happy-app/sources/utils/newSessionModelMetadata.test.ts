import { describe, expect, it } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import { getLatestSessionModelMetadata } from './newSessionModelMetadata';

function session(args: {
    id: string;
    machineId?: string;
    flavor?: string | null;
    activeAt: number;
    models?: Array<{ code: string; value: string; description?: string | null }>;
}): Session {
    return {
        id: args.id,
        seq: 1,
        createdAt: args.activeAt,
        updatedAt: args.activeAt,
        active: false,
        activeAt: args.activeAt,
        metadata: {
            path: '/repo',
            host: 'machine',
            machineId: args.machineId,
            flavor: args.flavor,
            models: args.models,
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: args.activeAt,
    };
}

describe('getLatestSessionModelMetadata', () => {
    it('returns the newest model metadata for the selected machine and agent', () => {
        const latest = getLatestSessionModelMetadata({
            sessions: [
                'loading',
                session({
                    id: 'old-codex',
                    machineId: 'mac',
                    flavor: 'codex',
                    activeAt: 10,
                    models: [{ code: 'gpt-old', value: 'gpt-old' }],
                }),
                session({
                    id: 'new-claude',
                    machineId: 'mac',
                    flavor: 'claude',
                    activeAt: 40,
                    models: [{ code: 'claude-new', value: 'claude-new' }],
                }),
                session({
                    id: 'other-machine-codex',
                    machineId: 'linux',
                    flavor: 'codex',
                    activeAt: 50,
                    models: [{ code: 'gpt-linux', value: 'gpt-linux' }],
                }),
                session({
                    id: 'new-codex',
                    machineId: 'mac',
                    flavor: 'codex',
                    activeAt: 30,
                    models: [{ code: 'gpt-5.6-sol', value: 'gpt-5.6-sol' }],
                }),
            ],
            selectedMachineId: 'mac',
            agent: 'codex',
        });

        expect(latest?.models?.map((model) => model.code)).toEqual(['gpt-5.6-sol']);
    });

    it('ignores sessions without model metadata', () => {
        expect(getLatestSessionModelMetadata({
            sessions: [
                session({ id: 'empty', machineId: 'mac', flavor: 'codex', activeAt: 20 }),
            ],
            selectedMachineId: 'mac',
            agent: 'codex',
        })).toBeNull();
    });
});
