import type { AgentLauncher } from './launchAgent';
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
const MAX_RECOMMENDED_CONTINUATION_STYLES = 10;
export const MIN_IMAGE_AGENT_VARIANTS_PER_STYLE = 1;
export const MAX_IMAGE_AGENT_VARIANTS_PER_STYLE = 4;

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

export function normalizeImageAgentVariantCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return MIN_IMAGE_AGENT_VARIANTS_PER_STYLE;
    return Math.max(MIN_IMAGE_AGENT_VARIANTS_PER_STYLE, Math.min(MAX_IMAGE_AGENT_VARIANTS_PER_STYLE, Math.floor(value)));
}

export function getImageAgentVariantCount(agent: Pick<AgentLauncher, 'imageVariantsPerStyle'>): number {
    return normalizeImageAgentVariantCount(agent.imageVariantsPerStyle);
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
    const recommendedOptions = getRecommendedContinuationStyles(styles)
        .map((style) => `<option>[[gpt-image-style:${style.id}]] ${style.title}</option>`)
        .join('\n');

    return [
        '使用 $gpt-image-2 skill 执行一次 GPT Image 2 图片编辑 / 生成批处理。',
        '',
        '生成锁：',
        '- 将这次请求视为一个已锁定的图片生成任务。这个锁只用于避免并发图片任务，不限制多风格或多图片输出。',
        '- 在每个选中风格的输出都保存完成，或任务明确失败之前，不要启动第二个批处理。',
        '- 如果当前会话里已经有另一个图片生成任务在运行，请报告图片生成器已被锁定，不要重复启动新的任务。',
        '',
        `输入：已上传 ${args.imageCount} 张参考图。除非用户明确说明不使用，否则请把所有上传图片都作为视觉参考。`,
        `用户目标：${userPrompt}`,
        '',
        '输出要求：',
        `- 对下面每个选中的风格，各生成 ${variants} 张变体。`,
        '- 将 prompt 保存到 garden-gpt-image-2/prompt/，将图片保存到 garden-gpt-image-2/image/。',
        '- 为本次批处理生成一个稳定 batchId（例如 gpt-image-2-YYYYMMDD-HHMMSS），同一批所有图片都使用这个 batchId。',
        '- 每保存一张 PNG/JPEG 后，立即用绝对本地路径调用 mcp__happy__send_image 内联发送，并传入本张图片对应的完整 prompt 和 batchId。不要对本地文件使用 Markdown 图片语法。',
        '- 不要在对话里展示生成过程、命令输出、完整 prompt 或路径清单。',
        '- 最终回复：如果全部成功，先只写“完成。”；不要输出 prompt 文件路径、图片文件路径或清单。如有失败的风格，只简短说明失败的风格 id 和原因。',
        '- 最终回复末尾附上下面这些 GPT Image Gallery 推荐选项，保持 option 内容原样，不要改写 style id；客户端会把它们渲染成可多选风格推荐。',
        '',
        '已选择的 GPT Image 2 风格：',
        styleList,
        '',
        '推荐续生成选项：',
        '<options>',
        recommendedOptions,
        '</options>',
    ].join('\n');
}

function getRecommendedContinuationStyles(styles: ImageAgentStylePreset[]): ImageAgentStylePreset[] {
    const selectedIds = new Set(styles.map((style) => style.id));
    const selectedCategoryIds = new Set(styles.map((style) => style.categoryId));
    const ordered: ImageAgentStylePreset[] = [];
    const push = (style: ImageAgentStylePreset) => {
        if (ordered.some((item) => item.id === style.id)) return;
        ordered.push(style);
    };

    styles.forEach(push);
    IMAGE_AGENT_STYLE_PRESETS
        .filter((style) => !selectedIds.has(style.id) && selectedCategoryIds.has(style.categoryId))
        .forEach(push);
    IMAGE_AGENT_STYLE_PRESETS
        .filter((style) => !selectedIds.has(style.id))
        .forEach(push);

    return ordered.slice(0, MAX_RECOMMENDED_CONTINUATION_STYLES);
}
