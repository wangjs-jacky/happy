import type { PluginCatalogItem } from '@slopus/happy-wire';

export type PluginCatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PluginCatalogSnapshot {
    status: PluginCatalogStatus;
    plugins: readonly PluginCatalogItem[];
    revision: number;
}

const EMPTY_PLUGIN_CATALOG: readonly PluginCatalogItem[] = [];

export class PluginCatalogStore {
    private snapshot: PluginCatalogSnapshot = {
        status: 'idle',
        plugins: EMPTY_PLUGIN_CATALOG,
        revision: 0,
    };
    private readonly listeners = new Set<() => void>();

    getSnapshot = (): PluginCatalogSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    beginAccount(): void {
        this.publish('loading', EMPTY_PLUGIN_CATALOG);
    }

    beginRefresh(): void {
        this.publish('loading', this.snapshot.plugins);
    }

    resolve(plugins: readonly PluginCatalogItem[]): void {
        this.publish('ready', [...plugins]);
    }

    reject(): void {
        this.publish('error', this.snapshot.plugins);
    }

    private publish(status: PluginCatalogStatus, plugins: readonly PluginCatalogItem[]): void {
        this.snapshot = {
            status,
            plugins,
            revision: this.snapshot.revision + 1,
        };
        for (const listener of this.listeners) listener();
    }
}
