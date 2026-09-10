import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Call inside an Ego nodejs round after selecting the task space and exact tab.
 * Keep screenshot bytes in this invocation: Ego's default disk screenshot name
 * is shared across invocations, so copying it after capture is already too late.
 * Re-selects only the caller's recorded numeric space; never creates, claims,
 * or recovers a missing/user-controlled workspace.
 */
export async function captureVerifiedBrowserStep({ cdp, pageInfo, currentTab, listTaskSpaces, useOrCreateTaskSpace }, expectedUrl, context) {
    if (!context || !Number.isSafeInteger(context.taskSpaceId) || context.taskSpaceId <= 0
        || !context.targetId || !context.sessionId || !context.runId
        || !['ego-browser', 'ego-ops'].includes(context.skillName)) {
        throw new Error('Explicit sessionId, runId, skillName, numeric taskSpaceId and targetId are required');
    }
    const { sessionId, runId, skillName, taskSpaceId, targetId } = context;
    const verifySpace = async () => {
        const spaces = await listTaskSpaces();
        const space = spaces.find(space => space.id === taskSpaceId);
        if (!space || space.ownership !== 'agent') {
            throw new Error('Expected task space is missing or no longer agent-owned; stop and ask the user');
        }
    };
    if (typeof expectedUrl !== 'string' || !expectedUrl.trim()) {
        throw new Error('An explicit expected URL is required for browser evidence');
    }
    const url = new URL(expectedUrl).href;
    await verifySpace();
    // URL equality alone cannot establish task ownership. Pin the explicitly
    // recorded space first; currentTab must then be its recorded exact target.
    const selectedSpace = await useOrCreateTaskSpace(taskSpaceId);
    if (selectedSpace.id !== taskSpaceId) throw new Error('Selected task space does not match the recorded task');
    const info = await pageInfo();
    if (info?.dialog || !(info?.w > 0 && info?.h > 0)) {
        throw new Error('Cannot capture browser evidence with a dialog or empty viewport');
    }
    const before = await currentTab();
    if (before?.targetId !== targetId || info.url !== url || before.url !== url) {
        throw new Error('Browser evidence targetId or URL does not match the expected page');
    }
    const screenshot = await cdp('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false,
    });
    const after = await currentTab();
    const finalInfo = await pageInfo();
    await verifySpace();
    if (after?.targetId !== before.targetId || after?.url !== url || finalInfo?.url !== url || finalInfo?.dialog) {
        throw new Error('Browser tab or URL changed during capture; discard and re-verify the target');
    }
    const bytes = Buffer.from(typeof screenshot?.data === 'string' ? screenshot.data : '', 'base64');
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
        throw new Error('Ego did not return a PNG screenshot');
    }
    const directory = await mkdtemp(join(tmpdir(), 'paws-browser-step-'));
    const path = join(directory, 'screenshot.png');
    try {
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        await writeFile(join(directory, 'evidence.json'), JSON.stringify({
            version: 1, sessionId, runId, skillName, taskSpaceId, targetId, url,
            sha256: createHash('sha256').update(bytes).digest('hex'),
        }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
    return { path, url, targetId, taskSpaceId, sessionId, runId, skillName };
}
