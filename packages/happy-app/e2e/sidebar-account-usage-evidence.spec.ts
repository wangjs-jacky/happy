import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { encodeBase64, encryptLegacy } from '../../happy-cli/src/api/encryption';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;
const e2eServerUrl = process.env.HAPPY_E2E_SERVER_URL!;
const evidenceDirectory = process.env.HAPPY_USAGE_POPUP_EVIDENCE_DIR;
const evidencePhase = process.env.HAPPY_USAGE_POPUP_EVIDENCE_PHASE === 'before' ? 'before' : 'after';

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

async function registerUsageMachine(request: APIRequestContext): Promise<() => Promise<void>> {
    const url = new URL(authenticatedWebUrl);
    const token = url.searchParams.get('dev_token');
    const secret = url.searchParams.get('dev_secret');
    if (!token || !secret || !e2eServerUrl) throw new Error('Missing local E2E authentication configuration.');

    const headers = {
        Authorization: `Bearer ${token}`,
        'X-Happy-Client': 'playwright-usage-popup-evidence',
    };
    const encryptionKey = new Uint8Array(Buffer.from(secret, 'base64url'));
    const machineId = `usage-popup-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const metadata = encodeBase64(encryptLegacy({
        host: 'studio-mac',
        platform: 'darwin',
        happyCliVersion: '0.0.0-e2e',
        happyHomeDir: '/tmp/.happy',
        homeDir: '/tmp',
    }, encryptionKey));
    const daemonState = encodeBase64(encryptLegacy({
        codexUsage: {
            source: 'codex-session-jsonl',
            scannedAt: Date.parse('2026-09-06T12:00:00.000Z'),
            timeZone: 'Asia/Shanghai',
            days: [],
            latestEvent: {
                timestamp: '2026-09-06T11:58:00.000Z',
                rateLimitsTimestamp: '2026-09-06T11:58:00.000Z',
                rateLimits: {
                    planType: 'plus',
                    primary: { usedPercent: 37, windowMinutes: 300, resetsAt: 1788710400 },
                    secondary: { usedPercent: 62, windowMinutes: 10_080, resetsAt: 1789138800 },
                },
            },
        },
    }, encryptionKey));
    const response = await request.post(new URL('/v1/machines', e2eServerUrl).toString(), {
        data: { id: machineId, metadata, daemonState, dataEncryptionKey: null },
        headers,
    });
    expect(response.ok()).toBe(true);

    return async () => {
        const deletion = await request.delete(
            new URL(`/v1/machines/${encodeURIComponent(machineId)}`, e2eServerUrl).toString(),
            { headers },
        );
        expect(deletion.ok() || deletion.status() === 404).toBe(true);
    };
}

test.use({ locale: 'zh-CN' });

test('[USAGE-POPUP-01] 账户菜单在弹窗内展示使用情况', async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    const deleteMachine = await registerUsageMachine(request);
    try {
        await hideExpoDevelopmentOverlay(page);
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.setViewportSize({ width: 1280, height: 900 });

        const appearanceUrl = new URL('/settings/appearance', authenticatedWebUrl);
        appearanceUrl.search = new URL(authenticatedWebUrl).search;
        await page.goto(appearanceUrl.toString());
        const ginghamOption = page.getByText('Gingham', { exact: true });
        await expect(ginghamOption).toBeVisible({ timeout: 120_000 });
        await ginghamOption.click();
        await expect.poll(() => page.evaluate(() => {
            const stored = window.localStorage.getItem('mmkv.default\\local-settings');
            return stored ? JSON.parse(stored).themePack : null;
        })).toBe('gingham');

        await expect.poll(() => page.locator('body').evaluate((element) => (
            window.getComputedStyle(element).backgroundColor
        ))).toBe('rgb(18, 24, 33)');

        const underlyingUrl = page.url();
        const accountTrigger = page.getByTestId('sidebar-account-trigger');
        await accountTrigger.click();
        const menu = page.getByTestId('sidebar-account-menu');
        await expect(menu).toBeVisible();

        const usageAction = page.getByTestId('sidebar-account-usage-action');
        await expect(usageAction).toBeVisible();
        if (evidencePhase === 'after') {
            await expect(usageAction).toHaveCSS('background-color', 'rgb(26, 35, 48)');
            await usageAction.hover();
            await expect(usageAction).toHaveCSS('background-color', 'rgb(31, 42, 56)');
            await page.mouse.down();
            await expect(usageAction).toHaveCSS('background-color', 'rgb(31, 42, 56)');
        }

        const actionOrder = await menu.locator('[role="button"][data-testid^="sidebar-account-"]').evaluateAll((elements) => (
            elements.map((element) => element.getAttribute('data-testid'))
        ));
        expect(actionOrder).toEqual([
            'sidebar-account-profile-action',
            'sidebar-account-settings-action',
            'sidebar-account-details-action',
            'sidebar-account-usage-action',
            'sidebar-account-logout-action',
        ]);

        if (evidencePhase === 'after') await page.mouse.up();
        else await usageAction.click();

        if (evidencePhase === 'before') {
            await expect.poll(() => new URL(page.url()).pathname).toBe('/settings/usage');
            await expect(page.getByText('Codex 用量', { exact: true }).filter({ visible: true })).toBeVisible();
        } else {
            await expect(page).toHaveURL(underlyingUrl);
            await expect(page.getByTestId('sidebar-account-menu')).toHaveCount(0);
            await expect(page.locator('[role="dialog"]')).toHaveCount(1);
            const modal = page.getByRole('dialog', { name: '使用情况' });
            await expect(modal).toBeVisible();
            const dialog = page.getByTestId('sidebar-account-usage-dialog');
            await expect(dialog).toBeVisible();
            await expect(dialog).not.toHaveAttribute('role');
            await expect(dialog).toHaveCSS('background-color', 'rgb(26, 35, 48)');
            await expect(page.getByTestId('sidebar-account-usage-dialog-content')).toBeVisible();
            const closeButton = page.getByTestId('sidebar-account-usage-dialog-close');
            await expect(closeButton).toHaveCSS('color', 'rgb(143, 162, 176)');
            await expect(closeButton).toBeFocused();
            await expect(closeButton).toHaveCSS('background-color', 'rgb(40, 53, 68)');
            await closeButton.hover();
            await expect(closeButton).toHaveCSS('background-color', 'rgb(31, 42, 56)');
            await page.mouse.down();
            await expect(closeButton).toHaveCSS('background-color', 'rgb(31, 42, 56)');
            const dialogBox = await dialog.boundingBox();
            expect(dialogBox).not.toBeNull();
            await page.mouse.move(dialogBox!.x + 80, dialogBox!.y + 80);
            await page.mouse.up();

            await page.keyboard.press('Shift+Tab');
            await expect.poll(() => page.evaluate(() => {
                const owner = document.querySelector('[role="dialog"]');
                return Boolean(owner && (owner === document.activeElement || owner.contains(document.activeElement)));
            })).toBe(true);
            await expect(page.getByTestId('sidebar-account-usage-dialog-backdrop')).not.toBeFocused();
            await expect(closeButton).toBeFocused();
            await expect(closeButton).toHaveCSS('background-color', 'rgb(40, 53, 68)');
            await page.keyboard.press('Tab');
            await expect(closeButton).toBeFocused();
            await expect(closeButton).toHaveCSS('background-color', 'rgb(40, 53, 68)');
            await expect(page.getByText('Codex 用量', { exact: true }).filter({ visible: true })).toBeVisible();
        }
        await expect(page.getByText('63%', { exact: true })).toBeVisible();

        if (process.env.HAPPY_E2E_RECORD === '1') {
            await page.waitForTimeout(1100);
        }
        await page.screenshot({ path: evidencePath(testInfo), fullPage: true });

        if (evidencePhase === 'after') {
            await page.getByTestId('sidebar-account-usage-dialog-close').click();
            await expect(page.getByTestId('sidebar-account-usage-dialog')).toHaveCount(0);
            await expect(page).toHaveURL(underlyingUrl);
            await expect(accountTrigger).toBeFocused();

            await accountTrigger.click();
            await page.getByTestId('sidebar-account-usage-action').click();
            await expect(page.getByTestId('sidebar-account-usage-dialog')).toBeVisible();
            await page.getByTestId('sidebar-account-usage-dialog-backdrop').click({ position: { x: 6, y: 6 } });
            await expect(page.getByTestId('sidebar-account-usage-dialog')).toHaveCount(0);
            await expect(page).toHaveURL(underlyingUrl);
            await expect(accountTrigger).toBeFocused();

            await accountTrigger.click();
            await page.getByTestId('sidebar-account-usage-action').click();
            await expect(page.getByTestId('sidebar-account-usage-dialog')).toBeVisible();
            await expect(page.getByTestId('sidebar-account-usage-dialog-close')).toBeFocused();
            await page.keyboard.press('Escape');
            await expect(page.getByTestId('sidebar-account-usage-dialog')).toHaveCount(0);
            await expect(page).toHaveURL(underlyingUrl);
            await expect(accountTrigger).toBeFocused();
        }
    } finally {
        await deleteMachine();
    }
});
