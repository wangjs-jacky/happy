import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;
function authenticatedRoute(pathnameAndSearch: string): string {
    const url = new URL(authenticatedWebUrl);
    const target = new URL(pathnameAndSearch, authenticatedWebUrl);
    url.pathname = target.pathname;
    url.search = target.search;
    return url.toString();
}
const evidenceDirectory = path.resolve(process.cwd(), '../../docs/visual-evidence/vercel-interactive-previews');

test('PC Web shows the account-scoped Vercel preview connection', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/v1/connect/vercel/status', async (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ available: true, connected: true, account: { teamId: 'team_happy', teamName: 'Happy Design', projectId: 'happy-previews' } }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(authenticatedRoute('/settings/temporary-previews'));
    await expect(page.getByTestId('temporary-previews-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('temporary-previews-status')).toContainText('Happy Design');
    await expect(page.getByTestId('temporary-previews-project')).toContainText('happy-previews');
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDirectory, 'case-1-vercel-settings-after.png'), fullPage: true });
});

test('PC Web callback fixture refreshes the connection without relying on localized copy', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/v1/connect/vercel/status', async (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ available: true, connected: true, account: { teamId: 'team_happy', projectId: 'happy-previews' } }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(authenticatedRoute('/settings/temporary-previews?vercel=connected'));
    await expect(page.getByTestId('temporary-previews-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('temporary-previews-status')).toBeVisible();
    await expect(page.getByTestId('temporary-previews-project')).toContainText('happy-previews');
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDirectory, 'case-2-vercel-popup-callback.png'), fullPage: true });
});
