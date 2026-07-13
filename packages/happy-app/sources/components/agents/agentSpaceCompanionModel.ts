import { t } from '@/text';
import type { AgentLauncher } from './launchAgent';

export type CompanionTip = {
    id: string;
    eyebrow: string;
    title: string;
    body: string;
};

export type CompanionAction = {
    id: string;
    icon: string;
    title: string;
    prompt: string;
};

export type AgentSpaceCompanionModel = {
    title: string;
    subtitle?: string;
    tips: CompanionTip[];
    actions: CompanionAction[];
};

function buildHealthCompanionModel(): AgentSpaceCompanionModel {
    return {
        title: t('agentSpace.companion.panelTitle'),
        subtitle: t('agentSpace.companion.panelSubtitle'),
        tips: [
            {
                id: 'bedtime',
                eyebrow: t('agentSpace.companion.tipBedtimeEyebrow'),
                title: t('agentSpace.companion.tipBedtimeTitle'),
                body: t('agentSpace.companion.tipBedtimeBody'),
            },
            {
                id: 'morning-light',
                eyebrow: t('agentSpace.companion.tipMorningLightEyebrow'),
                title: t('agentSpace.companion.tipMorningLightTitle'),
                body: t('agentSpace.companion.tipMorningLightBody'),
            },
            {
                id: 'sleep-window',
                eyebrow: t('agentSpace.companion.tipSleepWindowEyebrow'),
                title: t('agentSpace.companion.tipSleepWindowTitle'),
                body: t('agentSpace.companion.tipSleepWindowBody'),
            },
        ],
        actions: [
            {
                id: 'sleep',
                icon: 'weather-night',
                title: t('agentSpace.companion.actionSleepTitle'),
                prompt: t('agentSpace.companion.actionSleepPrompt'),
            },
            {
                id: 'exercise',
                icon: 'run',
                title: t('agentSpace.companion.actionExerciseTitle'),
                prompt: t('agentSpace.companion.actionExercisePrompt'),
            },
            {
                id: 'diet',
                icon: 'food-apple-outline',
                title: t('agentSpace.companion.actionDietTitle'),
                prompt: t('agentSpace.companion.actionDietPrompt'),
            },
            {
                id: 'weekly-summary',
                icon: 'chart-line',
                title: t('agentSpace.companion.actionWeeklyTitle'),
                prompt: t('agentSpace.companion.actionWeeklyPrompt'),
            },
        ],
    };
}

function buildDefaultCompanionModel(agent: AgentLauncher): AgentSpaceCompanionModel {
    return {
        title: t('agentSpace.companion.panelTitle'),
        subtitle: t('agentSpace.companion.panelSubtitle'),
        tips: [],
        actions: agent.presets.map((preset, index) => ({
            id: `preset-${index}`,
            icon: 'message-text-outline',
            title: preset.label,
            prompt: preset.prompt,
        })),
    };
}

export function buildAgentSpaceCompanionModel(agent: AgentLauncher): AgentSpaceCompanionModel {
    if (agent.spaceType === 'health') {
        return buildHealthCompanionModel();
    }

    return buildDefaultCompanionModel(agent);
}
