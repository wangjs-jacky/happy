import { describe, it, expect } from 'vitest';
import { buildScreencaptureArgs, parseFrontWindowId } from './screenshot';

describe('parseFrontWindowId', () => {
    it('正常数字直接解析', () => {
        expect(parseFrontWindowId('12345')).toBe(12345);
    });
    it('带换行/空白也能解析', () => {
        expect(parseFrontWindowId('  12345 \n')).toBe(12345);
    });
    it('空串返回 null', () => {
        expect(parseFrontWindowId('')).toBe(null);
    });
    it('纯空白返回 null', () => {
        expect(parseFrontWindowId('   \n  ')).toBe(null);
    });
    it('非数字返回 null', () => {
        expect(parseFrontWindowId('not a number')).toBe(null);
    });
});

describe('buildScreencaptureArgs', () => {
    it('desktop 整屏：-x 静音 + 输出路径', () => {
        expect(buildScreencaptureArgs('desktop', '/tmp/a.png'))
            .toEqual(['-x', '/tmp/a.png']);
    });
    it('browser 有 windowId：-x -o -l <id> + 输出路径', () => {
        expect(buildScreencaptureArgs('browser', '/tmp/b.png', { windowId: 7788 }))
            .toEqual(['-x', '-o', '-l', '7788', '/tmp/b.png']);
    });
    it('browser 无 windowId（null）：回退整屏兜底', () => {
        expect(buildScreencaptureArgs('browser', '/tmp/b.png', { windowId: null }))
            .toEqual(['-x', '/tmp/b.png']);
    });
    it('browser 未传 opts：回退整屏兜底', () => {
        expect(buildScreencaptureArgs('browser', '/tmp/b.png'))
            .toEqual(['-x', '/tmp/b.png']);
    });
});
