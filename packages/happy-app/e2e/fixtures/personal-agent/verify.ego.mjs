/** Run inside ego-browser nodejs against the exact recorded task/page. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
export async function run(context, options) {
    const { taskSpace, listTaskSpaces } = context;
    const output = fileURLToPath(new URL('../../../test-results/personal-agent/', import.meta.url));
    const runtime = JSON.parse(await fs.readFile(path.join(output, 'runtime.json'), 'utf8'));
    const task = await taskSpace(options.spaceId), rawPage = task.page('p2');
    let pageOperation = Promise.resolve();
    const serialize = run => { const result = pageOperation.then(run, run); pageOperation = result.then(() => {}, () => {}); return result; };
    // Raw CDP invalidates Ego action references: never capture concurrently
    // with an element action in the same Page.
    const page = options.record ? new Proxy(rawPage, { get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => serialize(() => value.apply(target, args)) : value; } }) : rawPage;
    assert.equal((await task.tabs()).find(tab => tab.label === 'p2')?.targetId, options.targetId);
    assert.equal(await page.url(), options.url);
    assert.equal(options.url, runtime.webUrl + '/personal');
    await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1680, height: 960, deviceScaleFactor: 1, mobile: false });
    const steps = [], frames = [], captures = [], checks = {};
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    let stopped = false, recordingError;
    const directory = path.join(output, options.record ? `${options.part}-replay-frames` : 'verification');
    await fs.mkdir(directory, { recursive: true });
    // Sample this exact Ego page for video only. This does not query business
    // status. Page.cdp currently rejects the legitimate screencast ACK field.
    const pump = options.record ? (async () => { while (!stopped) {
        const capture = await page.cdp('Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: false });
        const file = path.join(directory, String(frames.length).padStart(6, '0') + '.jpg');
        await fs.writeFile(file, Buffer.from(capture.data, 'base64'));
        frames.push({ file, timestamp: Date.now() / 1000 });
        await pause(160);
    } })().catch(error => { recordingError = String(error); }) : Promise.resolve();
    const step = label => { steps.push({ label, time: Date.now() }); console.log('PERSONAL_STEP ' + label); };
    const capture = async label => {
        if (!options.captureHelperUrl?.startsWith('file://')) throw new Error('Pass the capture helper URL provided by this Happy runtime');
        const { captureVerifiedBrowserStep } = await import(options.captureHelperUrl);
        await pause(900);
        const result = await captureVerifiedBrowserStep({ cdp: (method, params) => page.cdp(method, params), pageInfo: () => page.info(), currentTab: async () => (await task.tabs()).find(tab => tab.active), listTaskSpaces, useOrCreateTaskSpace: async id => ({ id: (await taskSpace(id)).spaceId }) }, options.url, { sessionId: options.sessionId, runId: options.runId, skillName: 'ego-browser', taskSpaceId: options.spaceId, targetId: options.targetId });
        captures.push({ label, ...result }); console.log('PERSONAL_CAPTURE ' + JSON.stringify({ label, ...result }));
    };
    const visible = selector => page.waitForSelector(selector, { state: 'visible', timeout: 30000 });
    const controller = async action => { const response = await fetch(runtime.controllerUrl + '/' + action, { method: 'POST' }); assert(response.ok); };
    try {
        if (options.part === 'chat') {
            await visible('[data-testid="personal-message-input"]');
            await page.fill('[data-testid="personal-message-input"]', '验收：同一段个人对话中的加密发送与回复。');
            await page.click('[data-testid="personal-message-send"]');
            await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="personal-assistant-bubble"]')].some(element => element.textContent.includes('Personal 隔离交互验收通过传输层')), undefined, { timeout: 30000 }); step('真实加密消息往返');
            await page.fill('[data-testid="personal-message-input"]', '保留多行草稿\n第二行');
            await controller('pending?history=1'); await visible('[data-testid="personal-pending-permission"]');
            assert.equal(await page.evaluate(() => document.querySelectorAll('[data-testid="personal-thinking"]').length), 0);
            await capture('固定审批入口与原对话草稿');
            await page.snapshot(); checks.fixedApproval = true;
            // PermissionFooter has one allow button in the fixed request panel.
            await page.click('[data-testid="personal-pending-permission"] [data-testid="permission-approve-button"]');
            await page.waitForSelector('[data-testid="personal-pending-permission"]', { state: 'hidden', timeout: 15000 }); step('单次审批完成');
            await controller('running'); await visible('[data-testid="personal-stop"]'); await page.click('[data-testid="personal-stop"]');
            await visible('[data-testid="personal-message-send"]'); step('停止运行');
            await controller('offline'); await visible('[data-testid="personal-reconnect"]'); await page.click('[data-testid="personal-reconnect"]');
            await page.waitForSelector('[data-testid="personal-reconnect"]', { state: 'hidden', timeout: 15000 }); step('同ID重连');
            await page.goto(options.url); await visible('[data-testid="personal-message-input"]');
            assert.equal(await page.evaluate(() => document.querySelector('[data-testid="personal-message-input"]').value), '保留多行草稿\n第二行');
            const metrics = await (await fetch(runtime.controllerUrl + '/metrics')).json();
            assert(metrics.messages >= 1 && metrics.approvals >= 1 && metrics.aborts >= 1 && metrics.resumes >= 1); checks.metrics = metrics; checks.draft = 'preserved after reload';
            step('刷新后草稿与对话保留'); await capture('个人对话发送、停止与重连验收完成');
        } else if (options.part === 'computer') {
            if (await page.evaluate(() => !!document.querySelector('[data-testid="personal-new-computer"]'))) await page.click('[data-testid="personal-new-computer"]');
            await visible('[data-testid="personal-target-docker"]'); await visible('[data-testid="personal-start-conversation"]');
            await page.click('[data-testid="personal-start-conversation"]'); await visible('[data-testid="personal-open-computer"]');
            step('显式创建隔离对话'); await page.click('[data-testid="personal-open-computer"]'); await visible('[data-testid="personal-computer-panel"]');
            await page.click('loc=role:button[name="启动电脑"]'); await visible('[data-testid="personal-computer-canvas"]');
            await page.waitForFunction(() => document.querySelector('[data-testid="personal-computer-canvas"] img')?.complete, undefined, { timeout: 30000 });
            checks.initialFrame = await page.evaluate(() => { const image = document.querySelector('[data-testid="personal-computer-canvas"] img'); return { width: image.naturalWidth, height: image.naturalHeight }; });
            step('真实电脑启动与加密画面');
            await page.click('[data-testid="personal-computer-control"]'); await visible('text="你正在接管 · Agent 已暂停"');
            await page.waitForFunction(() => !document.querySelector('[data-testid="personal-computer-address"]').readOnly, undefined, { timeout: 15000 });
            await page.fill('[data-testid="personal-computer-address"]', 'https://example.com/'); await page.click('loc=role:button[name="前往"]');
            await page.waitForFunction(() => document.querySelector('[data-testid="personal-computer-address"]').placeholder === 'https://example.com/', undefined, { timeout: 20000 });
            step('人工接管后导航'); await capture('真实隔离浏览器：人工接管与导航');
            const splitWidth = await page.evaluate(() => document.querySelector('[data-testid="personal-computer-canvas"]').getBoundingClientRect().width);
            await page.click('[data-testid="personal-computer-expand"]');
            await page.waitForFunction(width => document.querySelector('[data-testid="personal-computer-canvas"]').getBoundingClientRect().width > width * 1.5, splitWidth, { timeout: 10000 });
            checks.expanded = true; await capture('展开电脑画面：保留人工控制');
            await page.click('[data-testid="personal-computer-expand"]');
            await page.click('loc=role:button[name="关闭电脑面板"]'); await page.click('[data-testid="personal-open-computer"]');
            await visible('text="另一窗口正在接管 · Agent 已暂停"'); await page.click('[data-testid="personal-computer-control"]');
            await visible('text="你正在接管 · Agent 已暂停"'); await page.click('[data-testid="personal-computer-control"]');
            await visible('text="Agent 控制 · 当前为只读查看"'); step('关闭不交还、显式重接管与交还');
            await capture('云电脑交还 Agent：只读查看');
            await page.click('loc=role:button[name="停止电脑"]'); await visible('text="电脑尚未启动"');
            await page.click('loc=role:button[name="关闭电脑面板"]'); await page.click('[data-testid="personal-conversations"]');
            const choices = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="personal-select-"]')].map(el => ({ id: el.getAttribute('data-testid'), text: el.innerText })));
            const local = choices.find(choice => choice.text.includes('本地工作区')); assert(local);
            await page.click(`[data-testid="${local.id}"]`); await visible('[data-testid="personal-new-computer"]'); await visible('[data-testid="personal-message-input"]');
            assert.equal(await page.evaluate(() => document.querySelector('[data-testid="personal-message-input"]').value), '保留多行草稿\n第二行');
            checks.oldLocalDraft = true; checks.computerStopped = true; step('返回原本地对话与草稿'); await capture('原对话仍可继续：云电脑已停止');
        } else throw new Error('Unknown verification part');
    } finally {
        stopped = true; await pump;
        await fs.writeFile(path.join(output, `${options.part}-${options.record ? 'replay' : 'verification'}.json`), JSON.stringify({ steps, frames, captures, checks, recordingError }, null, 2));
    }
    assert(!recordingError, recordingError); return { steps, frames: frames.length, captures, checks };
}
