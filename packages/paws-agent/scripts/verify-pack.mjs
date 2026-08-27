import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageDir, '../..');
const workspace = await mkdtemp(join(tmpdir(), 'paws-agent-pack-'));
const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));

async function run(command, args, options = {}) {
    try {
        return await exec(command, args, {
            cwd: options.cwd ?? packageDir,
            env: { ...process.env, ...options.env },
            maxBuffer: 10 * 1024 * 1024,
        });
    } catch (error) {
        const details = [error.stdout, error.stderr].filter(Boolean).join('\n');
        throw new Error(`${command} ${args.join(' ')} failed${details ? `:\n${details}` : ''}`, { cause: error });
    }
}

await run('pnpm', ['run', 'build']);
const packed = await run('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', workspace,
]);
const packResult = JSON.parse(packed.stdout)[0];
const tarball = join(workspace, packResult.filename);

const listing = packResult.files.map(file => `package/${file.path}`);
for (const required of [
    'package/package.json',
    'package/bin/paws-agent.mjs',
    'package/dist/index.mjs',
    'package/dist/index.cjs',
    'package/dist/index.d.mts',
    'package/dist/index.d.cts',
    'package/dist/browser.mjs',
    'package/dist/node.mjs',
]) {
    if (!listing.includes(required)) throw new Error(`Packed artifact is missing ${required}`);
}
if (listing.some(entry => entry.includes('/src/') || entry.includes('.test.'))) {
    throw new Error('Packed artifact contains source or test files');
}

await run('npm', ['publish', '--dry-run', '--json', '--ignore-scripts', '--tag', 'next', tarball], { cwd: workspace });
await run('npm', ['init', '-y'], { cwd: workspace });
await run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', tarball,
], { cwd: workspace });
await run('npm', [
    'exec', '--yes', '--package=publint@0.3.24', '--', 'publint',
    join(workspace, 'node_modules/@wangjs-jacky/paws-agent'),
], { cwd: workspace });

await copyFile(join(packageDir, 'test/consumer/esm/index.mjs'), join(workspace, 'esm.mjs'));
await copyFile(join(packageDir, 'test/consumer/cjs/index.cjs'), join(workspace, 'cjs.cjs'));
for (const entry of ['esm.mjs', 'cjs.cjs']) {
    const result = await run(process.execPath, [join(workspace, entry)], { cwd: workspace });
    if (result.stdout || result.stderr) throw new Error(`${entry} produced import-time output`);
}

const cli = join(workspace, 'node_modules/.bin/paws-agent');
const version = await run(cli, ['--version'], { cwd: workspace });
if (version.stdout.trim() !== manifest.version) throw new Error(`Unexpected CLI version: ${version.stdout.trim()}`);
const help = await run(cli, ['--help'], { cwd: workspace });
if (!help.stdout.includes('paws-agent') || !help.stdout.includes('approve')) {
    throw new Error('Packed CLI help is incomplete');
}

const browserDir = join(workspace, 'browser');
await mkdir(browserDir);
await copyFile(join(packageDir, 'test/browser/main.ts'), join(browserDir, 'main.ts'));
await copyFile(join(packageDir, 'test/browser/index.html'), join(browserDir, 'index.html'));
const esbuild = join(repositoryRoot, 'node_modules/.bin/esbuild');
await run(esbuild, [
    join(browserDir, 'main.ts'), '--bundle', '--platform=browser', '--format=iife',
    `--outfile=${join(browserDir, 'bundle.js')}`,
], { cwd: workspace });
const browserBundle = await readFile(join(browserDir, 'bundle.js'), 'utf8');
for (const forbidden of ['node:', 'Buffer.from', 'process.env', 'paws-agent auth login']) {
    if (browserBundle.includes(forbidden)) throw new Error(`Browser bundle contains forbidden token: ${forbidden}`);
}

const { chromium } = await import('playwright');
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let executablePath = process.env.PAWS_CHROMIUM_EXECUTABLE;
if (!executablePath) {
    try {
        await access(systemChrome, constants.X_OK);
        executablePath = systemChrome;
    } catch {
        executablePath = undefined;
    }
}
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(browserDir, 'index.html')).href);
    await page.waitForFunction(() => window.__PAWS_AGENT_VERIFY__ === 'ready');
} finally {
    await browser.close();
}

const bytes = await readFile(tarball);
const checksum = createHash('sha256').update(bytes).digest('hex');
await writeFile(join(workspace, 'SHA256SUMS'), `${checksum}  ${packResult.filename}\n`);

process.stdout.write(JSON.stringify({
    package: manifest.name,
    version: manifest.version,
    tarball,
    sha256: checksum,
    files: listing.length,
    checks: ['metadata', 'dry-run', 'publint', 'esm', 'cjs', 'cli', 'browser-bundle', 'chromium'],
}, null, 2) + '\n');
