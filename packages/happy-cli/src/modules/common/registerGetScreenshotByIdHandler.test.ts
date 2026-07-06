import { describe, it, expect } from 'vitest';
import { registerGetScreenshotByIdHandler } from './registerGetScreenshotByIdHandler';
import { ScreenshotStore } from '@/utils/screenshotStore';

// 假的 rpc 管理器：把 handler 收进 Map，call 时直接调用
function fakeRpc() {
    const handlers = new Map<string, Function>();
    return {
        registerHandler: (m: string, h: Function) => handlers.set(m, h),
        call: (m: string, p: any) => handlers.get(m)!(p),
    };
}

describe('registerGetScreenshotByIdHandler', () => {
    it('已知 id：从 store 查路径 → 读文件 → 返回 success + base64', async () => {
        const rpc = fakeRpc();
        const store = new ScreenshotStore();
        const ref = store.add({ filePath: '/tmp/shot.png', target: 'desktop', takenAt: 1 });
        let readPath: string | undefined;
        registerGetScreenshotByIdHandler(rpc as any, store, {
            readBase64: async (p) => { readPath = p; return 'BASE64DATA'; },
        });
        const res = await rpc.call('getScreenshotById', { id: ref.id });
        expect(res.success).toBe(true);
        expect(res.dataBase64).toBe('BASE64DATA');
        expect(res.mimeType).toBe('image/png');
        expect(readPath).toBe('/tmp/shot.png');
    });

    it('未知 id：success=false，不读文件', async () => {
        const rpc = fakeRpc();
        const store = new ScreenshotStore();
        let read = false;
        registerGetScreenshotByIdHandler(rpc as any, store, {
            readBase64: async () => { read = true; return ''; },
        });
        const res = await rpc.call('getScreenshotById', { id: '999' });
        expect(res.success).toBe(false);
        expect(res.error).toContain('999');
        expect(read).toBe(false);
    });

    it('读文件失败：success=false + error', async () => {
        const rpc = fakeRpc();
        const store = new ScreenshotStore();
        const ref = store.add({ filePath: '/tmp/shot.png', target: 'desktop', takenAt: 1 });
        registerGetScreenshotByIdHandler(rpc as any, store, {
            readBase64: async () => { throw new Error('boom'); },
        });
        const res = await rpc.call('getScreenshotById', { id: ref.id });
        expect(res.success).toBe(false);
        expect(res.error).toContain('boom');
    });
});
