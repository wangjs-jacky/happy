/**
 * 带外图库懒拉取：App 监听到 session metadata 的 screenshotRefs 变化后，
 * 把本地还没有的 AI 截图通过会话级 RPC getScreenshotById 拉回、落盘、入 MMKV 图库。
 *
 * 注意：本文件顶层只放纯逻辑与类型，不静态 import apiSocket / screenshotGallery
 * （它们会传递引入 react-native，导致 vitest 无法解析）。IO 主流程在调用时
 * 动态 import，这样纯函数 diffPendingScreenshots 可被单测覆盖。
 */

/** CLI 写进 metadata.screenshotRefs 的轻量引用结构。 */
export interface ScreenshotRef {
    id: string;
    target: string;
    note?: string;
    takenAt: number;
}

/** getScreenshotById RPC 的返回结构（与 CLI registerGetScreenshotByIdHandler 对齐）。 */
interface GetScreenshotByIdResponse {
    success: boolean;
    dataBase64?: string;
    mimeType?: string;
    error?: string;
}

/**
 * 纯函数：从 refs 里筛出本地还没有的（按 remoteId 去重）。便于单测。
 * @param refs CLI 给的全部截图引用
 * @param localRemoteIds 本地图库里已存在的 remoteId 集合
 */
export function diffPendingScreenshots<T extends { id: string }>(
    refs: T[],
    localRemoteIds: Set<string>,
): T[] {
    return refs.filter((ref) => !localRemoteIds.has(ref.id));
}

/**
 * 主流程：逐个 ref，若本地没有就 RPC 拉字节 → 落盘 → 入图库。
 * 逐个 try/catch，单张失败不影响其它。IO 重活，不进单测。
 */
export async function syncScreenshotsForSession(sessionId: string, refs: ScreenshotRef[]): Promise<void> {
    const { apiSocket } = await import('@/sync/apiSocket');
    const { addScreenshotEntry, hasRemoteId, saveBase64Png } = await import('@/sync/screenshotGallery');

    for (const ref of refs) {
        // 去重兜底：即便版本判断漏了，hasRemoteId 也能避免重复落盘。
        if (hasRemoteId(sessionId, ref.id)) {
            continue;
        }
        try {
            const res = await apiSocket.sessionRPC<GetScreenshotByIdResponse, { id: string }>(
                sessionId,
                'getScreenshotById',
                { id: ref.id },
            );
            if (!res.success || !res.dataBase64) {
                console.warn(`[screenshotSync] 拉取截图 ${ref.id} 失败:`, res.error);
                continue;
            }
            const uri = await saveBase64Png(res.dataBase64);
            addScreenshotEntry(sessionId, {
                uri,
                source: 'ai',
                target: ref.target === 'browser' ? 'browser' : 'desktop',
                note: ref.note,
                remoteId: ref.id,
                createdAt: ref.takenAt,
            });
        } catch (e) {
            console.warn(`[screenshotSync] 同步截图 ${ref.id} 异常:`, e);
        }
    }
}
