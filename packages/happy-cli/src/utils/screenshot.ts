import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '@/ui/logger';

export type ScreenshotTarget = 'desktop' | 'browser';

/** buildScreencaptureArgs 的可选项：browser 目标可传最前窗口 id。 */
export interface ScreencaptureOpts {
    /** osascript 解析出的最前窗口 id；null 表示没拿到（回退整屏）。 */
    windowId?: number | null;
}

/** 从 osascript 输出解析最前窗口 id（纯函数，便于测试）。
 *  osascript 正常输出形如 "12345\n"，失败/无权限时可能为空串或非数字；
 *  解析不到合法数字时返回 null（由调用方回退整屏）。 */
export function parseFrontWindowId(osascriptStdout: string): number | null {
    const trimmed = osascriptStdout.trim();
    if (trimmed === '') {
        return null;
    }
    // 只接受纯数字（window id 是整数），避免把报错信息误当成 id
    if (!/^\d+$/.test(trimmed)) {
        return null;
    }
    const id = Number(trimmed);
    return Number.isInteger(id) ? id : null;
}

/** 拼装 macOS screencapture 参数（纯函数，便于测试）。
 *  - desktop：整屏 `-x`（静音）。
 *  - browser 且拿到有效 windowId：`-x -o -l <id>`（指定窗口、去阴影）。
 *  - browser 但没拿到 windowId：回退整屏兜底，绝不让 browser 截图失败。 */
export function buildScreencaptureArgs(
    target: ScreenshotTarget,
    outPath: string,
    opts?: ScreencaptureOpts,
): string[] {
    if (target === 'browser' && opts?.windowId != null) {
        return ['-x', '-o', '-l', String(opts.windowId), outPath];
    }
    return ['-x', outPath];
}

/** 跑 osascript 取最前台应用的最前窗口 id；失败/超时/无权限均返回 null（兜底整屏）。
 *  AppleScript 取 System Events 中 frontmost 进程的 front window id，
 *  这是无需逐个 app 适配、对任意前台应用都通用的写法（依赖「辅助功能」权限）。 */
async function getFrontWindowId(): Promise<number | null> {
    const script = 'tell application "System Events" to tell (first process whose frontmost is true) to get id of front window';
    return await new Promise<number | null>((resolve) => {
        const child = spawn('osascript', ['-e', script], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        // 给 osascript 合理超时，避免卡住截图
        const timer = setTimeout(() => {
            logger.debug('[screenshot] osascript 取最前窗口超时，回退整屏');
            child.kill('SIGKILL');
            resolve(null);
        }, 3000);

        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (err) => {
            clearTimeout(timer);
            logger.debug('[screenshot] osascript 启动失败，回退整屏:', err);
            resolve(null);
        });
        child.on('exit', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                // 常见原因：未授予「辅助功能」权限。记一笔 debug，回退整屏。
                logger.debug(`[screenshot] osascript 退出码 ${code}（可能缺辅助功能权限），回退整屏: ${stderr.trim()}`);
                resolve(null);
                return;
            }
            resolve(parseFrontWindowId(stdout));
        });
    });
}

/** 真截图：仅 macOS。返回生成的 png 文件绝对路径；失败 throw。
 *  - desktop：整屏。
 *  - browser：先用 osascript 取最前窗口 id，截该窗口；取不到则兜底整屏。 */
export async function captureScreenshot(target: ScreenshotTarget): Promise<string> {
    if (process.platform !== 'darwin') {
        throw new Error(`截图当前仅支持 macOS，检测到平台 ${process.platform}（Linux/Windows 待支持）`);
    }
    const outPath = join(tmpdir(), `happy-shot-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`);
    const resolvedTarget = target ?? 'desktop';
    // browser 目标才去取最前窗口 id；任何失败都兜底成 null（整屏）
    const windowId = resolvedTarget === 'browser' ? await getFrontWindowId() : null;
    const args = buildScreencaptureArgs(resolvedTarget, outPath, { windowId });
    try {
        await runScreencapture(args);
    } catch (err) {
        // browser 分支带 windowId 时，窗口可能在取 id 后已关闭/id 失效导致 screencapture 失败；
        // 此时自动回退整屏再试一次，避免 browser 截图整体失败。desktop 分支不重试。
        if (resolvedTarget === 'browser' && windowId != null) {
            logger.debug('[screenshot] 指定窗口截图失败，回退整屏重试:', err);
            await runScreencapture(['-x', outPath]);
        } else {
            throw err;
        }
    }
    return outPath;
}

/** 跑一次 screencapture（给定参数），退出码非 0 或启动失败均 reject。 */
async function runScreencapture(args: string[]): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
        const child = spawn('screencapture', args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`screencapture 退出码 ${code}`)));
    });
}
