import { describe, expect, it } from 'vitest';
import { MetadataSchema, type Session } from '@/sync/storageTypes';
import { getLatestSessionModelMetadata } from './newSessionModelMetadata';
import { getAvailableModels } from '@/components/modelModeOptions';
import { resolveNewSessionModeSelection } from './newSessionModeSelection';

function session(args: {
    id: string;
    machineId?: string;
    flavor?: string | null;
    activeAt: number;
    createdAt?: number;
    modelsUpdatedAt?: number;
    models?: Array<{ code: string; value: string; description?: string | null }>;
}): Session {
    return {
        id: args.id,
        seq: 1,
        createdAt: args.createdAt ?? args.activeAt,
        updatedAt: args.activeAt,
        active: false,
        activeAt: args.activeAt,
        metadata: {
            path: '/repo',
            host: 'machine',
            machineId: args.machineId,
            flavor: args.flavor,
            models: args.models,
            modelsUpdatedAt: args.modelsUpdatedAt,
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
    it('uses a freshly fetched catalog from a resumed old session and retains its timestamp through parsing', () => {
        const resumed = session({
            id: 'resumed', machineId: 'mac', flavor: 'codex', createdAt: 10, activeAt: 40,
            modelsUpdatedAt: 30,
            models: [{ code: 'gpt-6-astra', value: 'gpt-6-astra' }],
        });
        resumed.metadata = MetadataSchema.parse(resumed.metadata);
        const metadata = getLatestSessionModelMetadata({
            sessions: [resumed, session({
                id: 'newer', machineId: 'mac', flavor: 'codex', createdAt: 20, activeAt: 50,
                models: [{ code: 'gpt-5.5', value: 'gpt-5.5' }],
            })],
            selectedMachineId: 'mac', agent: 'codex',
        });
        expect(metadata?.modelsUpdatedAt).toBe(30);
        expect(metadata?.models?.map((model) => model.code)).toEqual(['gpt-6-astra']);
    });

    it('keeps activity-based discovery for other agents that publish live model updates', () => {
        const metadata = getLatestSessionModelMetadata({
            sessions: [
                session({
                    id: 'old', machineId: 'mac', flavor: 'opencode', createdAt: 10, activeAt: 30,
                    models: [{ code: 'live-new', value: 'live-new' }],
                }),
                session({
                    id: 'new', machineId: 'mac', flavor: 'opencode', createdAt: 20, activeAt: 20,
                    models: [{ code: 'stale', value: 'stale' }],
                }),
            ],
            selectedMachineId: 'mac', agent: 'opencode',
        });
        expect(metadata?.models?.map((model) => model.code)).toEqual(['live-new']);
    });

    it('keeps GPT-6 searchable and selected when older sessions become active again', () => {
        const old = session({
            id: 'old', machineId: 'mac', flavor: 'codex', createdAt: 10, activeAt: 10,
            models: [{ code: 'gpt-5.5', value: 'gpt-5.5' }],
        });
        const recent = session({
            id: 'recent', machineId: 'mac', flavor: 'codex', createdAt: 20, activeAt: 20,
            models: [{ code: 'gpt-6-astra', value: 'gpt-6-astra' }],
        });

        for (const [oldActivity, recentActivity] of [[10, 20], [30, 20], [30, 40], [50, 40]]) {
            const metadata = getLatestSessionModelMetadata({
                sessions: [
                    { ...old, activeAt: oldActivity, updatedAt: oldActivity },
                    { ...recent, activeAt: recentActivity, updatedAt: recentActivity },
                ],
                selectedMachineId: 'mac', agent: 'codex',
            });
            const modelOptions = getAvailableModels('codex', metadata, (key) => key);
            expect(modelOptions.filter((model) => model.name.includes('gpt-6')).map((model) => model.key))
                .toEqual(['gpt-6-astra']);
            expect(resolveNewSessionModeSelection({
                agent: 'codex', modelMode: 'gpt-6-astra', modelOptions,
                permissionMode: null, effortLevel: null, agentDefaultOverrides: null,
            }).modelMode).toBe('gpt-6-astra');
        }
    });

    it('uses a deterministic source when creation timestamps tie and list order changes', () => {
        const a = session({
            id: 'a', machineId: 'mac', flavor: 'codex', createdAt: 10, activeAt: 20,
            models: [{ code: 'gpt-5.5', value: 'gpt-5.5' }],
        });
        const b = session({
            id: 'b', machineId: 'mac', flavor: 'codex', createdAt: 10, activeAt: 20,
            models: [{ code: 'gpt-6-astra', value: 'gpt-6-astra' }],
        });
        const select = (sessions: Session[]) => getLatestSessionModelMetadata({
            sessions, selectedMachineId: 'mac', agent: 'codex',
        });
        expect(select([a, b])).toEqual(select([b, a]));
    });

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

    it('replaces a catalog when a newer session supplies one, including removed models', () => {
        const metadata = getLatestSessionModelMetadata({
            sessions: [
                session({
                    id: 'old', machineId: 'mac', flavor: 'codex', createdAt: 10, activeAt: 100,
                    models: [{ code: 'retired-model', value: 'retired-model' }],
                }),
                session({
                    id: 'new', machineId: 'mac', flavor: 'codex', createdAt: 20, activeAt: 20,
                    models: [{ code: 'replacement-model', value: 'replacement-model' }],
                }),
            ],
            selectedMachineId: 'mac', agent: 'codex',
        });
        expect(metadata?.models?.map((model) => model.code)).toEqual(['replacement-model']);
    });
});
