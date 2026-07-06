import type { ImageSourcePropType } from 'react-native';

const IMAGE_STYLE_PREVIEW_ASSETS: Record<string, ImageSourcePropType> = {
    'vintage-film': require('@/assets/images/gpt-image-2/skill-examples/vintage-film.jpg'),
    'premium-studio': require('@/assets/images/gpt-image-2/skill-examples/premium-studio.jpg'),
    'white-product': require('@/assets/images/gpt-image-2/skill-examples/white-product.jpg'),
    'lifestyle-scene': require('@/assets/images/gpt-image-2/skill-examples/lifestyle-scene.jpg'),
    packaging: require('@/assets/images/gpt-image-2/skill-examples/packaging.jpg'),
    'recipe-flow': require('@/assets/images/gpt-image-2/skill-examples/recipe-flow.jpg'),
    'step-infographic': require('@/assets/images/gpt-image-2/skill-examples/step-infographic.jpg'),
    'hand-drawn-info': require('@/assets/images/gpt-image-2/skill-examples/hand-drawn-info.jpg'),
    'bento-grid': require('@/assets/images/gpt-image-2/skill-examples/bento-grid.jpg'),
    'tvc-storyboard': require('@/assets/images/gpt-image-2/skill-examples/tvc-storyboard.jpg'),
    'cinematic-storyboard': require('@/assets/images/gpt-image-2/skill-examples/cinematic-storyboard.jpg'),
    'mixed-styles': require('@/assets/images/gpt-image-2/skill-examples/mixed-styles.jpg'),
    'brand-poster': require('@/assets/images/gpt-image-2/skill-examples/brand-poster.jpg'),
    'campaign-kv': require('@/assets/images/gpt-image-2/skill-examples/campaign-kv.jpg'),
    'web-hero': require('@/assets/images/gpt-image-2/skill-examples/web-hero.jpg'),
    'editorial-cover': require('@/assets/images/gpt-image-2/skill-examples/editorial-cover.jpg'),
    'vintage-editorial': require('@/assets/images/gpt-image-2/skill-examples/vintage-editorial.jpg'),
    'food-map': require('@/assets/images/gpt-image-2/skill-examples/food-map.jpg'),
    'lookbook-grid': require('@/assets/images/gpt-image-2/skill-examples/lookbook-grid.jpg'),
    'banner-grid': require('@/assets/images/gpt-image-2/skill-examples/banner-grid.jpg'),
    'retro-icons': require('@/assets/images/gpt-image-2/skill-examples/retro-icons.jpg'),
};

export function getImageStylePreviewAsset(styleId: string): ImageSourcePropType | undefined {
    return IMAGE_STYLE_PREVIEW_ASSETS[styleId];
}
