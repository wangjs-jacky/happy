import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./deploy-staging-web.sh', import.meta.url));

test('staging release script parses and rejects invalid rollback revisions before SSH', () => {
    const syntax = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const invalid = spawnSync('bash', [script, '--rollback', 'main'], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /40-character lowercase Git SHA/);
});

test('staging release script targets only the independent site and validates before switching', async () => {
    const source = await readFile(script, 'utf8');
    assert.match(source, /STAGING_ORIGIN='https:\/\/47\.115\.228\.20:8444'/);
    assert.match(source, /caddy validate --config/);
    assert.match(source, /sha256sum "\$caddy_file"/);
    assert.match(source, /prepare_current_release "\$old_revision"/);
    assert.match(source, /restore_caddy/);
    assert.match(source, /mv -Tf "\$root\/current.next" "\$root\/current"/);
    assert.match(source, /flock -x 9/);
    assert.match(source, /Staging changed concurrently/);
    assert.match(source, /--rollback/);
    assert.doesNotMatch(source, /STAGING_ORIGIN=.*:8443/);
});
