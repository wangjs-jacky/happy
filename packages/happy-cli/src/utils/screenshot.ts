import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

export type ScreenshotTarget = 'desktop' | 'browser';

/** 拼装 macOS screencapture 参数（纯函数，便于测试）。
 *  MVP：desktop 与 browser 都截整屏（-x 静音）；精确最前窗口留待后续任务。 */
export function buildScreencaptureArgs(target: ScreenshotTarget, outPath: string): string[] {
    return ['-x', outPath];
}

/** 真截图：仅 macOS。返回生成的 png 文件绝对路径；失败 throw。 */
export async function captureScreenshot(target: ScreenshotTarget): Promise<string> {
    if (process.platform !== 'darwin') {
        throw new Error(`截图当前仅支持 macOS，检测到平台 ${process.platform}（Linux/Windows 待支持）`);
    }
    const outPath = join(tmpdir(), `happy-shot-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`);
    const args = buildScreencaptureArgs(target ?? 'desktop', outPath);
    await new Promise<void>((resolve, reject) => {
        const child = spawn('screencapture', args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`screencapture 退出码 ${code}`)));
    });
    return outPath;
}
