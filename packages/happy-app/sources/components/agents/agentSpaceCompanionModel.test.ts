import { describe, expect, it, vi } from 'vitest';
import { en as defaultEnglish } from '@/text/_default';
import type { AgentLauncher } from './launchAgent';

vi.mock('@/text', () => ({
    t: (key: string) => ({
        'agentSpace.companion.panelTitle': 'Daily companion',
        'agentSpace.companion.panelSubtitle': 'Small steps for a steadier rhythm',
        'agentSpace.companion.tipBedtimeEyebrow': 'Before bed · 23:30',
        'agentSpace.companion.tipBedtimeTitle': 'Be in bed by 23:30',
        'agentSpace.companion.tipBedtimeBody': 'Close stimulating content 30 minutes earlier to give your brain a clear signal to sleep.',
        'agentSpace.companion.tipMorningLightEyebrow': 'Morning · 10 min',
        'agentSpace.companion.tipMorningLightTitle': 'Get 10 minutes of natural light',
        'agentSpace.companion.tipMorningLightBody': 'Get morning light soon after waking to help stabilize your circadian rhythm.',
        'agentSpace.companion.tipSleepWindowEyebrow': 'Tonight · 7 hours',
        'agentSpace.companion.tipSleepWindowTitle': 'Reserve a 7-hour sleep window',
        'agentSpace.companion.tipSleepWindowBody': 'Protect the sleep window first instead of trying to change every habit at once.',
        'agentSpace.companion.actionSleepTitle': "Record last night's sleep",
        'agentSpace.companion.actionSleepPrompt': "Help me record last night's sleep. I'll add a sleep screenshot or the exact times.",
        'agentSpace.companion.actionExerciseTitle': 'Record an exercise',
        'agentSpace.companion.actionExercisePrompt': "Help me record an exercise today. I'll add the activity type, duration, or a screenshot.",
        'agentSpace.companion.actionDietTitle': "Record today's diet",
        'agentSpace.companion.actionDietPrompt': "Help me record today's diet. I'll add the food, portions, or photos.",
        'agentSpace.companion.actionWeeklyTitle': "Summarize this week's health",
        'agentSpace.companion.actionWeeklyPrompt': "Based on this week's health records, summarize my sleep, exercise, and diet, then suggest what I should focus on next.",
    } as Record<string, string>)[key] ?? key,
}));

import { buildAgentSpaceCompanionModel } from './agentSpaceCompanionModel';

function makeAgent(overrides: Partial<AgentLauncher> = {}): AgentLauncher {
    return {
        id: 'agent-1',
        name: 'Agent',
        glyph: 'A',
        color: '#5e5791',
        machineId: 'machine-1',
        path: '~/work',
        presets: [],
        kind: 'standard',
        spaceType: 'default',
        imageStyleIds: [],
        imageVariantsPerStyle: 1,
        ...overrides,
    };
}

