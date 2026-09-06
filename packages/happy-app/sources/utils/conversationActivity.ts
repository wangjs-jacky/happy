import { summarizeToolFailureOutput, toolFailureDetail } from '@slopus/happy-wire';
import { Message, ToolCall, ToolCallMessage } from '@/sync/typesMessage';

export type ConversationActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type SkillConversationActivity = {
    kind: 'skill';
    name: string;
    isBatch?: boolean;
    status: ConversationActivityStatus;
    failure: ToolCall['failure'] | null;
    updatedAt: number;
    depth: number;
    order: number;
};

export type SubagentConversationActivity = {
    kind: 'subagent';
    id: string;
    title: string | null;
    status: ConversationActivityStatus;
    updatedAt: number;
    depth: number;
    order: number;
};

export type ConversationActivities = {
    skills: SkillConversationActivity[];
    subagents: SubagentConversationActivity[];
};

export type SubagentTranscript = {
    agent: ToolCallMessage;
    messages: Message[];
};

export function findSubagentTranscript(messages: Message[], subagentId: string): SubagentTranscript | null {
    const chronologicalMessages = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    for (const message of chronologicalMessages) {
        if (message.kind !== 'tool-call') {
            continue;
        }

        const isAgentTool = message.tool.name === 'Agent' || message.tool.name === 'Task';
        if (isAgentTool && message.tool.input?.sessionSubagent === subagentId) {
            return {
                agent: message,
                messages: message.children
                    .filter((child) => {
                        if (child.kind === 'agent-text' && child.isThinking) return false;
                        return child.kind !== 'agent-event'
                            || child.event.type !== 'subagent-status'
                            || child.event.subagent !== subagentId;
                    })
                    .sort((a, b) => a.createdAt - b.createdAt),
            };
        }

        const nestedTranscript = findSubagentTranscript(message.children, subagentId);
        if (nestedTranscript) {
            return nestedTranscript;
        }
    }

    return null;
}

function toolStatus(tool: ToolCall): ConversationActivityStatus {
    if (tool.permission?.status === 'canceled') {
        return 'cancelled';
    }
    if (tool.state === 'error') {
        return 'failed';
    }
    return tool.state;
}

function getToolFailure(message: ToolCallMessage): ToolCall['failure'] | null {
    const tool = message.tool;
    if (tool.state !== 'error') return null;
    if (tool.failure?.summary && summarizeToolFailureOutput(tool.failure.summary)) {
        return tool.failure;
    }

    // Older CLI versions stored the first line of stdout as the summary and
    // truncated its detail. Command-output children can still contain the error.
    const commandOutput = message.children
        .filter((child) => child.kind === 'agent-text' && child.isThinking)
        .map((child) => child.kind === 'agent-text' ? child.text : '')
        .join('');
    for (const output of [tool.result, commandOutput, tool.failure?.detail]) {
        if (typeof output !== 'string') continue;
        const summary = summarizeToolFailureOutput(output);
        if (!summary) continue;
        const detail = toolFailureDetail(output, summary);
        return {
            ...tool.failure,
            summary,
            ...(detail !== summary ? { detail } : {}),
        };
    }
    return null;
}

export function getSkillNamesFromTool(tool: Pick<ToolCall, 'name' | 'input'>): string[] {
    if (tool.name !== 'Skill') {
        return [];
    }

    const names = new Set<string>();
    const candidates = [tool.input?.skillNames, tool.input?.skills];
    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) {
            continue;
        }
        for (const name of candidate) {
            if (typeof name === 'string' && name.trim().length > 0) {
                names.add(name.trim());
            }
        }
    }

    for (const candidate of [tool.input?.skill, tool.input?.skillName, tool.input?.name]) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            names.add(candidate.trim());
        }
    }

    return [...names];
}

