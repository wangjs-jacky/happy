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
    sourceRepository: 'ConardLi/gpt-image-2-101';
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
