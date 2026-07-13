/** 会话工作目录是否为健康打卡目录（据此切健康面板 / 落地页引导）。 */
export function isHealthCheckinSession(path: string | null | undefined): boolean {
    return !!path && path.includes('健康打卡');
}
