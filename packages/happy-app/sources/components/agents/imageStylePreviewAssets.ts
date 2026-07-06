import type { ImageSourcePropType } from 'react-native';

const IMAGE_STYLE_PREVIEW_ASSETS: Record<string, ImageSourcePropType> = {
    'vintage-film': require('@/assets/images/gpt-image-2/tiramisu/vintage-film.jpg'),
    'premium-studio': require('@/assets/images/gpt-image-2/tiramisu/premium-studio.jpg'),
    'white-product': require('@/assets/images/gpt-image-2/tiramisu/white-product.jpg'),
    'lifestyle-scene': require('@/assets/images/gpt-image-2/tiramisu/lifestyle-scene.jpg'),
    packaging: require('@/assets/images/gpt-image-2/tiramisu/packaging.jpg'),
    'recipe-flow': require('@/assets/images/gpt-image-2/tiramisu/recipe-flow.jpg'),
    'step-infographic': require('@/assets/images/gpt-image-2/tiramisu/step-infographic.jpg'),
    'hand-drawn-info': require('@/assets/images/gpt-image-2/tiramisu/hand-drawn-info.jpg'),
    'bento-grid': require('@/assets/images/gpt-image-2/tiramisu/bento-grid.jpg'),
    'tvc-storyboard': require('@/assets/images/gpt-image-2/tiramisu/tvc-storyboard.jpg'),
    'cinematic-storyboard': require('@/assets/images/gpt-image-2/tiramisu/cinematic-storyboard.jpg'),
    'mixed-styles': require('@/assets/images/gpt-image-2/tiramisu/mixed-styles.jpg'),
    'brand-poster': require('@/assets/images/gpt-image-2/tiramisu/brand-poster.jpg'),
    'campaign-kv': require('@/assets/images/gpt-image-2/tiramisu/campaign-kv.jpg'),
    'web-hero': require('@/assets/images/gpt-image-2/tiramisu/web-hero.jpg'),
    'editorial-cover': require('@/assets/images/gpt-image-2/tiramisu/editorial-cover.jpg'),
    'vintage-editorial': require('@/assets/images/gpt-image-2/tiramisu/vintage-editorial.jpg'),
    'food-map': require('@/assets/images/gpt-image-2/tiramisu/food-map.jpg'),
    'lookbook-grid': require('@/assets/images/gpt-image-2/tiramisu/lookbook-grid.jpg'),
    'banner-grid': require('@/assets/images/gpt-image-2/tiramisu/banner-grid.jpg'),
    'retro-icons': require('@/assets/images/gpt-image-2/tiramisu/retro-icons.jpg'),
};

export function getImageStylePreviewAsset(styleId: string): ImageSourcePropType | undefined {
    return IMAGE_STYLE_PREVIEW_ASSETS[styleId];
}
