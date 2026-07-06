import { promises as fs } from 'fs';
import { logger } from '@/ui/logger';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { captureScreenshot, type ScreenshotTarget } from '@/utils/screenshot';

// 手动截屏 RPC：App 点截屏按钮 → sessionRPC 调本方法 → CLI 截图并返回 base64 png
export interface ScreenshotRequest {
    target?: ScreenshotTarget;
}

export interface ScreenshotResponse {
    success: boolean;
    dataBase64?: string;
    mimeType?: string;
    error?: string;
}

// 依赖注入：默认接真截图 + 读文件，测试时可替换避免真截屏
interface Deps {
    capture: (t: ScreenshotTarget) => Promise<string>;
    readBase64: (p: string) => Promise<string>;
}

const defaultDeps: Deps = {
    capture: captureScreenshot,
    readBase64: (p) => fs.readFile(p, 'base64'),
};

/**
 * 注册名为 'screenshot' 的 RPC handler。
 * 入参 { target }，出参 { success, dataBase64?, mimeType?, error? }。
 */
export function registerScreenshotHandler(
    rpcHandlerManager: RpcHandlerManager,
    deps: Deps = defaultDeps,
) {
    rpcHandlerManager.registerHandler<ScreenshotRequest, ScreenshotResponse>('screenshot', async (params) => {
        const target = params?.target ?? 'desktop';
        logger.debug('Screenshot request:', target);
        try {
            const filePath = await deps.capture(target);
            const dataBase64 = await deps.readBase64(filePath);
            return { success: true, dataBase64, mimeType: 'image/png' };
        } catch (error) {
            logger.debug('Failed to capture screenshot:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
}
