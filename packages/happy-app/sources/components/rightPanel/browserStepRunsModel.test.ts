import { describe, expect, it } from 'vitest';
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

function userMessage(id: string, createdAt: number): Message {
    return { kind: 'user-text', id, localId: null, createdAt, text: 'next request' };
}

describe('getBrowserStepRuns', () => {
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
            { skillName: 'ego-browser', stepIds: ['browser-1', 'browser-2'] },
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
