import * as React from 'react';
import { loadAdvisorImageSource } from '@/sync/relationshipAdvisorImageCache';
import { subscribeAdvisorImageChanges, type AdvisorImageSource } from '@/sync/relationshipAdvisorImageEvents';
import { imageViewer, useImageViewerStore } from '@/sync/imageViewer';

function releaseSources(sources: Array<AdvisorImageSource | null>) {
    const uris = new Set(sources.map((source) => source?.uri));
    if (useImageViewerStore.getState().sources.some((source) => uris.has(source.uri))) {
        imageViewer.close();
        imageViewer.clear();
    }
    sources.forEach((source) => source?.release());
}

/** Resolve local originals, including optimistic messages rendered before their save completes. */
export function useRelationshipAdvisorMessageImages(imageKeys: string[] = []): {
    sources: Array<AdvisorImageSource | null>; loading: boolean;
} {
    const signature = JSON.stringify(imageKeys);
    const [state, setState] = React.useState<{
        signature: string; sources: Array<AdvisorImageSource | null>; loading: boolean;
    }>({ signature, sources: [], loading: true });

    React.useEffect(() => {
        const keys: string[] = JSON.parse(signature);
        let disposed = false;
        let generation = 0;
        let owned: Array<AdvisorImageSource | null> = [];
        const load = async (changedKey?: string) => {
            const current = ++generation;
            const created: AdvisorImageSource[] = [];
            const sources = await Promise.all(keys.map(async (key, index) => {
                if (owned[index] && key !== changedKey) return owned[index];
                const source = await loadAdvisorImageSource(key).catch(() => null);
                if (source) created.push(source);
                return source;
            }));
            if (disposed || generation !== current) {
                // These reads never owned the viewer, even if native file URIs match.
                created.forEach((source) => source.release());
                return;
            }
            releaseSources(owned.filter((source) => !sources.includes(source)));
            owned = sources;
            setState({ signature, sources, loading: false });
        };
        const unsubscribe = subscribeAdvisorImageChanges((key) => {
            if (keys.includes(key)) void load(key);
        });
        void load();
        return () => {
            disposed = true;
            unsubscribe();
            releaseSources(owned);
        };
    }, [signature]);

    return state.signature === signature ? state : { sources: [], loading: true };
}
