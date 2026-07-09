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
    /** 实际截取目标：请求 browser 命中浏览器窗口=‘browser’，回退整屏=‘desktop’ */
    targetUsed?: ScreenshotTarget;
    error?: string;
}

// 依赖注入：默认接真截图 + 读文件，测试时可替换避免真截屏
interface Deps {
    capture: (t: ScreenshotTarget) => Promise<{ path: string; capturedTarget: ScreenshotTarget }>;
    readBase64: (p: string) => Promise<string>;
}

const defaultDeps: Deps = {
    capture: captureScreenshot,
    readBase64: (p) => fs.readFile(p, 'base64'),
};

/**
 * 注册名为 'screenshot' 的 RPC handler。
 * 入参 { target }，出参 { success, dataBase64?, mimeType?, targetUsed?, error? }。
 */
export function registerScreenshotHandler(
    rpcHandlerManager: RpcHandlerManager,
    deps: Deps = defaultDeps,
) {
    rpcHandlerManager.registerHandler<ScreenshotRequest, ScreenshotResponse>('screenshot', async (params) => {
        const target = params?.target ?? 'desktop';
        logger.debug('Screenshot request:', target);
        try {
            const { path: filePath, capturedTarget } = await deps.capture(target);
            const dataBase64 = await deps.readBase64(filePath);
            // captureScreenshot 现在返回 sips 压缩后的 JPEG（压缩失败的极端兜底会返回 PNG，
            // 但那是极端路径，App 端靠内容嗅探仍能显示，这里统一按 JPEG 上报即可）
            // targetUsed 让 App 知道请求 browser 时是否真截到了浏览器（还是回退了整屏）
            return { success: true, dataBase64, mimeType: 'image/jpeg', targetUsed: capturedTarget };
        } catch (error) {
            logger.debug('Failed to capture screenshot:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
}
