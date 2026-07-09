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

// 依赖注入：默认接真截图 + 读文件 + 删文件，测试时可替换避免真截屏 / 真删文件
interface Deps {
    capture: (t: ScreenshotTarget) => Promise<{ path: string; capturedTarget: ScreenshotTarget }>;
    readBase64: (p: string) => Promise<string>;
    removeFile: (p: string) => Promise<void>;
}

const defaultDeps: Deps = {
    capture: captureScreenshot,
    readBase64: (p) => fs.readFile(p, 'base64'),
    // 删除临时截图文件；失败静默（force 忽略「文件不存在」），不影响 RPC 结果
    removeFile: (p) => fs.rm(p, { force: true }).catch(() => {}),
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
            // 读完 base64 就把这个临时截图文件删掉，避免在 tmpdir 堆积（成功/失败路径都删）。
            // 用 try/finally 保证即便 readBase64 抛错也会清理。删除失败静默，不影响主流程。
            let dataBase64: string;
            try {
                dataBase64 = await deps.readBase64(filePath);
            } finally {
                await deps.removeFile(filePath);
            }
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
