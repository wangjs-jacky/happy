import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProcessRunner, resolveExecutable } from './processRunner';

describe('environment process runner', () => {
  it('uses argument arrays and returns bounded stdout', async () => {
    const runner = createProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'process.stdout.write("ready")'], {
      timeoutMs: 2_000,
      maxOutputBytes: 1024,
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ready', timedOut: false });
  });

  it('kills commands at the hard deadline', async () => {
    const runner = createProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
      timeoutMs: 20,
      maxOutputBytes: 1024,
    });
    expect(result.timedOut).toBe(true);
  });

  it('resolves only executable files from explicit paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paws-env-runner-'));
    const executable = join(directory, 'tool');
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);
    await expect(resolveExecutable('tool', directory, [])).resolves.toBe(executable);
  });
});
