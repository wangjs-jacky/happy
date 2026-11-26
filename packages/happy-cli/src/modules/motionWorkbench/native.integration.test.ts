/** Opt-in native test: unpack into a fresh disposable project, never edit the input archive. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createMotionWorkbenchHandlers } from './bridge';

const executable = process.env.PAWS_MOTIONHARNESS_BIN;
const archivePath = process.env.PAWS_MOTIONHARNESS_TEST_ARCHIVE;
const execute = promisify(execFile);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe.skipIf(!executable || !archivePath)('installed MotionHarness review roundtrip', () => {
    it('reads a real annotation, prepares without saving and rejects an edited instruction', async () => {
        if (!executable || !archivePath) throw new Error('Set PAWS_MOTIONHARNESS_BIN and PAWS_MOTIONHARNESS_TEST_ARCHIVE');
        const archive = await realpath(archivePath);
        const before = sha256(await readFile(archive));
        const root = await realpath(await mkdtemp(join(tmpdir(), 'paws-motion-native-')));
        const project = join(root, 'project');
        const options = { cwd: root, env: { ...process.env, MH_NO_BROWSER: '1', MH_NO_UPDATE_NOTIFIER: '1' }, timeout: 30000, maxBuffer: 1024 * 1024 };
        let engineStarted = false;
        try {
            await execute(executable, ['unpack', archive, project], options);
            // A CLI command may start the engine even if its response is lost.
            engineStarted = true;
            const created = await execute(executable, ['marker', 'edit', '--project', project, '--json', JSON.stringify({
                operation: 'upsert', markers: [{ id: 'paws-integration-test', label: 'Paws integration fixture', notes: 'Verify the review bridge only.',
                    timeSpace: 'project', start: 1.6, origin: 'user', anchor: { x: 500, y: 300, width: 120, height: 80 }, onResolve: 'keep' }],
            })], options);
            expect(JSON.parse(created.stdout).displayed).toBe(false);
            const handlers = createMotionWorkbenchHandlers(root, executable);
            const first = await handlers.inspect({ projectPath: project });
            expect(first.ok).toBe(true);
            if (!first.ok) throw new Error(JSON.stringify(first));
            const marker = first.value.markers.find(item => item.id === 'paws-integration-test');
            expect(marker).toBeDefined();
            if (!marker) throw new Error('Native test annotation missing');
            expect(marker.anchor).toEqual({ x: 500, y: 300, width: 120, height: 80 });
            const request = { projectPath: project, projectId: first.value.projectId, snapshotHash: first.value.snapshotHash,
                markers: [{ id: marker.id, requestVersion: marker.requestVersion }] };
            const prepared = await handlers.prepareReview(request);
            expect(prepared.ok).toBe(true);
            if (!prepared.ok) throw new Error(JSON.stringify(prepared));
            expect(prepared.value.prompt).toContain(marker.label);
            const afterPrepare = await handlers.inspect({ projectPath: project });
            expect(afterPrepare).toEqual(first);
            await execute(executable, ['marker', 'edit', '--project', project, '--json', JSON.stringify({
                operation: 'upsert', markers: [{ id: marker.id, notes: 'The user changed the review while it was open.' }],
            })], options);
            expect(await handlers.prepareReview(request)).toMatchObject({ ok: false, error: { code: 'STALE_REVIEW' } });
            const next = await handlers.inspect({ projectPath: project });
            expect(next.ok).toBe(true);
            if (!next.ok) throw new Error(JSON.stringify(next));
            expect(next.value.snapshotHash).not.toBe(first.value.snapshotHash);
            expect(next.value.markers.find(item => item.id === marker.id)?.requestVersion).not.toBe(marker.requestVersion);
            expect(sha256(await readFile(archive))).toBe(before);
        } finally {
            if (engineStarted) await execute(executable, ['close', '--project', project], options);
            await rm(root, { recursive: true, force: true });
        }
    }, 120000);
});
