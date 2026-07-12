import { resolveAgentDefaultConfig, type AgentDefaultOverrides } from '@/sync/agentDefaults';
import type { NewSessionAgentType } from '@/sync/persistence';
import type { AgentLauncher } from './launchAgent';

const validAgentTypes: ReadonlySet<string> = new Set([
    'ask',
    'claude',
    'codex',
    'gemini',
    'opencode',
    'openclaw',
]);

type DraftLaunchConfig = {
    agentType?: unknown;
    permissionMode?: string;
    modelMode?: string;
    effortLevel?: string | null;
};

export type AgentLaunchConfigResult =
    | {
        type: 'success';
        agent: NewSessionAgentType;
        permissionMode: string;
        modelMode: string;
        effortLevel: string | null;
    }
    | { type: 'error'; message: string };

function isNewSessionAgentType(value: unknown): value is NewSessionAgentType {
    return typeof value === 'string' && validAgentTypes.has(value);
}

export function resolveAgentLaunchConfig(args: {
    agent: AgentLauncher;
    draft: DraftLaunchConfig;
    defaults: AgentDefaultOverrides | null | undefined;
}): AgentLaunchConfigResult {
    const agentType = args.agent.agentType !== undefined ? args.agent.agentType : args.draft.agentType;
    if (!isNewSessionAgentType(agentType)) {
        return { type: 'error', message: 'Invalid Agent type' };
    }

    const defaults = resolveAgentDefaultConfig(args.defaults, agentType);
    return {
        type: 'success',
        agent: agentType,
        permissionMode: args.agent.permissionMode ?? args.draft.permissionMode ?? defaults.permissionMode,
        modelMode: args.agent.modelMode ?? args.draft.modelMode ?? defaults.modelMode,
        effortLevel: args.agent.effortLevel !== undefined
            ? args.agent.effortLevel
            : args.draft.effortLevel !== undefined
                ? args.draft.effortLevel
                : defaults.effortLevel,
    };
}
