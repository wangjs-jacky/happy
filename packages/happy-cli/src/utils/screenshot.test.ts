import { describe, it, expect, vi } from 'vitest';
import { buildScreencaptureArgs, buildSipsArgs, parseFrontWindowId, captureScreenshot } from './screenshot';

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

describe('buildSipsArgs', () => {
    it('默认值：缩放到最长边 1600 + 转 jpeg + 质量 70', () => {
        expect(buildSipsArgs('/tmp/in.png', '/tmp/out.jpg'))
            .toEqual(['-Z', '1600', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '/tmp/in.png', '--out', '/tmp/out.jpg']);
    });
    it('自定义 maxDim', () => {
        expect(buildSipsArgs('/tmp/in.png', '/tmp/out.jpg', { maxDim: 1024 }))
            .toEqual(['-Z', '1024', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '/tmp/in.png', '--out', '/tmp/out.jpg']);
    });
    it('自定义 quality', () => {
        expect(buildSipsArgs('/tmp/in.png', '/tmp/out.jpg', { quality: 50 }))
            .toEqual(['-Z', '1600', '-s', 'format', 'jpeg', '-s', 'formatOptions', '50', '/tmp/in.png', '--out', '/tmp/out.jpg']);
    });
    it('同时自定义 maxDim + quality', () => {
        expect(buildSipsArgs('/tmp/in.png', '/tmp/out.jpg', { maxDim: 800, quality: 40 }))
            .toEqual(['-Z', '800', '-s', 'format', 'jpeg', '-s', 'formatOptions', '40', '/tmp/in.png', '--out', '/tmp/out.jpg']);
    });
    it('输入路径在 --out 之前，输出路径在 --out 之后', () => {
        const args = buildSipsArgs('/a/in.png', '/b/out.jpg');
        const outIdx = args.indexOf('--out');
        expect(args[outIdx - 1]).toBe('/a/in.png');
        expect(args[outIdx + 1]).toBe('/b/out.jpg');
    });
});

describe('captureScreenshot（依赖注入 mock 掉 spawn 封装）', () => {
    // 仅在 macOS 上跑（captureScreenshot 非 darwin 直接 throw）
    const onDarwin = process.platform === 'darwin' ? it : it.skip;

    onDarwin('正常路径：截图后调 sips 压缩，返回 .jpg 路径', async () => {
        const runScreencapture = vi.fn(async (_args: string[]) => {});
        const runSips = vi.fn(async (_args: string[]) => {});
        const result = await captureScreenshot('desktop', { runScreencapture, runSips });
        expect(runScreencapture).toHaveBeenCalledTimes(1);
        expect(runSips).toHaveBeenCalledTimes(1);
        // 返回 jpeg 路径
        expect(result.endsWith('.jpg')).toBe(true);
        // sips 的入参：png 在前、jpg 在后
        const sipsArgs = runSips.mock.calls[0][0];
        const outIdx = sipsArgs.indexOf('--out');
        expect(sipsArgs[outIdx - 1].endsWith('.png')).toBe(true);
        expect(sipsArgs[outIdx + 1].endsWith('.jpg')).toBe(true);
    });

    onDarwin('sips 失败回退：返回原 png 路径', async () => {
        const runScreencapture = vi.fn(async (_args: string[]) => {});
        const runSips = vi.fn(async (_args: string[]) => { throw new Error('sips boom'); });
        const result = await captureScreenshot('desktop', { runScreencapture, runSips });
        expect(runScreencapture).toHaveBeenCalledTimes(1);
        expect(runSips).toHaveBeenCalledTimes(1);
        // 压缩失败兜底返回原 png
        expect(result.endsWith('.png')).toBe(true);
    });
});
