import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

const state = vi.hoisted(() => ({ watcherStarted: undefined as undefined | (() => void), onClose: undefined as undefined | (() => void) }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    watch: (...args: Parameters<typeof actual.watch>) => {
      const watcher = actual.watch(...args);
      const close = watcher.close.bind(watcher);
      watcher.close = () => {
        state.onClose?.();
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
        close();
      };
      state.watcherStarted?.();
      return watcher;
    },
  };
});

import { withMachineLock } from './files';

let directory = '';
afterEach(async () => { state.watcherStarted = undefined; state.onClose = undefined; if (directory) await rm(directory, { recursive: true, force: true }); });

it('releases the machine lock before a slow watcher cleanup', async () => {
  directory = await mkdtemp(join(tmpdir(), 'paws-slow-watch-'));
  let release!: () => void;
  let started!: () => void;
  const acquired = new Promise<void>(resolve => { started = resolve; });
  const holder = withMachineLock(directory, async () => {
    started();
    await new Promise<void>(resolve => { release = resolve; });
  });
  await acquired;
  const watching = new Promise<void>(resolve => { state.watcherStarted = resolve; });
  let lockPresentDuringClose: boolean | undefined;
  state.onClose = () => { lockPresentDuringClose = existsSync(join(directory, 'machine.lock')); };
  const waiter = withMachineLock(directory, async () => 'completed', { waitTimeoutMs: 5000 });
  try {
    await watching;
    release();
    await holder;
    expect(await waiter).toBe('completed');
    expect(lockPresentDuringClose).toBe(false);
  } finally {
    release();
    await Promise.allSettled([holder, waiter]);
  }
});
