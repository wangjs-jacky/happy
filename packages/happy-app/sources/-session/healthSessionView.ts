/** 是否在空的健康会话显示欢迎卡：健康会话且当前无可见消息。 */
export function shouldShowHealthWelcome(a: { isHealth: boolean; visibleCount: number }): boolean {
    return a.isHealth && a.visibleCount === 0;
}

/** 是否给空的健康会话后台补一句问候：健康会话、在线、无可见消息、尚未问候过。 */
export function shouldGreet(a: { isHealth: boolean; visibleCount: number; alreadyGreeted: boolean; online: boolean }): boolean {
    return a.isHealth && a.online && a.visibleCount === 0 && !a.alreadyGreeted;
}
