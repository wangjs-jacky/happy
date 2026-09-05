import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProcessRunner, resolveExecutable } from './processRunner';

describe('environment process runner', () => {
  const fixtureDirectories: string[] = [];
  async function fixtureDirectory() {
    const directory = await mkdtemp(join(tmpdir(), 'paws-env-runner-'));
    fixtureDirectories.push(directory);
    return directory;
  }

  afterEach(async () => {
    await Promise.all(fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('uses argument arrays and returns bounded stdout', async () => {
    const runner = createProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'process.stdout.write("ready")'], {
      timeoutMs: 2_000,
      maxOutputBytes: 1024,
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ready', timedOut: false });
  });

  it.each(['stdout', 'stderr'] as const)('caps overflowing %s independently of the other stream', async (stream) => {
    const other = stream === 'stdout' ? 'stderr' : 'stdout';
    const result = await createProcessRunner().run(process.execPath, ['-e',
      `process.${stream}.write('x'.repeat(131072)); process.${other}.write('other');`,
    ], { timeoutMs: 2_000, maxOutputBytes: 1024 });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, [stream]: 'x'.repeat(1024), [other]: 'other' });
  });

  it('retains only capped backing memory for both output streams after truncation', async () => {
    const concat = vi.spyOn(Buffer, 'concat');
    try {
      const result = await createProcessRunner().run(process.execPath, ['-e',
        "process.stdout.write('x'.repeat(131072)); process.stderr.write('y'.repeat(131072));",
      ], { timeoutMs: 2_000, maxOutputBytes: 17 });
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, stdout: 'x'.repeat(17), stderr: 'y'.repeat(17) });
      // Inspect the retained storage at its decoding boundary, not process RSS or GC timing.
      for (const character of ['x', 'y']) {
        const chunks = concat.mock.calls.find(([buffers]) => buffers.length > 0
          && buffers[0].byteLength === 17 && buffers[0][0] === character.charCodeAt(0))?.[0];
        expect(chunks).toBeDefined();
        const backingBuffers = new Set(chunks!.map((chunk) => chunk.buffer));
        expect([...backingBuffers].reduce((sum, buffer) => sum + buffer.byteLength, 0)).toBe(17);
      }
    } finally {
      concat.mockRestore();
    }
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
    const directory = await fixtureDirectory();
    const executable = join(directory, 'tool');
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);
    await expect(resolveExecutable('tool', directory, [])).resolves.toBe(executable);
  });

  it('skips executable directories before a later executable file', async () => {
    const firstDirectory = await fixtureDirectory();
    const secondDirectory = await fixtureDirectory();
    const directoryNamedTool = join(firstDirectory, 'tool');
    const executable = join(secondDirectory, 'tool');
    await mkdir(directoryNamedTool, { mode: 0o755 });
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);

    await expect(resolveExecutable('tool', [firstDirectory, secondDirectory].join(delimiter), [])).resolves.toBe(executable);
  });

  it('skips missing and non-executable candidates, and returns null if none are usable', async () => {
    const directory = await fixtureDirectory();
    const missing = join(directory, 'missing');
    const nonExecutable = join(directory, 'blocked');
    const executable = join(directory, 'usable');
    await writeFile(nonExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    await writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await expect(resolveExecutable('missing', directory, [missing, nonExecutable])).resolves.toBeNull();
    await expect(resolveExecutable('missing', directory, [nonExecutable, executable])).resolves.toBe(executable);
  });

  it.each(['missing', 'non-executable', 'missing-cwd'] as const)('settles a real spawn error for %s', async (failure) => {
    const directory = await fixtureDirectory();
    const blocked = join(directory, 'blocked');
    await writeFile(blocked, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    const executable = failure === 'missing' ? join(directory, 'missing') : failure === 'non-executable' ? blocked : process.execPath;
    const result = await createProcessRunner().run(executable, ['-e', 'process.exit(0)'], {
      timeoutMs: 2_000, maxOutputBytes: 17,
      ...(failure === 'missing-cwd' ? { cwd: join(directory, 'missing-directory') } : {}),
    });
    expect(result).toEqual({ exitCode: null, stdout: '', stderr: '', timedOut: false });
  });
});
