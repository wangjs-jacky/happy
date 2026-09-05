import type { Message, ToolCallMessage } from '@/sync/typesMessage';
import { getBrowserSteps, type BrowserStep } from './browserStepsModel';

export type EgoSkillName = 'ego-browser' | 'ego-ops';

export type BrowserStepRun = {
    id: string;
    invocationMessageId: string;
    createdAt: number;
    skillName: EgoSkillName;
    steps: BrowserStep[];
};

type MutableRun = BrowserStepRun & { aliases: Set<string> };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asEgoSkillName(value: unknown): EgoSkillName | null {
    return value === 'ego-browser' || value === 'ego-ops' ? value : null;
}

function getEgoSkillName(message: ToolCallMessage): EgoSkillName | null {
    const directName = asEgoSkillName(message.tool.name);
    if (directName) return directName;
    if (message.tool.name !== 'Skill' || !isRecord(message.tool.input)) return null;
    const names = Array.isArray(message.tool.input.skillNames) ? message.tool.input.skillNames : [];
    for (const name of names) {
        const egoName = asEgoSkillName(name);
        if (egoName) return egoName;
    }
    return null;
}

function compareMessages(a: Message, b: Message): number {
    return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function createRuns(messages: Message[]): MutableRun[] {
    return messages
        .filter((message): message is ToolCallMessage => message.kind === 'tool-call')
        .flatMap((message) => {
            const skillName = getEgoSkillName(message);
            if (!skillName) return [];
            const input = isRecord(message.tool.input) ? message.tool.input : {};
            const explicitRunId = typeof input.runId === 'string' && input.runId.trim().length > 0
                ? input.runId.trim()
                : null;
            const id = explicitRunId ?? message.id;
            const aliases = new Set([id, message.id]);
            if (message.tool.callId) aliases.add(message.tool.callId);
            return [{
                id,
                invocationMessageId: message.id,
                createdAt: message.createdAt,
                skillName,
                steps: [],
                aliases,
            } satisfies MutableRun];
        })
        .sort((a, b) => a.createdAt - b.createdAt || a.invocationMessageId.localeCompare(b.invocationMessageId));
}

/**
 * Associate browser frames with the Ego Skill invocation that produced them.
 * Explicit IDs are authoritative. Legacy frames are bounded to the latest
 * preceding Ego invocation in the same user turn, so unrelated browser work
 * cannot leak into a stale timeline.
 */
export function getBrowserStepRuns(messages: Message[]): BrowserStepRun[] {
    const orderedMessages = messages.slice().sort(compareMessages);
    const runs = createRuns(orderedMessages);
    const runByAlias = new Map<string, MutableRun>();
    for (const run of runs) {
        for (const alias of run.aliases) runByAlias.set(alias, run);
    }

    const stepByMessageId = new Map(getBrowserSteps(orderedMessages).map((step) => [step.id, step]));
    let latestLegacyRun: MutableRun | null = null;

    for (const message of orderedMessages) {
        if (message.kind === 'user-text') continue;
        if (message.kind === 'tool-call') {
            const invocation = runs.find((run) => run.invocationMessageId === message.id);
            if (invocation) latestLegacyRun = invocation;
        }

        const step = stepByMessageId.get(message.id);
        if (!step) continue;
        if (step.skillName && !asEgoSkillName(step.skillName)) continue;

        const run = step.runId ? runByAlias.get(step.runId) : latestLegacyRun;
        if (!run) continue;
        if (step.skillName && step.skillName !== run.skillName) continue;
        run.steps.push(step);
    }

    return runs
        .filter((run) => run.steps.length > 0)
        .map(({ aliases: _aliases, ...run }) => ({
            ...run,
            steps: run.steps.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
        }));
}
