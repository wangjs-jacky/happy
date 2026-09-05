import { describe, expect, it } from 'vitest';
import { sessionFileEventSchema } from '@slopus/happy-wire';
import type { Message } from '@/sync/typesMessage';
import { getBrowserStepRuns } from './browserStepRunsModel';

function skillMessage(id: string, createdAt: number, skillName: string, runId?: string): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt,
        children: [],
        tool: {
            callId: `call-${id}`,
            name: 'Skill',
            state: 'completed',
            input: {
                skillNames: [skillName],
                ...(runId ? { runId } : {}),
            },
            createdAt,
            startedAt: createdAt,
            completedAt: createdAt + 1,
            description: null,
        },
    };
}

function browserStep(
    id: string,
    createdAt: number,
    label: string,
    browserStepMetadata: Record<string, unknown> = {},
): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt,
        children: [],
        tool: {
            name: 'file',
            state: 'completed',
            input: {
                ref: `attachment://${id}`,
                name: `${id}.png`,
                source: 'browser_step',
                browserStep: { label, ...browserStepMetadata },
                image: { width: 1280, height: 720 },
            },
            createdAt,
            startedAt: createdAt,
            completedAt: createdAt,
            description: null,
        },
    };
}

function producerWireBrowserStep(
    id: string,
    createdAt: number,
    label: string,
    runId: string,
    skillName: 'ego-browser' | 'ego-ops',
): Message {
    const wireEvent = sessionFileEventSchema.parse({
        t: 'file',
        ref: `attachment://${id}`,
        name: `${id}.png`,
        size: 128,
        source: 'browser_step',
        browserStep: { label, runId, skillName },
    });
    return browserStep(id, createdAt, wireEvent.browserStep!.label, wireEvent.browserStep);
}

function userMessage(id: string, createdAt: number): Message {
    return { kind: 'user-text', id, localId: null, createdAt, text: 'next request' };
}

describe('getBrowserStepRuns', () => {
    it('binds the producer run ID to the latest matching real Skill invocation exactly once', () => {
        const runs = getBrowserStepRuns([
            skillMessage('browser-invocation-1', 10, 'ego-browser'),
            producerWireBrowserStep('browser-1', 20, 'B1', 'generated-browser-1', 'ego-browser'),
            producerWireBrowserStep('browser-2', 30, 'B2', 'generated-browser-1', 'ego-browser'),
            producerWireBrowserStep('orphan-second-id', 40, 'must not reuse invocation', 'generated-browser-2', 'ego-browser'),
            skillMessage('ops-invocation', 45, 'ego-ops'),
            producerWireBrowserStep('ops-1', 50, 'O1', 'generated-ops-1', 'ego-ops'),
            skillMessage('browser-invocation-2', 60, 'ego-browser'),
            producerWireBrowserStep('browser-3', 70, 'B3', 'generated-browser-2', 'ego-browser'),
        ]);

        expect(runs.map((run) => ({
            id: run.id,
            invocationMessageId: run.invocationMessageId,
            stepIds: run.steps.map((step) => step.id),
        }))).toEqual([
            { id: 'generated-browser-1', invocationMessageId: 'browser-invocation-1', stepIds: ['browser-1', 'browser-2'] },
            { id: 'generated-ops-1', invocationMessageId: 'ops-invocation', stepIds: ['ops-1'] },
            { id: 'generated-browser-2', invocationMessageId: 'browser-invocation-2', stepIds: ['browser-3'] },
        ]);
    });

    it('drops a generated run ID without a preceding unbound invocation of the same skill', () => {
        expect(getBrowserStepRuns([
            browserStep('before', 5, 'before', { runId: 'run-before', skillName: 'ego-browser' }),
            skillMessage('ops-only', 10, 'ego-ops'),
            browserStep('wrong-skill', 20, 'wrong', { runId: 'run-browser', skillName: 'ego-browser' }),
        ])).toEqual([]);
    });

    it('uses explicit run IDs to keep interleaved repeated Ego runs separate', () => {
        const runs = getBrowserStepRuns([
            skillMessage('skill-a', 10, 'ego-browser', 'run-a'),
            skillMessage('skill-b', 20, 'ego-browser', 'run-b'),
            browserStep('step-b-2', 50, 'B2', { runId: 'run-b' }),
            browserStep('step-a-1', 30, 'A1', { runId: 'run-a' }),
            browserStep('step-b-1', 40, 'B1', { runId: 'run-b' }),
        ]);

        expect(runs.map((run) => ({
            id: run.id,
            skillName: run.skillName,
            stepIds: run.steps.map((step) => step.id),
        }))).toEqual([
            { id: 'run-a', skillName: 'ego-browser', stepIds: ['step-a-1'] },
            { id: 'run-b', skillName: 'ego-browser', stepIds: ['step-b-1', 'step-b-2'] },
        ]);
    });

    it('continues to accept invocation input run IDs and tool call IDs', () => {
        const runs = getBrowserStepRuns([
            skillMessage('input-id', 10, 'ego-browser', 'declared-run'),
            browserStep('declared-step', 20, 'declared', { runId: 'declared-run', skillName: 'ego-browser' }),
            skillMessage('call-id', 30, 'ego-ops'),
            browserStep('call-step', 40, 'call', { runId: 'call-call-id', skillName: 'ego-ops' }),
        ]);

        expect(runs.map((run) => ({ id: run.id, stepIds: run.steps.map((step) => step.id) }))).toEqual([
            { id: 'declared-run', stepIds: ['declared-step'] },
            { id: 'call-call-id', stepIds: ['call-step'] },
        ]);
    });

    it('attaches legacy steps only to the most recent preceding Ego invocation within a user turn', () => {
        const runs = getBrowserStepRuns([
            browserStep('orphan-before', 5, 'not associated'),
            skillMessage('skill-browser', 10, 'ego-browser'),
            browserStep('browser-1', 20, 'browser one'),
            skillMessage('ordinary-skill', 25, 'dev'),
            browserStep('browser-2', 30, 'browser two'),
            userMessage('next-turn', 35),
            browserStep('orphan-after-turn', 40, 'not associated anymore'),
            skillMessage('skill-ops', 50, 'ego-ops'),
            browserStep('ops-1', 60, 'ops one'),
            browserStep('not-ego', 70, 'unrelated provider', { skillName: 'chrome' }),
        ]);

        expect(runs.map((run) => ({
            skillName: run.skillName,
            stepIds: run.steps.map((step) => step.id),
        }))).toEqual([
            { skillName: 'ego-browser', stepIds: ['browser-1', 'browser-2', 'orphan-after-turn'] },
            { skillName: 'ego-ops', stepIds: ['ops-1'] },
        ]);
    });

    it('excludes explicit browser events that do not resolve to an Ego invocation', () => {
        expect(getBrowserStepRuns([
            skillMessage('ordinary-skill', 10, 'dev', 'run-dev'),
            browserStep('ordinary-step', 20, 'unrelated', { runId: 'run-dev' }),
            browserStep('missing-run', 30, 'missing', { runId: 'missing' }),
        ])).toEqual([]);
    });

    it('uses message IDs as stable run IDs and deterministic timestamp tie-breakers for legacy events', () => {
        const runs = getBrowserStepRuns([
            skillMessage('skill-z', 10, 'ego-ops'),
            browserStep('step-z', 20, 'z'),
            browserStep('step-a', 20, 'a'),
        ]);

        expect(runs).toHaveLength(1);
        expect(runs[0]?.id).toBe('skill-z');
        expect(runs[0]?.steps.map((step) => step.id)).toEqual(['step-a', 'step-z']);
    });
});