describe('buildAgentSpaceCompanionModel', () => {
    it('returns the three fixed health tips in their approved order with stable IDs', () => {
        const model = buildAgentSpaceCompanionModel(makeAgent({ spaceType: 'health' }));

        expect(model.tips.map((tip) => tip.id)).toEqual([
            'bedtime',
            'morning-light',
            'sleep-window',
        ]);
        expect(model.tips).toEqual([
            expect.objectContaining({
                eyebrow: 'Before bed · 23:30',
                title: 'Be in bed by 23:30',
                body: expect.stringContaining('30 minutes earlier'),
            }),
            expect.objectContaining({
                eyebrow: 'Morning · 10 min',
                title: 'Get 10 minutes of natural light',
                body: expect.stringContaining('circadian rhythm'),
            }),
            expect.objectContaining({
                eyebrow: 'Tonight · 7 hours',
                title: 'Reserve a 7-hour sleep window',
                body: expect.stringContaining('every habit at once'),
            }),
        ]);
    });

    it('returns the four fixed health actions in approved order with stable IDs and complete prompts', () => {
        const model = buildAgentSpaceCompanionModel(makeAgent({ spaceType: 'health' }));

        expect(model.actions.map((action) => action.id)).toEqual([
            'sleep',
            'exercise',
            'diet',
            'weekly-summary',
        ]);
        expect(model.actions.map((action) => action.title)).toEqual([
            "Record last night's sleep",
            'Record an exercise',
            "Record today's diet",
            "Summarize this week's health",
        ]);
        expect(model.actions[0]?.prompt).toMatch(/screenshot|details/i);
        expect(model.actions[1]?.prompt).toMatch(/screenshot|details/i);
        expect(model.actions[2]?.prompt).toMatch(/photo|screenshot|details/i);
        expect(model.actions[3]?.prompt).toMatch(/sleep.*exercise.*diet.*next/is);
        expect(model.actions.every((action) => action.icon.length > 0)).toBe(true);
    });

    it('maps default presets to actions without changing prompt text and keeps duplicate-label IDs stable', () => {
        const presets = [
            { label: 'Check in', prompt: 'First prompt, unchanged.' },
            { label: 'Check in', prompt: 'Second prompt, also unchanged.' },
        ];
        const first = buildAgentSpaceCompanionModel(makeAgent({ presets }));
        const second = buildAgentSpaceCompanionModel(makeAgent({ presets }));

        expect(first.tips).toEqual([]);
        expect(first.actions.map(({ id, title, prompt }) => ({ id, title, prompt }))).toEqual([
            { id: 'preset-0', title: 'Check in', prompt: 'First prompt, unchanged.' },
            { id: 'preset-1', title: 'Check in', prompt: 'Second prompt, also unchanged.' },
        ]);
        expect(second.actions.map((action) => action.id)).toEqual(first.actions.map((action) => action.id));
    });

    it('routes exclusively by spaceType instead of path or agent name', () => {
        const healthLikeDefault = buildAgentSpaceCompanionModel(makeAgent({
            name: 'Health Check-in',
            path: '~/人生辅助系统/健康打卡',
            spaceType: 'default',
            presets: [{ label: 'Preset', prompt: 'Keep me default.' }],
        }));
        const renamedHealth = buildAgentSpaceCompanionModel(makeAgent({
            name: 'Renamed space',
            path: '~/work',
            spaceType: 'health',
        }));

        expect(healthLikeDefault.tips).toEqual([]);
        expect(healthLikeDefault.actions.map((action) => action.prompt)).toEqual(['Keep me default.']);
        expect(renamedHealth.tips.map((tip) => tip.id)).toEqual(['bedtime', 'morning-light', 'sleep-window']);
    });

    it('keeps the approved health companion copy semantics in the source locale', () => {
        expect(defaultEnglish.agentSpace.companion).toMatchObject({
            tipBedtimeTitle: 'Be in bed by 23:30',
            tipBedtimeBody: 'Close stimulating content 30 minutes earlier to give your brain a clear signal to sleep.',
            tipMorningLightTitle: 'Get 10 minutes of natural light',
            tipMorningLightBody: 'Get morning light soon after waking to help stabilize your circadian rhythm.',
            tipSleepWindowTitle: 'Reserve a 7-hour sleep window',
            tipSleepWindowBody: 'Protect the sleep window first instead of trying to change every habit at once.',
            actionSleepTitle: "Record last night's sleep",
            actionSleepPrompt: "Help me record last night's sleep. I'll add a sleep screenshot or the exact times.",
            actionExerciseTitle: 'Record an exercise',
            actionExercisePrompt: "Help me record an exercise today. I'll add the activity type, duration, or a screenshot.",
            actionDietTitle: "Record today's diet",
            actionDietPrompt: "Help me record today's diet. I'll add the food, portions, or photos.",
            actionWeeklyTitle: "Summarize this week's health",
            actionWeeklyPrompt: "Based on this week's health records, summarize my sleep, exercise, and diet, then suggest what I should focus on next.",
        });
    });
});
