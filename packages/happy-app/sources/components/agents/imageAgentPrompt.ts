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
    UserImageStyle,
} from './imageStyleTypes';

export type { ImageAgentStyleCategory, ImageAgentStyleLabelKey, ImageAgentStylePreset };

export const USER_IMAGE_STYLE_ID_PREFIX = 'user-reference/';

export const IMAGE_AGENT_STYLE_CATEGORIES: ImageAgentStyleCategory[] = [
    { id: 'user-reference', label: '自定义风格', accent: '#2F7D6B', count: 0 },
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

export function shouldUseUserImageStyleReferenceImages(style: Pick<UserImageStyle, 'analysisStatus' | 'promptContent' | 'referenceImages'>): boolean {
    return style.referenceImages.length > 0 && !(style.analysisStatus === 'prompt-ready' && !!style.promptContent?.trim());
}

function normalizeLegacyReferenceStyleId(styleId: string): string {
    if (styleId.startsWith('oba-tiramisu/')) {
        return styleId.replace('oba-tiramisu/', 'reference-tiramisu/');
    }
    if (styleId.startsWith('oba-dog/')) {
        return styleId.replace('oba-dog/', 'reference-dog/');
    }
    return styleId;
}

export function createUserImageStylePreset(style: UserImageStyle): ImageAgentStylePreset {
    const extractedPrompt = style.analysisStatus === 'prompt-ready' ? style.promptContent?.trim() : undefined;
    const promptContent = extractedPrompt
        ? [
            `自定义 Prompt 风格：${style.title}`,
            extractedPrompt,
            style.negativePrompt?.trim() ? `避免：${style.negativePrompt.trim()}` : '',
            style.tags?.length ? `标签：${style.tags.join('、')}` : '',
            '把这份沉淀后的风格 Prompt 应用到本次用户素材或用户描述上，不需要再依赖原始参考照片，除非本次用户另外上传了图片。',
        ].filter(Boolean).join('\n')
        : [
            `自定义参考照片风格：${style.title}`,
            style.promptHint,
            '当前风格 Prompt 还在提炼中，先用随任务一起上传的自定义风格参考图作为临时风格来源。',
            '必须从自定义风格参考图中提取视觉语言，包括色彩、光线、材质、镜头/笔触、构图、背景氛围和排版倾向。',
            '把这些风格特征迁移到本次用户素材或用户描述上，不要把参考图主体误当成必须复刻的内容，除非用户明确要求。',
        ].join('\n');

    return {
        id: style.id,
        title: style.title,
        categoryId: 'user-reference',
        categoryLabel: '自定义风格',
        categoryAccent: '#2F7D6B',
        templateRef: 'user-reference/photo-style',
        templateLabel: extractedPrompt ? 'Prompt Ready' : 'Reference Ready',
        promptHint: style.promptHint,
        promptContent,
        promptPath: `user-reference/${style.id}.md`,
        sourceCaseId: style.id,
        sourceRepository: 'user-reference',
        // Always carry the reference images so the gallery card can render its
        // thumbnail. Whether to actually SEND them as attachments (vs. using the
        // extracted text prompt) is a separate decision made on the raw style via
        // shouldUseUserImageStyleReferenceImages — see ComposeHome's
        // selectedCustomReferenceImages. Gating this field too used to blank the
        // thumbnail the moment a prompt was extracted (prompt-ready).
        referenceImages: style.referenceImages,
        analysisStatus: style.analysisStatus,
        analysisError: style.analysisError,
        customPromptContent: style.promptContent,
        customNegativePrompt: style.negativePrompt,
        customCreatedAt: style.createdAt,
        customUpdatedAt: style.updatedAt,
        customAnalyzedAt: style.analyzedAt,
        customAnalysisSessionId: style.analysisSessionId,
        custom: true,
    };
}

function getUserStylePresets(customStyles: UserImageStyle[] = []): ImageAgentStylePreset[] {
    return customStyles
        .filter((style) => style.referenceImages.length > 0 || !!style.promptContent?.trim())
        .map(createUserImageStylePreset);
}

function resolveImageAgentStyle(styleId: string, customStyles: UserImageStyle[] = []): ImageAgentStylePreset | undefined {
    const custom = getUserStylePresets(customStyles).find((style) => style.id === styleId);
    if (custom) return custom;
    const normalizedStyleId = normalizeLegacyReferenceStyleId(styleId);
    return STYLE_BY_ID.get(normalizedStyleId) ?? STYLE_BY_ID.get(LEGACY_IMAGE_STYLE_ID_ALIASES[normalizedStyleId]);
}

export function getImageAgentStyleLabel(style: ImageAgentStylePreset): string {
    return style.title;
}

export function getImageAgentStylesForAgent(agent: Pick<AgentLauncher, 'imageStyleIds'>, customStyles: UserImageStyle[] = []): ImageAgentStylePreset[] {
    const ids = agent.imageStyleIds ?? [];
    const selected = ids
        .map((id) => resolveImageAgentStyle(id, customStyles))
        .filter((style): style is ImageAgentStylePreset => !!style);
    return selected.length > 0 ? selected : IMAGE_AGENT_STYLE_PRESETS;
}

export function getImageAgentStyleOptionsForAgent(agent: Pick<AgentLauncher, 'imageStyleIds'>, customStyles: UserImageStyle[] = []): ImageAgentStylePreset[] {
    const builtinStyles = getImageAgentStylesForAgent(agent, []);
    return [
        ...getUserStylePresets(customStyles),
        ...builtinStyles,
    ];
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
    customStyles?: UserImageStyle[];
    userPrompt: string;
    imageCount: number;
    styleReferenceImageCount?: number;
    userImageCount?: number;
}): string {
    const styles = getImageAgentStylesForAgent(args.agent, args.customStyles);
    const variants = getImageAgentVariantCount(args.agent);
    const userPrompt = args.userPrompt.trim() || '请把上传的参考图作为主体参考，生成一组可复用的风格效果总览。';
    const styleList = styles.map((style, index) => [
        `${index + 1}. ${style.id} (${style.templateRef}) - ${style.title}: ${style.promptHint}`,
        style.promptContent,
    ].filter(Boolean).join('\n')).join('\n');
    const recommendedOptions = getRecommendedContinuationStyles(styles)
        .map((style) => `<option>[[gpt-image-style:${style.id}]] ${style.title}</option>`)
        .join('\n');

    const styleReferenceImageCount = args.styleReferenceImageCount ?? 0;
    const userImageCount = args.userImageCount ?? args.imageCount;
    const inputLine = styleReferenceImageCount > 0
        ? `输入：已上传 ${args.imageCount} 张图片。其中前 ${styleReferenceImageCount} 张是自定义风格的临时参考图，只用于提取风格；后 ${userImageCount} 张是本次用户素材。除非用户明确说明不使用，否则请把本次用户素材作为主体参考。`
        : `输入：已上传 ${args.imageCount} 张参考图。除非用户明确说明不使用，否则请把所有上传图片都作为视觉参考。`;

    return [
        '使用 $gpt-image-2 skill 执行一次 GPT Image 2 图片编辑 / 生成批处理。',
        '',
        '生成锁：',
        '- 将这次请求视为一个已锁定的图片生成任务。这个锁只用于避免并发图片任务，不限制多风格或多图片输出。',
        '- 在每个选中风格的输出都保存完成，或任务明确失败之前，不要启动第二个批处理。',
        '- 如果当前会话里已经有另一个图片生成任务在运行，请报告图片生成器已被锁定，不要重复启动新的任务。',
        '',
        inputLine,
        styleReferenceImageCount > 0 ? '自定义风格规则：先分析前面的临时风格参考图，抽取可复用的视觉风格，再应用到本次用户素材或用户描述；不要把风格参考图里的主体误替换成本次主体。Prompt 已提炼完成的自定义风格会直接出现在风格清单里，不需要额外参考图。' : '',
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
