import type { NewSessionAgentType } from '@/sync/persistence';

export type SessionConfigExperience = {
    isAskMode: boolean;
    showPath: boolean;
    showModeDetails: boolean;
    showPermission: boolean;
    showWorktree: boolean;
};

export type ComposeHomeExperience = {
    displayAgentType: NewSessionAgentType;
    canAttach: boolean;
    showCreationRail: boolean;
};

export function getSessionConfigExperience(agentType: NewSessionAgentType): SessionConfigExperience {
    const isAskMode = agentType === 'ask';
    return {
        isAskMode,
        showPath: !isAskMode,
        showModeDetails: !isAskMode,
        showPermission: !isAskMode,
        showWorktree: !isAskMode,
    };
}

export function getComposeHomeExperience(args: {
    agentType: NewSessionAgentType;
    activeImageAgent: boolean;
}): ComposeHomeExperience {
    const { agentType, activeImageAgent } = args;
    const displayAgentType = activeImageAgent ? 'codex' : agentType;
    return {
        displayAgentType,
        canAttach: activeImageAgent || agentType === 'claude' || agentType === 'codex',
        showCreationRail: !activeImageAgent && agentType !== 'ask',
    };
}
