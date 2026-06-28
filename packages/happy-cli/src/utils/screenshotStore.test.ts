import { describe, it, expect } from 'vitest';
import { ScreenshotStore } from './screenshotStore';

describe('ScreenshotStore', () => {
    it('add 返回自增 id 引用，list 给轻量引用（不含字节/路径）', () => {
        const s = new ScreenshotStore();
        const ref = s.add({ filePath: '/tmp/a.png', target: 'desktop', note: 'hi', takenAt: 100 });
        expect(ref.id).toBe('1');
        expect(ref.target).toBe('desktop');
        expect(ref.note).toBe('hi');
        expect((ref as any).filePath).toBeUndefined(); // 引用不暴露磁盘路径
        const list = s.list();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('1');
    });
    it('getFilePath 用 id 取回磁盘路径，未知 id 返回 undefined', () => {
        const s = new ScreenshotStore();
        s.add({ filePath: '/tmp/a.png', target: 'desktop', takenAt: 1 });
        expect(s.getFilePath('1')).toBe('/tmp/a.png');
        expect(s.getFilePath('999')).toBeUndefined();
    });
});
