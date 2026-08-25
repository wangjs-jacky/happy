import * as React from 'react';

import {
    getGeneratedImagesPluginStatus,
    type GeneratedImagesPluginStatus,
} from '@/sync/generatedImagesPlugin';

/** Loads the server-owned gallery installation state only while its UI surface is active. */
export function useGeneratedImagesPlugin(enabled = true) {
    const [status, setStatus] = React.useState<GeneratedImagesPluginStatus | null>(null);
    const [loading, setLoading] = React.useState(enabled);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const refresh = React.useCallback(async () => {
        if (!enabled) return null;
        setLoading(true);
        try {
            const next = await getGeneratedImagesPluginStatus();
            if (mountedRef.current) setStatus(next);
            return next;
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [enabled]);

    React.useEffect(() => {
        if (!enabled) return;
        void refresh().catch(() => undefined);
    }, [enabled, refresh]);

    return { loading, status, refresh };
}
