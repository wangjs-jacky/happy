export interface ImageAgentStyleCategory {
    id: string;
    label: string;
    accent: string;
    count: number;
}

export interface ImageAgentStylePreset {
    id: string;
    title: string;
    labelKey?: ImageAgentStyleLabelKey;
    categoryId: string;
    categoryLabel: string;
    categoryAccent: string;
    templateRef: string;
    templateLabel: string;
    promptHint: string;
    promptContent: string;
    promptPath: string;
    sourceCaseId: string;
    sourceRepository: 'ConardLi/gpt-image-2-101' | 'curated-reference-examples' | 'user-reference';
    referenceImages?: ImageAgentStyleReferenceImage[];
    analysisStatus?: UserImageStyleAnalysisStatus;
    analysisError?: string;
    customPromptContent?: string;
    customNegativePrompt?: string;
    customCreatedAt?: number;
    customUpdatedAt?: number;
    customAnalyzedAt?: number;
    custom?: boolean;
}

export interface ImageAgentStyleReferenceImage {
    id: string;
    uri: string;
    width: number;
    height: number;
    mimeType: string;
    size: number;
    name: string;
    thumbhash?: string;
}

export interface UserImageStyle {
    id: string;
    title: string;
    promptHint: string;
    promptContent?: string;
    negativePrompt?: string;
    tags: string[];
    analysisStatus: UserImageStyleAnalysisStatus;
    analysisError?: string;
    analyzedAt?: number;
    promptSource: UserImageStylePromptSource;
    referenceImages: ImageAgentStyleReferenceImage[];
    createdAt: number;
    updatedAt: number;
}

export type UserImageStyleAnalysisStatus = 'reference-ready' | 'analyzing' | 'prompt-ready' | 'failed';

export type UserImageStylePromptSource = 'reference-image' | 'extracted-prompt' | 'manual';

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
