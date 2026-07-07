import { spawn } from 'node:child_process';
import type { ImageJob } from './types';

export interface NativeImageRequest {
    jobId: string;
    prompt: string;
    options: {
        size: '1024x1024';
        output: 'png';
        count: 1;
    };
}

export interface NativeImageResult {
    resultUrl?: string;
    imagePath?: string;
    actualCostCents?: number;
}

export function buildNativeImageRequest(job: ImageJob): NativeImageRequest {
    return {
        jobId: job.id,
        prompt: job.prompt,
        options: {
            size: '1024x1024',
            output: 'png',
            count: 1,
        },
    };
}

export async function runNativeImageCommand(command: string, job: ImageJob, timeoutMs: number): Promise<NativeImageResult> {
    const request = buildNativeImageRequest(job);
    const [bin, ...args] = splitCommand(command);
    if (!bin) {
        throw new Error('IMAGE_WORKER_NATIVE_COMMAND is required');
    }

    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: process.env,
        });
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Native image command timed out'));
        }, timeoutMs);

        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`Native image command failed: ${stderr.trim() || `exit ${code}`}`));
                return;
            }
            try {
                const parsed = JSON.parse(stdout) as NativeImageResult;
                if (!parsed.resultUrl && !parsed.imagePath) {
                    reject(new Error('Native image command must return resultUrl or imagePath JSON'));
                    return;
                }
                resolve(parsed);
            } catch {
                reject(new Error('Native image command returned invalid JSON'));
            }
        });
        child.stdin.end(JSON.stringify(request));
    });
}

function splitCommand(command: string): string[] {
    return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) ?? [];
}
