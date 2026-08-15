import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { encodeBase64, encryptLegacy } from '../../happy-cli/src/api/encryption';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;
const e2eServerUrl = process.env.HAPPY_E2E_SERVER_URL!;
const recordEvidence = process.env.HAPPY_E2E_RECORD === '1';

test.use({ video: 'off', trace: 'off' });
test.setTimeout(360_000);

function authenticatedRoute(pathname: string): string {
    const url = new URL(authenticatedWebUrl);
    url.pathname = pathname;
    return url.toString();
}

function authContext(): { headers: Record<string, string>; encryptionKey: Uint8Array } {
    const url = new URL(authenticatedWebUrl);
    const token = url.searchParams.get('dev_token');
    const secret = url.searchParams.get('dev_secret');
    if (!token || !secret || !e2eServerUrl) {
        throw new Error('Missing isolated E2E authentication context.');
    }
    return {
        headers: { Authorization: `Bearer ${token}`, 'X-Happy-Client': 'playwright-e2e' },
        encryptionKey: new Uint8Array(Buffer.from(secret, 'base64url')),
    };
}

async function createSession(
    request: APIRequestContext,
    options: { name: string; summary: string; path: string },
): Promise<string> {
    const { headers, encryptionKey } = authContext();
    const metadata = encodeBase64(encryptLegacy({
        path: options.path,
        host: 'sidebar-e2e-mac',
        name: options.name,
        summary: { text: options.summary, updatedAt: Date.now() },
        flavor: 'codex',
        machineId: 'sidebar-e2e-machine',
        homeDir: '/workspace',
        lifecycleState: 'running',
        startedBy: 'terminal',
    }, encryptionKey));
    const response = await request.post(new URL('/v1/sessions', e2eServerUrl).toString(), {
        data: {
            tag: `sidebar-lists-tags-${Date.now()}-${Math.random()}`,
            metadata,
            agentState: null,
            dataEncryptionKey: null,
        },
        headers,
    });
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { session: { id: string } }).session.id;
}

async function deleteSession(request: APIRequestContext, sessionId: string): Promise<void> {
    const { headers } = authContext();
    await request.post(new URL(`/v1/sessions/${encodeURIComponent(sessionId)}/archive`, e2eServerUrl).toString(), { headers });
    const response = await request.delete(
        new URL(`/v1/sessions/${encodeURIComponent(sessionId)}`, e2eServerUrl).toString(),
        { headers },
    );
    expect(response.ok()).toBe(true);
}

async function pauseForReview(page: Page, duration = 850): Promise<void> {
    if (recordEvidence) await page.waitForTimeout(duration);
}

async function captureEvidenceFrame(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    if (!recordEvidence) return;
    await page.screenshot({ path: testInfo.outputPath(`evidence-${name}.png`), fullPage: true });
}

