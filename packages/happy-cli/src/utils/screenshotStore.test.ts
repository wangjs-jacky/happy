import { describe, it, expect } from 'vitest';
import { ScreenshotStore } from './screenshotStore';

describe('ScreenshotStore', () => {
    it('add 返回唯一 id 引用，list 给轻量引用（不含字节/路径）', () => {
        const s = new ScreenshotStore();
        const ref = s.add({ filePath: '/tmp/a.png', target: 'desktop', note: 'hi', takenAt: 100 });
        // id 带进程级 nonce 前缀，不再绑定具体字符串，只断言非空、唯一、可取回
        expect(typeof ref.id).toBe('string');
        expect(ref.id.length).toBeGreaterThan(0);
        expect(ref.target).toBe('desktop');
        expect(ref.note).toBe('hi');
        expect((ref as any).filePath).toBeUndefined(); // 引用不暴露磁盘路径
        const list = s.list();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(ref.id);
        // 多次 add 的 id 互不相同
        const ref2 = s.add({ filePath: '/tmp/b.png', target: 'browser', takenAt: 101 });
        expect(ref2.id).not.toBe(ref.id);
        expect(s.list()).toHaveLength(2);
    });
    it('getFilePath 用 id 取回磁盘路径，未知 id 返回 undefined', () => {
        const s = new ScreenshotStore();
        const ref = s.add({ filePath: '/tmp/a.png', target: 'desktop', takenAt: 1 });
        expect(s.getFilePath(ref.id)).toBe('/tmp/a.png');
        expect(s.getFilePath('does-not-exist')).toBeUndefined();
    });
});
