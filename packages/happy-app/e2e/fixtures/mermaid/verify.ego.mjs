import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function verifyMermaidPreview(runtime, config) {
    const { taskSpace, cdp, pageInfo, currentTab, listTaskSpaces, useOrCreateTaskSpace } = runtime;
    const task = await taskSpace(config.taskSpaceId);
    const page = task.page('p1');
    let expected = 'http://127.0.0.1:49828/?theme=dark';
    const verifyTarget = async () => {
        assert.equal(task.ownership, 'agent');
        assert.equal((await task.tabs()).find(tab => tab.label === 'p1')?.targetId, config.targetId);
        assert.equal(await page.url(), expected);
    };
    await verifyTarget();
    const frames = [];
    const directory = config.record ? await mkdtemp(join(tmpdir(), 'paws-mermaid-video-')) : null;
    const settle = () => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    const frame = async label => {
        if (!config.record) return;
        await settle();
        await verifyTarget();
        const shot = await page.cdp('Page.captureScreenshot', { format: 'jpeg', quality: 92, captureBeyondViewport: false });
        await verifyTarget();
        const path = join(directory, `frame-${String(frames.length).padStart(2, '0')}.jpg`);
        await writeFile(path, Buffer.from(shot.data, 'base64'));
        frames.push({ label, path });
    };
    const imageReady = () => page.waitForFunction(() => {
        const img = document.querySelector('[data-testid="mermaid-inline-surface"] img');
        return img?.complete && img.naturalWidth > 0;
    });
    const transform = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="mermaid-fullscreen-surface"] svg').parentElement).transform);
    const scale = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-testid="mermaid-fullscreen-surface"] svg').parentElement).transform).a);
    const waitTransform = initial => page.waitForFunction(value => {
        const svg = document.querySelector('[data-testid="mermaid-fullscreen-surface"] svg');
        return svg && getComputedStyle(svg.parentElement).transform !== value;
    }, initial);
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.goto(expected);
    await imageReady();
    const preview = await page.evaluate(() => ({
        height: document.querySelector('[data-testid="mermaid-inline-surface"]').getBoundingClientRect().height,
        nextBottom: document.querySelector('#following-message').getBoundingClientRect().bottom,
        inlineSvg: document.querySelectorAll('[data-testid="mermaid-inline-surface"] svg').length,
        controls: document.querySelectorAll('[data-testid="mermaid-zoom-in"]').length,
    }));
    assert.ok(preview.height <= 322);
    assert.ok(preview.nextBottom < 900);
    assert.equal(preview.inlineSvg, 0);
    assert.equal(preview.controls, 0);
    await frame('长流程图完整预览，后续消息同屏');
    await page.mouse.move(700, 260);
    await page.mouse.wheel(0, 160);
    await page.waitForFunction(() => scrollY > 0);
    await page.mouse.wheel(0, -800);
    await page.waitForFunction(() => scrollY === 0);

    await page.focus('[data-testid="mermaid-fullscreen-open"]');
    await page.keyboard.press('Enter');
    await waitTransform('none');
    const fitted = await page.evaluate(() => {
        const svg = document.querySelector('[data-testid="mermaid-fullscreen-surface"] svg');
        const box = svg.getBoundingClientRect();
        return { box: box.toJSON(), nodes: svg.querySelectorAll('g.node').length, text: svg.textContent };
    });
    assert.equal(fitted.nodes, 11);
    assert.ok(fitted.text.includes('澄清目标') && fitted.text.includes('交付成果'));
    assert.ok(fitted.box.top >= 0 && fitted.box.bottom <= 901);
    assert.ok(fitted.box.left >= 0 && fitted.box.right <= 1441);
    const initial = await transform();
    await frame('键盘打开全屏，整图适配视口');
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -120);
    assert.equal(await transform(), initial);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await waitTransform(initial);
    await page.click('[data-testid="mermaid-zoom-reset"]');
    await page.waitForFunction(value => getComputedStyle(document.querySelector('[data-testid="mermaid-fullscreen-surface"] svg').parentElement).transform === value, initial);
    await page.mouse.move(720, 450);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(720 + i * 12, 450 + i * 8);
    await page.mouse.up();
    await waitTransform(initial);
    const beforeZoomIn = await scale();
    await page.click('[data-testid="mermaid-zoom-in"]');
    await page.click('[data-testid="mermaid-zoom-in"]');
    await page.waitForFunction(previous => new DOMMatrix(getComputedStyle(document.querySelector('[data-testid="mermaid-fullscreen-surface"] svg').parentElement).transform).a > previous, beforeZoomIn);
    await settle();
    const beforeZoomOut = await scale();
    await frame('全屏放大拖拽阅读中文节点');
    await page.click('[data-testid="mermaid-zoom-out"]');
    await page.waitForFunction(previous => new DOMMatrix(getComputedStyle(document.querySelector('[data-testid="mermaid-fullscreen-surface"] svg').parentElement).transform).a < previous, beforeZoomOut);
    await settle();
    await page.click('[data-testid="mermaid-zoom-reset"]');
    await page.waitForFunction(value => getComputedStyle(document.querySelector('[data-testid="mermaid-fullscreen-surface"] svg').parentElement).transform === value, initial);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="mermaid-fullscreen-surface"]'));
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'mermaid-fullscreen-open');
    await page.click('[data-testid="mermaid-fullscreen-open"]');
    await waitTransform('none');
    await page.click('[data-testid="mermaid-fullscreen-close"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="mermaid-fullscreen-surface"]'));
    await frame('关闭返回预览，聊天位置保留');

    expected = 'http://127.0.0.1:49828/?theme=light&shape=wide';
    await page.goto(expected);
    await imageReady();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await frame('浅色横向流程图完整预览');
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    expected = 'http://127.0.0.1:49828/?theme=light';
    await page.goto(expected);
    await imageReady();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(await page.evaluate(() => document.querySelector('[data-testid="mermaid-inline-surface"]').getBoundingClientRect().height <= 322));
    await page.click('[data-testid="mermaid-fullscreen-open"]');
    await waitTransform('none');
    await frame('窄屏全屏适配');
    await page.click('[data-testid="mermaid-fullscreen-close"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="mermaid-fullscreen-surface"]'));
    await frame('窄屏关闭返回，整图与后文均可读');
    const result = { status: 'pass', cases: ['BOUNDED-WHOLE-IMAGE', 'PAGE-SCROLL', 'KEYBOARD-OPEN-ESCAPE', 'FULLSCREEN-FIT-ZOOM-PAN-RESET', 'LIGHT-WIDE', 'LIGHT-390'], directory, frames };
    console.log(JSON.stringify(result));
    return result;
}
