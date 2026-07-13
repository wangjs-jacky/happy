import { resolve, sep } from 'path';

export interface PathValidationResult {
    valid: boolean;
    resolvedPath?: string;
    error?: string;
}

/**
 * 验证路径是否在允许的工作目录内
 * @param targetPath - 要验证的路径（可以是相对路径或绝对路径）
 * @param workingDirectory - 会话的工作目录（必须是绝对路径）
 * @returns 验证结果
 */
export function validatePath(targetPath: string, workingDirectory: string): PathValidationResult {
    // 将两条路径都解析为绝对路径以处理路径遍历尝试
    const resolvedTarget = resolve(workingDirectory, targetPath);
    const resolvedWorkingDir = resolve(workingDirectory);

    // 检查解析后的目标路径是否以工作目录开头
    // 使用 path.sep 在 Windows (\) 和 Unix (/) 上都能正确工作
    if (!resolvedTarget.startsWith(resolvedWorkingDir + sep) && resolvedTarget !== resolvedWorkingDir) {
        return {
            valid: false,
            resolvedPath: resolvedTarget,
            error: `Access denied: Path '${targetPath}' is outside the working directory`
        };
    }

    return { valid: true, resolvedPath: resolvedTarget };
}

/**
 * 只读访问校验：相对路径仍相对 workingDirectory 解析（保持既有调用行为），
 * 但「允许访问的根」放宽到 containmentRoot（本项目传机器 HOME）。
 * 用于 readFile / listDirectory / getDirectoryTree，让手机端能浏览 HOME 下
 * 任意文件；写入与命令执行仍走 validatePath（锁在工作目录）。
 *
 * @param targetPath - 要验证的路径（可以是相对路径或绝对路径）
 * @param workingDirectory - 会话的工作目录（用于解析相对路径）
 * @param containmentRoot - 允许访问的根目录（通常是机器 HOME）
 * @returns 验证结果
 */
export function validateReadPath(
    targetPath: string,
    workingDirectory: string,
    containmentRoot: string,
): PathValidationResult {
    const resolvedTarget = resolve(workingDirectory, targetPath);
    const root = resolve(containmentRoot);

    if (resolvedTarget !== root && !resolvedTarget.startsWith(root + sep)) {
        return {
            valid: false,
            resolvedPath: resolvedTarget,
            error: `Access denied: Path '${targetPath}' is outside the allowed root`,
        };
    }

    return { valid: true, resolvedPath: resolvedTarget };
}
