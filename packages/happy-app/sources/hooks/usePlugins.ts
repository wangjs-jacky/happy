import type { PluginCatalogItem } from '@slopus/happy-wire';
import * as React from 'react';

import { getPluginCatalog, subscribePluginCatalogChanges } from '@/sync/plugins';

/** Loads the account-specific server catalog only while a plugin surface is active. */
export function usePlugins(enabled = true) {
    const [plugins, setPlugins] = React.useState<PluginCatalogItem[]>([]);
    const [loading, setLoading] = React.useState(enabled);
    const mountedRef = React.useRef(true);
    const requestGenerationRef = React.useRef(0);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const refresh = React.useCallback(async () => {
        if (!enabled) return null;
        const requestGeneration = ++requestGenerationRef.current;
        setLoading(true);
        try {
            const catalog = await getPluginCatalog();
            if (mountedRef.current && requestGeneration === requestGenerationRef.current) {
                setPlugins(catalog.plugins);
            }
            return catalog;
        } finally {
            if (mountedRef.current && requestGeneration === requestGenerationRef.current) {
                setLoading(false);
            }
        }
    }, [enabled]);

    React.useEffect(() => {
        if (!enabled) {
            requestGenerationRef.current++;
            setLoading(false);
            return;
        }
        void refresh().catch(() => undefined);
    }, [enabled, refresh]);

    React.useEffect(() => {
        if (!enabled) return;
        return subscribePluginCatalogChanges(() => {
            void refresh().catch(() => undefined);
        });
    }, [enabled, refresh]);

    const getPlugin = React.useCallback(
        (pluginId: string) => plugins.find((plugin) => plugin.manifest.id === pluginId) ?? null,
        [plugins],
    );

    return { getPlugin, loading, plugins, refresh };
}
