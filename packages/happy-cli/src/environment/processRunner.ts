import { spawn } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

const TERMINATION_GRACE_MS = 100;
const SETTLEMENT_GRACE_MS = 100;

export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
};

export type ProcessRunner = {
  run(executable: string, args: readonly string[], options: RunProcessOptions): Promise<ProcessResult>;
};

type RetainedOutput = { chunks: Buffer[]; bytes: number };

function appendBounded(output: RetainedOutput, chunk: Buffer, maxOutputBytes: number): void {
  const retainedBytes = Math.min(chunk.length, maxOutputBytes - output.bytes);
  if (retainedBytes > 0) {
    // An unpooled copy owns exactly the retained bytes, including tiny truncated tails.
    // A subarray (or pooled copy) can keep a much larger backing allocation alive.
    const retained = Buffer.allocUnsafeSlow(retainedBytes);
    chunk.copy(retained, 0, 0, retainedBytes);
    output.chunks.push(retained);
    output.bytes += retainedBytes;
  }
}

export function createProcessRunner(): ProcessRunner {
  return {
    run(executable, args, options) {
      return new Promise((resolve) => {
        const stdout: RetainedOutput = { chunks: [], bytes: 0 };
        const stderr: RetainedOutput = { chunks: [], bytes: 0 };
        let timedOut = false;
        let settled = false;
        let deadlineTimer: NodeJS.Timeout | undefined;
        let terminationTimer: NodeJS.Timeout | undefined;
        let settlementTimer: NodeJS.Timeout | undefined;

        const child = spawn(executable, [...args], {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: options.cwd,
          env: options.env,
        });

        const closePipes = (): void => {
          child.stdout?.destroy();
          child.stderr?.destroy();
        };

        const finish = (exitCode: number | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(deadlineTimer);
          clearTimeout(terminationTimer);
          clearTimeout(settlementTimer);
          if (timedOut) closePipes();
          resolve({
            exitCode,
            stdout: Buffer.concat(stdout.chunks, stdout.bytes).toString('utf8'),
            stderr: Buffer.concat(stderr.chunks, stderr.bytes).toString('utf8'),
            timedOut,
          });
        };

        deadlineTimer = setTimeout(() => {
          timedOut = true;
          closePipes();
          child.kill('SIGTERM');
          terminationTimer = setTimeout(() => {
            child.kill('SIGKILL');
            settlementTimer = setTimeout(() => finish(null), SETTLEMENT_GRACE_MS);
          }, TERMINATION_GRACE_MS);
        }, options.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => appendBounded(stdout, chunk, options.maxOutputBytes));
        child.stderr.on('data', (chunk: Buffer) => appendBounded(stderr, chunk, options.maxOutputBytes));
        child.once('error', () => finish(null));
        child.once('exit', (exitCode) => {
          if (timedOut) finish(exitCode);
        });
        child.once('close', (exitCode) => finish(exitCode));
      });
    },
  };
}

export async function resolveExecutable(
  name: string,
  envPath: string | undefined,
  candidates: readonly string[],
): Promise<string | null> {
  const pathCandidates = envPath === undefined ? [] : envPath.split(delimiter).map((entry) => join(entry, name));

  for (const candidate of [...pathCandidates, ...candidates]) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue until an executable candidate is found.
    }
  }

  return null;
}
