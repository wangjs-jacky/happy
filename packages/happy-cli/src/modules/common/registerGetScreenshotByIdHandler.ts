import { promises as fs } from 'fs';
import { logger } from '@/ui/logger';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type { ScreenshotStore } from '@/utils/screenshotStore';

// 会话级 RPC：App 监听到 metadata.screenshotRefs 变化后，按 id 向 CLI 懒拉取截图字节。
// 与 MCP take 工具共享同一个 ScreenshotStore 实例（由 ApiSessionClient 持有），
// 这样 take 存进去的图 id 在这里能查到磁盘路径。
export interface GetScreenshotByIdRequest {
    id: string;
}

export interface GetScreenshotByIdResponse {
    success: boolean;
    dataBase64?: string;
    mimeType?: string;
    error?: string;
}

// 依赖注入：默认读真文件，测试时可替换避免真磁盘 IO
interface Deps {
    readBase64: (p: string) => Promise<string>;
}

const defaultDeps: Deps = {
    readBase64: (p) => fs.readFile(p, 'base64'),
};

/**
 * 注册名为 'getScreenshotById' 的 RPC handler。
 * 入参 { id }，从 store.getFilePath(id) 读文件转 base64。
 * 未知 id（store 里没有该截图）→ success:false。
 */
export function registerGetScreenshotByIdHandler(
    rpcHandlerManager: RpcHandlerManager,
    store: ScreenshotStore,
    deps: Deps = defaultDeps,
) {
    rpcHandlerManager.registerHandler<GetScreenshotByIdRequest, GetScreenshotByIdResponse>('getScreenshotById', async (params) => {
        const id = params?.id;
        logger.debug('getScreenshotById request:', id);
        const filePath = id ? store.getFilePath(id) : undefined;
        if (!filePath) {
            return { success: false, error: `screenshot #${id} not found` };
        }
        try {
            const dataBase64 = await deps.readBase64(filePath);
            return { success: true, dataBase64, mimeType: 'image/png' };
        } catch (error) {
            logger.debug('Failed to read screenshot file:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
}
