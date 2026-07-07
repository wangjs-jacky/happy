import { runNativeImageCommand } from './nativeGenerator';
import type { ImageJob } from './types';

const gatewayUrl = process.env.IMAGE_GATEWAY_URL ?? 'http://127.0.0.1:3010';
const workerToken = process.env.IMAGE_GATEWAY_WORKER_TOKEN;
const nativeCommand = process.env.IMAGE_WORKER_NATIVE_COMMAND;
const pollMs = Number(process.env.IMAGE_WORKER_POLL_MS ?? 5000);
const timeoutMs = Number(process.env.IMAGE_WORKER_TIMEOUT_MS ?? 300000);

if (!workerToken) {
    throw new Error('IMAGE_GATEWAY_WORKER_TOKEN is required');
}
if (!nativeCommand) {
    throw new Error('IMAGE_WORKER_NATIVE_COMMAND is required');
}

async function main() {
    for (;;) {
        const job = await claimJob();
        if (!job) {
            await delay(pollMs);
            continue;
        }
        try {
            const result = await runNativeImageCommand(nativeCommand!, job, timeoutMs);
            if (result.resultUrl) {
                await reportSuccess(job.id, result.resultUrl, result.actualCostCents);
            } else if (result.imagePath) {
                const url = await uploadLocalImage(job.id, result.imagePath);
                await reportSuccess(job.id, url, result.actualCostCents);
            } else {
                throw new Error('Native image command returned no result');
            }
        } catch (error) {
            await reportFailure(job.id, error instanceof Error ? error.message : 'Unknown worker error');
        }
    }
}

async function claimJob(): Promise<ImageJob | null> {
    const response = await fetch(`${gatewayUrl}/image/worker/claim`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${workerToken}`,
        },
    });
    if (!response.ok) {
        throw new Error(`Claim failed: ${response.status}`);
    }
    const payload = await response.json() as { job: ImageJob | null };
    return payload.job;
}

async function reportSuccess(jobId: string, resultUrl: string, actualCostCents?: number) {
    await postJson(`/image/worker/jobs/${jobId}/succeed`, { resultUrl, actualCostCents });
}

async function reportFailure(jobId: string, error: string) {
    await postJson(`/image/worker/jobs/${jobId}/fail`, { error });
}

async function postJson(path: string, payload: unknown) {
    const response = await fetch(`${gatewayUrl}${path}`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${workerToken}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Gateway report failed: ${response.status}`);
    }
}

async function uploadLocalImage(jobId: string, imagePath: string): Promise<string> {
    const uploadCommand = process.env.IMAGE_WORKER_UPLOAD_COMMAND;
    if (!uploadCommand) {
        throw new Error('IMAGE_WORKER_UPLOAD_COMMAND is required when native command returns imagePath');
    }
    const { spawn } = await import('node:child_process');
    return new Promise((resolve, reject) => {
        const child = spawn(uploadCommand, [jobId, imagePath], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0 && stdout.trim()) {
                resolve(stdout.trim());
            } else {
                reject(new Error(stderr.trim() || `Upload command failed: ${code}`));
            }
        });
    });
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
