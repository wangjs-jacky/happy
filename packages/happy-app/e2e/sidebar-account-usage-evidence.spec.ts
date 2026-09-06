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

async function registerUsageFixtures(request: APIRequestContext): Promise<{
    currentMachineId: string;
    sessionId: string;
    cleanup: () => Promise<void>;
}> {
    const url = new URL(authenticatedWebUrl);
    const token = url.searchParams.get('dev_token');
    const secret = url.searchParams.get('dev_secret');
    if (!token || !secret || !e2eServerUrl) throw new Error('Missing local E2E authentication configuration.');

    const headers = {
        Authorization: `Bearer ${token}`,
        'X-Happy-Client': 'playwright-usage-popup-evidence',
    };
    const encryptionKey = new Uint8Array(Buffer.from(secret, 'base64url'));
    const fixtureKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const currentMachineId = `usage-current-${fixtureKey}`;
    const newerOtherMachineId = `usage-other-${fixtureKey}`;
    const usageDay = (date: string, totalTokens: number, sessions: number) => ({
        date,
        inputTokens: totalTokens,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens,
        tokenCountEvents: 1,
        sessions,
        totalOnlyTokens: 0,
    });
    const registerMachine = async (options: {
        id: string;
        host: string;
        scannedAt: string;
        eventAt: string;
        usedPercent: number;
        planType: string;
        days: ReturnType<typeof usageDay>[];
    }) => {
        const metadata = encodeBase64(encryptLegacy({
            host: options.host,
            platform: 'darwin',
            happyCliVersion: '0.0.0-e2e',
            happyHomeDir: '/tmp/.happy',
            homeDir: '/tmp',
        }, encryptionKey));
        const daemonState = encodeBase64(encryptLegacy({
            codexUsage: {
                source: 'codex-session-jsonl',
                scannedAt: Date.parse(options.scannedAt),
                timeZone: 'Asia/Shanghai',
                days: options.days,
                latestEvent: {
                    timestamp: options.eventAt,
                    rateLimitsTimestamp: options.eventAt,
                    rateLimits: {
                        planType: options.planType,
                        primary: { usedPercent: options.usedPercent, windowMinutes: 10_080, resetsAt: 1789138800 },
                    },
                },
            },
        }, encryptionKey));
        const response = await request.post(new URL('/v1/machines', e2eServerUrl).toString(), {
            data: { id: options.id, metadata, daemonState, dataEncryptionKey: null },
            headers,
        });
        expect(response.ok()).toBe(true);
    };

    await registerMachine({
        id: currentMachineId,
        host: 'current-session-mac',
        scannedAt: '2026-09-06T15:05:00.000Z',
        eventAt: '2026-09-06T15:03:00.000Z',
        usedPercent: 35,
        planType: 'pro',
        days: [
            usageDay('2026-09-05', 240_000_000, 12),
            usageDay('2026-09-06', 625_510_000, 86),
        ],
    });
    await registerMachine({
        id: newerOtherMachineId,
        host: 'newer-other-mac',
        scannedAt: '2026-09-06T15:25:00.000Z',
        eventAt: '2026-09-06T15:23:00.000Z',
        usedPercent: 0,
        planType: 'plus',
        days: [],
    });

    const sessionMetadata = encodeBase64(encryptLegacy({
        path: '/tmp/usage-current-session',
        host: 'current-session-mac',
        name: 'Usage current machine evidence',
        flavor: 'codex',
        machineId: currentMachineId,
        lifecycleState: 'running',
        startedBy: 'terminal',
    }, encryptionKey));
    const sessionResponse = await request.post(new URL('/v1/sessions', e2eServerUrl).toString(), {
        data: {
            tag: `usage-popup-${fixtureKey}`,
            metadata: sessionMetadata,
            agentState: null,
            dataEncryptionKey: null,
        },
        headers,
    });
    expect(sessionResponse.ok()).toBe(true);
    const sessionId = (await sessionResponse.json() as { session: { id: string } }).session.id;

    return {
        currentMachineId,
        sessionId,
        cleanup: async () => {
            const archiveResponse = await request.post(
                new URL(`/v1/sessions/${encodeURIComponent(sessionId)}/archive`, e2eServerUrl).toString(),
                { headers },
            );
            expect(archiveResponse.ok() || archiveResponse.status() === 404).toBe(true);
            const sessionDeletion = await request.delete(
                new URL(`/v1/sessions/${encodeURIComponent(sessionId)}`, e2eServerUrl).toString(),
                { headers },
            );
            expect(sessionDeletion.ok() || sessionDeletion.status() === 404).toBe(true);
            for (const machineId of [currentMachineId, newerOtherMachineId]) {
                const deletion = await request.delete(
                    new URL(`/v1/machines/${encodeURIComponent(machineId)}`, e2eServerUrl).toString(),
                    { headers },
                );
                expect(deletion.ok() || deletion.status() === 404).toBe(true);
            }
        },
    };
}

