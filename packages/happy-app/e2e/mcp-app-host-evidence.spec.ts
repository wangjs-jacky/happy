import { expect, test } from '@playwright/test';
import {
    findMcpAppFrames,
    injectUnexpectedSourceMessage,
    requireMcpAppE2eEnvironment,
    saveMcpAppEvidence,
    sessionUrl,
} from './helpers/mcpAppHarness';

const environment = requireMcpAppE2eEnvironment();
test.use({ storageState: environment.storageState });

test.describe.serial('MCP App real-origin Web Host', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(sessionUrl(environment), { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('mcp-app-content')).toBeVisible({ timeout: 30_000 });
    });

    test('[MCP-WEB-001] renders a read-only App on the sandbox origin', async ({ page }, testInfo) => {
        const { proxy, view } = await findMcpAppFrames(page, environment.sandboxOrigin, environment.webOrigin);
        expect(new URL(proxy.url()).origin).toBe(environment.sandboxOrigin);
        expect(new URL(proxy.url()).origin).not.toBe(new URL(page.url()).origin);
        await expect(view.locator('[data-testid="mcp-example-root"]')).toHaveCount(1);
        await expect(view.getByTestId('readiness-title')).toHaveText('Paws MCP Apps Host E2E');
        await expect(view.getByTestId('readiness-score')).toContainText('4 / 4');
        await saveMcpAppEvidence(page, testInfo, 'mcp-web-001-success.png');
    });

    test('[MCP-WEB-002] blocks parent DOM and cookie access', async ({ page }, testInfo) => {
        const { view } = await findMcpAppFrames(page, environment.sandboxOrigin, environment.webOrigin);
        const access = await view.evaluate(() => {
            try {
                void window.top!.document.cookie;
                return 'accessible';
            } catch (error) {
                return error instanceof DOMException ? error.name : 'unexpected-error';
            }
        });
        expect(access).toBe('SecurityError');
        await saveMcpAppEvidence(page, testInfo, 'mcp-web-002-isolation.png');
    });

    test('[MCP-WEB-003] rejects a forged Proxy message', async ({ page }, testInfo) => {
        const { proxy, view } = await findMcpAppFrames(page, environment.sandboxOrigin, environment.webOrigin);
        const proxyUrl = proxy.url();
        const viewUrl = view.url();
        await injectUnexpectedSourceMessage(page, environment.sandboxOrigin);
        expect(page.frames()).toContain(proxy);
        expect(page.frames()).toContain(view);
        expect(proxy.url()).toBe(proxyUrl);
        expect(view.url()).toBe(viewUrl);
        expect(view.parentFrame()).toBe(proxy);
        await expect(view.locator('[data-testid="mcp-example-root"]')).toHaveCount(1);
        await expect(page.getByTestId('mcp-app-content')).toBeVisible();
        await expect(page.getByTestId('mcp-app-error')).toHaveCount(0);
        await saveMcpAppEvidence(page, testInfo, 'mcp-web-003-forged-source-stable.png');
    });

    test('[MCP-WEB-004] mediates an App tool call and teardown', async ({ page }, testInfo) => {
        const { view } = await findMcpAppFrames(page, environment.sandboxOrigin, environment.webOrigin);
        await view.getByTestId('mcp-example-tool-call').click();
        await expect(view.getByTestId('mcp-example-tool-result')).toHaveText('approved');
        await saveMcpAppEvidence(page, testInfo, 'mcp-web-004-interaction.png');
        const home = new URL('/', environment.authenticatedWebUrl).toString();
        await page.goto(home, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-testid="mcp-app-sandbox-frame"]')).toHaveCount(0);
    });

    test('[MCP-WEB-005] keeps the tool card when the sandbox is unavailable', async ({ page }, testInfo) => {
        await page.route(`${environment.sandboxOrigin}/mcp-app-sandbox/host?*`, (route) => route.abort('failed'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('tool-card-header')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('mcp-app-error')).toBeVisible();
        await expect(page.locator('[data-testid="mcp-app-sandbox-frame"]')).toHaveCount(0);
        await saveMcpAppEvidence(page, testInfo, 'mcp-web-005-fallback.png');
    });
});
