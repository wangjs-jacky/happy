import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const buildModulePath = resolve(import.meta.dirname, '../../scripts/build-atomic.cjs');
const temporaryDirectories: string[] = [];

function makePackageDir(): string {
    const packageDir = mkdtempSync(join(tmpdir(), 'paws-atomic-build-'));
    temporaryDirectories.push(packageDir);
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    writeFileSync(join(packageDir, 'dist/index.mjs'), 'old entry');
    writeFileSync(join(packageDir, 'dist/old-chunk.mjs'), 'old chunk');
    return packageDir;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('atomic CLI build', () => {
    it.each(['index.mjs', 'codexWorkerEntry.mjs'])('executes Codex orchestration exactly once through the built %s artifact', (artifact) => {
        const probeHome = mkdtempSync(join(tmpdir(), 'paws-entry-once-'));
        temporaryDirectories.push(probeHome);
        const guardPath = join(probeHome, 'guard.cjs');
        writeFileSync(guardPath, `
            const fs = require('node:fs');
            const append = fs.appendFileSync;
            fs.appendFileSync = function (path, value, ...args) {
                if (String(value).includes('[AUTH]')) process.exit(86);
                return append.call(this, path, value, ...args);
            };
            require('node:net').Socket.prototype.connect = function () { process.exit(87); };
            require('node:module').syncBuiltinESMExports();
        `);

        const result = spawnSync(process.execPath, [
            '--no-warnings', '--no-deprecation', '--require', guardPath,
            resolve(import.meta.dirname, '../../dist', artifact), 'codex', 'usage',
        ], {
            cwd: probeHome,
            env: {
                PATH: process.env.PATH,
                HOME: probeHome,
                HAPPY_HOME_DIR: join(probeHome, 'happy'),
                CODEX_HOME: join(probeHome, 'codex'),
                HAPPY_SERVER_URL: 'http://127.0.0.1:1',
            },
            encoding: 'utf8',
            // This checks dispatch multiplicity, not startup speed. Allow cold
            // dependency loading while other unit-test workers occupy the host.
            timeout: 60_000,
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout.match(/^Codex usage source:/gm) ?? []).toHaveLength(1);
        expect(result.stdout.match(/^Today: no local Codex token events found$/gm) ?? []).toHaveLength(1);
    }, 65_000);

    it('requires the worker artifact from the published manifest before promoting any CLI output', () => {
        const packageDir = makePackageDir();
        const { collectDistOutputs, runAtomicBuild } = require(buildModulePath);
        const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'));
        const requiredOutputs = collectDistOutputs(manifest);

        expect(requiredOutputs).toEqual(expect.arrayContaining([
            'index.mjs', 'codexWorkerEntry.mjs', 'codexWorkerEntry.cjs',
            'codexWorkerEntry.d.mts', 'codexWorkerEntry.d.cts',
        ]));
        expect(() => runAtomicBuild({
            packageDir,
            requiredOutputs,
            runTypecheck: () => undefined,
            runBundler: (stagingDist: string) => {
                for (const output of requiredOutputs) {
                    if (output === 'codexWorkerEntry.mjs') continue;
                    const file = join(stagingDist, output);
                    mkdirSync(resolve(file, '..'), { recursive: true });
                    writeFileSync(file, 'new output');
                }
            },
        })).toThrow('Build output is missing: codexWorkerEntry.mjs');
        expect(readFileSync(join(packageDir, 'dist/index.mjs'), 'utf8')).toBe('old entry');
    });

    it('keeps the live dist intact when validation fails', () => {
        const packageDir = makePackageDir();
        const { runAtomicBuild } = require(buildModulePath) as {
            runAtomicBuild: (options: {
                packageDir: string;
                requiredOutputs: string[];
                runTypecheck: () => void;
                runBundler: (stagingDist: string) => void;
            }) => void;
        };

        expect(() => runAtomicBuild({
            packageDir,
            requiredOutputs: ['index.mjs'],
            runTypecheck: () => {
                expect(readFileSync(join(packageDir, 'dist/index.mjs'), 'utf8')).toBe('old entry');
                throw new Error('typecheck failed');
            },
            runBundler: () => {
                throw new Error('bundler must not run');
            },
        })).toThrow('typecheck failed');

        expect(readFileSync(join(packageDir, 'dist/index.mjs'), 'utf8')).toBe('old entry');
    });

    it('promotes a complete build without deleting files used by running processes', () => {
        const packageDir = makePackageDir();
        const { runAtomicBuild } = require(buildModulePath) as {
            runAtomicBuild: (options: {
                packageDir: string;
                requiredOutputs: string[];
                runTypecheck: () => void;
                runBundler: (stagingDist: string) => void;
            }) => void;
        };

        runAtomicBuild({
            packageDir,
            requiredOutputs: ['index.mjs'],
            runTypecheck: () => undefined,
            runBundler: (stagingDist) => {
                expect(readFileSync(join(packageDir, 'dist/index.mjs'), 'utf8')).toBe('old entry');
                mkdirSync(stagingDist, { recursive: true });
                writeFileSync(join(stagingDist, 'index.mjs'), 'new entry');
                writeFileSync(join(stagingDist, 'new-chunk.mjs'), 'new chunk');
            },
        });

        expect(readFileSync(join(packageDir, 'dist/index.mjs'), 'utf8')).toBe('new entry');
        expect(readFileSync(join(packageDir, 'dist/new-chunk.mjs'), 'utf8')).toBe('new chunk');
        expect(readFileSync(join(packageDir, 'dist/old-chunk.mjs'), 'utf8')).toBe('old chunk');
    });
});
