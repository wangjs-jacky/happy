import { describe, it, expect } from 'vitest';
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
    it('截图成功：返回 success + base64 jpeg', async () => {
        const rpc = fakeRpc();
        registerScreenshotHandler(rpc as any, {
            capture: async () => '/tmp/x.jpg',
            readBase64: async () => 'AAA',
        });
        const res = await rpc.call('screenshot', { target: 'desktop' });
        expect(res.success).toBe(true);
        expect(res.dataBase64).toBe('AAA');
        // captureScreenshot 现在返回 sips 压缩后的 JPEG，handler 统一上报 image/jpeg
        expect(res.mimeType).toBe('image/jpeg');
    });

    it('截图失败：success=false + error 包含原始信息', async () => {
        const rpc = fakeRpc();
        registerScreenshotHandler(rpc as any, {
            capture: async () => { throw new Error('boom'); },
            readBase64: async () => '',
        });
        const res = await rpc.call('screenshot', { target: 'desktop' });
        expect(res.success).toBe(false);
        expect(res.error).toContain('boom');
    });

    it('未传 target 时默认 desktop', async () => {
        const rpc = fakeRpc();
        let captured: string | undefined;
        registerScreenshotHandler(rpc as any, {
            capture: async (t) => { captured = t; return '/tmp/x.png'; },
            readBase64: async () => 'AAA',
        });
        const res = await rpc.call('screenshot', {});
        expect(res.success).toBe(true);
        expect(captured).toBe('desktop');
    });
});
