import type { NewSessionAgentType, NewSessionSessionType } from '@/sync/persistence';

export interface AgentPreset { label: string; prompt: string; }
export interface AgentLauncher {
    id: string; name: string; glyph: string; color: string;
    machineId: string; path: string; presets: AgentPreset[];
    kind: 'standard' | 'image-styles';
    imageStyleIds: string[];
    imageVariantsPerStyle: number;
}

interface DraftSetters {
    setMachineId: (id: string | null) => void;
    setPath: (path: string | null) => void;
    setAgentType: (agent: NewSessionAgentType) => void;
    setSessionType: (t: NewSessionSessionType) => void;
    setInput: (s: string) => void;
}

/** 设 draft（顺序：先 machine 后 path，因 setMachineId 会清空 path）后导航到预填的新建会话页。 */
export function launchAgent(
    agent: AgentLauncher,
    draft: DraftSetters,
    navigate: (path: string) => void,
): void {
    draft.setMachineId(agent.machineId);
    draft.setPath(agent.path);
    if (agent.kind === 'image-styles') {
        draft.setAgentType('codex');
    }
    draft.setSessionType('simple');
    draft.setInput('');
    navigate(`/new?agentId=${agent.id}`);
}
