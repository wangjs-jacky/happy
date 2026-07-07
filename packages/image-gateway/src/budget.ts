import type { GatewayMode, ImageJobStatus } from './types';

export interface SubmissionBudgetInput {
    mode: GatewayMode;
    dailyBudgetCents: number;
    dailySpentEstimateCents: number;
    estimatedCostCents: number;
}

export interface SubmissionDecision {
    status: Extract<ImageJobStatus, 'queued' | 'pending_review' | 'rejected'>;
    nextMode: GatewayMode;
}

export function decideSubmission(input: SubmissionBudgetInput): SubmissionDecision {
    if (input.mode === 'closed') {
        return { status: 'rejected', nextMode: 'closed' };
    }

    if (input.mode === 'review') {
        return { status: 'pending_review', nextMode: 'review' };
    }

    const nextSpent = input.dailySpentEstimateCents + input.estimatedCostCents;
    if (nextSpent > input.dailyBudgetCents) {
        return { status: 'pending_review', nextMode: 'review' };
    }

    return { status: 'queued', nextMode: 'open' };
}
