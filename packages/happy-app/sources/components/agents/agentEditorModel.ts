import { isHealthCheckinSession } from '@/utils/healthLog';
import { hasDuplicateAgentPath } from '@/utils/agentSpaceIdentity';
import type { AgentLauncher } from './launchAgent';

export type AgentSaveValidationResult =
    | { ok: true }
    | { ok: false; reason: 'duplicate-path' };

export function validateAgentSave(args: {
    agents: readonly AgentLauncher[];
    editingId: string | null;
    machineId: string;
    path: string;
    homeDir: string | null | undefined;
}): AgentSaveValidationResult {
    return hasDuplicateAgentPath(args)
        ? { ok: false, reason: 'duplicate-path' }
        : { ok: true };
}

export function buildAgentForSave(args: {
    existing: AgentLauncher | null;
    agent: Omit<AgentLauncher, 'spaceType'> | AgentLauncher;
}): AgentLauncher {
    return {
        ...args.agent,
        spaceType: args.existing?.spaceType ?? (isHealthCheckinSession(args.agent.path) ? 'health' : 'default'),
    };
}
