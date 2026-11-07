import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { encrypt, decrypt, encodeBase64, decodeBase64 } from '@/api/encryption';
import { ArtifactStore } from './store';
import { registerArtifactHandlers } from './rpc';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
it('serves durable versions over both encrypted variants, with bounded requests and session scope checks', async () => {
  for (const variant of ['dataKey', 'legacy'] as const) {
    const dir = await mkdtemp(join(tmpdir(), 'paws-artifact-rpc-')); dirs.push(dir); const root = join(dir, 'project'); await mkdir(root); await writeFile(join(root, 'a.md'), 'first');
    const key = randomBytes(32), store = new ArtifactStore({ storage: join(dir, 'store'), accountScope: 'a'.repeat(64), inventory: async () => [] });
    const manager = new RpcHandlerManager({ scopePrefix: 'test', encryptionKey: key, encryptionVariant: variant, logger: () => {} });
    registerArtifactHandlers(manager, async () => store, root);
    const call = async (method: string, input: unknown): Promise<any> => decrypt(key, variant, decodeBase64(await manager.handleRequest({ method: `test:${method}`, params: encodeBase64(encrypt(key, variant, input)) })));
    expect(await call('artifactCapabilities', {})).toMatchObject({ ok: true, value: { protocol: 1, formats: ['html', 'markdown'] } });
    const reg = await call('artifactRegister', { root, entryPath: 'a.md', managedPaths: ['a.md'], operationId: 'register' }); expect(reg.ok).toBe(true);
    const ref = { workspaceId: reg.value.workspaceId, artifactId: reg.value.id };
    const read = await call('artifactRead', ref);
    const saved = await call('artifactSave', { ...ref, operationId: 'save', expectedRevision: read.value.workingRevision, entryContent: 'second' });
    expect(saved.ok).toBe(true);
    expect((await call('artifactVersions', ref)).value.versions).toHaveLength(2);
    expect((await call('artifactRead', { ...ref, versionId: reg.value.currentVersionId })).value.entryContent).toBe('first');
    expect(await call('artifactResourceRead', { ...ref, readRef: read.value.readRef, path: 'a.md', offset: 0, length: 256 * 1024 + 1 })).toMatchObject({ ok: false });
    expect(await call('artifactRegister', { root: dir, entryPath: 'project/a.md', managedPaths: ['project/a.md'], operationId: 'escape' })).toMatchObject({ ok: false, error: { code: 'PATH_OUT_OF_BOUNDS' } });
  }
});
