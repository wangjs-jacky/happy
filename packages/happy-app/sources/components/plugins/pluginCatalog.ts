import type { Ionicons } from '@expo/vector-icons';

export type PluginId = 'relationship-advisor' | 'generated-images-gallery';

export type PluginCatalogEntry = {
    id: PluginId;
    titleKey: 'relationshipAdvisor.title' | 'generatedImages.title';
    descriptionKey: 'relationshipAdvisor.cloudSubtitle' | 'generatedImages.entrySubtitle';
    icon: keyof typeof Ionicons.glyphMap;
    featured: boolean;
    installedAction: 'configure' | 'open';
};

/** First-party plugin metadata lives here so the market can grow without coupling entries to its UI. */
export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [
    {
        id: 'relationship-advisor',
        titleKey: 'relationshipAdvisor.title',
        descriptionKey: 'relationshipAdvisor.cloudSubtitle',
        icon: 'chatbubbles-outline',
        featured: true,
        installedAction: 'configure',
    },
    {
        id: 'generated-images-gallery',
        titleKey: 'generatedImages.title',
        descriptionKey: 'generatedImages.entrySubtitle',
        icon: 'albums-outline',
        featured: true,
        installedAction: 'open',
    },
];
