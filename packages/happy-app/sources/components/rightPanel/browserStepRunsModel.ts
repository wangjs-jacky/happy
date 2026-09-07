import type { Message, ToolCallMessage } from '@/sync/typesMessage';
import { getBrowserSteps, type BrowserStep } from './browserStepsModel';
import { getSkillNamesFromTool } from '@/utils/conversationActivity';

export type EgoSkillName = 'ego-browser' | 'ego-ops';

export type BrowserStepRun = {
    id: string;
    invocationMessageId: string;
    createdAt: number;
    skillName: EgoSkillName;
    steps: BrowserStep[];
};

type MutableRun = BrowserStepRun & {
    aliases: Set<string>;
    boundExplicitRunId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asEgoSkillName(value: unknown): EgoSkillName | null {
    return value === 'ego-browser' || value === 'ego-ops' ? value : null;
}

function getEgoSkillNames(message: ToolCallMessage): EgoSkillName[] {
    const directName = asEgoSkillName(message.tool.name);
    if (directName) return [directName];
    if (message.tool.name !== 'Skill' || !isRecord(message.tool.input)) return [];
    const names = getSkillNamesFromTool(message.tool);
    return names.filter((name): name is EgoSkillName => asEgoSkillName(name) !== null);
}

function compareMessages(a: Message, b: Message): number {
    return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function createRuns(messages: Message[]): MutableRun[] {
    return messages
        .filter((message): message is ToolCallMessage => message.kind === 'tool-call')
        .flatMap((message) => {
            const skillNames = getEgoSkillNames(message);
            if (!skillNames.length) return [];
            const input = isRecord(message.tool.input) ? message.tool.input : {};
            const explicitRunId = typeof input.runId === 'string' && input.runId.trim().length > 0
                ? input.runId.trim()
                : null;
            return skillNames.map(skillName => {
            const id = explicitRunId ?? (skillNames.length > 1 ? `${message.id}:${skillName}` : message.id);
            const aliases = new Set([id, message.id]);
            if (message.tool.callId) aliases.add(message.tool.callId);
            return {
                id,
                invocationMessageId: message.id,
                createdAt: message.createdAt,
                skillName,
                steps: [],
                aliases,
                boundExplicitRunId: explicitRunId,
            } satisfies MutableRun;
            });
        })
        .sort((a, b) => a.createdAt - b.createdAt || a.invocationMessageId.localeCompare(b.invocationMessageId));
}

/**
 * Associate browser frames with the Ego Skill invocation that produced them.
 * Explicit IDs are authoritative. A producer-generated ID first binds FIFO to
 * a pending matching invocation, unless an invocation/call alias identifies
 * an exact pending invocation.
 * Legacy frames follow the latest preceding Ego invocation until superseded.
 */
export function getBrowserStepRuns(messages: Message[]): BrowserStepRun[] {
    const orderedMessages = messages.slice().sort(compareMessages);
    const runs = createRuns(orderedMessages);
    const runByAlias = new Map<string, MutableRun[]>();
    const runByInvocationMessageId = new Map<string, MutableRun[]>();
    const addAlias = (alias: string, run: MutableRun) => {
        const entries = runByAlias.get(alias) ?? [];
        if (!entries.includes(run)) entries.push(run);
        runByAlias.set(alias, entries);
    };
    for (const run of runs) {
        const invocations = runByInvocationMessageId.get(run.invocationMessageId) ?? [];
        invocations.push(run);
        runByInvocationMessageId.set(run.invocationMessageId, invocations);
        for (const alias of run.aliases) addAlias(alias, run);
    }

    const stepByMessageId = new Map(getBrowserSteps(orderedMessages).map((step) => [step.id, step]));
    let latestLegacyRun: MutableRun | null = null;
    const pendingInvocationsBySkill = new Map<EgoSkillName, MutableRun[]>();

    const removePending = (run: MutableRun) => {
        const pending = pendingInvocationsBySkill.get(run.skillName);
        if (!pending) return;
        const index = pending.indexOf(run);
        if (index >= 0) pending.splice(index, 1);
    };

    const bindRunId = (run: MutableRun, runId: string) => {
        run.id = runId;
        run.boundExplicitRunId = runId;
        run.aliases.add(runId);
        addAlias(runId, run);
        removePending(run);
    };

    for (const message of orderedMessages) {
        if (message.kind === 'user-text') continue;
        if (message.kind === 'tool-call') {
            const invocations = runByInvocationMessageId.get(message.id) ?? [];
            if (invocations.length) latestLegacyRun = invocations.length === 1 ? invocations[0] : null;
            for (const invocation of invocations) {
                if (invocation.boundExplicitRunId === null) {
                    const pending = pendingInvocationsBySkill.get(invocation.skillName) ?? [];
                    pending.push(invocation);
                    pendingInvocationsBySkill.set(invocation.skillName, pending);
                }
            }
        }

        const step = stepByMessageId.get(message.id);
        if (!step) continue;
        if (step.skillName && !asEgoSkillName(step.skillName)) continue;

        const candidates = step.runId ? (runByAlias.get(step.runId) ?? [])
            .filter(run => !step.skillName || run.skillName === step.skillName) : [];
        let run = step.runId ? (candidates.length === 1 ? candidates[0] : undefined) : latestLegacyRun;
        if (step.runId && !run && step.skillName) {
            const skillName = asEgoSkillName(step.skillName);
            const candidate = skillName ? pendingInvocationsBySkill.get(skillName)?.[0] : undefined;
            if (candidate) {
                bindRunId(candidate, step.runId);
                run = candidate;
            }
        }
        if (!run) continue;
        if (step.skillName && step.skillName !== run.skillName) continue;
        if (step.runId && run.boundExplicitRunId === null) bindRunId(run, step.runId);
        run.steps.push(step);
    }

    const ownRuns = runs
        .filter((run) => run.steps.length > 0)
        .map(({ aliases: _aliases, boundExplicitRunId: _boundExplicitRunId, ...run }) => ({
            ...run,
            steps: run.steps.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
        }));
    const linkedStepIds = new Set(ownRuns.flatMap(run => run.steps.map(step => step.id)));
    const standaloneRuns = new Map<string, BrowserStepRun>();
    for (const step of stepByMessageId.values()) {
        if (linkedStepIds.has(step.id) || !step.runId) continue;
        const skillName = asEgoSkillName(step.skillName);
        if (!skillName) continue;
        const key = `${skillName}:${step.runId}`;
        const run = standaloneRuns.get(key) ?? {
            id: step.runId,
            invocationMessageId: step.id,
            createdAt: step.createdAt,
            skillName,
            steps: [],
        };
        run.steps.push(step);
        standaloneRuns.set(key, run);
    }
    // Each nested tool transcript owns its legacy/FIFO queue; never bind a
    // sibling agent's screenshot merely because its timestamp is nearby.
    const childRuns = messages.flatMap(message => message.kind === 'tool-call'
        ? getBrowserStepRuns(message.children) : []);
    return [...ownRuns, ...standaloneRuns.values(), ...childRuns]
        .map(run => ({ ...run, steps: run.steps.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) }))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Only remove evidence when its invocation has a matching progress entry. */
export function hideLinkedBrowserSteps(messages: Message[], runs: BrowserStepRun[]): Message[] {
    const linked = new Set(runs.flatMap(run => run.steps.map(step => step.id)));
    const filter = (items: Message[]): Message[] => items.flatMap(message => {
        if (linked.has(message.id)) return [];
        if (message.kind !== 'tool-call' || !message.children.length) return [message];
        const children = filter(message.children);
        return [children.length === message.children.length && children.every((child, i) => child === message.children[i])
            ? message : { ...message, children }];
    });
    return linked.size ? filter(messages) : messages;
}
