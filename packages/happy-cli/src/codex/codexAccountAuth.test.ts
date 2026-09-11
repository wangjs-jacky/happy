import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodexAccountAuth } from './codexAccountAuth';

const auth = { tokens: { id_token: 'fake-id', access_token: 'fake-access', refresh_token: 'fake-refresh', account_id: 'fake-account' } };
const homes: string[] = [];
async function home() { const h = await mkdtemp(join(tmpdir(), 'codex-auth-test-')); homes.push(h); return h; }
afterEach(async () => { await Promise.all(homes.splice(0).map(h => rm(h, { recursive: true, force: true }))); });

describe('readCodexAccountAuth', () => {
  it('reads only the selected home and preserves the complete valid auth record', async () => {
    const h = await home();
    await writeFile(join(h, 'auth.json'), JSON.stringify(auth));
    expect(await readCodexAccountAuth(h)).toEqual(auth);
  });
  it.each(['{secret-canary', '{}', JSON.stringify({ tokens: { access_token: 'secret-canary' } }), JSON.stringify({ ...auth, injected: 'secret-canary' }), ' '.repeat(65537)])('rejects malformed, incomplete, unknown-field and oversized files without echoing content', async value => {
    const h = await home(); await writeFile(join(h, 'auth.json'), value);
    await expect(readCodexAccountAuth(h)).rejects.toThrow('Invalid Codex auth.json');
    try { await readCodexAccountAuth(h); } catch (e) { expect(String(e)).not.toContain('secret-canary'); }
  });
  it('rejects missing, directory and symlink credentials', async () => {
    const h = await home();
    await expect(readCodexAccountAuth(h)).rejects.toThrow();
    await mkdir(join(h, 'auth.json'));
    await expect(readCodexAccountAuth(h)).rejects.toThrow();
    const other = await home(); await writeFile(join(other, 'auth.json'), JSON.stringify(auth));
    const linked = await home(); await symlink(join(other, 'auth.json'), join(linked, 'auth.json'));
    await expect(readCodexAccountAuth(linked)).rejects.toThrow();
  });
});
