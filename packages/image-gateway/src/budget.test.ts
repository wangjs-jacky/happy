import { describe, expect, it } from 'vitest';
import { decideSubmission } from './budget';

describe('decideSubmission', () => {
    it('queues public jobs while the gateway is open and under budget', () => {
        const decision = decideSubmission({
            mode: 'open',
            dailyBudgetCents: 1000,
            dailySpentEstimateCents: 250,
            estimatedCostCents: 40,
        });

        expect(decision.status).toBe('queued');
        expect(decision.nextMode).toBe('open');
    });

    it('switches to review and holds new jobs once the daily budget is reached', () => {
        const decision = decideSubmission({
            mode: 'open',
            dailyBudgetCents: 1000,
            dailySpentEstimateCents: 980,
            estimatedCostCents: 40,
        });

        expect(decision.status).toBe('pending_review');
        expect(decision.nextMode).toBe('review');
    });

    it('rejects public jobs when the kill switch is closed', () => {
        const decision = decideSubmission({
            mode: 'closed',
            dailyBudgetCents: 1000,
            dailySpentEstimateCents: 0,
            estimatedCostCents: 40,
        });

        expect(decision.status).toBe('rejected');
        expect(decision.nextMode).toBe('closed');
    });
});
