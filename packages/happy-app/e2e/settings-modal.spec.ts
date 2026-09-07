import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;
const evidenceDirectory = process.env.HAPPY_SETTINGS_MODAL_EVIDENCE_DIR;

function route(pathname: string): string {
    const url = new URL(authenticatedWebUrl);
    url.pathname = pathname;
    return url.toString();
}

test('[PC SETTINGS MODAL] keeps descendants in a dialog and restores the original route on close', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(route('/'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('compose-home-settings-button')).toBeVisible();

    const currentUrl = page.url();
    await page.getByTestId('compose-home-settings-button').click();

    await expect(page.getByTestId('desktop-modal-panel')).toBeVisible();
    await expect(page.getByTestId('desktop-modal-close')).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/settings');

    const modalPanel = page.getByTestId('desktop-modal-panel');
    await modalPanel.getByText('Theme', { exact: true }).click();
    await expect(modalPanel.getByText('Appearance', { exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/settings/appearance');

    await page.getByTestId('desktop-modal-back').click();
    await expect(modalPanel.getByText('Settings', { exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/settings');

    if (evidenceDirectory) {
        fs.mkdirSync(evidenceDirectory, { recursive: true });
        await page.screenshot({
            path: path.join(evidenceDirectory, 'case-3-after.png'),
            fullPage: true,
        });
    }

    await page.getByTestId('desktop-modal-close').click();
    await expect(page.getByTestId('desktop-modal-panel')).toHaveCount(0);
    await expect(page).toHaveURL(currentUrl);
});
