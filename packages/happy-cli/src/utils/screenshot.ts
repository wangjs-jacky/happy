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

/** buildSipsArgs 的可选项：缩放最长边与 JPEG 质量。 */
export interface SipsOpts {
    /** 缩放到最长边像素（sips -Z）；默认 1600。 */
    maxDim?: number;
    /** JPEG 压缩质量 0-100（sips formatOptions）；默认 70。 */
    quality?: number;
}

/** 拼装 macOS sips 参数（纯函数，便于测试）：把 inPath 缩放 + 转 JPEG 输出到 outPath。
 *  参考命令：`sips -Z 1600 -s format jpeg -s formatOptions 70 <in> --out <out>`
 *  - `-Z <maxDim>`：等比缩放到最长边不超过 maxDim（默认 1600）。
 *  - `-s format jpeg`：转 JPEG。
 *  - `-s formatOptions <quality>`：JPEG 质量（默认 70）。 */
export function buildSipsArgs(
    inPath: string,
    outPath: string,
    opts?: SipsOpts,
): string[] {
    const maxDim = opts?.maxDim ?? 1600;
    const quality = opts?.quality ?? 70;
    return [
        '-Z', String(maxDim),
        '-s', 'format', 'jpeg',
        '-s', 'formatOptions', String(quality),
        inPath,
        '--out', outPath,
    ];
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

/** captureScreenshot 的依赖注入：默认接真实 spawn 封装，测试时可替换避免真截屏/真压缩。 */
export interface CaptureDeps {
    runScreencapture: (args: string[]) => Promise<void>;
    runSips: (args: string[]) => Promise<void>;
}

const defaultCaptureDeps: CaptureDeps = { runScreencapture, runSips };

/** 真截图：仅 macOS。返回生成的图片文件绝对路径；失败 throw。
 *  - desktop：整屏。
 *  - browser：先用 osascript 取最前窗口 id，截该窗口；取不到则兜底整屏。
 *  截出的 PNG 是全分辨率、体积可达数 MB，base64+加密后会超过服务端 socket.io 单包 1MB 上限、
 *  导致 socket 被掐断（App 报 "RPC target disconnected"）。因此截图后追加一步 sips 压缩：
 *  缩放 + 转 JPEG，把体积压到远低于 1MB，返回 JPEG 路径。
 *  压缩失败则记 debug 日志、回退返回原 PNG 路径（宁可发原图也不因压缩整体崩溃）。 */
export async function captureScreenshot(
    target: ScreenshotTarget,
    deps: CaptureDeps = defaultCaptureDeps,
): Promise<string> {
    if (process.platform !== 'darwin') {
        throw new Error(`截图当前仅支持 macOS，检测到平台 ${process.platform}（Linux/Windows 待支持）`);
    }
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const outPath = join(tmpdir(), `happy-shot-${stamp}.png`);
    const resolvedTarget = target ?? 'desktop';
    // browser 目标才去取最前窗口 id；任何失败都兜底成 null（整屏）
    const windowId = resolvedTarget === 'browser' ? await getFrontWindowId() : null;
    const args = buildScreencaptureArgs(resolvedTarget, outPath, { windowId });
    try {
        await deps.runScreencapture(args);
    } catch (err) {
        // browser 分支带 windowId 时，窗口可能在取 id 后已关闭/id 失效导致 screencapture 失败；
        // 此时自动回退整屏再试一次，避免 browser 截图整体失败。desktop 分支不重试。
        if (resolvedTarget === 'browser' && windowId != null) {
            logger.debug('[screenshot] 指定窗口截图失败，回退整屏重试:', err);
            await deps.runScreencapture(['-x', outPath]);
        } else {
            throw err;
        }
    }
    // 压缩：缩放 + 转 JPEG，让最终 base64 体积远低于服务端 1MB 单包上限
    const jpegPath = join(tmpdir(), `happy-shot-${stamp}.jpg`);
    try {
        await deps.runSips(buildSipsArgs(outPath, jpegPath));
        return jpegPath;
    } catch (err) {
        // 压缩失败兜底：回退返回原 PNG（可能超限，但至少不因压缩崩溃）
        logger.debug('[screenshot] sips 压缩失败，回退返回原 PNG:', err);
        return outPath;
    }
}

/** 跑一次 screencapture（给定参数），退出码非 0 或启动失败均 reject。 */
async function runScreencapture(args: string[]): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
        const child = spawn('screencapture', args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`screencapture 退出码 ${code}`)));
    });
}

/** 跑一次 sips（给定参数），退出码非 0 或启动失败均 reject。 */
async function runSips(args: string[]): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
        const child = spawn('sips', args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`sips 退出码 ${code}`)));
    });
}
