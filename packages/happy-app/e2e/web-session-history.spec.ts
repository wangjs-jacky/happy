import { expect, test } from '@playwright/test';
import { encodeBase64, encryptLegacy } from '../../happy-cli/src/api/encryption';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;

function historyRoute(): string {
    const url = new URL(authenticatedWebUrl);
    url.pathname = '/session/recent';
    return url.toString();
}

test('[HISTORY-WHEEL-01] one wheel-to-end gesture requests and renders the next history page', async ({ page }) => {
    // This deterministic Playwright case documents the local harness contract.
    // Production acceptance executes the same single-gesture case with Ego only.
    const secret = new URL(authenticatedWebUrl).searchParams.get('dev_secret');
    if (!secret) throw new Error('Missing local history E2E encryption secret.');
    const encryptionKey = new Uint8Array(Buffer.from(secret, 'base64url'));
    const now = Date.now();
    const snapshots = Array.from({ length: 55 }, (_, index) => ({
        id: `history-wheel-${String(index).padStart(2, '0')}`,
        seq: index + 1,
        metadata: encodeBase64(encryptLegacy({
            path: `/workspace/history-wheel-${index}`,
            host: 'local-history-e2e',
            name: `History wheel session ${index}`,
            flavor: 'codex',
            lifecycleState: 'stopped',
            startedBy: 'terminal',
        }, encryptionKey)),
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        dataEncryptionKey: null,
        active: false,
        activeAt: now - index,
        createdAt: now - index * 60_000,
        updatedAt: now - index * 60_000,
    }));

    await page.route('**/v2/sessions**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/v2/sessions/active') {
            await route.fulfill({ json: { sessions: [] } });
            return;
        }
        if (url.pathname !== '/v2/sessions') {
            await route.continue();
            return;
        }
        const secondPage = url.searchParams.has('cursor');
        await route.fulfill({
            json: secondPage
                ? { sessions: snapshots.slice(50), nextCursor: null, hasNext: false }
                : { sessions: snapshots.slice(0, 50), nextCursor: 'cursor_v1_history-wheel-49', hasNext: true },
        });
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(historyRoute());
    await expect(page.getByTestId('session-history-row-history-wheel-00')).toBeVisible();
    await expect(page.getByTestId('session-history-row-history-wheel-50')).toHaveCount(0);

    const nextPageRequest = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return url.pathname === '/v2/sessions' && url.searchParams.get('cursor') === 'cursor_v1_history-wheel-49';
    });
    await page.getByTestId('session-history-list').hover();
    await page.mouse.wheel(0, 100_000);

    const request = await nextPageRequest;
    expect(new URL(request.url()).searchParams.get('cursor')).toBe('cursor_v1_history-wheel-49');
    await expect(page.getByTestId('session-history-row-history-wheel-50')).toHaveCount(1);
});
