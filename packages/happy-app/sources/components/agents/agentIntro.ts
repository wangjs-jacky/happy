import { isHealthCheckinSession } from '@/components/rightPanel/isHealthCheckinSession';
import type { AgentLauncher } from './launchAgent';

/** 落地页引导类型：健康打卡目录 → 富引导；其它 → 极简派生引导。 */
export function resolveAgentIntroKind(agent: Pick<AgentLauncher, 'path'>): 'health' | 'generic' {
    return isHealthCheckinSession(agent.path) ? 'health' : 'generic';
}
