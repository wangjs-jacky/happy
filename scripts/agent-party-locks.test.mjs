import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('stopped service locks are preserved while durable and unrelated files remain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'party-lock-recovery-'));
  try {
    const data = join(root, 'data');
    const backup = join(root, 'backup');
    for (const dir of ['public-shell', 'accounts/owner', 'unrelated']) await mkdir(join(data, dir), { recursive: true });
    for (const path of ['public-shell/service.lock', 'accounts/owner/service.lock', 'unrelated/service.lock', 'public-shell/history.json']) await writeFile(join(data, path), path);
    const script = await readFile(new URL('./deploy-agent-party.sh', import.meta.url), 'utf8');
    const fn = script.match(/preserve_stopped_service_locks\(\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(fn);
    const result = spawnSync('bash', ['-eu', '-s', '--', data, backup], { input: `${fn}\ndata="$1"\npreserve_stopped_service_locks "$2"\npreserve_stopped_service_locks "$2"\n`, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const path of ['public-shell/service.lock', 'accounts/owner/service.lock']) {
      assert.equal(await readFile(join(backup, path), 'utf8'), path);
      await assert.rejects(access(join(data, path)));
    }
    for (const path of ['unrelated/service.lock', 'public-shell/history.json']) assert.equal(await readFile(join(data, path), 'utf8'), path);
    assert.ok(script.indexOf('data_backed_up=1\npreserve_stopped_service_locks') > script.indexOf('docker stop --time 30'));
    assert.match(script, /tar -xzf.*\n\s+preserve_stopped_service_locks "\$backup\/rollback-locks"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
