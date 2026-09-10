import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';

const evidenceSchema = z.object({
    version: z.literal(1),
    sessionId: z.string().min(1),
    runId: z.string().trim().min(1).max(128),
    skillName: z.enum(['ego-browser', 'ego-ops']),
    taskSpaceId: z.number().int().positive(),
    targetId: z.string().min(1),
    url: z.string().url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Verify the capture receipt against the receiving session before any upload. */
export async function readBrowserStepEvidence(input: {
    path: string; runId: string; skillName: 'ego-browser' | 'ego-ops';
}, sessionId: string) {
    const directory = dirname(input.path);
    if (!isAbsolute(input.path) || basename(input.path) !== 'screenshot.png'
        || !/^paws-browser-step-[a-zA-Z0-9]+$/.test(basename(directory))) {
        throw new Error('Use the exact private path returned by captureVerifiedBrowserStep; shared or copied screenshots are not accepted');
    }
    const receiptPath = join(directory, 'evidence.json');
    const [imageStat, receiptStat, directoryStat] = await Promise.all([lstat(input.path), lstat(receiptPath), lstat(directory)]);
    if (!imageStat.isFile() || !receiptStat.isFile() || !directoryStat.isDirectory()
        || imageStat.nlink !== 1 || receiptStat.nlink !== 1) {
        throw new Error('Browser evidence must be original private files, not links');
    }
    if (process.platform !== 'win32' && [imageStat, receiptStat, directoryStat].some(s => (s.mode & 0o077) !== 0)) {
        throw new Error('Browser evidence files must be private to the current user');
    }
    const [bytes, receipt] = await Promise.all([readFile(input.path), readFile(receiptPath, 'utf8')]);
    const evidence = evidenceSchema.parse(JSON.parse(receipt));
    if (evidence.sessionId !== sessionId || evidence.runId !== input.runId || evidence.skillName !== input.skillName) {
        throw new Error('Browser evidence belongs to another session, run or skill');
    }
    if (createHash('sha256').update(bytes).digest('hex') !== evidence.sha256
        || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
        throw new Error('Browser screenshot changed after capture or is not a PNG');
    }
    return { bytes, evidence };
}
