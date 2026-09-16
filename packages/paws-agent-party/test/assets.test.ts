import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetStore, MAX_IMAGE_BYTES } from '../src/server/assets.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function store(): Promise<AssetStore> {
  const dir = await mkdtemp(join(tmpdir(), 'paws-agent-party-assets-'));
  dirs.push(dir);
  return new AssetStore(dir);
}

describe('AssetStore', () => {
  it('rejects unsupported image content before allocating an asset', async () => {
    const assets = await store();

    await expect(assets.put({ name: 'notes.txt', mimeType: 'text/plain', bytes: new Uint8Array([1]) }))
      .rejects.toThrow('PNG, JPEG, or WebP');
    expect(await assets.list()).toEqual([]);
  });

  it('rejects an image larger than 10 MiB before writing it', async () => {
    const assets = await store();

    await expect(assets.put({
      name: 'huge.png',
      mimeType: 'image/png',
      bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
    })).rejects.toThrow('10 MiB');
    expect(await assets.list()).toEqual([]);
  });

  it('binds references to stored metadata and reads only a known asset id', async () => {
    const assets = await store();
    const ref = await assets.put({ name: '../chart.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) });

    expect(ref.name).toBe('chart.png');
    await expect(assets.resolve({ ...ref, size: 4 })).rejects.toThrow('does not match');
    expect([...await assets.read(ref.id)]).toEqual([1, 2, 3]);
    await expect(assets.read('../metadata')).rejects.toThrow('Unknown image');
    expect((await stat(join(assets.directory, ref.id))).mode & 0o077).toBe(0);
    expect(JSON.parse(await readFile(join(assets.directory, 'metadata.json'), 'utf8'))).toHaveProperty(ref.id);
  });
});
