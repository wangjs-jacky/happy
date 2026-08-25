const trustedPluginRoutes = {
    'relationship-advisor': {
        routeId: 'relationship-advisor',
        path: '/relationship-advisor',
    },
    'generated-images-gallery': {
        routeId: 'generated-images-gallery',
        path: '/generated-images',
    },
} as const;

export function resolvePluginRoute(pluginId: string, routeId: string): string | null {
    const adapter = trustedPluginRoutes[pluginId as keyof typeof trustedPluginRoutes];
    return adapter?.routeId === routeId ? adapter.path : null;
}
