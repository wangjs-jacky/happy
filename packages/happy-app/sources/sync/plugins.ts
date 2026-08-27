import {
    PluginCatalogItemSchema,
    PluginCatalogResponseSchema,
    PluginInstallationStatusSchema,
} from '@slopus/happy-wire';
import type {
    PluginCatalogItem,
    PluginCatalogResponse,
    PluginInstallationStatus,
} from '@slopus/happy-wire';

import { apiSocket } from './apiSocket';

const pluginCatalogChangeListeners = new Set<() => void>();

export function subscribePluginCatalogChanges(listener: () => void): () => void {
    pluginCatalogChangeListeners.add(listener);
    return () => pluginCatalogChangeListeners.delete(listener);
}

function notifyPluginCatalogChanged() {
    for (const listener of pluginCatalogChangeListeners) listener();
}

async function readResponse<T>(response: Response, parse: (value: unknown) => T): Promise<T> {
    if (!response.ok) throw new Error(`Plugin request failed: ${response.status}`);
    return parse(await response.json());
}

export async function getPluginCatalog(): Promise<PluginCatalogResponse> {
    return readResponse(
        await apiSocket.request('/v1/plugins'),
        (value) => PluginCatalogResponseSchema.parse(value),
    );
}

export async function getPlugin(pluginId: string): Promise<PluginCatalogItem> {
    return readResponse(
        await apiSocket.request(`/v1/plugins/${encodeURIComponent(pluginId)}`),
        (value) => PluginCatalogItemSchema.parse(value),
    );
}

export async function installPlugin(
    pluginId: string,
    version: string,
    configuration: Record<string, string>,
): Promise<PluginInstallationStatus> {
    const status = await readResponse(
        await apiSocket.request(`/v1/plugins/${encodeURIComponent(pluginId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version, configuration }),
        }),
        (value) => PluginInstallationStatusSchema.parse(value),
    );
    notifyPluginCatalogChanged();
    return status;
}

export async function uninstallPlugin(pluginId: string): Promise<PluginInstallationStatus> {
    const status = await readResponse(
        await apiSocket.request(`/v1/plugins/${encodeURIComponent(pluginId)}`, { method: 'DELETE' }),
        (value) => PluginInstallationStatusSchema.parse(value),
    );
    notifyPluginCatalogChanged();
    return status;
}
