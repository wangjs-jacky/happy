import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

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

function appendBounded(chunks: Buffer[], chunk: Buffer, maxOutputBytes: number): void {
  const collectedBytes = chunks.reduce((total, collected) => total + collected.length, 0);
  const remainingBytes = maxOutputBytes - collectedBytes;

  if (remainingBytes > 0) {
    chunks.push(chunk.subarray(0, remainingBytes));
  }
}

export function createProcessRunner(): ProcessRunner {
  return {
    run(executable, args, options) {
      return new Promise((resolve) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let timedOut = false;
        let settled = false;

        const finish = (exitCode: number | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve({
            exitCode,
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8'),
            timedOut,
          });
        };

        const child = spawn(executable, [...args], {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: options.cwd,
          env: options.env,
        });
        const timeout = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => appendBounded(stdoutChunks, chunk, options.maxOutputBytes));
        child.stderr.on('data', (chunk: Buffer) => appendBounded(stderrChunks, chunk, options.maxOutputBytes));
        child.once('error', () => finish(null));
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
      return candidate;
    } catch {
      // Continue until an executable candidate is found.
    }
  }

  return null;
}
