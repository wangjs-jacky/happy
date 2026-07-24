import { expect, test } from '@playwright/test';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;

function authenticatedRoute(pathname: string): string {
    const url = new URL(authenticatedWebUrl);
    url.pathname = pathname;
    return url.toString();
}

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

test('Web 弹窗不会触发已弃用样式、组件或原生动画警告', async ({ page }) => {
    const modalWarnings: string[] = [];
    page.on('console', (message) => {
        if (
            message.type() === 'warning'
            && (
                message.text().includes('"shadow*" style props are deprecated')
                || message.text().includes('TouchableWithoutFeedback is deprecated')
                || message.text().includes('useNativeDriver` is not supported')
            )
        ) {
            modalWarnings.push(message.text());
        }
    });

    await page.goto(authenticatedWebUrl);
    await expect(page.getByRole('textbox')).toBeVisible();
    await page.goto(new URL('/settings/account', authenticatedWebUrl).toString());
    await page.getByText('Logout', { exact: true }).click();
    await expect(page.getByText('Are you sure you want to logout?', { exact: false })).toBeVisible();
    await page.getByText('Cancel', { exact: true }).click();

    await page.goto(new URL('/dev/modal-demo', authenticatedWebUrl).toString());
    await page.getByText('Custom Modal', { exact: true }).first().click();
    const customModalMessage = page.getByText(
        'This is a completely custom modal component. You can put anything in here!',
        { exact: true },
    );
    await expect(customModalMessage).toBeVisible();
    await page.getByText('Custom Modal', { exact: true }).last().click();
    await expect(customModalMessage).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(customModalMessage).toHaveCount(0);

    expect(modalWarnings).toEqual([]);
});

test('Web 深色命令面板跟随主题并支持完整关闭交互', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(new URL('/settings/appearance', authenticatedWebUrl).toString());
    await page.getByText('Terminal', { exact: true }).click();
    await page.goto(new URL('/settings/features', authenticatedWebUrl).toString());

    const featureSwitches = page.getByRole('switch');
    await expect(featureSwitches).toHaveCount(10);
    const commandPaletteSwitch = page.getByRole('switch', { name: 'Command Palette' });
    await expect(commandPaletteSwitch).not.toBeChecked();
    await commandPaletteSwitch.click();

    await page.keyboard.press('Meta+KeyK');
    const commandInput = page.getByTestId('command-palette-input');
    await expect(commandInput).toBeVisible();

    const paletteColors = await page.evaluate(() => {
        const input = document.querySelector('[data-testid="command-palette-input"]');
        const palette = document.querySelector('[data-testid="command-palette"]');
        const selected = document.querySelector('[data-testid="command-palette-item-new-session"]');
        if (!input || !palette || !selected) {
            throw new Error('找不到命令面板主题探针');
        }
        return {
            input: window.getComputedStyle(input).color,
            surface: window.getComputedStyle(palette).backgroundColor,
            selected: window.getComputedStyle(selected).backgroundColor,
        };
    });
    expect(paletteColors).toEqual({
        input: 'rgb(229, 229, 231)',
        surface: 'rgb(19, 19, 22)',
        selected: 'rgb(32, 32, 38)',
    });

    await commandInput.press('Escape');
    await expect(commandInput).toHaveCount(0);

    await page.keyboard.press('Meta+KeyK');
    await expect(page.getByTestId('command-palette-input')).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(page.getByTestId('command-palette-input')).toHaveCount(0);

    await commandPaletteSwitch.click();
    await expect(commandPaletteSwitch).not.toBeChecked();

    await page.goto(new URL('/settings/appearance', authenticatedWebUrl).toString());
    await page.getByText('Caramel', { exact: true }).click();
});

test.describe('中文 Web 命令面板', () => {
    test.use({ locale: 'zh-CN' });

    test('静态命令、类别和空结果均完成本地化', async ({ page }) => {
        await page.goto(new URL('/settings/features', authenticatedWebUrl).toString());

        const commandPaletteSwitch = page.getByRole('switch', { name: '命令面板' });
        await expect(commandPaletteSwitch).not.toBeChecked();
        await commandPaletteSwitch.click();
        await page.keyboard.press('Meta+KeyK');

        const commandInput = page.getByTestId('command-palette-input');
        await expect(commandInput).toHaveAttribute('placeholder', '输入命令或搜索...');
        await expect(page.getByText('导航', { exact: true })).toBeVisible();
        await expect(page.getByText('开始新会话', { exact: true })).toBeVisible();
        await expect(page.getByText('配置应用偏好', { exact: true })).toBeVisible();

        await commandInput.fill('不会匹配任何命令的关键词');
        await expect(page.getByText('未找到命令', { exact: true })).toBeVisible();

        await commandInput.press('Escape');
        await commandPaletteSwitch.click();
        await expect(commandPaletteSwitch).not.toBeChecked();
    });
});

