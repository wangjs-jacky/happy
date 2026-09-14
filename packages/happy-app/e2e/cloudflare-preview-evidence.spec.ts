import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { seedCloudflarePreviewFixture } from './fixtures/cloudflare-interactive-previews/fixture';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;
const e2eServerUrl = process.env.HAPPY_E2E_SERVER_URL!;
const evidenceDirectory = path.resolve(process.cwd(), '../../docs/visual-evidence/cloudflare-interactive-previews');

function authenticatedRoute(pathname: string, fixture?: string): string {
    const url = new URL(authenticatedWebUrl);
    url.pathname = pathname;
    if (fixture) url.searchParams.set('happy_preview_fixture', fixture);
    return url.toString();
}

function evidencePath(testInfo: TestInfo, filename: string): string {
    if (process.env.HAPPY_CLOUDFLARE_PREVIEW_EVIDENCE_DIR) {
        fs.mkdirSync(evidenceDirectory, { recursive: true });
        return path.join(evidenceDirectory, filename);
    }
    return testInfo.outputPath(filename);
}

async function expectFixtureReady(page: Page, testId: string): Promise<void> {
    await expect(page.getByTestId(testId)).toBeVisible({ timeout: 60_000 });
}

test.describe('Happy-managed Cloudflare preview PC Web evidence', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('[PREVIEW-SETTINGS] covers availability, token form, retry, and disconnect cleanup warning', async ({ page }, testInfo) => {
        test.setTimeout(120_000);

        await page.goto(authenticatedRoute('/settings/temporary-previews', 'unavailable'));
        await expectFixtureReady(page, 'temporary-previews-screen');
        await expect(page.getByTestId('temporary-previews-status')).toBeVisible();
        await expect(page.getByTestId('temporary-previews-connect')).toHaveCount(0);

        await page.goto(authenticatedRoute('/settings/temporary-previews', 'disconnected'));
        await expect(page.getByTestId('temporary-previews-connect')).toBeVisible();
        await page.getByTestId('temporary-previews-connect').click();
        await page.getByTestId('temporary-previews-account-id').fill('a'.repeat(32));
        await page.getByTestId('temporary-previews-api-token').fill('fixture-token-not-a-real-secret');
        await expect(page.getByTestId('temporary-previews-api-token')).toHaveAttribute('type', 'password');
        await page.getByTestId('temporary-previews-save').click();
        await expect(page.getByTestId('temporary-previews-project')).toContainText('happy-previews');
        await expect(page.getByTestId('temporary-previews-reconnect')).toBeVisible();

        await page.goto(authenticatedRoute('/settings/temporary-previews', 'error-once'));
        await expect(page.getByTestId('temporary-previews-error')).toBeVisible();
        await page.getByTestId('temporary-previews-retry').click();
        await expect(page.getByTestId('temporary-previews-connect')).toBeVisible();

        await page.goto(authenticatedRoute('/settings/temporary-previews', 'disconnect-warning'));
        await expect(page.getByTestId('temporary-previews-project')).toContainText('happy-previews');
        await page.getByTestId('temporary-previews-disconnect').click();
        const confirmDialog = page.getByRole('dialog').last();
        await expect(confirmDialog).toBeVisible();
        await confirmDialog.getByRole('button', { name: /Disconnect|断开/ }).click();
        await expect(page.getByTestId('temporary-previews-connect')).toBeVisible();
        await expect(page.getByRole('dialog').last()).toContainText(/remaining deployments|剩余部署|清理/);

        await page.screenshot({
            path: evidencePath(testInfo, 'case-1-cloudflare-settings-after.png'),
            fullPage: true,
        });
    });

    test('[PREVIEW-CARD] renders display-only lifecycle cards and external/copy actions', async ({ page, context }, testInfo) => {
        test.setTimeout(120_000);
        const fixture = await seedCloudflarePreviewFixture({ serverUrl: e2eServerUrl, webUrl: authenticatedWebUrl });
        await page.goto(fixture.sessionUrl);
        await expectFixtureReady(page, 'session-message-input');

        const cards = page.getByTestId('interactive-preview-card');
        await expect(cards).toHaveCount(4);
        await expect(page.getByTestId('interactive-preview-open')).toHaveCount(1);
        await expect(page.getByTestId('interactive-preview-copy')).toHaveCount(1);
        await expect(cards.filter({ hasText: 'Publishing checkout flow' })).toBeVisible();
        await expect(cards.filter({ hasText: 'Failed checkout flow' })).toBeVisible();
        await expect(cards.filter({ hasText: 'Expired checkout flow' })).toBeVisible();
        await expect(cards.locator('iframe')).toHaveCount(0);
        await expect(cards.locator('input, textarea, form')).toHaveCount(0);

        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(authenticatedWebUrl).origin });
        await page.getByTestId('interactive-preview-copy').click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toBe('https://happy-preview.example.invalid/checkout');

        const externalPagePromise = context.waitForEvent('page');
        await page.getByTestId('interactive-preview-open').click();
        const externalPage = await externalPagePromise;
        await externalPage.waitForURL('https://happy-preview.example.invalid/checkout');
        await externalPage.close();

        await page.screenshot({
            path: evidencePath(testInfo, 'case-2-preview-cards-after.png'),
            fullPage: true,
        });
    });

    for (const theme of ['default', 'ginghamDark'] as const) {
        test(`[EGO-POPOVER] opens repeated runs as one inline gallery (${theme})`, async ({ page }, testInfo) => {
            test.setTimeout(120_000);
            const fixture = await seedCloudflarePreviewFixture({ serverUrl: e2eServerUrl, webUrl: authenticatedWebUrl });
            if (theme === 'ginghamDark') {
                await page.goto(authenticatedRoute('/settings/appearance'));
                await page.getByTestId('appearance-theme-pack-gingham').click();
                await page.getByTestId('appearance-theme-preference').click();
                await page.getByTestId('appearance-theme-preference').click();
                await expect(page.locator('html')).toHaveClass(/ginghamDark/);
                await page.getByTestId(`session-row-${fixture.sessionId}`).click();
            } else {
                await page.goto(fixture.sessionUrl);
            }
            await expectFixtureReady(page, 'capability-hub-summary');
            await expect(page.getByTestId('capability-block-skills')).toBeVisible();
            await expect(page.getByTestId('capability-hub-detail-skills')).toHaveCount(0);

            const activityRow = page.getByTestId('activity-skill-ego-browser');
            const trigger = activityRow.getByTestId('browser-progress-trigger');
            await expect(trigger).toBeVisible();
            await expect(trigger).toContainText(/15/);
            await expect(activityRow).toBeVisible();
            await expect(trigger).toHaveCount(1);
            await trigger.click();
            await expect(page.getByTestId('browser-steps-popover')).toBeVisible();
            await expect(page.getByTestId('browser-steps-timeline-scroll')).toContainText('Verified browser milestone 1.12');
            await expect(page.getByTestId('browser-steps-timeline-scroll')).toContainText('Verified browser milestone 2.3');
            await page.getByTestId('browser-steps-popover-close').click();
            await expect(page.getByTestId('browser-steps-popover')).toHaveCount(0);
            await trigger.focus();
            await trigger.press('Enter');
            await expect(page.getByTestId('browser-steps-popover')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.getByTestId('browser-steps-popover')).toHaveCount(0);
            await expect(trigger).toBeFocused();
            await trigger.press('Space');
            await expect(page.getByTestId('browser-steps-popover')).toBeVisible();

            await page.screenshot({
                path: evidencePath(testInfo, `case-3-ego-popover-${theme}-after.png`),
                fullPage: true,
            });

            await page.keyboard.press('Escape');
            await page.setViewportSize({ width: 1024, height: 768 });
            await page.getByTestId('desktop-right-panel-toggle-button').click();
            await page.getByTestId('capability-block-skills').click();
            await trigger.click();
            const popoverBox = await page.getByTestId('browser-steps-popover').boundingBox();
            expect(popoverBox).not.toBeNull();
            expect(popoverBox!.x).toBeGreaterThanOrEqual(12);
            expect(popoverBox!.y).toBeGreaterThanOrEqual(12);
            expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(1012);
            expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(756);
            await page.getByTestId('browser-steps-timeline-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
            expect(await page.getByTestId('browser-steps-timeline-scroll').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
            await page.screenshot({
                path: evidencePath(testInfo, `case-3-ego-popover-${theme}-boundary-1024x768.png`),
                fullPage: true,
            });
        });
    }
});
