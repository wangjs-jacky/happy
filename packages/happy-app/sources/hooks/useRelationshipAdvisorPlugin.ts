import * as React from 'react';

import {
    getRelationshipAdvisorPluginStatus,
    type RelationshipAdvisorPluginStatus,
} from '@/sync/relationshipAdvisorPlugin';

/** Loads the server-owned plugin state only while its UI surface is active. */
export function useRelationshipAdvisorPlugin(enabled = true) {
    const [status, setStatus] = React.useState<RelationshipAdvisorPluginStatus | null>(null);
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
            const next = await getRelationshipAdvisorPluginStatus();
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
