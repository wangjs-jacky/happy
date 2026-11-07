import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const settings = vi.hoisted(() => ({ happyHomeDir: '', serverUrl: 'https://example.test' }));
vi.mock('@/configuration', () => ({ configuration: settings }));
vi.mock('@/daemon/controlClient', () => ({ readArtifactWorkerInventory: async () => [] }));
import { createArtifactRuntime, watchArtifactChanges } from './runtime';
import { withMachineLock } from './files';
let directory: string;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
it('retains the invalidation watcher when startup races a live machine lock', async () => {
  directory = await mkdtemp(join(tmpdir(), 'paws-version-events-')); settings.happyHomeDir = join(directory, 'home'); await mkdir(settings.happyHomeDir);
  const root = join(directory, 'project'); await mkdir(root); await writeFile(join(root, 'a.md'), 'one');
  const runtime = createArtifactRuntime(new Uint8Array(32).fill(1), 'machine');
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const held = withMachineLock(join(settings.happyHomeDir, 'artifact-workspaces'), async () => { started(); await new Promise<void>(resolve => { release = resolve; }); });
  await ready;
  let store;
  try { store = await runtime.getStore(); } finally { release(); await held; }
  let watcher: { dispose(): void } | undefined;
  const event = new Promise<any>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Missing artifact invalidation event')), 5000);
    watcher = watchArtifactChanges(runtime.getStore, events => { clearTimeout(deadline); resolve(events); });
  });
  try {
    const artifact = await store!.register({ root, entryPath: 'a.md', managedPaths: ['a.md'], operationId: 'register' });
    expect((await event)[0]).toMatchObject({ artifactId: artifact.id, currentVersionId: artifact.currentVersionId });
  } finally { watcher?.dispose(); }
});
