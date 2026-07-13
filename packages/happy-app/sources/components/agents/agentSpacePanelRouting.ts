import type { AgentLauncher } from './launchAgent';

export type SessionRightPanelSelection =
    | { type: 'capability-hub' }
    | { type: 'companion'; agent: AgentLauncher };

type SessionQuickPromptComposer = {
    setMessage: (prompt: string) => void;
};

export function resolveSessionRightPanel({
    spaceAgent,
}: {
    spaceAgent: AgentLauncher | null;
}): SessionRightPanelSelection {
    if (!spaceAgent) return { type: 'capability-hub' };
    return {
        type: 'companion',
        agent: spaceAgent,
    };
}

export function insertSessionQuickPrompt(
    composer: SessionQuickPromptComposer | null,
    prompt: string,
): void {
    composer?.setMessage(prompt);
}
