import * as React from 'react';
import { machineBrowseDirectory, machineBash } from '@/sync/ops';
import {
    decodeBase64Utf8,
    isReportFilename,
    todayLocalISO,
    parseHealthLog,
    type HealthLog,
} from '@/utils/healthLog';

const TREND_DAYS = 7;

export interface HealthReports {
    loading: boolean;
    today: HealthLog | null;   // 当天日报（无则 null → 面板显示「今天还没记录」）
    trend: HealthLog[];        // 最近若干天（升序），供趋势卡
}

/** POSIX 单引号安全转义，用于把绝对路径塞进 bash 命令。 */
function shellSingleQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 「机器级」读取健康打卡日报（`<agent path>/日报/*.md`）——**不依赖活跃会话**，只要机器在线即可，
 * 因此可用于「空间模式」里还没有会话的场景（会话级 sessionReadFile 拿不到时的替代）。
 *
 * 流程：先用 `machineBrowseDirectory` 把 agent.path 解析成绝对路径（规避 `~` 展开歧义），
 * 再用一次 `machineBash` 列出并 base64 读回最近 TREND_DAYS 天的日报。解析沿用 healthLog 的纯函数。
 * 任何一步失败都静默回落到空数据（契合本仓库「never show loading error」）。
 */
export function useHealthReports(opts: {
    machineId: string | null;
    path: string | null;
    enabled: boolean;
    reloadKey?: number;
}): HealthReports {
    const { machineId, path, enabled, reloadKey = 0 } = opts;
    const [state, setState] = React.useState<HealthReports>({ loading: true, today: null, trend: [] });

    React.useEffect(() => {
        if (!enabled || !machineId || !path) {
            setState({ loading: false, today: null, trend: [] });
            return;
        }
        let cancelled = false;
        (async () => {
            setState((s) => (s.loading ? s : { ...s, loading: true }));

            // 1) 解析 agent.path → 绝对路径（machineBrowseDirectory 会处理 ~ / 相对路径）
            const browse = await machineBrowseDirectory(machineId, path);
            const baseAbs = browse.success && browse.path ? browse.path : path;
            const dir = `${baseAbs}/日报`;

            // 2) 一次 bash：列出日报文件名（YYYY-MM-DD.md）、取最近 TREND_DAYS 天，逐个 base64 单行读回
            const q = shellSingleQuote(dir);
            const cmd =
                `d=${q}; ls -1 "$d" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.md$' | sort | tail -n ${TREND_DAYS} | ` +
                `while IFS= read -r f; do printf '@@F:%s@@\\n' "$f"; base64 < "$d/$f" 2>/dev/null | tr -d '\\n'; printf '\\n'; done`;
            const res = await machineBash(machineId, { command: cmd, timeout: 20000 });
            if (cancelled) return;

            const parsed = new Map<string, HealthLog>();
            if (res.success && res.stdout) {
                for (const chunk of res.stdout.split('@@F:')) {
                    const m = chunk.match(/^(.+?)@@\n([\s\S]*)$/);
                    if (!m) continue;
                    const name = m[1].trim();
                    const b64 = m[2].trim();
                    if (!isReportFilename(name) || !b64) continue;
                    try {
                        parsed.set(name, parseHealthLog(name, decodeBase64Utf8(b64)));
                    } catch {
                        // 单个文件解析失败不影响其余
                    }
                }
            }

            const trend = [...parsed.keys()].sort().map((n) => parsed.get(n)!).filter(Boolean);
            const today = parsed.get(`${todayLocalISO(new Date())}.md`) ?? null;
            setState({ loading: false, today, trend });
        })();
        return () => {
            cancelled = true;
        };
    }, [machineId, path, enabled, reloadKey]);

    return state;
}
