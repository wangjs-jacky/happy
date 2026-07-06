import type { AgentLauncher } from './launchAgent';

export interface ImageAgentStylePreset {
    id: string;
    labelKey: ImageAgentStyleLabelKey;
    templateRef: string;
    promptHint: string;
}

export type ImageAgentStyleLabelKey =
    | 'agents.imageStyleVintageFilm'
    | 'agents.imageStylePremiumStudio'
    | 'agents.imageStyleWhiteProduct'
    | 'agents.imageStyleLifestyleScene'
    | 'agents.imageStylePackaging'
    | 'agents.imageStyleRecipeFlow'
    | 'agents.imageStyleStepInfographic'
    | 'agents.imageStyleHandDrawnInfo'
    | 'agents.imageStyleBentoGrid'
    | 'agents.imageStyleTvcStoryboard'
    | 'agents.imageStyleCinematicStoryboard'
    | 'agents.imageStyleMixedStyles'
    | 'agents.imageStyleBrandPoster'
    | 'agents.imageStyleCampaignKv'
    | 'agents.imageStyleWebHero'
    | 'agents.imageStyleEditorialCover'
    | 'agents.imageStyleVintageEditorial'
    | 'agents.imageStyleFoodMap'
    | 'agents.imageStyleLookbookGrid'
    | 'agents.imageStyleBannerGrid'
    | 'agents.imageStyleRetroIcons';

export const IMAGE_AGENT_STYLE_PRESETS: ImageAgentStylePreset[] = [
    { id: 'vintage-film', labelKey: 'agents.imageStyleVintageFilm', templateRef: 'product-visuals/lifestyle-product-scene.md', promptHint: 'warm diary-reference vintage film photo, available light, visible real-world context' },
    { id: 'premium-studio', labelKey: 'agents.imageStylePremiumStudio', templateRef: 'product-visuals/premium-studio-product.md', promptHint: 'premium commercial studio product photograph with controlled light and polished shadows' },
    { id: 'white-product', labelKey: 'agents.imageStyleWhiteProduct', templateRef: 'product-visuals/white-background-product.md', promptHint: 'clean white-background ecommerce product image with realistic contact shadows' },
    { id: 'lifestyle-scene', labelKey: 'agents.imageStyleLifestyleScene', templateRef: 'product-visuals/lifestyle-product-scene.md', promptHint: 'real lifestyle scene that preserves the reference subject and makes the setting believable' },
    { id: 'packaging', labelKey: 'agents.imageStylePackaging', templateRef: 'product-visuals/packaging-showcase.md', promptHint: 'packaging showcase with box, insert card, staged product, and export-ready composition' },
    { id: 'recipe-flow', labelKey: 'agents.imageStyleRecipeFlow', templateRef: 'storyboards-and-sequences/recipe-process-flowchart.md', promptHint: 'step-by-step recipe or assembly flow with numbered panels and ingredient/process details' },
    { id: 'step-infographic', labelKey: 'agents.imageStyleStepInfographic', templateRef: 'infographics/step-by-step-infographic.md', promptHint: 'warm instructional infographic with clear numbered stages and small callouts' },
    { id: 'hand-drawn-info', labelKey: 'agents.imageStyleHandDrawnInfo', templateRef: 'infographics/hand-drawn-infographic.md', promptHint: 'hand-drawn annotated info sheet, soft paper texture, sketches, labels, and ingredient notes' },
    { id: 'bento-grid', labelKey: 'agents.imageStyleBentoGrid', templateRef: 'infographics/bento-grid-infographic.md', promptHint: 'modular bento grid overview with photos, color swatches, detail panels, and concise labels' },
    { id: 'tvc-storyboard', labelKey: 'agents.imageStyleTvcStoryboard', templateRef: 'storyboards-and-sequences/product-tvc-storyboard.md', promptHint: 'commercial TVC storyboard contact sheet with sequential shots and cinematic product closeups' },
    { id: 'cinematic-storyboard', labelKey: 'agents.imageStyleCinematicStoryboard', templateRef: 'storyboards-and-sequences/cinematic-storyboard-grid.md', promptHint: 'cinematic storyboard grid with consistent subject continuity and film still mood' },
    { id: 'mixed-styles', labelKey: 'agents.imageStyleMixedStyles', templateRef: 'grids-and-collages/mixed-style-multi-panel.md', promptHint: 'multi-panel board exploring the same subject in several distinct visual styles' },
    { id: 'brand-poster', labelKey: 'agents.imageStyleBrandPoster', templateRef: 'poster-and-campaigns/brand-poster.md', promptHint: 'brand poster with strong hero composition, title area, and product-led campaign mood' },
    { id: 'campaign-kv', labelKey: 'agents.imageStyleCampaignKv', templateRef: 'poster-and-campaigns/campaign-kv.md', promptHint: 'campaign key visual system with hero layout and supporting format variations' },
    { id: 'web-hero', labelKey: 'agents.imageStyleWebHero', templateRef: 'poster-and-campaigns/banner-hero.md', promptHint: 'wide web hero image with product focus, headline-safe negative space, and CTA-safe area' },
    { id: 'editorial-cover', labelKey: 'agents.imageStyleEditorialCover', templateRef: 'poster-and-campaigns/editorial-cover.md', promptHint: 'editorial magazine cover with masthead-safe layout and refined food/product styling' },
    { id: 'vintage-editorial', labelKey: 'agents.imageStyleVintageEditorial', templateRef: 'poster-and-campaigns/vintage-editorial-infographic.md', promptHint: 'vintage editorial infographic poster with archival typography and dense annotations' },
    { id: 'food-map', labelKey: 'agents.imageStyleFoodMap', templateRef: 'maps/food-map.md', promptHint: 'illustrated food map that turns components, origin, or context into a whimsical labeled map' },
    { id: 'lookbook-grid', labelKey: 'agents.imageStyleLookbookGrid', templateRef: 'grids-and-collages/lookbook-grid.md', promptHint: 'lookbook grid of multiple usage moments, closeups, and scene variations' },
    { id: 'banner-grid', labelKey: 'agents.imageStyleBannerGrid', templateRef: 'grids-and-collages/banner-grid-2x2.md', promptHint: 'cohesive 2x2 marketing banner set with consistent product identity and copy-safe space' },
    { id: 'retro-icons', labelKey: 'agents.imageStyleRetroIcons', templateRef: 'assets-and-props/retro-skeuomorphic-icons.md', promptHint: 'retro skeuomorphic icon set with the subject and related props as exportable square icons' },
];

const STYLE_BY_ID = new Map(IMAGE_AGENT_STYLE_PRESETS.map((style) => [style.id, style]));

export function getImageAgentStylesForAgent(agent: Pick<AgentLauncher, 'imageStyleIds'>): ImageAgentStylePreset[] {
    const ids = agent.imageStyleIds ?? [];
    const selected = ids
        .map((id) => STYLE_BY_ID.get(id))
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
        `${index + 1}. ${style.id} (${style.templateRef}) - ${style.promptHint}`
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
