import { expect, test } from '@playwright/test';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;

const viewports = [
    { name: '窄屏', width: 799, height: 900 },
    { name: '断点宽度', width: 800, height: 900 },
    { name: '宽屏', width: 1280, height: 900 },
] as const;

for (const viewport of viewports) {
    test(`${viewport.name}首页可输入且没有 OTA 蒙层`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(authenticatedWebUrl);

        const composer = page.getByRole('textbox');
        await expect(composer).toHaveCount(1);
        await expect(composer).toBeVisible();
        await expect(page.getByRole('button', { name: /OTA/i })).toHaveCount(0);

        const hitTargetIsComposer = await composer.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const hitTarget = document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
            );
            return hitTarget === element;
        });
        expect(hitTargetIsComposer).toBe(true);

        await composer.click();
        await expect(composer).toBeFocused();
        await composer.fill('浏览器 E2E 点击探针');
        await expect(composer).toHaveValue('浏览器 E2E 点击探针');
    });
}

test('桌面侧栏导航控件不覆盖用户卡片', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(authenticatedWebUrl);

    await expect(page.getByRole('textbox')).toBeVisible();

    const zenButton = page.locator('[data-testid="desktop-navigation-controls"]');
    const sidebarCard = page.locator('[data-testid="sidebar-user-card"]');
    await expect(zenButton).toHaveCount(1);
    await expect(sidebarCard).toHaveCount(1);
    const controls = await zenButton.boundingBox();
    const card = await sidebarCard.boundingBox();
    expect(controls).not.toBeNull();
    expect(card).not.toBeNull();
    expect(controls!.x).toBeGreaterThanOrEqual(card!.x + card!.width);

    await page.screenshot({ path: 'test-results/desktop-sidebar-navigation.png', fullPage: true });
});
