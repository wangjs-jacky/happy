export const SCHEDULE_AGENT_ID = 'builtin:schedule-manager';

export type ScheduleAgentModuleId = 'today' | 'task-pool' | 'calendar' | 'review';
export type ScheduleAgentActionId = 'plan-today' | 'review-pool' | 'sync-tt' | 'weekly-reset';

export type ScheduleAgentPanelState = {
    activeView: ScheduleAgentModuleId;
    focusedModuleId: ScheduleAgentModuleId;
    selectedActionId: ScheduleAgentActionId | null;
    chatOpen: boolean;
    lastPrompt: string | null;
};

export type ScheduleAgentPanelEvent =
    | { type: 'focus-module'; moduleId: ScheduleAgentModuleId }
    | { type: 'select-command'; actionId: ScheduleAgentActionId }
    | { type: 'open-chat' }
    | { type: 'close-chat' };

export type ScheduleAgentModule = {
    id: ScheduleAgentModuleId;
    icon: 'today-outline' | 'file-tray-full-outline' | 'calendar-outline' | 'analytics-outline';
    accent: string;
};

export type ScheduleAgentAction = {
    id: ScheduleAgentActionId;
    icon: 'map-outline' | 'file-tray-full-outline' | 'sync-outline' | 'refresh-circle-outline';
    accent: string;
};

export const SCHEDULE_AGENT_MODULES: ScheduleAgentModule[] = [
    { id: 'today', icon: 'today-outline', accent: '#2563EB' },
    { id: 'task-pool', icon: 'file-tray-full-outline', accent: '#059669' },
    { id: 'calendar', icon: 'calendar-outline', accent: '#D97706' },
    { id: 'review', icon: 'analytics-outline', accent: '#7C3AED' },
];

export const SCHEDULE_AGENT_ACTIONS: ScheduleAgentAction[] = [
    { id: 'plan-today', icon: 'map-outline', accent: '#2563EB' },
    { id: 'review-pool', icon: 'file-tray-full-outline', accent: '#059669' },
    { id: 'sync-tt', icon: 'sync-outline', accent: '#0891B2' },
    { id: 'weekly-reset', icon: 'refresh-circle-outline', accent: '#DB2777' },
];

export function createScheduleAgentPanelState(): ScheduleAgentPanelState {
    return {
        activeView: 'today',
        focusedModuleId: 'today',
        selectedActionId: null,
        chatOpen: false,
        lastPrompt: null,
    };
}

export function getScheduleAgentActionPrompt(actionId: ScheduleAgentActionId): string {
    const sharedProtocol = [
        `Agent: ${SCHEDULE_AGENT_ID}`,
        '你是我的日程管理专家。TT 是滴答清单/待办的事实源，Obsidian 只保存规则、偏好、复盘和 agent.md。',
        '先读取事实，再给建议；凡是会改 TT 的动作，必须先列出变更清单并等待我确认后再执行写操作。',
        '不要直接修改、完成、删除、延期任何 TT 任务；除非我明确确认。',
        '优先使用 TT CLI：tt project-list、tt task today、tt task completed、tt task undone，以及任务池项目。',
    ].join('\n');

    switch (actionId) {
        case 'plan-today':
            return `${sharedProtocol}\n\n任务：生成今天的作战图。\n请拉取今天的 TT 任务、已完成任务、任务池中未定日期任务和明显逾期任务，按「必须今天做 / 可以推进 / 等待确认 / 不建议碰」分组。最后给我一个 3 步执行顺序和需要确认的 TT 写操作。`;
        case 'review-pool':
            return `${sharedProtocol}\n\n任务：整理任务池。\n请先用 tt project-list 找到任务池，再读取任务池任务。按项目、能量、是否需要补上下文分组，指出 3 个最值得今天转入日程的任务。确认后再执行写操作。`;
        case 'sync-tt':
            return `${sharedProtocol}\n\n任务：同步 TT 状态。\n请读取 TT 今日、已完成、任务池和逾期任务，输出差异摘要、异常项和下一步建议。只做读取和分析，不做写操作。`;
        case 'weekly-reset':
            return `${sharedProtocol}\n\n任务：做一次本周日程重置。\n请基于 TT 的未完成/逾期/任务池信息，生成本周主题、风险、可删减事项和建议迁移清单。任何 TT 写入都需要我确认。`;
    }
}

export function reduceScheduleAgentPanelState(
    state: ScheduleAgentPanelState,
    event: ScheduleAgentPanelEvent,
): ScheduleAgentPanelState {
    switch (event.type) {
        case 'focus-module':
            return {
                ...state,
                activeView: event.moduleId,
                focusedModuleId: event.moduleId,
            };
        case 'select-command':
            return {
                ...state,
                selectedActionId: event.actionId,
                chatOpen: true,
                lastPrompt: getScheduleAgentActionPrompt(event.actionId),
            };
        case 'open-chat':
            return {
                ...state,
                chatOpen: true,
            };
        case 'close-chat':
            return {
                ...state,
                chatOpen: false,
            };
    }
}
