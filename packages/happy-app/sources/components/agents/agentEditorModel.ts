import { isHealthCheckinSession } from '@/utils/healthLog';
import type { AgentLauncher } from './launchAgent';

export function buildAgentForSave(args: {
    existing: AgentLauncher | null;
    agent: Omit<AgentLauncher, 'spaceType'> | AgentLauncher;
}): AgentLauncher {
    return {
        ...args.agent,
        spaceType: args.existing?.spaceType ?? (isHealthCheckinSession(args.agent.path) ? 'health' : 'default'),
    };
}
