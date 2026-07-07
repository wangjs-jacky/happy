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
        expect((await service.getWorkerHealth()).totalPolls).toBe(2);
        expect((await service.getWorkerHealth()).lastClaimedJobId).toBe(job.id);
    });

    it('records worker heartbeat even when the queue is empty', async () => {
        const store = createMemoryStore();
        const service = createImageGatewayService({
            store,
            ipHashSecret: 'test-secret',
            now: () => new Date('2026-07-07T08:00:00.000Z'),
        });

        expect(await service.claimNextJob()).toBeNull();

        const worker = await service.getWorkerHealth();
        expect(worker.lastSeenAt).toBe('2026-07-07T08:00:00.000Z');
        expect(worker.totalPolls).toBe(1);
        expect(worker.totalClaimed).toBe(0);
    });

    it('records worker success and failure outcomes', async () => {
        let index = 0;
        const times = [
            '2026-07-07T08:00:00.000Z',
            '2026-07-07T08:00:01.000Z',
            '2026-07-07T08:00:02.000Z',
            '2026-07-07T08:00:03.000Z',
            '2026-07-07T08:00:04.000Z',
            '2026-07-07T08:00:05.000Z',
        ];
        const store = createMemoryStore();
        const service = createImageGatewayService({
            store,
            ipHashSecret: 'test-secret',
            now: () => new Date(times[index++] ?? times.at(-1)!),
        });

        const first = await service.submitJob({
            prompt: 'draw a green check',
            ip: '203.0.113.7',
            userAgent: 'vitest',
        });
        await service.claimNextJob();
        await service.reportSuccess(first.id, { resultUrl: 'https://example.com/ok.png' });

        const second = await service.submitJob({
            prompt: 'draw a red cross',
            ip: '203.0.113.7',
            userAgent: 'vitest',
        });
        await service.claimNextJob();
        await service.reportFailure(second.id, 'native command failed <secret>');

        const worker = await service.getWorkerHealth();
        expect(worker.currentJobId).toBeUndefined();
        expect(worker.lastCompletedJobId).toBe(first.id);
        expect(worker.lastFailedJobId).toBe(second.id);
        expect(worker.lastError).toBe('native command failed secret');
        expect(worker.totalSucceeded).toBe(1);
        expect(worker.totalFailed).toBe(1);
    });

    it('requeues failed jobs for retry', async () => {
        let index = 0;
        const times = [
            '2026-07-07T08:00:00.000Z',
            '2026-07-07T08:00:01.000Z',
            '2026-07-07T08:00:02.000Z',
            '2026-07-07T08:00:03.000Z',
        ];
        const store = createMemoryStore();
        const service = createImageGatewayService({
            store,
            ipHashSecret: 'test-secret',
            now: () => new Date(times[index++] ?? times.at(-1)!),
        });

        const job = await service.submitJob({
            prompt: 'draw a retry button',
            ip: '203.0.113.8',
            userAgent: 'vitest',
        });
        await service.claimNextJob();
        await service.reportFailure(job.id, 'temporary provider error');

        const retried = await service.retryJob(job.id);

        expect(retried.status).toBe('queued');
        expect(retried.error).toBeUndefined();
        expect(retried.finishedAt).toBeUndefined();
        expect((await service.claimNextJob())?.id).toBe(job.id);
    });

    it('rejects retries for jobs that are not failed', async () => {
        const store = createMemoryStore();
        const service = createImageGatewayService({
            store,
            ipHashSecret: 'test-secret',
            now: () => new Date('2026-07-07T08:00:00.000Z'),
        });
        const job = await service.submitJob({
            prompt: 'draw an already queued job',
            ip: '203.0.113.9',
            userAgent: 'vitest',
        });

        await expect(service.retryJob(job.id)).rejects.toThrow('Only failed jobs can be retried');
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
