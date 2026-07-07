import { describe, expect, it } from 'vitest';
import { createImageGatewayService } from './service';
import { createMemoryStore } from './store';

describe('image gateway service', () => {
    it('holds submissions for review after the global budget is exhausted', async () => {
        const store = createMemoryStore();
        const service = createImageGatewayService({
            store,
            ipHashSecret: 'test-secret',
            now: () => new Date('2026-07-07T08:00:00.000Z'),
        });

        await service.updateSettings({ mode: 'open', dailyBudgetCents: 50 });

        const first = await service.submitJob({
            prompt: 'paint a quiet mountain observatory',
            ip: '203.0.113.4',
            userAgent: 'vitest',
        });
        await service.reportSuccess(first.id, {
            resultUrl: 'https://example.com/first.png',
            actualCostCents: 40,
        });

        const second = await service.submitJob({
            prompt: 'paint a city made of glass',
            ip: '203.0.113.4',
            userAgent: 'vitest',
        });

        expect(second.status).toBe('pending_review');
        expect((await service.getSettings()).mode).toBe('review');
    });

    it('lets the worker claim only queued jobs and marks them running', async () => {
        const store = createMemoryStore();
        const service = createImageGatewayService({
            store,
            ipHashSecret: 'test-secret',
            now: () => new Date('2026-07-07T08:00:00.000Z'),
        });

        const job = await service.submitJob({
            prompt: 'draw a product photo of a ceramic keyboard',
            ip: '203.0.113.5',
            userAgent: 'vitest',
        });

        const claimed = await service.claimNextJob();

        expect(claimed?.id).toBe(job.id);
        expect(claimed?.status).toBe('running');
        expect(await service.claimNextJob()).toBeNull();
    });

    it('moves approved review jobs into the worker queue', async () => {
        const store = createMemoryStore();
        const service = createImageGatewayService({
            store,
            ipHashSecret: 'test-secret',
            now: () => new Date('2026-07-07T08:00:00.000Z'),
        });

        await service.updateSettings({ mode: 'review' });
        const job = await service.submitJob({
            prompt: 'draw a soft UI icon set',
            ip: '203.0.113.6',
            userAgent: 'vitest',
        });

        expect(job.status).toBe('pending_review');

        const approved = await service.approveJob(job.id);

        expect(approved.status).toBe('queued');
        expect((await service.claimNextJob())?.id).toBe(job.id);
    });
});
