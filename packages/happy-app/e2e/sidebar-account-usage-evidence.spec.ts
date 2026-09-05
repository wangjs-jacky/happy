import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;
const evidenceDirectory = process.env.HAPPY_USAGE_MENU_EVIDENCE_DIR;
const evidencePhase = process.env.HAPPY_USAGE_MENU_EVIDENCE_PHASE === 'before' ? 'before' : 'after';

function evidencePath(testInfo: TestInfo): string {
    const filename = `case-1-${evidencePhase}.png`;
    if (!evidenceDirectory) return testInfo.outputPath(filename);
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    return path.join(evidenceDirectory, filename);
}

async function hideExpoDevelopmentOverlay(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const hideOverlay = () => {
            document.querySelectorAll<HTMLElement>('.__expo_fast_refresh').forEach((element) => {
                element.style.setProperty('visibility', 'hidden', 'important');
            });
        };
        new MutationObserver(hideOverlay).observe(document, {
            attributes: true,
            attributeFilter: ['class'],
            childList: true,
            subtree: true,
        });
        hideOverlay();
    });
}

test.use({ locale: 'zh-CN' });

test('[USAGE-MENU-01] 账户菜单提供一级使用情况入口', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await hideExpoDevelopmentOverlay(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(authenticatedWebUrl);
    await expect(page.getByRole('textbox')).toBeVisible({ timeout: 120_000 });

    await page.getByTestId('sidebar-account-trigger').click();
    const menu = page.getByTestId('sidebar-account-menu');
    await expect(menu).toBeVisible();

    const usageAction = page.getByTestId('sidebar-account-usage-action');
    if (evidencePhase === 'before') {
        await expect(usageAction).toHaveCount(0);
    } else {
        await expect(usageAction).toBeVisible();
    }

    const actionOrder = await menu.locator('[role="button"][data-testid^="sidebar-account-"]').evaluateAll((elements) => (
        elements.map((element) => element.getAttribute('data-testid'))
    ));
    expect(actionOrder).toEqual(evidencePhase === 'before'
        ? [
            'sidebar-account-profile-action',
            'sidebar-account-settings-action',
            'sidebar-account-details-action',
            'sidebar-account-logout-action',
        ]
        : [
            'sidebar-account-profile-action',
            'sidebar-account-settings-action',
            'sidebar-account-details-action',
            'sidebar-account-usage-action',
            'sidebar-account-logout-action',
        ]);

    if (process.env.HAPPY_E2E_RECORD === '1') {
        await page.waitForTimeout(900);
    }
    await page.screenshot({ path: evidencePath(testInfo), fullPage: true });

    if (evidencePhase === 'after') {
        await usageAction.click();
        await expect.poll(() => new URL(page.url()).pathname).toBe('/settings/usage');
        await expect(page.getByText('Codex 用量', { exact: true }).filter({ visible: true })).toBeVisible();
        if (process.env.HAPPY_E2E_RECORD === '1') {
            await page.waitForTimeout(1100);
        }
    }
});
