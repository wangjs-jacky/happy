import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;
function authenticatedRoute(pathname: string): string { const url = new URL(authenticatedWebUrl); url.pathname = pathname; return url.toString(); }
const evidenceDirectory = path.resolve(process.cwd(), '../../docs/visual-evidence/vercel-interactive-previews');

test('PC Web shows the account-scoped Vercel preview connection', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/v1/connect/vercel/status', async (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ available: true, connected: true, account: { teamId: 'team_happy', teamName: 'Happy Design' } }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(authenticatedRoute('/settings/temporary-previews'));
    await expect(page.getByText('Vercel 云端预览')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Happy Design')).toBeVisible();
    await expect(page.getByText(/24 小时后自动删除/)).toBeVisible();
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDirectory, 'case-1-vercel-settings-after.png'), fullPage: true });
});
