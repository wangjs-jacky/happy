import type { Session, Machine } from '@/sync/storageTypes';
import { sessionWorkingPath } from '@/sync/sessionWorkingPath';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import type { AgentLauncher } from './launchAgent';

/** 去掉结尾斜杠，统一路径比对（根 '/' 保留）。 */
function stripTrailingSlash(p: string): string {
    return p.length > 1 ? p.replace(/[/\\]+$/, '') : p;
}

/**
 * 某个 Agent 的最近会话：机器一致 + 解析后工作目录一致，按 updatedAt 倒序取前 limit。
 * 路径两边都用机器 homeDir 解析 '~' 后再归一化结尾斜杠比对，避免 '~/x' 与绝对路径漏配。
 */
export function recentSessionsForAgent(params: {
    agent: Pick<AgentLauncher, 'machineId' | 'path'>;
    sessions: Session[];
    machines: Machine[];
    limit?: number;
}): Session[] {
    const { agent, sessions, machines, limit = 5 } = params;
    const homeDir = machines.find((m) => m.id === agent.machineId)?.metadata?.homeDir;
    const target = stripTrailingSlash(resolveAbsolutePath(agent.path, homeDir));

    return sessions
        .filter((s) => s.metadata?.machineId === agent.machineId)
        .filter((s) => {
            const p = sessionWorkingPath(s);
            return !!p && stripTrailingSlash(resolveAbsolutePath(p, homeDir)) === target;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
}
