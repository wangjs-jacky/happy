/**
 * 文件夹浏览器的纯路径导航函数。仅处理 POSIX 风格绝对路径(远端开发机是
 * macOS/Linux)。刻意不依赖 React / RPC,好让导航规则可独立单测。
 */

/** 取上一级目录;封顶到文件系统根 `/`。 */
export function getParentPath(path: string): string {
    if (path === '/' || path === '') return '/';
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const idx = trimmed.lastIndexOf('/');
    return idx <= 0 ? '/' : trimmed.slice(0, idx);
}

/** 拼接子项路径(处理父目录尾部斜杠)。 */
export function joinChild(dir: string, name: string): string {
    const base = dir.endsWith('/') ? dir.slice(0, -1) : dir;
    return `${base}/${name}`;
}

/** 是否还能向上(不越过 HOME)。到达 HOME 即不可再上。 */
export function canGoUp(currentPath: string, homeDir: string): boolean {
    return currentPath !== homeDir;
}

export type BackTarget = { kind: 'up'; path: string } | { kind: 'exit' };

/**
 * 解析「返回」手势去向:逐层上退到浏览器根目录,到根则退出回能力中心;
 * 永不越过 HOME。
 */
export function resolveBack(currentPath: string, rootPath: string, homeDir: string): BackTarget {
    if (currentPath === rootPath || !canGoUp(currentPath, homeDir)) {
        return { kind: 'exit' };
    }
    return { kind: 'up', path: getParentPath(currentPath) };
}
