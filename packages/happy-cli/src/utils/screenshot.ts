import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '@/ui/logger';

export type ScreenshotTarget = 'desktop' | 'browser';

/** 浏览器窗口矩形（屏幕坐标，单位：点）。用于 screencapture -R 区域截图。 */
export interface BrowserBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 按优先级尝试的一组已知浏览器（AppleScript 应用名）。
 *  取第一个「正在运行且能拿到 front window bounds」的作为截图目标。 */
const KNOWN_BROWSERS = ['Google Chrome', 'Safari', 'Microsoft Edge', 'Arc', 'Brave Browser'] as const;

/** 从 osascript 输出解析浏览器 front window bounds（纯函数，便于测试）。
 *  AppleScript `get bounds of front window` 返回形如 "0, 25, 840, 1440"（{x1,y1,x2,y2}），
 *  这里转成 {x, y, width, height}（width=x2-x1, height=y2-y1）。
 *  解析失败 / 非 4 个整数 / 宽或高 <= 0 时返回 null（由调用方回退整屏）。 */
export function parseBrowserBounds(osascriptStdout: string): BrowserBounds | null {
    const trimmed = osascriptStdout.trim();
    if (trimmed === '') {
        return null;
    }
    const parts = trimmed.split(',').map((s) => s.trim());
    if (parts.length !== 4) {
        return null;
    }
    // 只接受整数（可含负号），避免把报错信息误当坐标
    if (!parts.every((p) => /^-?\d+$/.test(p))) {
        return null;
    }
    const [x1, y1, x2, y2] = parts.map(Number);
    const width = x2 - x1;
    const height = y2 - y1;
    if (width <= 0 || height <= 0) {
        return null;
    }
    return { x: x1, y: y1, width, height };
}

/** 拼装区域截图参数（纯函数，便于测试）：`-x -R<x>,<y>,<w>,<h> <out>`。
 *  `-x` 静音，`-R` 指定截取矩形（屏幕坐标）。 */
export function buildRegionCaptureArgs(region: BrowserBounds, outPath: string): string[] {
    const { x, y, width, height } = region;
    return ['-x', `-R${x},${y},${width},${height}`, outPath];
}

/** 拼装整屏 screencapture 参数（纯函数，便于测试）：desktop 用 `-x`（静音）整屏。 */
export function buildScreencaptureArgs(target: ScreenshotTarget, outPath: string): string[] {
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

/** 跑 osascript 问指定浏览器自己的 front window bounds；失败/超时/未运行均返回 null。
 *  走 Automation 权限（脚本控制目标 App），无需「辅助功能」权限——这是相对
 *  System Events 方案的关键区别：Automation 权限首次触发会弹窗授权、当场可用。 */
async function queryBrowserBounds(browser: string): Promise<BrowserBounds | null> {
    // 先判 is running，避免脚本把未运行的浏览器拉起来
    const script = `if application "${browser}" is running then tell application "${browser}" to get bounds of front window`;
    return await new Promise<BrowserBounds | null>((resolve) => {
        const child = spawn('osascript', ['-e', script], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        // 给 osascript 合理超时，避免卡住截图
        const timer = setTimeout(() => {
            logger.debug(`[screenshot] osascript 取 ${browser} 窗口超时，跳过`);
            child.kill('SIGKILL');
            resolve(null);
        }, 3000);

        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (err) => {
            clearTimeout(timer);
            logger.debug(`[screenshot] osascript 启动失败（${browser}），跳过:`, err);
            resolve(null);
        });
        child.on('exit', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                logger.debug(`[screenshot] osascript 取 ${browser} 退出码 ${code}，跳过: ${stderr.trim()}`);
                resolve(null);
                return;
            }
            resolve(parseBrowserBounds(stdout));
        });
    });
}

/** 依次问一组已知浏览器，返回第一个拿到合法 front window bounds 的那个；都拿不到返回 null。
 *  任何单个浏览器的失败都静默（debug 日志），继续尝试下一个。 */
