import * as React from 'react';
import { sync } from '@/sync/sync';
import { storage, useSessionMessages } from '@/sync/storage';
import { sessionWorkingPath } from '@/sync/sessionWorkingPath';
import { isHealthCheckinSession } from '@/components/rightPanel/HealthCheckinPanel';
import { filterVisibleMessages } from '@/sync/messageVisibility';
import { shouldGreet } from './healthSessionView';
import { t } from '@/text';

/** 进程内幂等集合：每个 sessionId 只触发一次问候。 */
const greeted = new Set<string>();

/**
 * 进入空的健康会话时，后台自动发一条隐藏问候 prompt，
 * 让 Agent 回一句温暖开场白。幂等：每个会话仅触发一次。
 */
export function useHealthGreeting(sessionId: string) {
    const { messages } = useSessionMessages(sessionId);
    React.useEffect(() => {
        const s = storage.getState().sessions[sessionId];
        const isHealth = isHealthCheckinSession(sessionWorkingPath(s));
        const visibleCount = filterVisibleMessages(messages).length;
        const online = s?.presence === 'online';
        if (!shouldGreet({ isHealth, visibleCount, alreadyGreeted: greeted.has(sessionId), online })) return;
        greeted.add(sessionId);
        sync.sendMessage(sessionId, t('healthPanel.greetingPrompt'), { hidden: true });
    }, [sessionId, messages]);
}