test('Web 账户页不会让用户触发不支持的推送重新注册', async ({ page }) => {
    await page.goto(authenticatedWebUrl);
    await expect(page.getByRole('textbox')).toBeVisible();
    await page.goto(new URL('/settings/account', authenticatedWebUrl).toString());
    await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();

    const reRegisterAction = page.getByText('Re-register This Device', { exact: true });
    const isDisabled = await reRegisterAction.evaluate((element) => {
        let current: HTMLElement | null = element as HTMLElement;
        while (current) {
            if (
                current.getAttribute('aria-disabled') === 'true'
                || ('disabled' in current && (current as HTMLButtonElement).disabled)
            ) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    });
    expect(isDisabled).toBe(true);

    await reRegisterAction.click({ force: true });
    await page.waitForTimeout(300);

    await expect(
        page.getByText('Push notifications are not enabled for this device yet.', { exact: true }),
    ).toHaveCount(0);
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

test.describe('中文 Web 语音设置', () => {
    test.use({ locale: 'zh-CN' });

    test('开发者诊断完成本地化、保持紧凑且页面加载没有失败 Fetch', async ({ page }) => {
        await page.goto(authenticatedWebUrl);
        await expect(page.getByRole('textbox')).toBeVisible();

        const voicePage = await page.context().newPage();
        const failedFetchStatuses: number[] = [];
        const failedUsageFetchRequests: string[] = [];
        voicePage.on('response', (response) => {
            if (response.request().resourceType() === 'fetch' && response.status() >= 400) {
                failedFetchStatuses.push(response.status());
            }
        });
        voicePage.on('requestfailed', (request) => {
            if (request.resourceType() === 'fetch' && request.method() === 'GET') {
                failedUsageFetchRequests.push(request.failure()?.errorText ?? 'unknown');
            }
        });

        await voicePage.setViewportSize({ width: 1280, height: 900 });
        await voicePage.goto(new URL('/settings/voice', authenticatedWebUrl).toString());

        await expect(voicePage.getByText('开发者', { exact: true })).toBeVisible();
        const statusTitle = voicePage.getByText('语音实验状态', { exact: true });
        await expect(statusTitle).toBeVisible();
        await expect(voicePage.getByText('重置语音计数', { exact: true })).toBeVisible();
        await expect(voicePage.getByText(/Voice 升级推荐：对照组/)).toBeVisible();
        await expect(voicePage.getByText(/来源：默认值/)).toBeVisible();
        await expect(voicePage.getByText(/访问方式：Paws 服务器访问控制/)).toBeVisible();
        await expect(voicePage.getByText(/实验功能设置：(开启|关闭)/)).toBeVisible();
        await expect(voicePage.getByText(/软付费墙展示次数：0/)).toBeVisible();
        await expect(voicePage.getByText(/新手引导提示词加载次数：0/)).toBeVisible();
        await expect(voicePage.getByText(/Voice 消息数：0/)).toBeVisible();

        await expect(voicePage.getByTestId('voice-usage-loading')).toHaveCount(0);
        const statusRowBox = await voicePage.getByTestId('voice-experiment-status-row').boundingBox();
        const resetRowBox = await voicePage.getByTestId('voice-reset-counters-row').boundingBox();
        const developerFooterBox = await voicePage.getByText(
            '当前 Voice 灰度发布的开发者诊断与本地控制。除非同时启用“直接连接”和自定义 ElevenLabs 代理，否则付费 Voice 的访问控制由 Paws 服务器处理。',
            { exact: true },
        ).boundingBox();
        expect(statusRowBox).not.toBeNull();
        expect(resetRowBox).not.toBeNull();
        expect(developerFooterBox).not.toBeNull();
        expect(statusRowBox!.height).toBeLessThanOrEqual(resetRowBox!.height + 1);
        expect(statusRowBox!.y + statusRowBox!.height).toBeLessThanOrEqual(resetRowBox!.y);
        expect(resetRowBox!.y + resetRowBox!.height).toBeLessThanOrEqual(developerFooterBox!.y);
        expect(failedFetchStatuses).toEqual([]);
        expect(failedUsageFetchRequests).toEqual([]);
        await voicePage.screenshot({
            path: 'test-results/voice-settings-desktop-zh.png',
            fullPage: true,
        });
    });
});

test.describe('中文 Web 语言设置', () => {
    test.use({ locale: 'zh-CN' });

    test('切换语言前使用待确认语义并允许取消', async ({ page }) => {
        await page.goto(new URL('/settings/language', authenticatedWebUrl).toString());
        await page.getByText('English', { exact: true }).click();

        await expect(page.getByText('需要重启应用', { exact: true })).toBeVisible();
        await page.getByText('取消', { exact: true }).click();
        await expect(page.getByText('需要重启应用', { exact: true })).toHaveCount(0);
    });
});

test.describe('中文 Web 资料与使用情况设置', () => {
    test.use({ locale: 'zh-CN' });

    test('使用情况提供可见标题、周期按钮语义和空数据反馈', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(authenticatedRoute('/settings/usage'));

        const visibleTitle = page.getByText('使用情况', { exact: true }).filter({ visible: true });
        await expect(visibleTitle).toBeVisible();
        const titleBox = await visibleTitle.boundingBox();
        expect(titleBox).not.toBeNull();
        expect(titleBox!.width).toBeGreaterThan(0);
        expect(titleBox!.height).toBeGreaterThan(0);

        await expect(page.getByText('暂无使用数据', { exact: true })).toBeVisible();
        await expect(page.getByRole('tablist', { name: '使用情况' })).toBeVisible();
        const todayButton = page.getByRole('tab', { name: '今天' });
        const weekButton = page.getByRole('tab', { name: '过去 7 天' });
        const monthButton = page.getByRole('tab', { name: '过去 30 天' });
        await expect(todayButton).toBeVisible();
        await expect(weekButton).toBeVisible();
        await expect(monthButton).toBeVisible();
        await expect(weekButton).toHaveAttribute('aria-selected', 'true');

        await todayButton.click();
        await expect(todayButton).toHaveAttribute('aria-selected', 'true');
        await expect(weekButton).toHaveAttribute('aria-selected', 'false');
    });

    test('资料保存操作暴露按钮语义并在可逆编辑后恢复禁用', async ({ page }) => {
        await page.goto(authenticatedRoute('/settings/profile'));

        const saveButton = page.getByRole('button', { name: '保存' });
        const nameInput = page.getByRole('textbox', { name: '姓名' });
        await expect(saveButton).toBeDisabled();

        const originalName = await nameInput.inputValue();
        await nameInput.fill(`${originalName}x`);
        await expect(saveButton).toBeEnabled();

        await nameInput.fill(originalName);
        await expect(saveButton).toBeDisabled();
    });
});

test.describe('中文 Web 自定义指令与 Skills 设置', () => {
    test.use({ locale: 'zh-CN' });

    test('自定义指令输入框使用可见标签且适配 800px 桌面断点', async ({ page }) => {
        await page.setViewportSize({ width: 800, height: 900 });
        await page.goto(authenticatedRoute('/settings/custom-instructions'));

        const instructions = page.getByRole('textbox', { name: '指令内容' });
        await expect(instructions).toBeVisible();
        const inputBox = await instructions.boundingBox();
        expect(inputBox).not.toBeNull();
        expect(inputBox!.width).toBeGreaterThan(450);

        await instructions.focus();
        await expect(instructions).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(instructions).not.toBeFocused();
    });

    test('Skills 空态或搜索交互不会产生 key 或文本节点错误', async ({ page }) => {
        const renderErrors: string[] = [];
        page.on('console', (message) => {
            if (
                message.type() === 'error'
                && (
                    message.text().includes('Encountered two children with the same key')
                    || message.text().includes('Unexpected text node')
                )
            ) {
                renderErrors.push(message.text());
            }
        });

        await page.goto(authenticatedRoute('/settings/skills'));
        const search = page.getByRole('textbox', { name: '搜索名称或触发词…' });
        const noMachine = page.getByText('无在线机器，请先连接一台机器', { exact: true });
        await expect(search.or(noMachine)).toBeVisible();

        if (await search.isVisible()) {
            await search.fill('zzzz-audit-no-match');
            await expect(page.getByText('无匹配的 Skills', { exact: true })).toBeVisible();
            await search.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
            await search.press('Backspace');
            await expect(search).toHaveValue('');
        } else {
            await expect(noMachine).toBeVisible();
        }

        expect(renderErrors).toEqual([]);
    });
});
