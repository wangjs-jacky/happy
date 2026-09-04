import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
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

  it('settles after escalating when a command ignores SIGTERM', async () => {
    const runner = createProcessRunner();
    const startedAt = Date.now();
    const result = await runner.run(process.execPath, [
      '-e',
      'process.on("SIGTERM", () => {}); setTimeout(() => process.exit(0), 1_000);',
    ], {
      timeoutMs: 200,
      maxOutputBytes: 1024,
    });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('settles when a timed-out child leaves stdout open through a descendant', async () => {
    const runner = createProcessRunner();
    const startedAt = Date.now();
    const result = await runner.run(process.execPath, [
      '-e',
      `
        const { spawn } = require('node:child_process');
        spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1_000)'], { stdio: 'inherit' });
        process.on('SIGTERM', () => process.exit(0));
        setTimeout(() => {}, 1_000);
      `,
    ], {
      timeoutMs: 200,
      maxOutputBytes: 1024,
    });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('resolves only executable files from explicit paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paws-env-runner-'));
    const executable = join(directory, 'tool');
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);
    await expect(resolveExecutable('tool', directory, [])).resolves.toBe(executable);
  });

  it('skips executable directories before a later executable file', async () => {
    const firstDirectory = await mkdtemp(join(tmpdir(), 'paws-env-runner-directory-'));
    const secondDirectory = await mkdtemp(join(tmpdir(), 'paws-env-runner-executable-'));
    const directoryNamedTool = join(firstDirectory, 'tool');
    const executable = join(secondDirectory, 'tool');
    await mkdir(directoryNamedTool, { mode: 0o755 });
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);

    await expect(resolveExecutable('tool', [firstDirectory, secondDirectory].join(delimiter), [])).resolves.toBe(executable);
  });
});
