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

function resolveImageAgentStyle(styleId: string): ImageAgentStylePreset | undefined {
    return STYLE_BY_ID.get(styleId) ?? STYLE_BY_ID.get(LEGACY_IMAGE_STYLE_ID_ALIASES[styleId]);
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
    const userPrompt = args.userPrompt.trim() || 'Use the uploaded reference image(s) as the subject reference and generate a reusable style overview.';
    const styleList = styles.map((style, index) => (
        `${index + 1}. ${style.id} (${style.templateRef}) - ${style.title}: ${style.promptHint}`
    )).join('\n');

    return [
        'Use the $gpt-image-2 skill to run a GPT Image 2 image editing/generation batch.',
        '',
        'Generation lock:',
        '- Treat this as one locked image generation job. Do not start a second batch until every requested output is saved or the job fails.',
        '- If another generation job is already active in this session, report that the image generator is locked instead of starting a duplicate.',
        '',
        `Input: ${args.imageCount} uploaded reference image(s). Use all uploaded images as visual references unless the user explicitly says otherwise.`,
        `User goal: ${userPrompt}`,
        '',
        'Output contract:',
        `- Generate ${variants} variant(s) per style for every selected style below.`,
        '- Save prompts under garden-gpt-image-2/prompt/ and images under garden-gpt-image-2/image/.',
        '- After each PNG/JPEG is saved, send it inline with mcp__happy__send_image using the absolute local path. Do not use Markdown image syntax for local files.',
        '- Finish with a concise manifest listing style id, output path, and any failed style with the reason.',
        '',
        'Selected GPT Image 2 styles:',
        styleList,
    ].join('\n');
}
