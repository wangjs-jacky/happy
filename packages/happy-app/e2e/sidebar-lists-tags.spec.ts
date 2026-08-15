import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';
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

async function expectMobileTouchTarget(locator: Locator): Promise<void> {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function createList(
    page: Page,
    options: { name: string; kind: 'workspace' | 'agent' },
): Promise<void> {
    await page.getByTestId('sidebar-create-list-button').click();
    await expect(page.getByText('New list', { exact: true })).toBeVisible();
    await page.getByTestId('sidebar-list-name-input').fill(options.name);
    await page.getByTestId(`sidebar-list-kind-${options.kind}`).click();
    await expect(page.getByTestId(`sidebar-list-kind-${options.kind}`)).toHaveAttribute('aria-checked', 'true');
    if (options.kind === 'agent') {
        await expect(page.getByText('Default machine', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Default directory', { exact: true })).toHaveCount(0);
        await expect(page.getByTestId('sidebar-list-agent-prompt-input')).toHaveCount(0);
        const askMode = page.getByRole('radio', { name: 'Ask', exact: true });
        await expect(askMode).toHaveAttribute('aria-checked', 'true');
        await expect(askMode).toBeDisabled();
    } else {
        await expect(page.getByTestId('sidebar-list-machine-picker')).toBeVisible();
        const directoryPicker = page.getByTestId('sidebar-list-directory-picker');
        await expect(directoryPicker).toBeVisible();
        await expect(page.getByTestId('sidebar-list-directory-none')).toHaveAttribute('aria-checked', 'true');
        await expect(directoryPicker.locator('input')).not.toBeEditable();
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
        const remoteListRow = page.getByText('Remote Happy', { exact: true });
        await expect(remoteListRow).toBeVisible();
        const remoteListId = await remoteListRow.locator('xpath=ancestor::*[@data-testid][1]').getAttribute('data-testid');
        expect(remoteListId).toMatch(/^sidebar-list-/);
        const remoteId = remoteListId!.replace('sidebar-list-', '');
        await page.getByTestId(`sidebar-edit-list-${remoteId}`).click();
        await expect(page.getByText('Edit list', { exact: true })).toBeVisible();
        await page.getByTestId('sidebar-list-name-input').fill('Remote Happy renamed');
        await page.getByTestId('sidebar-edit-list-submit').click();
        await expect(page.getByText('Remote Happy renamed', { exact: true })).toBeVisible();

        await createList(page, { name: 'Advisor', kind: 'agent' });
        await captureEvidenceFrame(page, testInfo, '04-agent-list');

        await page.getByTestId('sidebar-create-tag-button').click();
        await page.getByPlaceholder('Tag name').fill('product');
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await expect(page.getByRole('button', { name: /^product 0$/ })).toBeVisible();
        await expect(page).toHaveURL(alphaUrl);
        await captureEvidenceFrame(page, testInfo, '05-tag-created');

        await organizeSession(page, { sessionId: alphaId, listName: 'Remote Happy renamed', tagName: 'product' });
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

        await page.getByTestId('sidebar-close-tag-filter').click();
        const advisorListRow = page.getByText('Advisor', { exact: true });
        const advisorListTestId = await advisorListRow.locator('xpath=ancestor::*[@data-testid][1]').getAttribute('data-testid');
        expect(advisorListTestId).toMatch(/^sidebar-list-/);
        const advisorId = advisorListTestId!.replace('sidebar-list-', '');
        await page.getByTestId(`sidebar-edit-list-${advisorId}`).click();
        await page.getByTestId('sidebar-delete-list').click();
        await expect(page.getByText('Delete list', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(page.getByText('Advisor', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^product 2$/ })).toBeVisible();
        await expect(page.getByTestId(`organized-session-${betaId}`)).toBeVisible();

        await page.reload({ timeout: 180_000 });
        await expect(page.getByTestId('desktop-sidebar-tab-lists')).toHaveAttribute('aria-selected', 'true', { timeout: 120_000 });
        await expect(page.getByText('Remote Happy renamed', { exact: true })).toBeVisible();
        await expect(page.getByText('Advisor', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^product 2$/ })).toBeVisible({ timeout: 120_000 });
        await page.getByRole('button', { name: /^product 2$/ }).click();
        await expect(page.getByTestId(`organized-session-${alphaId}`)).toBeVisible();
        await expect(page.getByTestId(`organized-session-${betaId}`)).toBeVisible();
        await expect(page).toHaveURL((url) => url.pathname === `/session/${alphaId}`);
        await expect(page.locator('[data-testid="session-header-title"]:visible')).toHaveText('E2E Alpha conversation');
        await pauseForReview(page);
        await page.screenshot({ path: testInfo.outputPath('03-reload-persisted.png'), fullPage: true });
        await captureEvidenceFrame(page, testInfo, '09-reload-persisted');
    } finally {
        await page.close();
        await Promise.allSettled([deleteSession(request, alphaId), deleteSession(request, betaId)]);
    }
});

test('[SIDEBAR-LISTS-TAGS-MOBILE] mobile drawer exposes Projects and Lists tabs', async ({ page, request }, testInfo: TestInfo) => {
    const sessionId = await createSession(request, {
        name: 'Mobile sidebar tabs',
        summary: 'Mobile sidebar tabs',
        path: '/workspace/mobile-sidebar-tabs',
    });
    const evidencePhase = process.env.HAPPY_SIDEBAR_LISTS_TAGS_MOBILE_EVIDENCE_PHASE ?? 'after';

    try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(authenticatedRoute('/'));
        page.setDefaultTimeout(15_000);
        const composer = page.getByRole('textbox');
        try {
            await expect(composer).toBeVisible({ timeout: 120_000 });
        } catch {
            await page.reload({ timeout: 180_000 });
            await expect(composer).toBeVisible({ timeout: 120_000 });
        }

        await page.getByTestId('compose-home-drawer-button').click();
        const accountFooter = page.getByTestId('sidebar-account-footer');
        await expect.poll(async () => (await accountFooter.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
        await expect(page.getByTestId(`session-row-${sessionId}`)).toBeVisible();

        const projectsTab = page.getByTestId('desktop-sidebar-tab-projects');
        const listsTab = page.getByTestId('desktop-sidebar-tab-lists');
        if (evidencePhase === 'before') {
            await expect(projectsTab).toHaveCount(0);
            await expect(listsTab).toHaveCount(0);
            await page.screenshot({ path: testInfo.outputPath('mobile-before-no-tabs.png'), fullPage: true });
            return;
        }

        await expect(projectsTab).toBeVisible();
        await expect(listsTab).toBeVisible();
        await expect(projectsTab).toHaveAttribute('aria-selected', 'true');
        await expectMobileTouchTarget(projectsTab);
        await expectMobileTouchTarget(listsTab);
        const projectsVisual = await page.getByTestId('desktop-sidebar-tab-projects-visual').boundingBox();
        const listsVisual = await page.getByTestId('desktop-sidebar-tab-lists-visual').boundingBox();
        expect(projectsVisual?.height).toBeLessThanOrEqual(32);
        expect(listsVisual?.height).toBeLessThanOrEqual(32);
        await captureEvidenceFrame(page, testInfo, 'mobile-01-projects');
        const homeUrl = page.url();
        await listsTab.click();
        await expect(listsTab).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('sidebar-lists-view')).toBeVisible();
        await expect(page).toHaveURL(homeUrl);
        await expectMobileTouchTarget(page.getByTestId('sidebar-create-list-button'));
        await expectMobileTouchTarget(page.getByTestId('sidebar-create-tag-button'));
        await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        await page.getByTestId('sidebar-create-list-button').click();
        await expect(page.getByText('New list', { exact: true })).toBeVisible();
        await expectMobileTouchTarget(page.getByTestId('sidebar-list-kind-workspace'));
        await expectMobileTouchTarget(page.getByTestId('sidebar-list-color-blue'));
        await expectMobileTouchTarget(page.getByTestId('sidebar-create-list-submit'));
        await page.getByTestId('sidebar-create-list-cancel').click();
        await expect(page.getByText('New list', { exact: true })).toHaveCount(0);

        await expect.poll(async () => {
            const box = await accountFooter.boundingBox();
            return box !== null
                && box.x >= 0
                && box.y >= 0
                && box.x + box.width <= 390
                && box.y + box.height <= 844;
        }).toBe(true);
        await pauseForReview(page);
        await page.screenshot({ path: testInfo.outputPath('mobile-after-lists-tab.png'), fullPage: true });
        await captureEvidenceFrame(page, testInfo, 'mobile-02-lists');
    } finally {
        await page.close();
        await deleteSession(request, sessionId);
    }
});

test('[SIDEBAR-LISTS-TAGS-PERF] 100 unassigned sessions remain responsive when expanded', async ({ page, request }, testInfo: TestInfo) => {
    const sessionIds = await Promise.all(Array.from({ length: 100 }, (_, index) => createSession(request, {
        name: `Sidebar performance ${index + 1}`,
        summary: `Performance conversation ${index + 1}`,
        path: `/workspace/sidebar-performance-${index + 1}`,
    })));

    try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(authenticatedRoute(`/session/${sessionIds[0]}`));
        page.setDefaultTimeout(15_000);
        await expect(page.locator('[data-testid="session-header-title"]:visible')).toHaveText('Performance conversation 1', { timeout: 120_000 });
        const listsTab = page.getByTestId('desktop-sidebar-tab-lists');
        await expect(listsTab).toBeVisible();
        const listsTabBox = await listsTab.boundingBox();
        expect(listsTabBox).not.toBeNull();
        await page.mouse.click(
            listsTabBox!.x + listsTabBox!.width / 2,
            listsTabBox!.y + listsTabBox!.height / 2,
        );
        await expect(listsTab).toHaveAttribute('aria-selected', 'true', { timeout: 120_000 });
        const unassigned = page.getByTestId('sidebar-list-unassigned');
        await expect(unassigned).toContainText('100', { timeout: 120_000 });

        const mountedSessions = page.locator('[data-testid^="organized-session-"]');
        await expect(mountedSessions.first()).toBeVisible({ timeout: 120_000 });
        expect(await mountedSessions.count()).toBeLessThan(100);

        const unassignedBox = await unassigned.boundingBox();
        expect(unassignedBox).not.toBeNull();
        const clickUnassigned = () => page.mouse.click(
            unassignedBox!.x + unassignedBox!.width / 2,
            unassignedBox!.y + unassignedBox!.height / 2,
        );

        await clickUnassigned();
        await expect(mountedSessions).toHaveCount(0);

        const startedAt = Date.now();
        await clickUnassigned();
        await expect(mountedSessions.first()).toBeVisible();
        expect(Date.now() - startedAt).toBeLessThan(5_000);
        expect(await mountedSessions.count()).toBeLessThan(100);
        await captureEvidenceFrame(page, testInfo, 'desktop-100-sessions-responsive');

        await clickUnassigned();
        await expect(mountedSessions).toHaveCount(0);
        await page.getByTestId('sidebar-create-tag-button').click();
        await expect(page.getByPlaceholder('Tag name')).toBeVisible();
    } finally {
        await page.close();
        await Promise.allSettled(sessionIds.map((sessionId) => deleteSession(request, sessionId)));
    }
});
