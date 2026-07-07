import { describe, expect, it } from 'vitest';
import {
    SCHEDULE_AGENT_ID,
    createScheduleAgentPanelState,
    getScheduleAgentActionPrompt,
    getScheduleAgentWorkspaceLanes,
    reduceScheduleAgentPanelState,
} from './scheduleAgentModel';

describe('scheduleAgentModel', () => {
    it('uses a stable built-in agent id', () => {
        expect(SCHEDULE_AGENT_ID).toBe('builtin:schedule-manager');
    });

    it('turns module taps into focused workspace state', () => {
        const initial = createScheduleAgentPanelState();
        const focused = reduceScheduleAgentPanelState(initial, { type: 'focus-module', moduleId: 'task-pool' });

        expect(focused.focusedModuleId).toBe('task-pool');
        expect(focused.activeView).toBe('task-pool');
        expect(focused.chatOpen).toBe(false);
    });

    it('opens chat and records the selected command prompt', () => {
        const initial = createScheduleAgentPanelState();
        const next = reduceScheduleAgentPanelState(initial, { type: 'select-command', actionId: 'plan-today' });

        expect(next.chatOpen).toBe(true);
        expect(next.selectedActionId).toBe('plan-today');
        expect(next.lastPrompt).toContain('TT');
        expect(next.lastPrompt).toContain('不要直接修改');
    });

    it('builds TT-first prompts for task pool review', () => {
        const prompt = getScheduleAgentActionPrompt('review-pool');

        expect(prompt).toContain('任务池');
        expect(prompt).toContain('tt project-list');
        expect(prompt).toContain('确认后再执行写操作');
        expect(prompt).toContain(SCHEDULE_AGENT_ID);
    });

    it('models the workspace as context, plan, and execution lanes', () => {
        const focused = reduceScheduleAgentPanelState(createScheduleAgentPanelState(), {
            type: 'focus-module',
            moduleId: 'calendar',
        });
        const selected = reduceScheduleAgentPanelState(focused, { type: 'select-command', actionId: 'sync-tt' });

        const lanes = getScheduleAgentWorkspaceLanes(selected);

        expect(lanes.map((lane) => lane.id)).toEqual(['context', 'plan', 'execute']);
        expect(lanes[0]).toMatchObject({ kind: 'modules', selectedId: 'calendar' });
        expect(lanes[1]).toMatchObject({ kind: 'focus', selectedId: 'calendar' });
        expect(lanes[2]).toMatchObject({ kind: 'actions', selectedId: 'sync-tt' });
    });
});
