import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { deriveKey } from '../../happy-cli/src/utils/deriveKey';
import { encodeBase64, encryptBlob, encryptLegacy } from '../../happy-cli/src/api/encryption';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;
const e2eServerUrl = process.env.HAPPY_E2E_SERVER_URL!;
const evidenceDirectory = process.env.HAPPY_BROWSER_STEPS_EVIDENCE_DIR;
const liveEgoAcceptance = process.env.HAPPY_EGO_LIVE_E2E === '1';
const egoBrowserCommand = process.env.EGO_BROWSER_BIN ?? '/Users/jacky/.local/bin/ego-browser';

function authenticatedRoute(pathname: string): string {
    const url = new URL(authenticatedWebUrl);
    url.pathname = pathname;
    return url.toString();
}

function evidencePath(testInfo: TestInfo, filename: string): string {
    if (!evidenceDirectory) return testInfo.outputPath(filename);
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    return path.join(evidenceDirectory, filename);
}

async function pauseForRecordedReview(page: Page, duration = 900): Promise<void> {
    if (process.env.HAPPY_E2E_RECORD === '1') await page.waitForTimeout(duration);
}

async function installDevelopmentRefreshIndicatorSuppression(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const suppress = () => {
            document.querySelectorAll<HTMLElement>('.__expo_fast_refresh').forEach((element) => {
                element.style.setProperty('visibility', 'hidden', 'important');
            });
        };
        new MutationObserver(suppress).observe(document, {
            attributes: true,
            attributeFilter: ['class'],
            childList: true,
            subtree: true,
        });
        suppress();
    });
}

function getE2ECredentials() {
    const authUrl = new URL(authenticatedWebUrl);
    const token = authUrl.searchParams.get('dev_token');
    const secret = authUrl.searchParams.get('dev_secret');
    if (!token || !secret || !e2eServerUrl) throw new Error('缺少浏览器步骤 E2E 的本地认证配置。');
    return { token, secret: new Uint8Array(Buffer.from(secret, 'base64url')) };
}

async function createE2ESession(request: APIRequestContext): Promise<string> {
    const { token, secret } = getE2ECredentials();
    const metadata = encodeBase64(encryptLegacy({
        path: '/workspace/browser-steps-e2e',
        host: 'playwright-browser-steps.local',
        name: 'Browser step live playback',
        flavor: 'codex',
        lifecycleState: 'running',
        startedBy: 'terminal',
    }, secret));
    const response = await request.post(new URL('/v1/sessions', e2eServerUrl).toString(), {
        data: {
            tag: `browser-steps-e2e-${Date.now()}-${Math.random()}`,
            metadata,
            agentState: null,
            dataEncryptionKey: null,
        },
        headers: { Authorization: `Bearer ${token}`, 'X-Happy-Client': 'playwright-browser-steps' },
    });
    expect(response.ok()).toBe(true);
    return (await response.json() as { session: { id: string } }).session.id;
}

async function uploadImageAttachment(
    request: APIRequestContext,
    sessionId: string,
    filename: string,
    bytes: Uint8Array,
): Promise<{ ref: string; encrypted: Uint8Array }> {
    const { token, secret } = getE2ECredentials();
    const blobKey = await deriveKey(secret, 'Happy Blobs', ['master']);
    const encrypted = encryptBlob(bytes, blobKey);
    const headers = { Authorization: `Bearer ${token}`, 'X-Happy-Client': 'playwright-browser-steps' };
    const descriptorResponse = await request.post(
        new URL(`/v1/sessions/${encodeURIComponent(sessionId)}/attachments/request-upload`, e2eServerUrl).toString(),
        { data: { filename, size: encrypted.length }, headers },
    );
    expect(descriptorResponse.ok()).toBe(true);
    const descriptor = await descriptorResponse.json() as { ref: string; uploadUrl: string; method: 'PUT' | 'POST' };
    expect(descriptor.method).toBe('PUT');
    const uploadResponse = await request.put(new URL(descriptor.uploadUrl, e2eServerUrl).toString(), {
        data: encrypted,
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    });
    expect(uploadResponse.ok()).toBe(true);
    return { ref: descriptor.ref, encrypted };
}

async function installEncryptedAttachmentRoutes(
    page: Page,
    sessionId: string,
    attachments: Map<string, Uint8Array>,
): Promise<void> {
    await page.route(`**/v1/sessions/${sessionId}/attachments/request-download`, async (route) => {
        const { ref } = route.request().postDataJSON() as { ref?: string };
        if (!ref || !attachments.has(ref)) {
            await route.fallback();
            return;
        }
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ downloadUrl: `https://browser-steps.e2e/${encodeURIComponent(ref)}` }),
        });
    });
    await page.route('https://browser-steps.e2e/**', async (route) => {
        const ref = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
        const encrypted = attachments.get(ref);
        if (!encrypted) {
            await route.fulfill({ status: 404 });
            return;
        }
        await route.fulfill({ contentType: 'application/octet-stream', body: Buffer.from(encrypted) });
    });
}

