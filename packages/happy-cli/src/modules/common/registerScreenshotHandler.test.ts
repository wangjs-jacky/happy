import { describe, it, expect, vi } from 'vitest';
import { registerScreenshotHandler } from './registerScreenshotHandler';

// 假的 rpc 管理器：把 handler 收进 Map，call 时直接调用，避免真截屏 / 真网络
function fakeRpc() {
    const handlers = new Map<string, Function>();
    return {
        registerHandler: (m: string, h: Function) => handlers.set(m, h),
        call: (m: string, p: any) => handlers.get(m)!(p),
    };
}

describe('registerScreenshotHandler', () => {
    it('截图成功：返回 success + base64 jpeg + targetUsed', async () => {
        const rpc = fakeRpc();
        registerScreenshotHandler(rpc as any, {
            capture: async () => ({ path: '/tmp/x.jpg', capturedTarget: 'desktop' }),
            readBase64: async () => 'AAA',
            removeFile: async () => {},
        });
        const res = await rpc.call('screenshot', { target: 'desktop' });
        expect(res.success).toBe(true);
        expect(res.dataBase64).toBe('AAA');
        // captureScreenshot 现在返回 sips 压缩后的 JPEG，handler 统一上报 image/jpeg
        expect(res.mimeType).toBe('image/jpeg');
        expect(res.targetUsed).toBe('desktop');
    });

    it('请求 browser 命中浏览器：targetUsed=browser', async () => {
        const rpc = fakeRpc();
        registerScreenshotHandler(rpc as any, {
            capture: async () => ({ path: '/tmp/x.jpg', capturedTarget: 'browser' }),
            readBase64: async () => 'AAA',
            removeFile: async () => {},
        });
        const res = await rpc.call('screenshot', { target: 'browser' });
        expect(res.success).toBe(true);
        expect(res.targetUsed).toBe('browser');
    });

    it('请求 browser 回退整屏：targetUsed=desktop', async () => {
        const rpc = fakeRpc();
        registerScreenshotHandler(rpc as any, {
            capture: async () => ({ path: '/tmp/x.jpg', capturedTarget: 'desktop' }),
            readBase64: async () => 'AAA',
            removeFile: async () => {},
        });
        const res = await rpc.call('screenshot', { target: 'browser' });
        expect(res.success).toBe(true);
        expect(res.targetUsed).toBe('desktop');
    });

    it('截图失败：success=false + error 包含原始信息', async () => {
        const rpc = fakeRpc();
        registerScreenshotHandler(rpc as any, {
            capture: async () => { throw new Error('boom'); },
            readBase64: async () => '',
            removeFile: async () => {},
        });
        const res = await rpc.call('screenshot', { target: 'desktop' });
        expect(res.success).toBe(false);
        expect(res.error).toContain('boom');
    });

    it('未传 target 时默认 desktop', async () => {
        const rpc = fakeRpc();
        let captured: string | undefined;
        registerScreenshotHandler(rpc as any, {
            capture: async (t) => { captured = t; return { path: '/tmp/x.png', capturedTarget: 'desktop' }; },
            readBase64: async () => 'AAA',
            removeFile: async () => {},
        });
        const res = await rpc.call('screenshot', {});
        expect(res.success).toBe(true);
        expect(captured).toBe('desktop');
    });

    it('读完 base64 后删除临时文件（清理泄漏）', async () => {
        const rpc = fakeRpc();
        const removeFile = vi.fn(async () => {});
        registerScreenshotHandler(rpc as any, {
            capture: async () => ({ path: '/tmp/happy-shot-123.jpg', capturedTarget: 'desktop' }),
            readBase64: async () => 'AAA',
            removeFile,
        });
        const res = await rpc.call('screenshot', { target: 'desktop' });
        expect(res.success).toBe(true);
        // 读完 base64 必须把这个临时文件删掉，避免堆积
        expect(removeFile).toHaveBeenCalledTimes(1);
        expect(removeFile).toHaveBeenCalledWith('/tmp/happy-shot-123.jpg');
    });

    it('readBase64 抛错也要删除临时文件（try/finally 保证）', async () => {
        const rpc = fakeRpc();
        const removeFile = vi.fn(async () => {});
        registerScreenshotHandler(rpc as any, {
            capture: async () => ({ path: '/tmp/happy-shot-456.jpg', capturedTarget: 'desktop' }),
            readBase64: async () => { throw new Error('read fail'); },
            removeFile,
        });
        const res = await rpc.call('screenshot', { target: 'desktop' });
        // 读失败走 catch → success=false，但临时文件仍必须被清理
        expect(res.success).toBe(false);
        expect(removeFile).toHaveBeenCalledTimes(1);
        expect(removeFile).toHaveBeenCalledWith('/tmp/happy-shot-456.jpg');
    });
});
