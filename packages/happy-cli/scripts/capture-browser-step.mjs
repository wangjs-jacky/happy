import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Call inside an Ego nodejs round after selecting the task space and exact tab.
 * Keep screenshot bytes in this invocation: Ego's default disk screenshot name
 * is shared across invocations, so copying it after capture is already too late.
 * This helper never selects, claims, or recovers a workspace.
 */
export async function captureVerifiedBrowserStep({ cdp, pageInfo, currentTab }, expectedUrl) {
    if (typeof expectedUrl !== 'string' || !expectedUrl.trim()) {
        throw new Error('An explicit expected URL is required for browser evidence');
    }
    const url = new URL(expectedUrl).href;
    const info = await pageInfo();
    if (info?.dialog || !(info?.w > 0 && info?.h > 0)) {
        throw new Error('Cannot capture browser evidence with a dialog or empty viewport');
    }
    const before = await currentTab();
    if (!before?.targetId || info.url !== url || before.url !== url) {
        throw new Error('Browser evidence URL does not match the expected page');
    }
    const screenshot = await cdp('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false,
    });
    const after = await currentTab();
    const finalInfo = await pageInfo();
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
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
    return { path, url, targetId: before.targetId };
}
