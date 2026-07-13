import * as React from 'react';
import { sessionListDirectory } from '@/sync/ops';

// 模块级缓存:同一 (session, path) 只请求一次 listDirectory,避免每次滑出
// 右侧面板都重新拉。key = `${sessionId}::${rootPath}`。
const rootCountCache = new Map<string, number>();

/**
 * 懒加载会话工作目录下的顶层条目数,用于「文件夹」能力卡的角标数字。
 * 加载完成前(或无会话/无路径)返回 null。
 */
export function useFolderRootCount(sessionId: string | undefined, rootPath: string | null): number | null {
    const key = sessionId && rootPath ? `${sessionId}::${rootPath}` : null;
    const [count, setCount] = React.useState<number | null>(() => (key ? rootCountCache.get(key) ?? null : null));

    React.useEffect(() => {
        if (!sessionId || !rootPath || !key) return;
        const cached = rootCountCache.get(key);
        if (cached !== undefined) {
            setCount(cached);
            return;
        }
        let cancelled = false;
        (async () => {
            const res = await sessionListDirectory(sessionId, rootPath);
            if (cancelled) return;
            if (res.success && Array.isArray(res.entries)) {
                rootCountCache.set(key, res.entries.length);
                setCount(res.entries.length);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionId, rootPath, key]);

    return count;
}
