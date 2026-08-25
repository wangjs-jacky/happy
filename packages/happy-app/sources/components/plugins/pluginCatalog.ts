import type { Ionicons } from '@expo/vector-icons';

export type PluginId = 'relationship-advisor';

export type PluginCatalogEntry = {
    id: PluginId;
    titleKey: 'relationshipAdvisor.title';
    descriptionKey: 'relationshipAdvisor.cloudSubtitle';
    icon: keyof typeof Ionicons.glyphMap;
    featured: boolean;
};

/** First-party plugin metadata lives here so the market can grow without coupling entries to its UI. */
export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [
    {
        id: 'relationship-advisor',
        titleKey: 'relationshipAdvisor.title',
        descriptionKey: 'relationshipAdvisor.cloudSubtitle',
        icon: 'chatbubbles-outline',
        featured: true,
    },
];
