import { describe, it, expect } from 'vitest';
import { createScreenshotTools } from './startHappyServer';
import { ScreenshotStore } from '../../utils/screenshotStore';

describe('createScreenshotTools', () => {
    it('take：存库 + 触发信号 + 返回纯文本引用（无 base64 字节）', async () => {
        const store = new ScreenshotStore();
        const signals: any[] = [];
        const tools = createScreenshotTools({
            store,
            capture: async () => '/tmp/x.png',
            readBase64: async () => 'BYTES',
            signalNewScreenshot: (refs) => signals.push(refs),
            now: () => 123,
        });
        const out = await tools.take({ target: 'browser', note: '登录页' });
        // id 现在带进程级 nonce 前缀，不再是裸 "1"。断言返回文本含实际 id 即可。
        const takenId = store.list()[0].id;
        expect(out).toContain(`#${takenId}`);
        expect(out).toMatch(/get_screenshot/);
        expect(out).not.toMatch(/BYTES/); // 字节不进返回（不进上下文）
        expect(signals).toHaveLength(1); // 触发了向 App 的信号
        expect(store.list()).toHaveLength(1);
    });

    it('take：未传 target 默认 desktop', async () => {
        const store = new ScreenshotStore();
        const tools = createScreenshotTools({
            store,
            capture: async () => '/tmp/x.png',
            readBase64: async () => 'BYTES',
            signalNewScreenshot: () => {},
            now: () => 1,
        });
        await tools.take({});
        expect(store.list()[0].target).toBe('desktop');
    });

    it('get：返回图像 base64 + image/png', async () => {
        const store = new ScreenshotStore();
        const ref = store.add({ filePath: '/tmp/x.png', target: 'desktop', takenAt: 1 });
        const tools = createScreenshotTools({
            store,
            capture: async () => '',
            readBase64: async () => 'BYTES',
            signalNewScreenshot: () => {},
            now: () => 1,
        });
        const out = await tools.get({ id: ref.id });
        expect(out.base64).toBe('BYTES');
        expect(out.mimeType).toBe('image/png');
    });

    it('get：未知 id 抛错', async () => {
        const store = new ScreenshotStore();
        const tools = createScreenshotTools({
            store,
            capture: async () => '',
            readBase64: async () => '',
            signalNewScreenshot: () => {},
            now: () => 1,
        });
        await expect(tools.get({ id: '404' })).rejects.toThrow(/not found|不存在/i);
    });

    it('list：返回引用列表', async () => {
        const store = new ScreenshotStore();
        store.add({ filePath: '/tmp/a.png', target: 'desktop', takenAt: 1 });
        store.add({ filePath: '/tmp/b.png', target: 'browser', note: 'x', takenAt: 2 });
        const tools = createScreenshotTools({
            store,
            capture: async () => '',
            readBase64: async () => '',
            signalNewScreenshot: () => {},
            now: () => 1,
        });
        const out = await tools.list();
        expect(out).toHaveLength(2);
        expect(out[1].note).toBe('x');
    });
});