export async function getFrontmostBrowserBounds(): Promise<BrowserBounds | null> {
    for (const browser of KNOWN_BROWSERS) {
        const bounds = await queryBrowserBounds(browser);
        if (bounds) {
            logger.debug(`[screenshot] 命中浏览器 ${browser}，bounds:`, bounds);
            return bounds;
        }
    }
    logger.debug('[screenshot] 未找到可用浏览器窗口，回退整屏');
    return null;
}

/** captureScreenshot 的依赖注入：默认接真实 spawn 封装 + 真实浏览器定位，
 *  测试时可替换避免真截屏/真压缩/真 osascript。 */
export interface CaptureDeps {
    runScreencapture: (args: string[]) => Promise<void>;
    runSips: (args: string[]) => Promise<void>;
    getFrontmostBrowserBounds: () => Promise<BrowserBounds | null>;
}

const defaultCaptureDeps: CaptureDeps = { runScreencapture, runSips, getFrontmostBrowserBounds };

/** captureScreenshot 的结果：图片路径 + 实际截取目标。
 *  capturedTarget 反映真正截了什么：请求 browser 且命中浏览器窗口=‘browser’，
 *  请求 browser 但回退整屏=‘desktop’，请求 desktop=‘desktop’。 */
export interface CaptureResult {
    path: string;
    capturedTarget: ScreenshotTarget;
}

/** 真截图：仅 macOS。返回 { path, capturedTarget }；失败 throw。
 *  - desktop：整屏。
 *  - browser：先问最前台浏览器**自己**的 front window bounds（走 Automation 权限，
 *    不依赖辅助功能），拿到就用 `-R` 区域截图；拿不到则回退整屏（capturedTarget=desktop）。
 *  截出的 PNG 是全分辨率、体积可达数 MB，base64+加密后会超过服务端 socket.io 单包 1MB 上限、
 *  导致 socket 被掐断（App 报 "RPC target disconnected"）。因此截图后追加一步 sips 压缩：
 *  缩放 + 转 JPEG，把体积压到远低于 1MB，path 返回 JPEG 路径。
 *  压缩失败则记 debug 日志、path 回退返回原 PNG（宁可发原图也不因压缩整体崩溃）。 */
export async function captureScreenshot(
    target: ScreenshotTarget,
    deps: CaptureDeps = defaultCaptureDeps,
): Promise<CaptureResult> {
    if (process.platform !== 'darwin') {
        throw new Error(`截图当前仅支持 macOS，检测到平台 ${process.platform}（Linux/Windows 待支持）`);
    }
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const outPath = join(tmpdir(), `happy-shot-${stamp}.png`);
    const resolvedTarget = target ?? 'desktop';

    // browser 目标：先问浏览器自己要 bounds，命中就区域截图，否则回退整屏
    let capturedTarget: ScreenshotTarget = 'desktop';
    let captureArgs: string[];
    if (resolvedTarget === 'browser') {
        const bounds = await deps.getFrontmostBrowserBounds();
        if (bounds) {
            captureArgs = buildRegionCaptureArgs(bounds, outPath);
            capturedTarget = 'browser';
        } else {
            captureArgs = ['-x', outPath];
            capturedTarget = 'desktop';
        }
    } else {
        captureArgs = ['-x', outPath];
        capturedTarget = 'desktop';
    }

    await deps.runScreencapture(captureArgs);

    // 压缩：缩放 + 转 JPEG，让最终 base64 体积远低于服务端 1MB 单包上限
    const jpegPath = join(tmpdir(), `happy-shot-${stamp}.jpg`);
    try {
        await deps.runSips(buildSipsArgs(outPath, jpegPath));
        return { path: jpegPath, capturedTarget };
    } catch (err) {
        // 压缩失败兜底：回退返回原 PNG（可能超限，但至少不因压缩崩溃）
        logger.debug('[screenshot] sips 压缩失败，回退返回原 PNG:', err);
        return { path: outPath, capturedTarget };
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
