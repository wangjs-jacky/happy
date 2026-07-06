import { IMAGE_AGENT_STYLE_PRESETS, type ImageAgentStylePreset } from './imageAgentPrompt';
import type { AgentLauncher } from './launchAgent';

export const IMAGE_STYLE_MODE_PARAM = 'image-styles';
export const IMAGE_STYLE_COMPOSE_ROUTE = `/new?mode=${IMAGE_STYLE_MODE_PARAM}`;
export const BUILTIN_IMAGE_STYLE_AGENT_ID = 'builtin-image-styles';

const DEFAULT_IMAGE_STYLE_IDS = IMAGE_AGENT_STYLE_PRESETS.map((style) => style.id);

function firstParam(value: unknown): string | null {
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
    }
    return null;
}

export function isImageStyleComposeMode(routeMode: unknown): boolean {
    return firstParam(routeMode) === IMAGE_STYLE_MODE_PARAM;
}

export function createBuiltinImageStyleAgent(): AgentLauncher {
    return {
        id: BUILTIN_IMAGE_STYLE_AGENT_ID,
        name: 'GPT Image 2 Styles',
        glyph: 'P',
        color: '#8A5A2B',
        machineId: '',
        path: '~',
        presets: [],
        kind: 'image-styles',
        imageStyleIds: DEFAULT_IMAGE_STYLE_IDS,
        imageVariantsPerStyle: 1,
    };
}

export function resolveComposeImageAgent(args: {
    routeMode: unknown;
    agent: AgentLauncher | null;
}): AgentLauncher | null {
    if (args.agent?.kind === 'image-styles') {
        return args.agent;
    }
    if (!args.agent && isImageStyleComposeMode(args.routeMode)) {
        return createBuiltinImageStyleAgent();
    }
    return null;
}

export function selectImageAgentStyle(agent: AgentLauncher, styleId: string): AgentLauncher {
    return {
        ...agent,
        imageStyleIds: [styleId],
    };
}

export function createImageStyleSelectionPrompt(style: ImageAgentStylePreset): string {
    return [
        `Apply the ${style.id} GPT Image 2 effect.`,
        `Effect direction: ${style.promptHint}.`,
        'Preserve the uploaded subject identity, key geometry, important text, and any user-provided constraints unless I explicitly ask to change them.',
    ].join('\n');
}
