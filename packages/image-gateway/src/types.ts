export type GatewayMode = 'open' | 'review' | 'closed';

export type ImageJobStatus =
    | 'pending_review'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'rejected';

export interface GatewaySettings {
    mode: GatewayMode;
    dailyBudgetCents: number;
    dailySpentEstimateCents: number;
    estimatedCostPerJobCents: number;
}

export interface WorkerHealth {
    lastSeenAt?: string;
    lastClaimAt?: string;
    lastClaimedJobId?: string;
    lastCompletedAt?: string;
    lastCompletedJobId?: string;
    lastFailedAt?: string;
    lastFailedJobId?: string;
    lastError?: string;
    currentJobId?: string;
    totalPolls: number;
    totalClaimed: number;
    totalSucceeded: number;
    totalFailed: number;
}

export interface ImageJob {
    id: string;
    prompt: string;
    status: ImageJobStatus;
    size: '1024x1024';
    estimatedCostCents: number;
    actualCostCents?: number;
    requesterIpHash: string;
    userAgentHash: string;
    resultUrl?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
    reviewedAt?: string;
    startedAt?: string;
    finishedAt?: string;
}

export interface ImageGatewaySnapshot {
    settings: GatewaySettings;
    worker: WorkerHealth;
    jobs: ImageJob[];
}

export const defaultGatewaySettings: GatewaySettings = {
    mode: 'open',
    dailyBudgetCents: 1000,
    dailySpentEstimateCents: 0,
    estimatedCostPerJobCents: 40,
};

export const defaultWorkerHealth: WorkerHealth = {
    totalPolls: 0,
    totalClaimed: 0,
    totalSucceeded: 0,
    totalFailed: 0,
};