async function createList(
    page: Page,
    options: { name: string; kind: 'workspace' | 'agent'; prompt?: string },
): Promise<void> {
    await page.getByTestId('sidebar-create-list-button').click();
    await expect(page.getByText('New list', { exact: true })).toBeVisible();
    await page.getByTestId('sidebar-list-name-input').fill(options.name);
    await page.getByTestId(`sidebar-list-kind-${options.kind}`).click();
    await expect(page.getByTestId(`sidebar-list-kind-${options.kind}`)).toHaveAttribute('aria-checked', 'true');
    if (options.kind === 'agent') {
        await expect(page.getByText('Default machine', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Default directory', { exact: true })).toHaveCount(0);
        await page.getByTestId('sidebar-list-agent-prompt-input').fill(options.prompt ?? '');
    } else {
        await expect(page.getByText('Default machine', { exact: true })).toBeVisible();
        await expect(page.getByText('Default directory', { exact: true })).toBeVisible();
    }
    await page.getByTestId('sidebar-create-list-submit').click();
    await expect(page.getByText(options.name, { exact: true })).toBeVisible();
}

async function organizeSession(
    page: Page,
    options: { sessionId: string; listName: string; tagName: string },
): Promise<void> {
    await page.getByTestId(`organize-session-${options.sessionId}`).click();
    await expect(page.getByText('Organize session', { exact: true })).toBeVisible();
    const list = page.getByRole('radio', { name: options.listName, exact: true });
    await list.click();
    await expect(list).toHaveAttribute('aria-checked', 'true');
    const tag = page.getByRole('checkbox', { name: options.tagName, exact: true });
    await tag.click();
    await expect(tag).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('organize-session-save').click();
    await expect(page.getByText('Organize session', { exact: true })).toHaveCount(0);
}

test('[SIDEBAR-LISTS-TAGS] desktop Lists and Tags organize sessions without replacing the conversation', async ({ page, request }, testInfo: TestInfo) => {
    const alphaId = await createSession(request, {
        name: 'Sidebar Alpha runtime',
        summary: 'E2E Alpha conversation',
        path: '/workspace/remote-happy',
    });
    const betaId = await createSession(request, {
        name: 'Sidebar Beta runtime',
        summary: 'E2E Beta conversation',
        path: '/workspace/local-happy',
    });

    try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(authenticatedRoute(`/session/${alphaId}`));
        page.setDefaultTimeout(15_000);
        expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
        const alphaUrl = page.url();
        const visibleTitle = page.locator('[data-testid="session-header-title"]:visible');
        await expect(visibleTitle).toHaveText('E2E Alpha conversation', { timeout: 120_000 });
        await expect(page.getByTestId('desktop-sidebar-tab-projects')).toHaveAttribute('aria-selected', 'true');
        await captureEvidenceFrame(page, testInfo, '01-projects-default');

        await page.getByTestId('desktop-sidebar-tab-lists').click();
        await expect(page.getByTestId('desktop-sidebar-tab-lists')).toHaveAttribute('aria-selected', 'true');
        await expect(page).toHaveURL(alphaUrl);
        await expect(visibleTitle).toHaveText('E2E Alpha conversation');
        await captureEvidenceFrame(page, testInfo, '02-lists-empty');

        await createList(page, { name: 'Remote Happy', kind: 'workspace' });
        await captureEvidenceFrame(page, testInfo, '03-workspace-list');
        await createList(page, { name: 'Advisor', kind: 'agent', prompt: 'Help me think clearly.' });
        await captureEvidenceFrame(page, testInfo, '04-agent-list');

        await page.getByTestId('sidebar-create-tag-button').click();
        await page.getByPlaceholder('Tag name').fill('product');
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await expect(page.getByRole('button', { name: /^product 0$/ })).toBeVisible();
        await expect(page).toHaveURL(alphaUrl);
        await captureEvidenceFrame(page, testInfo, '05-tag-created');

        await organizeSession(page, { sessionId: alphaId, listName: 'Remote Happy', tagName: 'product' });
        await expect(page.getByTestId(`organized-session-${alphaId}`)).toBeVisible();
        await expect(page).toHaveURL(alphaUrl);
        await expect(visibleTitle).toHaveText('E2E Alpha conversation');
        await pauseForReview(page);
        await page.screenshot({ path: testInfo.outputPath('01-lists-organized.png'), fullPage: true });
        await captureEvidenceFrame(page, testInfo, '06-alpha-organized');

        await page.getByTestId(`organized-session-${betaId}`).click();
        await expect(page).toHaveURL((url) => url.pathname === `/session/${betaId}`);
        await expect(page.locator('[data-testid="session-header-title"]:visible')).toHaveText('E2E Beta conversation');
        const betaUrl = page.url();
        await captureEvidenceFrame(page, testInfo, '07-beta-selected');

        await organizeSession(page, { sessionId: betaId, listName: 'Advisor', tagName: 'product' });
        await expect(page.getByRole('button', { name: /^product 2$/ })).toBeVisible();
        await page.getByRole('button', { name: /^product 2$/ }).click();
        await expect(page.getByTestId(`organized-session-${alphaId}`)).toBeVisible();
        await expect(page.getByTestId(`organized-session-${betaId}`)).toBeVisible();
        await expect(page).toHaveURL(betaUrl);
        await expect(page.locator('[data-testid="session-header-title"]:visible')).toHaveText('E2E Beta conversation');
        await pauseForReview(page, 1_100);
        await page.screenshot({ path: testInfo.outputPath('02-tag-cross-list-filter.png'), fullPage: true });
        await captureEvidenceFrame(page, testInfo, '08-tag-cross-list-filter');

        await page.getByTestId(`organized-session-${alphaId}`).click();
        await expect(page).toHaveURL((url) => url.pathname === `/session/${alphaId}`);
        await expect(page.locator('[data-testid="session-header-title"]:visible')).toHaveText('E2E Alpha conversation');

        await page.reload({ timeout: 180_000 });
        await expect(page.getByTestId('desktop-sidebar-tab-lists')).toHaveAttribute('aria-selected', 'true', { timeout: 120_000 });
        await expect(page.getByText('Remote Happy', { exact: true })).toBeVisible();
        await expect(page.getByText('Advisor', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /^product 2$/ })).toBeVisible();
        await page.getByRole('button', { name: /^product 2$/ }).click();
        await expect(page.getByTestId(`organized-session-${alphaId}`)).toBeVisible();
        await expect(page.getByTestId(`organized-session-${betaId}`)).toBeVisible();
        await expect(page).toHaveURL((url) => url.pathname === `/session/${alphaId}`);
        await expect(page.locator('[data-testid="session-header-title"]:visible')).toHaveText('E2E Alpha conversation');
        await pauseForReview(page);
        await page.screenshot({ path: testInfo.outputPath('03-reload-persisted.png'), fullPage: true });
        await captureEvidenceFrame(page, testInfo, '09-reload-persisted');
    } finally {
        await Promise.allSettled([deleteSession(request, alphaId), deleteSession(request, betaId)]);
    }
});
