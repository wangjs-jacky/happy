import { createHash, randomUUID } from 'node:crypto';
import { decideSubmission } from './budget';
import { defaultGatewaySettings, type GatewaySettings, type ImageJob } from './types';
import { type ImageGatewayStore, withSnapshot } from './store';

const MAX_PROMPT_LENGTH = 1200;

export interface CreateImageGatewayServiceOptions {
    store: ImageGatewayStore;
    ipHashSecret: string;
    now?: () => Date;
}

export interface SubmitJobInput {
    prompt: string;
    ip: string;
    userAgent: string;
}

export interface SuccessInput {
    resultUrl: string;
    actualCostCents?: number;
}

export function createImageGatewayService(options: CreateImageGatewayServiceOptions) {
    const now = options.now ?? (() => new Date());

    return {
        async getSettings() {
            return (await options.store.read()).settings;
        },
        async updateSettings(patch: Partial<Pick<GatewaySettings, 'mode' | 'dailyBudgetCents' | 'estimatedCostPerJobCents'>>) {
            return withSnapshot(options.store, (snapshot) => {
                snapshot.settings = {
                    ...snapshot.settings,
                    ...patch,
                };
                return { ...snapshot.settings };
            });
        },
        async listJobs() {
            const snapshot = await options.store.read();
            return snapshot.jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        },
        async getWorkerHealth() {
            return (await options.store.read()).worker;
        },
        async getJob(id: string) {
            const snapshot = await options.store.read();
            return snapshot.jobs.find((job) => job.id === id) ?? null;
        },
        async submitJob(input: SubmitJobInput) {
            const prompt = normalizePrompt(input.prompt);
            return withSnapshot(options.store, (snapshot) => {
                const settings = {
                    ...defaultGatewaySettings,
                    ...snapshot.settings,
                };
                const decision = decideSubmission({
                    mode: settings.mode,
                    dailyBudgetCents: settings.dailyBudgetCents,
                    dailySpentEstimateCents: settings.dailySpentEstimateCents,
                    estimatedCostCents: settings.estimatedCostPerJobCents,
                });
                const timestamp = now().toISOString();
                const job: ImageJob = {
                    id: `job_${randomUUID()}`,
                    prompt,
                    status: decision.status,
                    size: '1024x1024',
                    estimatedCostCents: settings.estimatedCostPerJobCents,
                    requesterIpHash: hashValue(options.ipHashSecret, input.ip),
                    userAgentHash: hashValue(options.ipHashSecret, input.userAgent),
                    createdAt: timestamp,
                    updatedAt: timestamp,
                };
                snapshot.settings.mode = decision.nextMode;
                snapshot.jobs.push(job);
                return { ...job };
            });
        },
        async approveJob(id: string) {
            return updateJob(options.store, id, now, (job, timestamp) => {
                if (job.status !== 'pending_review') {
                    throw new Error(`Only pending review jobs can be approved. Current status: ${job.status}`);
                }
                job.status = 'queued';
                job.reviewedAt = timestamp;
            });
        },
        async rejectJob(id: string) {
            return updateJob(options.store, id, now, (job, timestamp) => {
                if (job.status === 'succeeded' || job.status === 'running') {
                    throw new Error(`Cannot reject job in status: ${job.status}`);
                }
                job.status = 'rejected';
                job.reviewedAt = timestamp;
                job.finishedAt = timestamp;
            });
        },
        async retryJob(id: string) {
            return updateJob(options.store, id, now, (job, timestamp, snapshot) => {
                if (job.status !== 'failed') {
                    throw new Error(`Only failed jobs can be retried. Current status: ${job.status}`);
                }
                job.status = 'queued';
                job.error = undefined;
                job.finishedAt = undefined;
                job.resultUrl = undefined;
                job.actualCostCents = undefined;
                job.startedAt = undefined;
                snapshot.worker.lastError = snapshot.worker.lastFailedJobId === job.id ? undefined : snapshot.worker.lastError;
            });
        },
        async claimNextJob() {
            return withSnapshot(options.store, (snapshot) => {
                const timestamp = now().toISOString();
                snapshot.worker.lastSeenAt = timestamp;
                snapshot.worker.totalPolls += 1;
                const job = snapshot.jobs
                    .filter((candidate) => candidate.status === 'queued')
                    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
                if (!job) return null;
                job.status = 'running';
                job.startedAt = timestamp;
                job.updatedAt = timestamp;
                snapshot.worker.lastClaimAt = timestamp;
                snapshot.worker.lastClaimedJobId = job.id;
                snapshot.worker.currentJobId = job.id;
                snapshot.worker.lastError = undefined;
                snapshot.worker.totalClaimed += 1;
                return { ...job };
            });
        },
        async reportSuccess(id: string, input: SuccessInput) {
            return updateJob(options.store, id, now, (job, timestamp, snapshot) => {
                if (job.status !== 'running' && job.status !== 'queued') {
                    throw new Error(`Cannot complete job in status: ${job.status}`);
                }
                job.status = 'succeeded';
                job.resultUrl = input.resultUrl;
                job.actualCostCents = input.actualCostCents ?? job.estimatedCostCents;
                job.finishedAt = timestamp;
                snapshot.worker.lastSeenAt = timestamp;
                snapshot.worker.lastCompletedAt = timestamp;
                snapshot.worker.lastCompletedJobId = job.id;
                snapshot.worker.currentJobId = snapshot.worker.currentJobId === job.id ? undefined : snapshot.worker.currentJobId;
                snapshot.worker.lastError = undefined;
                snapshot.worker.totalSucceeded += 1;
                snapshot.settings.dailySpentEstimateCents += job.actualCostCents;
                if (snapshot.settings.dailySpentEstimateCents >= snapshot.settings.dailyBudgetCents) {
                    snapshot.settings.mode = 'review';
                }
            });
        },
        async reportFailure(id: string, error: string) {
            return updateJob(options.store, id, now, (job, timestamp, snapshot) => {
                if (job.status !== 'running') {
                    throw new Error(`Cannot fail job in status: ${job.status}`);
                }
                job.status = 'failed';
                job.error = safeError(error);
                job.finishedAt = timestamp;
                snapshot.worker.lastSeenAt = timestamp;
                snapshot.worker.lastFailedAt = timestamp;
                snapshot.worker.lastFailedJobId = job.id;
                snapshot.worker.currentJobId = snapshot.worker.currentJobId === job.id ? undefined : snapshot.worker.currentJobId;
                snapshot.worker.lastError = job.error;
                snapshot.worker.totalFailed += 1;
            });
        },
    };
}

function normalizePrompt(prompt: string): string {
    const normalized = prompt.trim().replace(/\s+/g, ' ');
    if (!normalized) {
        throw new Error('Prompt is required');
    }
    if (normalized.length > MAX_PROMPT_LENGTH) {
        throw new Error(`Prompt is too long. Max length is ${MAX_PROMPT_LENGTH} characters`);
    }
    return normalized;
}

function hashValue(secret: string, value: string): string {
    return createHash('sha256').update(secret).update('\0').update(value).digest('hex');
}

function safeError(error: string): string {
    return error.replace(/[^\w\s.,:;!?()[\]-]/g, '').slice(0, 500);
}

async function updateJob(
    store: ImageGatewayStore,
    id: string,
    now: () => Date,
    update: (job: ImageJob, timestamp: string, snapshot: Awaited<ReturnType<ImageGatewayStore['read']>>) => void,
): Promise<ImageJob> {
    return withSnapshot(store, (snapshot) => {
        const job = snapshot.jobs.find((candidate) => candidate.id === id);
        if (!job) {
            throw new Error(`Job not found: ${id}`);
        }
        const timestamp = now().toISOString();
        update(job, timestamp, snapshot);
        job.updatedAt = timestamp;
        return { ...job };
    });
}
