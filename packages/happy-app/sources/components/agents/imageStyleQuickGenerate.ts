import type { ImageAgentStylePreset } from './imageStyleTypes';

export type ImageStyleSelectionAction = {
    selectedStyleIds: string[];
    closeGallery: boolean;
    shouldSubmit: boolean;
};

export type ImageStyleQuickGenerateCardState = 'ready' | 'needs-photo' | 'machine-offline' | 'generating';

export function getImageStyleQuickGenerateCardState(args: {
    hasInput: boolean;
    canSpawn: boolean;
    sending: boolean;
}): ImageStyleQuickGenerateCardState {
    if (args.sending) return 'generating';
    if (!args.hasInput) return 'needs-photo';
    if (!args.canSpawn) return 'machine-offline';
    return 'ready';
}

export function getImageStyleSelectionAction(args: {
    style: ImageAgentStylePreset;
    hasText: boolean;
    userImageCount: number;
    canSpawn: boolean;
    sending: boolean;
}): ImageStyleSelectionAction {
    const hasRequiredInput = args.style.inputMode === 'image-required'
        ? args.userImageCount > 0
        : args.hasText || args.userImageCount > 0;

    return {
        selectedStyleIds: [args.style.id],
        closeGallery: true,
        shouldSubmit: !!args.style.quickGenerate && args.canSpawn && !args.sending && hasRequiredInput,
    };
}
