import * as React from 'react';

// useOtaVersions —— 拉取自建 OSS 上某频道的全部 OTA 历史版本，供「OTA 版本」选择器展示。
//
// 数据来源：发布脚本 publish-ota.js 每次发布都会在 OSS 写一份轻量元信息
//   meta/<platform>/<runtime>/<channel>/<stamp>.json = { stamp, createdAt, id, channel, git }
// 这里分两步：
//   1) 对桶做 ListObjectsV2（GET ?list-type=2&prefix=meta/.../<channel>/）拿到全部 key；
//      OSS 返回 XML，用正则提取 <Key> 即可（受控格式，无需引 XML 解析库）。
//   2) 并发 fetch 每个 meta json，组装成版本列表（按 stamp 倒序，最新在前）。
// 需要桶对 meta/ 前缀开匿名 ListObjects + GetObject 权限（见部署文档）。

const OSS_PUBLIC_BASE = 'https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com';
// 单次最多展示多少个版本（够回归验收用，避免拉太多 meta）
const MAX_VERSIONS = 50;

export interface OtaGitInfo {
    sha?: string;
    branch?: string;
    subject?: string;
    dirty?: boolean;
}

export interface OtaVersion {
    stamp: string;        // 毫秒时间戳，定向锁定的 key
    id: string;           // manifest UUID（= 运行时 Update ID）
    createdAt: string;    // ISO 时间
    channel: string;
    git: OtaGitInfo;
}

export interface OtaVersionsState {
    versions: OtaVersion[];
    loading: boolean;
    error: string | null;
    debug: string; // 诊断信息（HTTP 状态 / 字节数 / 解析结果），排查「拿不到版本」用
    refresh: () => Promise<void>;
}

// 从 OSS ListObjectsV2 的 XML 响应里提取所有对象 key
function extractKeys(xml: string): string[] {
    const keys: string[] = [];
    const re = /<Key>([^<]+)<\/Key>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        keys.push(m[1]);
    }
    return keys;
}

export function useOtaVersions(channel: string = 'preview', platform: string = 'android', runtime: string = '21'): OtaVersionsState {
    const [versions, setVersions] = React.useState<OtaVersion[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [debug, setDebug] = React.useState<string>('');

    const refresh = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const prefix = `meta/${platform}/${runtime}/${channel}/`;
            const listUrl = `${OSS_PUBLIC_BASE}/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
            const listRes = await fetch(listUrl);
            const xml = await listRes.text();
            const allKeys = extractKeys(xml);
            const stamps = allKeys
                .filter((k) => k.endsWith('.json'))
                .map((k) => k.slice(prefix.length).replace(/\.json$/, ''))
                .filter((s) => /^\d+$/.test(s))
                .sort((a, b) => Number(b) - Number(a)) // 最新在前
                .slice(0, MAX_VERSIONS);
            // 诊断：HTTP 状态 / 响应字节 / 解析出的 key 数 / stamp 数 + 响应头几个字符
            setDebug(`HTTP ${listRes.status} · ${xml.length}B · keys ${allKeys.length} · stamps ${stamps.length} · head「${xml.slice(0, 40).replace(/\s+/g, ' ')}」`);
            if (!listRes.ok) {
                throw new Error(`ListObjects HTTP ${listRes.status}: ${xml.slice(0, 120)}`);
            }

            const metas = await Promise.all(
                stamps.map(async (stamp) => {
                    try {
                        const res = await fetch(`${OSS_PUBLIC_BASE}/${prefix}${stamp}.json`);
                        if (!res.ok) return null;
                        const meta = await res.json();
                        return {
                            stamp,
                            id: meta.id ?? '',
                            createdAt: meta.createdAt ?? '',
                            channel: meta.channel ?? channel,
                            git: meta.git ?? {},
                        } as OtaVersion;
                    } catch {
                        return null;
                    }
                }),
            );
            const ok = metas.filter((v): v is OtaVersion => v !== null);
            setVersions(ok);
            setDebug((d) => `${d} · metaOk ${ok.length}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
            setDebug((d) => `${d || ''} · ERR ${msg}`.slice(0, 300));
        } finally {
            setLoading(false);
        }
    }, [channel, platform, runtime]);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    return { versions, loading, error, debug, refresh };
}