function getSubagentTitle(tool: ToolCall): string | null {
    for (const candidate of [
        tool.input?.description,
        tool.input?.title,
        tool.input?.agentPath,
        tool.input?.agent_path,
        tool.input?.subagent_type,
        tool.input?.prompt,
    ]) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    return null;
}

export function collectConversationActivities(
    messages: Message[],
    options: { rootSubagentId?: string } = {},
): ConversationActivities {
    const skillActivities = new Map<string, SkillConversationActivity>();
    const subagentDefaults = new Map<string, SubagentConversationActivity>();
    const subagentEvents: SubagentConversationActivity[] = [];
    let sequence = 0;

    const visit = (items: Message[], depth: number, ownerPath: string[]): void => {
        const chronologicalItems = [...items].sort((a, b) => a.createdAt - b.createdAt);
        for (const message of chronologicalItems) {
            sequence += 1;
            if (message.kind === 'agent-event' && message.event.type === 'subagent-status') {
                const ownerDepth = ownerPath.lastIndexOf(message.event.subagent);
                subagentEvents.push({
                    kind: 'subagent',
                    id: message.event.subagent,
                    title: message.event.title ?? null,
                    status: message.event.status,
                    updatedAt: message.createdAt,
                    depth: ownerDepth >= 0 ? ownerDepth : Math.max(0, depth - 1),
                    order: sequence,
                });
                continue;
            }

            if (message.kind !== 'tool-call') {
                continue;
            }

            const skillNames = getSkillNamesFromTool(message.tool);
            // A shell command supplies one status for the entire batch. Do not
            // invent per-file outcomes (later reads may be skipped by &&).
            if (skillNames.length > 0) {
                const isBatch = skillNames.length > 1;
                const name = skillNames.join(', ');
                const next: SkillConversationActivity = {
                    kind: 'skill',
                    name,
                    ...(isBatch ? { isBatch: true } : {}),
                    status: toolStatus(message.tool),
                    failure: getToolFailure(message),
                    updatedAt: message.tool.completedAt ?? message.createdAt,
                    depth,
                    order: sequence,
                };
                const key = JSON.stringify([ownerPath, isBatch ? 'batch' : 'skill', isBatch ? message.id : name]);
                const existing = skillActivities.get(key);
                if (!existing || next.status === 'running' || next.updatedAt >= existing.updatedAt) {
                    skillActivities.set(key, existing ? { ...next, order: existing.order } : next);
                }
            }

            const sessionSubagent = message.tool.input?.sessionSubagent;
            if ((message.tool.name === 'Task' || message.tool.name === 'Agent')
                && typeof sessionSubagent === 'string'
                && sessionSubagent.length > 0) {
                subagentDefaults.set(sessionSubagent, {
                    kind: 'subagent',
                    id: sessionSubagent,
                    title: getSubagentTitle(message.tool),
                    status: toolStatus(message.tool),
                    updatedAt: message.tool.completedAt ?? message.createdAt,
                    depth,
                    order: sequence,
                });
                visit(message.children, depth + 1, [...ownerPath, sessionSubagent]);
                continue;
            }

            visit(message.children, depth, ownerPath);
        }
    };

    const rootSubagentId = options.rootSubagentId;
    visit(messages, rootSubagentId ? 1 : 0, rootSubagentId ? [rootSubagentId] : []);

    const subagents = new Map(subagentDefaults);
    subagentEvents
        .sort((a, b) => a.updatedAt - b.updatedAt || a.order - b.order)
        .forEach((event) => {
            const existing = subagents.get(event.id);
            subagents.set(event.id, {
                kind: 'subagent',
                id: event.id,
                title: event.title ?? existing?.title ?? null,
                status: event.status,
                updatedAt: event.updatedAt,
                depth: existing?.depth ?? event.depth,
                order: existing?.order ?? event.order,
            });
        });

    return {
        skills: [...skillActivities.values()].sort((a, b) => a.order - b.order),
        subagents: [...subagents.values()].sort((a, b) => a.order - b.order),
    };
}
