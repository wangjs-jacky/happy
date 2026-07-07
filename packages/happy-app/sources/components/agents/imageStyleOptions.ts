import {
    IMAGE_AGENT_STYLE_PRESETS,
    getImageAgentStyleLabel,
    normalizeImageAgentVariantCount,
    type ImageAgentStylePreset,
} from './imageAgentPrompt';

export const IMAGE_STYLE_OPTION_PREFIX = 'gpt-image-style:';
export const MAX_IMAGE_STYLE_OPTION_COUNT = 10;

const STYLE_BY_ID = new Map(IMAGE_AGENT_STYLE_PRESETS.map((style) => [style.id, style]));

export type ParsedImageStyleOption = {
    raw: string;
    title: string;
    style: ImageAgentStylePreset;
};

export function formatImageStyleOption(style: ImageAgentStylePreset): string {
    return `[[${IMAGE_STYLE_OPTION_PREFIX}${style.id}]] ${getImageAgentStyleLabel(style)}`;
}

export function parseImageStyleOption(raw: string): ParsedImageStyleOption | null {
    const match = raw.match(/^\[\[gpt-image-style:([^\]]+)\]\]\s*(.*)$/);
    if (!match) return null;
    const style = STYLE_BY_ID.get(match[1]);
    if (!style) return null;
    const title = match[2].trim() || getImageAgentStyleLabel(style);
    return { raw, title, style };
}

export function parseImageStyleOptions(items: string[], limit: number = MAX_IMAGE_STYLE_OPTION_COUNT): ParsedImageStyleOption[] {
    const result: ParsedImageStyleOption[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        const parsed = parseImageStyleOption(item);
        if (!parsed || seen.has(parsed.style.id)) continue;
        seen.add(parsed.style.id);
        result.push(parsed);
        if (result.length >= limit) break;
    }
    return result;
}

export function buildImageStyleContinuationPrompt(
    styles: ImageAgentStylePreset[],
    options: { variantsPerStyle?: number } = {},
): string {
    const variants = normalizeImageAgentVariantCount(options.variantsPerStyle ?? 1);
    const styleList = styles.map((style, index) => (
        `${index + 1}. ${style.id} (${style.templateRef}) - ${getImageAgentStyleLabel(style)}: ${style.promptHint}`
    )).join('\n');
    const recommendedOptions = getRecommendedImageStyleOptions(styles).map((option) => `<option>${option}</option>`).join('\n');

    return [
        '使用 Happy 内置 GPT Image 2 图片工作流继续执行一次图片编辑 / 生成批处理。',
        '这是 Happy 自带能力，不要求安装或调用外部 Skills；在 Codex 中优先使用宿主原生 imagegen。',
        '',
        '批量策略：',
        '- 这是同一个续生成批处理；请在这一轮里完成下面所有选中风格，不要拆成多个新任务。',
        '- 将每个选中风格、每张变体都视为独立图片 prompt，尽量并行发起；不要等第 1 张完成后才开始第 2 张。',
        '- 只有宿主原生 imagegen、工具调度或上游接口明确限流时，才退化为串行，并简短说明原因。',
        '- 不要兜底到本地网关、Garden/OpenAI 兼容脚本或 scripts/generate.js，除非用户明确要求使用这些模式。',
        '',
        '输入：优先使用当前会话中最近一次生成的图片作为视觉参考；如果不可用，使用最近一次上传或生成的相关图片作为参考。',
        '用户目标：基于当前结果继续生成下面选中的 GPT Image Gallery 风格。',
        '',
        '输出要求：',
        `- 对下面每个选中的风格，各生成 ${variants} 张变体。`,
        '- 将 prompt 保存到 garden-gpt-image-2/prompt/，将图片保存到 garden-gpt-image-2/image/。',
        '- 每保存一张 PNG/JPEG 后，立即用绝对本地路径调用 mcp__happy__send_image 内联发送。不要对本地文件使用 Markdown 图片语法。',
        '- 不要在对话里展示生成过程、命令输出、完整 prompt 或路径清单。',
        '- 最终回复：如果全部成功，先只写“完成。”；如有失败的风格，只简短说明失败的风格 id 和原因。',
        '- 最终回复末尾附上下面这些 GPT Image Gallery 推荐选项，保持 option 内容原样，不要改写 style id；客户端会把它们渲染成可多选风格推荐。',
        '',
        '已选择的 GPT Image Gallery 风格：',
        styleList,
        '',
        '推荐续生成选项：',
        '<options>',
        recommendedOptions,
        '</options>',
    ].join('\n');
}

export function getRecommendedImageStyleOptions(styles: ImageAgentStylePreset[], limit: number = MAX_IMAGE_STYLE_OPTION_COUNT): string[] {
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

    return ordered.slice(0, limit).map(formatImageStyleOption);
}
