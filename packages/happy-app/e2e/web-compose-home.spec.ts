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

test('Web 启动不会注册无效的 push token listener', async ({ page }) => {
    const unsupportedPushTokenWarnings: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'warning' && message.text().includes('Listening to push token changes')) {
            unsupportedPushTokenWarnings.push(message.text());
        }
    });

    await page.goto(new URL('/new', authenticatedWebUrl).toString());
    await expect(page.getByRole('textbox')).toBeVisible();

    expect(unsupportedPushTokenWarnings).toEqual([]);
});

test('Web 启动不会使用已弃用的 pointerEvents 组件属性', async ({ page }) => {
    const deprecatedPointerEventsWarnings: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'warning' && message.text().includes('props.pointerEvents is deprecated')) {
            deprecatedPointerEventsWarnings.push(message.text());
        }
    });

    await page.goto(new URL('/new', authenticatedWebUrl).toString());
    await expect(page.getByRole('textbox')).toBeVisible();

    expect(deprecatedPointerEventsWarnings).toEqual([]);
});

test('Web 外观设置不会使用已弃用的 shadow 样式或 pointerEvents 组件属性', async ({ page }) => {
    const deprecatedShadowWarnings: string[] = [];
    const deprecatedPointerEventsWarnings: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'warning' && message.text().includes('"shadow*" style props are deprecated')) {
            deprecatedShadowWarnings.push(message.text());
        }
        if (message.type() === 'warning' && message.text().includes('props.pointerEvents is deprecated')) {
            deprecatedPointerEventsWarnings.push(message.text());
        }
    });

    await page.goto(new URL('/settings/appearance', authenticatedWebUrl).toString());
    await page.waitForFunction(() => document.querySelectorAll('[role="switch"]').length > 0);

    expect(deprecatedShadowWarnings).toEqual([]);
    expect(deprecatedPointerEventsWarnings).toEqual([]);
});

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

test('桌面问候语与输入框内容列对齐且代表性中文标题保持单行', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(new URL('/new', authenticatedWebUrl).toString());
    await expect(page.getByRole('textbox')).toBeVisible();

    const greeting = page.locator('[data-testid="compose-home-greeting"]:visible');
    const composerContent = page.locator('[data-testid="message-composer-content"]:visible');
    const greetingBox = await greeting.boundingBox();
    const composerContentBox = await composerContent.boundingBox();

    expect(greetingBox).not.toBeNull();
    expect(composerContentBox).not.toBeNull();
    expect(Math.abs(greetingBox!.x - composerContentBox!.x)).toBeLessThanOrEqual(1);

    const representativeGreetingFitsOneLine = await greeting.evaluate((element) => {
        const probe = element.cloneNode() as HTMLElement;
        probe.removeAttribute('data-testid');
        probe.textContent = '嗨 jacky，今天和 Paws 做点什么';
        probe.style.position = 'fixed';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        element.parentElement!.appendChild(probe);

        const { height } = probe.getBoundingClientRect();
        const lineHeight = Number.parseFloat(window.getComputedStyle(probe).lineHeight);
        probe.remove();
        return height <= lineHeight + 1;
    });
    expect(representativeGreetingFitsOneLine).toBe(true);
});

test('手机首页保留菜单按钮并能打开抽屉', async ({ page }) => {
    await page.setViewportSize({ width: 799, height: 900 });
    await page.goto(authenticatedWebUrl);
    await expect(page.getByRole('textbox')).toBeVisible();

    const phoneDrawerButton = page.getByTestId('compose-home-drawer-button');
    const sidebarCard = page.getByTestId('sidebar-user-card');
    await expect(phoneDrawerButton).toBeVisible();
    const closedSidebarBox = await sidebarCard.boundingBox();
    expect(closedSidebarBox).not.toBeNull();
    expect(closedSidebarBox!.x + closedSidebarBox!.width).toBeLessThanOrEqual(0);

    await phoneDrawerButton.click();
    await expect.poll(async () => (await sidebarCard.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
});

for (const width of [800, 1280]) {
    test(`宽度 ${width}px 的桌面首页不显示手机抽屉菜单`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(authenticatedWebUrl);
        await expect(page.getByRole('textbox')).toBeVisible();

        await expect(page.getByTestId('compose-home-drawer-button')).toHaveCount(0);
    });
}

for (const width of [800, 1280]) {
    test(`宽度 ${width}px 的 /new 使用全局返回，且头部控件命中区域不重叠`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(authenticatedWebUrl);
        await expect(page.getByRole('textbox')).toBeVisible();
        await page.getByTestId('sidebar-new-session-button').click();
        await expect(page).toHaveURL(new URL('/new', authenticatedWebUrl).toString());

        await expect(page.getByTestId('compose-home-back-button')).toHaveCount(0);
        const navigationControls = page.getByTestId('desktop-navigation-controls');
        const backButton = page.getByTestId('desktop-navigation-back-button');
        const modelChip = page.locator('[data-testid="compose-home-model-chip"]:visible');
        const controlsBox = await navigationControls.boundingBox();
        const modelChipBox = await modelChip.boundingBox();
        expect(controlsBox).not.toBeNull();
        expect(modelChipBox).not.toBeNull();
        expect(modelChipBox!.x - 8).toBeGreaterThanOrEqual(controlsBox!.x + controlsBox!.width + 10);
        await expect(backButton).toBeEnabled();
        await backButton.click();

        await expect(page).toHaveURL(authenticatedWebUrl);
        await expect(page.getByRole('textbox')).toBeVisible();
    });
}
