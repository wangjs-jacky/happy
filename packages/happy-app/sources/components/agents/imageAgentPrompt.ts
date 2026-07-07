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
        '使用 Happy 内置 GPT Image 2 图片工作流执行一次图片编辑 / 生成批处理。',
        '这是 Happy 自带能力，不要求安装或调用外部 Skills；在 Codex 中优先使用宿主原生 imagegen。',
        '',
        '批量策略：',
        '- 将每个选中风格、每张变体都视为独立图片 prompt，尽量并行发起；不要等第 1 张完成后才开始第 2 张。',
        '- 只有宿主原生 imagegen、工具调度或上游接口明确限流时，才退化为串行，并简短说明原因。',
        '- 不要兜底到本地网关、Garden/OpenAI 兼容脚本或 scripts/generate.js，除非用户明确要求使用这些模式。',
        '',
        `输入：已上传 ${args.imageCount} 张参考图。除非用户明确说明不使用，否则请把所有上传图片都作为视觉参考。`,
        `用户目标：${userPrompt}`,
        '',
        '输出要求：',
        `- 对下面每个选中的风格，各生成 ${variants} 张变体。`,
        '- 将 prompt 保存到 garden-gpt-image-2/prompt/，将图片保存到 garden-gpt-image-2/image/。',
        '- 每保存一张 PNG/JPEG 后，立即用绝对本地路径调用 mcp__happy__send_image 内联发送。不要对本地文件使用 Markdown 图片语法。',
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
