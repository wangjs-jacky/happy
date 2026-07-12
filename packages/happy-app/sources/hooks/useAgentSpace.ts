import * as React from 'react';
import { useLocalSetting, useLocalSettingMutable } from '@/sync/storage';
import type { AgentLauncher } from '@/components/agents/launchAgent';

/**
 * 「Agent 空间模式」状态入口。
 *
 * 当前空间只用一个 `agentSpaceId`（存 localSettings，设备本地、持久化、响应式）表示，
 * 具体 Agent 由该 id 在「我的 Agent」列表里实时解析：这样 Agent 被改名/换色/删掉时空间会自动
 * 跟随或失效，无需额外同步一份快照。解析不到（如内置 Agent、已删 Agent）即视为不在空间，
 * 调用方据此回落到全局视图。
 */
export function useAgentSpace(): {
    agentSpaceId: string | null;
    agent: AgentLauncher | null;
    enter: (agentId: string) => void;
    exit: () => void;
} {
    const [agentSpaceId, setAgentSpaceId] = useLocalSettingMutable('agentSpaceId');
    const agents = useLocalSetting('agents');
    const agent = React.useMemo(
        () => (agentSpaceId ? agents.find((a) => a.id === agentSpaceId) ?? null : null),
        [agentSpaceId, agents],
    );
    const enter = React.useCallback((id: string) => setAgentSpaceId(id), [setAgentSpaceId]);
    const exit = React.useCallback(() => setAgentSpaceId(null), [setAgentSpaceId]);
    return { agentSpaceId, agent, enter, exit };
}
