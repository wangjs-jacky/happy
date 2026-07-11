/** 是否在空的健康会话显示欢迎卡：健康会话且当前无可见消息。 */
export function shouldShowHealthWelcome(a: { isHealth: boolean; visibleCount: number }): boolean {
    return a.isHealth && a.visibleCount === 0;
}