async function appendBrowserStep(
    request: APIRequestContext,
    sessionId: string,
    input: { id: string; ref: string; name: string; label: string; time: number },
): Promise<void> {
    const { token, secret } = getE2ECredentials();
    const envelope = {
        id: input.id,
        time: input.time,
        role: 'agent',
        turn: 'browser-steps-turn',
        ev: {
            t: 'file',
            ref: input.ref,
            name: input.name,
            size: 1,
            mimeType: 'image/png',
            source: 'browser_step',
            browserStep: { label: input.label },
            image: { width: 1280, height: 720, thumbhash: '' },
        },
    };
    const response = await request.post(
        new URL(`/v3/sessions/${encodeURIComponent(sessionId)}/messages`, e2eServerUrl).toString(),
        {
            data: {
                messages: [{
                    content: encodeBase64(encryptLegacy({ role: 'session', content: envelope }, secret)),
                    localId: `${input.id}-${Date.now()}`,
                }],
            },
            headers: { Authorization: `Bearer ${token}`, 'X-Happy-Client': 'playwright-browser-steps' },
        },
    );
    expect(response.ok()).toBe(true);
}

type EgoStepResult = {
    taskSpaceId: number;
    screenshotPath: string;
    count?: number;
    missingTitleCount?: number;
};

function parseLastJsonLine(output: string): EgoStepResult {
    for (const line of output.split(/\r?\n/).map((value) => value.trim()).reverse()) {
        if (!line) continue;
        try {
            const result = JSON.parse(line) as Partial<EgoStepResult>;
            if (typeof result.taskSpaceId === 'number' && typeof result.screenshotPath === 'string') {
                return result as EgoStepResult;
            }
        } catch {
            // Ego emits diagnostics outside cliLog; only its final JSON is protocol output.
        }
    }
    throw new Error('Ego Lite 未返回可验收的步骤结果。');
}

async function runEgoStep(script: string): Promise<EgoStepResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(egoBrowserCommand, ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { stdout += chunk; });
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });
        child.once('error', () => reject(new Error('无法启动 Ego Lite。')));
        child.once('close', (code) => {
            if (code !== 0) {
                reject(new Error('Ego Lite 真实验收步骤失败。'));
                return;
            }
            try {
                resolve(parseLastJsonLine(`${stdout}\n${stderr}`));
            } catch (error) {
                reject(error);
            }
        });
        child.stdin.end(`${script}\n`);
    });
}

