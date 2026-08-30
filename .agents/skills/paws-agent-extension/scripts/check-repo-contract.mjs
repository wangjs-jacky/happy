import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const sdkPackagePath = resolve(repoRoot, 'packages/paws-agent/package.json');
const sdkIndexPath = resolve(repoRoot, 'packages/paws-agent/src/index.ts');
const sdkBrowserPath = resolve(repoRoot, 'packages/paws-agent/src/browser.ts');
const chromePackagePath = resolve(repoRoot, 'packages/paws-agent-chrome/package.json');

const sdkPackage = JSON.parse(await readFile(sdkPackagePath, 'utf8'));
const chromePackage = JSON.parse(await readFile(chromePackagePath, 'utf8'));
const sdkIndex = await readFile(sdkIndexPath, 'utf8');
const sdkBrowser = await readFile(sdkBrowserPath, 'utf8');

assert.equal(sdkPackage.name, '@wangjs-jacky/paws-agent');
for (const entry of ['.', './browser', './node']) {
    assert.ok(sdkPackage.exports?.[entry], `missing public SDK export ${entry}`);
}
for (const script of ['typecheck', 'build', 'test']) {
    assert.equal(typeof sdkPackage.scripts?.[script], 'string', `missing SDK script ${script}`);
}
for (const symbol of ['PawsAgentClient', 'CredentialProvider', 'PawsAgentEvent', 'SpawnSessionResult']) {
    assert.match(sdkIndex, new RegExp(`\\b${symbol}\\b`), `missing core export ${symbol}`);
}
for (const symbol of ['BrowserCredentialProvider', 'startBrowserAccountLink']) {
    assert.match(sdkBrowser, new RegExp(`\\b${symbol}\\b`), `missing browser export ${symbol}`);
}
assert.equal(chromePackage.dependencies?.['@wangjs-jacky/paws-agent'], 'workspace:*');
assert.equal(typeof chromePackage.scripts?.verify, 'string', 'Chrome exemplar must keep a static verify gate');

process.stdout.write(JSON.stringify({
    contract: 'paws-agent-extension-skill',
    status: 'pass',
    sdk: sdkPackage.name,
    entrypoints: ['.', './browser', './node'],
    exemplar: chromePackage.name,
}, null, 2) + '\n');
