import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const packageDir = resolve(repoRoot, 'packages/paws-agent-chrome');
const packageJson = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
const protocolHarness = await readFile(resolve(packageDir, 'scripts/e2e.mjs'), 'utf8');
const egoHarness = await readFile(resolve(packageDir, 'scripts/egoE2e.mjs'), 'utf8');

for (const path of [
    'scripts/build.mjs',
    'scripts/e2e.mjs',
    'scripts/egoE2e.mjs',
    'scripts/smoke.mjs',
    'test/e2eFixtureServer.mjs',
]) {
    await access(resolve(packageDir, path), constants.R_OK);
}

for (const script of ['verify', 'test:e2e', 'test:e2e:record', 'test:e2e:ego', 'test:e2e:ego:record']) {
    assert.equal(typeof packageJson.scripts?.[script], 'string', `missing package script ${script}`);
}
assert.match(packageJson.scripts['test:e2e:ego'], /PAWS_EXTENSION_INCLUDE_LOCALHOST=1/, 'Ego test build must inject loopback permission explicitly');

for (const marker of [
    'PAWS-CHROME-BUBBLE-01',
    'requestResolutionCalls',
    'stored credentials must survive reload',
    'page errors',
]) {
    assert.match(protocolHarness, new RegExp(escapeRegExp(marker)), `protocol harness lost assertion marker: ${marker}`);
}

for (const marker of [
    'PAWS-EGO-LITE-HOST-01',
    'chrome-extension:',
    'paws-agent.credentials',
    'full Ego Lite process restart reconnect',
    "process.kill(-child.pid, 'SIGTERM')",
]) {
    assert.match(egoHarness, new RegExp(escapeRegExp(marker)), `Ego harness lost assertion marker: ${marker}`);
}

process.stdout.write(JSON.stringify({
    contract: 'paws-agent-extension-e2e-skill',
    status: 'pass',
    package: packageJson.name,
    cases: ['PAWS-CHROME-BUBBLE-01', 'PAWS-EGO-LITE-HOST-01'],
}, null, 2) + '\n');

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