test.use({ locale: 'zh-CN' });

test('[USAGE-POPUP-01] 账户菜单在弹窗内展示使用情况', async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    const fixtures = await registerUsageFixtures(request);
    try {
        await hideExpoDevelopmentOverlay(page);
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.setViewportSize({ width: 1280, height: 900 });

        const sessionUrl = new URL(`/session/${fixtures.sessionId}`, authenticatedWebUrl);
        sessionUrl.search = new URL(authenticatedWebUrl).search;
        await page.goto(sessionUrl.toString());
        await expect(page.getByTestId('session-message-input')).toBeVisible({ timeout: 120_000 });

        const underlyingUrl = page.url();
        const accountTrigger = page.getByTestId('sidebar-account-trigger');
        await accountTrigger.click();
        const menu = page.getByTestId('sidebar-account-menu');
        await expect(menu).toBeVisible();

        const usageAction = page.getByTestId('sidebar-account-usage-action');
        await expect(usageAction).toBeVisible();

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

        await usageAction.click();
        await expect(page).toHaveURL(underlyingUrl);
        await expect(page.getByTestId('sidebar-account-menu')).toHaveCount(0);
        await expect(page.locator('[role="dialog"]')).toHaveCount(1);
        const modal = page.getByRole('dialog', { name: '使用情况' });
        await expect(modal).toBeVisible();
        const dialog = page.getByTestId('sidebar-account-usage-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).not.toHaveAttribute('role');
        await expect(page.getByTestId('sidebar-account-usage-dialog-content')).toBeVisible();
        const closeButton = page.getByTestId('sidebar-account-usage-dialog-close');
        await expect(closeButton).toBeFocused();
        await expect(page.getByText('Codex 用量', { exact: true }).filter({ visible: true })).toBeVisible();
        const expectedRemaining = evidencePhase === 'before' ? '100%' : '65%';
        const unexpectedRemaining = evidencePhase === 'before' ? '65%' : '100%';
        await expect(page.getByText(expectedRemaining, { exact: true })).toBeVisible();
        await expect(page.getByText(unexpectedRemaining, { exact: true })).toHaveCount(0);
        await expect(page.getByText(evidencePhase === 'before' ? 'PLUS' : 'PRO', { exact: true })).toBeVisible();

        const currentDaySummary = evidencePhase === 'before'
            ? '2026-09-06：625.51M 个令牌 · 86 个会话'
            : '2026-09-06：6.26 亿 token · 86 个会话';
        await expect(page.getByText(currentDaySummary, { exact: true })).toBeVisible();

        const priorDayCell = page.getByTestId('codex-usage-day-2026-09-05');
        await priorDayCell.hover();
        if (evidencePhase === 'before') {
            await expect(page.getByText(currentDaySummary, { exact: true })).toBeVisible();
        } else {
            await expect(page.getByText('2026-09-05：2.40 亿 token · 12 个会话', { exact: true })).toBeVisible();
            await expect(priorDayCell).toHaveCSS('transition-duration', '0.12s');
            await expect.poll(() => priorDayCell.evaluate((element) => (
                window.getComputedStyle(element).transform
            ))).not.toBe('none');
        }

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
        await page.close();
        await fixtures.cleanup();
    }
});
