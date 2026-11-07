import { watch } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { ArtifactStore, type ArtifactWorker } from './store';
import { ArtifactError, digest, inside } from './files';
import { configuration } from '@/configuration';
import { readArtifactWorkerInventory } from '@/daemon/controlClient';
import { getMountedVolumePaths } from '@/modules/common/browseHomeDirectory';
import type { ArtifactChanged } from '@slopus/happy-wire';

export function artifactAccountScope(identity: Uint8Array, serverUrl: string, machineId: string) {
  return digest(JSON.stringify(['artifact-account-v1', new URL(serverUrl).origin, machineId, digest(Buffer.from(identity))]));
}
export function createArtifactRuntime(identity: Uint8Array | undefined, machineId: string | undefined, onChanged?: (event: ArtifactChanged) => void | Promise<void>) {
  let initialized: Promise<ArtifactStore> | undefined;
  const getStore = () => {
    if (process.platform !== 'darwin' && process.platform !== 'linux') return Promise.reject(new ArtifactError('UNAVAILABLE', 'Artifact version leases currently support macOS and Linux execution hosts'));
    if (!identity || !machineId) return Promise.reject(new ArtifactError('UNAVAILABLE', 'This worker has no stable artifact account identity'));
    initialized ??= (async () => {
      const store = new ArtifactStore({ storage: join(configuration.happyHomeDir, 'artifact-workspaces'), accountScope: artifactAccountScope(identity, configuration.serverUrl, machineId), inventory: readArtifactWorkerInventory, onChanged });
      try { await store.recover(); }
      catch (error) { if (!(error instanceof ArtifactError) || error.code !== 'WRITER_ACTIVE') throw error; }
      // A busy startup lock does not disable the event subscription. Pending
      // journals still fail closed in every mutation until explicitly resolved.
      return store;
    })();
    return initialized.catch(error => { initialized = undefined; throw error; });
  };
  return { getStore, supported: process.platform === 'darwin' || process.platform === 'linux' };
}

export async function authorizeArtifactRoot(root: string) {
  const roots = [homedir(), ...await getMountedVolumePaths()];
  for (const candidate of roots) { try { if (inside(await realpath(candidate), root)) return; } catch {} }
  throw new ArtifactError('PATH_OUT_OF_BOUNDS', 'Choose a workspace under the home directory or a mounted volume');
}

/** One filesystem invalidation event per durable catalog replacement; no business polling. */
export function watchArtifactChanges(getStore: () => Promise<ArtifactStore>, onChanges: (events: ArtifactChanged[]) => void | Promise<void>) {
  let disposed = false;
  let watcher: ReturnType<typeof watch> | undefined;
  let reading = false, invalidated = false;
  const seen = new Map<string, number>();
  const refresh = async () => {
    if (disposed) return;
    if (reading) { invalidated = true; return; }
    reading = true;
    try {
      const changes = await (await getStore()).invalidations();
      const events = changes.filter(event => (seen.get(event.workspaceId + ":" + event.artifactId) ?? -1) < event.sequence);
      for (const event of events) seen.set(event.workspaceId + ":" + event.artifactId, event.sequence);
      if (!disposed && events.length) await onChanges(events.slice(-64));
    } catch { /* A lock contention can coalesce events; RPC and reconnect single reads repair it. */ }
    finally { reading = false; if (invalidated) { invalidated = false; void refresh(); } }
  };
  // The directory is established by getStore. Start only once, on connection.
  void getStore().then(() => {
    if (disposed) return;
    watcher = watch(join(configuration.happyHomeDir, 'artifact-workspaces'), { persistent: false }, (_event, filename) => { if (filename === 'catalog.json') void refresh(); });
    watcher.on('error', () => {}); void refresh();
  }).catch(() => {});
  return { dispose() { disposed = true; watcher?.close(); } };
}