function closeEgoTaskSpace(taskSpaceId: number): void {
    // Must remain a dedicated browser heredoc: the browser skill requires cleanup
    // to happen separately from the work that produced the evidence. Ego's GUI
    // transport can retain an inherited stream after this command finishes, so it
    // must not keep the Playwright worker alive after the product assertions pass.
    const child = spawn(egoBrowserCommand, ['nodejs'], {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.unref();
    child.stdin.end(`const result = await completeTaskSpace(${taskSpaceId}, { keep: false });\ncliLog(JSON.stringify(result));\n`);
}

async function reportLiveEgoStep(
    request: APIRequestContext,
    sessionId: string,
    screenshotPath: string,
    label: string,
    index: number,
    attachments: Map<string, Uint8Array>,
): Promise<void> {
    // This is the same encrypted attachment + browser_step envelope emitted by
    // report_browser_step. Keeping it protocol-level avoids importing the full
    // CLI runtime into the Playwright process.
    const attachment = await uploadImageAttachment(
        request,
        sessionId,
        path.basename(screenshotPath),
        fs.readFileSync(screenshotPath),
    );
    attachments.set(attachment.ref, attachment.encrypted);
    await appendBrowserStep(request, sessionId, {
        id: `live-ego-step-${index}`,
        ref: attachment.ref,
        name: path.basename(screenshotPath),
        label,
        time: Date.now() + index,
    });
}

test.setTimeout(120_000);

test('[BROWSER-STEPS-PANEL] 实时回显浏览器截图、保留步骤时间线，并允许回看历史步骤', async ({ page, request }, testInfo) => {
    const sessionId = await createE2ESession(request);
    // Playwright runs from packages/happy-app, so these remain inside the app
    // package instead of assuming the monorepo root as cwd.
    const firstImage = fs.readFileSync(path.join(process.cwd(), 'pr-evidence/session-title-tags/01-desktop-create-option.png'));
    const secondImage = fs.readFileSync(path.join(process.cwd(), 'logo.png'));
    const [firstAttachment, secondAttachment] = await Promise.all([
        uploadImageAttachment(request, sessionId, 'browser-step-01.png', firstImage),
        uploadImageAttachment(request, sessionId, 'browser-step-02.png', secondImage),
    ]);

    await page.setViewportSize({ width: 1440, height: 900 });
    await installDevelopmentRefreshIndicatorSuppression(page);
    await installEncryptedAttachmentRoutes(page, sessionId, new Map([
        [firstAttachment.ref, firstAttachment.encrypted],
        [secondAttachment.ref, secondAttachment.encrypted],
    ]));
    try {
        await page.goto(authenticatedRoute(`/session/${sessionId}`));
        await expect(page.getByTestId('session-message-input')).toBeVisible({ timeout: 30_000 });

        const baseTime = Date.now();
        await appendBrowserStep(request, sessionId, {
            id: 'browser-step-first',
            ref: firstAttachment.ref,
            name: 'browser-step-01.png',
            label: '打开项目概览',
            time: baseTime,
        });
        const panel = page.getByTestId('browser-steps-panel');
        await expect(panel).toBeVisible({ timeout: 30_000 });
        await expect(panel.getByText('实时回显 · 1 步', { exact: true })).toBeVisible();
        await expect(panel.getByTestId('browser-steps-active-label')).toHaveText('打开项目概览');
        await expect(page.getByTestId('browser-steps-preview-image').locator('img'))
            .toHaveAttribute('src', /^blob:/, { timeout: 30_000 });

        await appendBrowserStep(request, sessionId, {
            id: 'browser-step-second',
            ref: secondAttachment.ref,
            name: 'browser-step-02.png',
            label: '展开筛选条件',
            time: baseTime + 1_000,
        });
        await expect(panel.getByText('实时回显 · 2 步', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(panel.getByTestId('browser-steps-active-label')).toHaveText('展开筛选条件');
        await expect(panel.getByTestId('browser-steps-step-1')).toBeVisible();
        await expect(panel.getByTestId('browser-steps-step-2')).toBeVisible();
        await pauseForRecordedReview(page);
        await page.screenshot({ path: evidencePath(testInfo, 'browser-steps-live-latest.png') });

        await panel.getByTestId('browser-steps-step-1').click();
        await expect(panel.getByTestId('browser-steps-active-meta')).toContainText('第 1 步');
        await expect(panel.getByTestId('browser-steps-active-label')).toHaveText('打开项目概览');
        await pauseForRecordedReview(page);
        await page.screenshot({ path: evidencePath(testInfo, 'browser-steps-history-selected.png') });
    } finally {
        await page.close();
    }
});

test('[LIVE-EGO-DOUYIN-PANEL] Ego Lite 真实抖音步骤经附件上报后实时显示在 Web 面板', async ({ page, request }, testInfo) => {
    // A real logged-in browser must load a remote page and produce three PNGs.
    // Keep this opt-in acceptance case independent from the Web suite's 60s
    // default, especially when HAPPY_E2E_RECORD adds review pauses.
    test.setTimeout(180_000);
    test.skip(!liveEgoAcceptance, '仅在维护者显式设置 HAPPY_EGO_LIVE_E2E=1 且本机已登录抖音时运行。');

    const sessionId = await createE2ESession(request);
    let taskSpaceId: number | null = null;
    const attachments = new Map<string, Uint8Array>();

    try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await installDevelopmentRefreshIndicatorSuppression(page);
        // The isolated local E2E attachment store issues opaque download URLs.
        // Serve the already-uploaded encrypted bytes through a deterministic
        // route so the real panel's decryption path can render each screenshot.
        await installEncryptedAttachmentRoutes(page, sessionId, attachments);
        await page.goto(authenticatedRoute(`/session/${sessionId}`));
        await expect(page.getByTestId('session-message-input')).toBeVisible({ timeout: 30_000 });

        const openedDouyin = await runEgoStep(`
const fs = await import('node:fs');
const task = await useOrCreateTaskSpace('live ego douyin panel acceptance');
await openOrReuseTab('https://www.douyin.com', { wait: true, timeout: 30 });
const verified = await js(String.raw\`(() => ({
  loggedIn: /我的/.test(document.body?.innerText || '') && !/登录后查看/.test(document.body?.innerText || '')
}))()\`);
if (!verified.loggedIn) throw new Error('无法确认抖音登录态');
const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
const screenshotPath = '/Users/jacky/.happy/artifacts/ego-live-douyin-panel-e2e/step-1-open-douyin.png';
fs.mkdirSync('/Users/jacky/.happy/artifacts/ego-live-douyin-panel-e2e', { recursive: true });
fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
cliLog(JSON.stringify({ taskSpaceId: task.id, screenshotPath }));
`);
        taskSpaceId = openedDouyin.taskSpaceId;
        await reportLiveEgoStep(request, sessionId, openedDouyin.screenshotPath, '打开抖音并确认登录', 1, attachments);

        const panel = page.getByTestId('browser-steps-panel');
        await expect(panel).toBeVisible({ timeout: 30_000 });
        await expect(panel.getByText('实时回显 · 1 步', { exact: true })).toBeVisible();
        await expect(panel.getByTestId('browser-steps-active-label')).toHaveText('打开抖音并确认登录');
        await expect(page.getByTestId('browser-steps-preview-image').locator('img')).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });

        const openedFavorites = await runEgoStep(`
const fs = await import('node:fs');
await useOrCreateTaskSpace(${taskSpaceId});
await openOrReuseTab('https://www.douyin.com/user/self?from_tab_name=main&showSubTab=video&showTab=favorite_collection', { wait: true, timeout: 30 });
await wait(2);
const verified = await js(String.raw\`(() => {
  const params = new URL(location.href).searchParams;
  const text = document.body?.innerText || '';
  return { favoriteVideoView: location.pathname === '/user/self' && params.get('showTab') === 'favorite_collection' && params.get('showSubTab') === 'video' && /收藏/.test(text) && /视频/.test(text) };
})()\`);
if (!verified.favoriteVideoView) throw new Error('无法确认收藏视频视图');
const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
const screenshotPath = '/Users/jacky/.happy/artifacts/ego-live-douyin-panel-e2e/step-2-open-favorites.png';
fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
cliLog(JSON.stringify({ taskSpaceId: ${taskSpaceId}, screenshotPath }));
`);
        await reportLiveEgoStep(request, sessionId, openedFavorites.screenshotPath, '进入我的收藏视频列表', 2, attachments);
        await expect(panel.getByText('实时回显 · 2 步', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(panel.getByTestId('browser-steps-active-label')).toHaveText('进入我的收藏视频列表');

        const extractedFavorites = await runEgoStep(`
const fs = await import('node:fs');
await useOrCreateTaskSpace(${taskSpaceId});
const extracted = await js(String.raw\`(() => {
  const canonical = (value) => {
    try { const url = new URL(value); const match = url.pathname.match(/^\\/video\\/(\\d+)\\/?$/); return url.protocol === 'https:' && url.hostname === 'www.douyin.com' && match ? 'https://www.douyin.com/video/' + match[1] : null; } catch { return null; }
  };
  const ordered = new Map();
  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = canonical(anchor.href); if (!url || ordered.has(url)) continue;
    const card = anchor.closest('li');
    const title = [anchor.getAttribute('title'), anchor.getAttribute('aria-label'), anchor.querySelector('img')?.getAttribute('alt'), anchor.textContent, card?.getAttribute('title'), card?.getAttribute('aria-label'), card?.innerText].find((value) => typeof value === 'string' && value.trim())?.replace(/\\s+/g, ' ').trim() || '';
    ordered.set(url, title);
  }
  const items = [...ordered.entries()].slice(0, 10);
  return { count: items.length, missingTitleCount: items.filter(([, title]) => !title).length };
})()\`);
if (extracted.count !== 10) throw new Error('无法提取收藏夹前 10 个视频');
const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
const screenshotPath = '/Users/jacky/.happy/artifacts/ego-live-douyin-panel-e2e/step-3-extracted-first-ten.png';
fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
cliLog(JSON.stringify({ taskSpaceId: ${taskSpaceId}, screenshotPath, ...extracted }));
`);
        expect(extractedFavorites.count).toBe(10);
        expect(extractedFavorites.missingTitleCount).toBe(0);
        await reportLiveEgoStep(request, sessionId, extractedFavorites.screenshotPath, '提取收藏夹前 10 个视频', 3, attachments);
        await expect(panel.getByText('实时回显 · 3 步', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(panel.getByTestId('browser-steps-active-label')).toHaveText('提取收藏夹前 10 个视频');
        await pauseForRecordedReview(page);
        await page.screenshot({ path: evidencePath(testInfo, 'live-ego-douyin-latest.png') });

        await panel.getByTestId('browser-steps-step-1').click();
        await expect(panel.getByTestId('browser-steps-active-label')).toHaveText('打开抖音并确认登录');
        await pauseForRecordedReview(page);
        await page.screenshot({ path: evidencePath(testInfo, 'live-ego-douyin-history.png') });
    } finally {
        if (taskSpaceId !== null) closeEgoTaskSpace(taskSpaceId);
        // The fixture owns this page and closes its context after the test.
        // Explicit close can wait on the panel's live attachment requests while
        // recording is finalised, despite all acceptance assertions succeeding.
    }
});
