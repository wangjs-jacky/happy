import { describe, it, expect, vi } from 'vitest';
import { buildScreencaptureArgs, buildSipsArgs, buildRegionCaptureArgs, parseBrowserBounds, captureScreenshot } from './screenshot';

describe('parseBrowserBounds', () => {
    it('正常四数字（无空格）解析为 x/y/width/height', () => {
        expect(parseBrowserBounds('0,25,840,1440'))
            .toEqual({ x: 0, y: 25, width: 840, height: 1415 });
    });
    it('数字间带空格也能解析', () => {
        expect(parseBrowserBounds('0, 25, 840, 1440'))
            .toEqual({ x: 0, y: 25, width: 840, height: 1415 });
    });
    it('带换行/首尾空白也能解析', () => {
        expect(parseBrowserBounds('  100, 50, 500, 400 \n'))
            .toEqual({ x: 100, y: 50, width: 400, height: 350 });
    });
    it('空串返回 null', () => {
        expect(parseBrowserBounds('')).toBe(null);
    });
    it('非四数字返回 null', () => {
        expect(parseBrowserBounds('0, 25, 840')).toBe(null);
    });
    it('含非数字返回 null', () => {
        expect(parseBrowserBounds('execution error: xxx')).toBe(null);
    });
    it('宽度 <= 0 返回 null', () => {
        expect(parseBrowserBounds('840, 25, 840, 1440')).toBe(null);
    });
    it('高度 <= 0 返回 null', () => {
        expect(parseBrowserBounds('0, 1440, 840, 1440')).toBe(null);
    });
});

describe('buildRegionCaptureArgs', () => {
    it('拼出 -x + -R<x,y,w,h> + 输出路径', () => {
        expect(buildRegionCaptureArgs({ x: 0, y: 25, width: 840, height: 1415 }, '/tmp/b.png'))
            .toEqual(['-x', '-R0,25,840,1415', '/tmp/b.png']);
    });
});

describe('buildScreencaptureArgs（desktop 整屏）', () => {
    it('desktop 整屏：-x 静音 + 输出路径', () => {
        expect(buildScreencaptureArgs('desktop', '/tmp/a.png'))
            .toEqual(['-x', '/tmp/a.png']);
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

    // desktop 分支不会用到 getFrontmostBrowserBounds，给个永不命中的桩即可
    const noBrowser = vi.fn(async () => null);

    onDarwin('desktop：截图后调 sips 压缩，返回 .jpg 路径 + capturedTarget=desktop', async () => {
        const runScreencapture = vi.fn(async (_args: string[]) => {});
        const runSips = vi.fn(async (_args: string[]) => {});
        const result = await captureScreenshot('desktop', { runScreencapture, runSips, getFrontmostBrowserBounds: noBrowser });
        expect(runScreencapture).toHaveBeenCalledTimes(1);
        expect(runSips).toHaveBeenCalledTimes(1);
        expect(result.path.endsWith('.jpg')).toBe(true);
        expect(result.capturedTarget).toBe('desktop');
        // desktop 走整屏 -x
        expect(runScreencapture.mock.calls[0][0][0]).toBe('-x');
        // sips 的入参：png 在前、jpg 在后
        const sipsArgs = runSips.mock.calls[0][0];
        const outIdx = sipsArgs.indexOf('--out');
        expect(sipsArgs[outIdx - 1].endsWith('.png')).toBe(true);
        expect(sipsArgs[outIdx + 1].endsWith('.jpg')).toBe(true);
    });

    onDarwin('sips 失败回退：返回原 png 路径', async () => {
        const runScreencapture = vi.fn(async (_args: string[]) => {});
        const runSips = vi.fn(async (_args: string[]) => { throw new Error('sips boom'); });
        const result = await captureScreenshot('desktop', { runScreencapture, runSips, getFrontmostBrowserBounds: noBrowser });
        expect(runScreencapture).toHaveBeenCalledTimes(1);
        expect(runSips).toHaveBeenCalledTimes(1);
        expect(result.path.endsWith('.png')).toBe(true);
        expect(result.capturedTarget).toBe('desktop');
    });

    onDarwin('browser 命中浏览器 bounds：走 -R 区域截图 + capturedTarget=browser', async () => {
        const runScreencapture = vi.fn(async (_args: string[]) => {});
        const runSips = vi.fn(async (_args: string[]) => {});
        const getBounds = vi.fn(async () => ({ x: 0, y: 25, width: 840, height: 1415 }));
        const result = await captureScreenshot('browser', { runScreencapture, runSips, getFrontmostBrowserBounds: getBounds });
        expect(getBounds).toHaveBeenCalledTimes(1);
        expect(result.capturedTarget).toBe('browser');
        // 区域截图参数带 -R
        const args = runScreencapture.mock.calls[0][0];
        expect(args).toContain('-R0,25,840,1415');
    });

    onDarwin('browser 拿不到 bounds：回退整屏 + capturedTarget=desktop', async () => {
        const runScreencapture = vi.fn(async (_args: string[]) => {});
        const runSips = vi.fn(async (_args: string[]) => {});
        const getBounds = vi.fn(async () => null);
        const result = await captureScreenshot('browser', { runScreencapture, runSips, getFrontmostBrowserBounds: getBounds });
        expect(getBounds).toHaveBeenCalledTimes(1);
        expect(result.capturedTarget).toBe('desktop');
        // 回退走整屏 -x，无 -R
        const args = runScreencapture.mock.calls[0][0];
        expect(args[0]).toBe('-x');
        expect(args.some((a) => a.startsWith('-R'))).toBe(false);
    });
});
