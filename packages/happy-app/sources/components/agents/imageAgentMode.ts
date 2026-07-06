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
        '使用 $gpt-image-2 skill 生成或编辑图片，并以下面选中的 Garden 案例作为目标风格。',
        '',
        `已选择的 Garden 案例：${style.id}`,
        `案例标题：${style.title}`,
        `模板：${style.templateRef}`,
        `分类：${style.categoryLabel}`,
        '',
        '除非我明确要求改变，否则请保留上传主体的身份特征、关键几何结构、重要文字，以及用户提供的所有约束。',
        '',
        'Garden 案例 prompt：',
        style.promptContent,
    ].join('\n');
}
