import type { AgentLauncher } from './launchAgent';
import { FOLD_PROMPT_CLOSE_TAG, FOLD_PROMPT_OPEN_TAG } from '@/utils/autoFoldPrompt';
import {
    IMAGE_AGENT_STYLE_CATEGORIES as BASE_IMAGE_AGENT_STYLE_CATEGORIES,
    IMAGE_AGENT_STYLE_PRESETS as BASE_IMAGE_AGENT_STYLE_PRESETS,
    LEGACY_IMAGE_STYLE_ID_ALIASES,
} from './imageStyleCatalog';
import {
    EXTRA_IMAGE_AGENT_STYLE_CATEGORIES,
    EXTRA_IMAGE_AGENT_STYLE_PRESETS,
} from './imageStyleCatalogExtras';
import type {
    ImageAgentStyleCategory,
    ImageAgentStyleLabelKey,
    ImageAgentStylePreset,
} from './imageStyleTypes';

export type { ImageAgentStyleCategory, ImageAgentStyleLabelKey, ImageAgentStylePreset };

export const IMAGE_AGENT_STYLE_CATEGORIES: ImageAgentStyleCategory[] = [
    ...EXTRA_IMAGE_AGENT_STYLE_CATEGORIES,
    ...BASE_IMAGE_AGENT_STYLE_CATEGORIES,
];

export const IMAGE_AGENT_STYLE_PRESETS: ImageAgentStylePreset[] = [
    ...EXTRA_IMAGE_AGENT_STYLE_PRESETS,
    ...BASE_IMAGE_AGENT_STYLE_PRESETS,
];

const STYLE_BY_ID = new Map(IMAGE_AGENT_STYLE_PRESETS.map((style) => [style.id, style]));

function normalizeLegacyReferenceStyleId(styleId: string): string {
    if (styleId.startsWith('oba-tiramisu/')) {
        return styleId.replace('oba-tiramisu/', 'reference-tiramisu/');
    }
    if (styleId.startsWith('oba-dog/')) {
        return styleId.replace('oba-dog/', 'reference-dog/');
    }
    return styleId;
}

function resolveImageAgentStyle(styleId: string): ImageAgentStylePreset | undefined {
    const normalizedStyleId = normalizeLegacyReferenceStyleId(styleId);
    return STYLE_BY_ID.get(normalizedStyleId) ?? STYLE_BY_ID.get(LEGACY_IMAGE_STYLE_ID_ALIASES[normalizedStyleId]);
}

export function getImageAgentStyleLabel(style: ImageAgentStylePreset): string {
    return style.title;
}

export function getImageAgentStylesForAgent(agent: Pick<AgentLauncher, 'imageStyleIds'>): ImageAgentStylePreset[] {
    const ids = agent.imageStyleIds ?? [];
    const selected = ids
        .map((id) => resolveImageAgentStyle(id))
        .filter((style): style is ImageAgentStylePreset => !!style);
    return selected.length > 0 ? selected : IMAGE_AGENT_STYLE_PRESETS;
}

export function getImageAgentVariantCount(agent: Pick<AgentLauncher, 'imageVariantsPerStyle'>): number {
    const value = agent.imageVariantsPerStyle ?? 1;
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(4, Math.floor(value)));
}

export function buildImageAgentPrompt(args: {
    agent: AgentLauncher;
    userPrompt: string;
    imageCount: number;
}): string {
    const styles = getImageAgentStylesForAgent(args.agent);
    const variants = getImageAgentVariantCount(args.agent);
    const userPrompt = args.userPrompt.trim() || '请把上传的参考图作为主体参考，生成一组可复用的风格效果总览。';
    const styleList = styles.map((style, index) => (
        `${index + 1}. ${style.id} (${style.templateRef}) - ${style.title}: ${style.promptHint}`
    )).join('\n');

    return [
        '使用 $gpt-image-2 skill 执行一次 GPT Image 2 图片编辑 / 生成批处理。',
        '',
        '生成锁：',
        '- 将这次请求视为一个已锁定的图片生成任务。在每个请求的输出都保存完成，或任务明确失败之前，不要启动第二个批处理。',
        '- 如果当前会话里已经有另一个图片生成任务在运行，请报告图片生成器已被锁定，不要重复启动新的任务。',
        '',
        `输入：已上传 ${args.imageCount} 张参考图。除非用户明确说明不使用，否则请把所有上传图片都作为视觉参考。`,
        `用户目标：${userPrompt}`,
        '',
        '输出要求：',
        `- 对下面每个选中的风格，各生成 ${variants} 张变体。`,
        '- 将 prompt 保存到 garden-gpt-image-2/prompt/，将图片保存到 garden-gpt-image-2/image/。',
        '- 每保存一张 PNG/JPEG 后，立即用绝对本地路径调用 mcp__happy__send_image 内联发送。不要对本地文件使用 Markdown 图片语法。',
        `- 如果需要在对话中展示完整的生成 prompt 或风格 prompt，请把每段完整 prompt 包在 ${FOLD_PROMPT_OPEN_TAG} 和 ${FOLD_PROMPT_CLOSE_TAG} 之间。`,
        '- 结束时给出一份简洁清单，列出风格 id、输出路径；如有失败的风格，也列出失败原因。',
        '',
        '已选择的 GPT Image 2 风格：',
        styleList,
    ].join('\n');
}
