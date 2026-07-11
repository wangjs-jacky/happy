import type { Message } from '@/sync/typesMessage';

/** 过滤掉客户端注入的隐藏消息（不在聊天流渲染）。 */
export function filterVisibleMessages(messages: Message[]): Message[] {
    return messages.filter((m) => !m.meta?.hidden);
}
