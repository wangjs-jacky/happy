import { z } from 'zod';

import { pluginSecretVault } from '@/modules/plugin-secrets/pluginSecretVault';

interface PluginSecretVault {
    set: (accountId: string, pluginId: string, value: string) => Promise<void>;
    get: (accountId: string, pluginId: string) => Promise<string | null>;
    delete: (accountId: string, pluginId: string) => Promise<void>;
}

const GENERATED_IMAGES_PLUGIN_ID = 'generated-images-gallery';
const installationMarkerSchema = z.object({ version: z.literal(1) });
const installationMarker = installationMarkerSchema.parse({ version: 1 });

export function createGeneratedImagesPlugin(vault: PluginSecretVault) {
    return {
        async install(accountId: string): Promise<void> {
            await vault.set(accountId, GENERATED_IMAGES_PLUGIN_ID, JSON.stringify(installationMarker));
        },
        async getStatus(accountId: string) {
            const stored = await vault.get(accountId, GENERATED_IMAGES_PLUGIN_ID);
            if (!stored) return { installed: false as const };
            installationMarkerSchema.parse(JSON.parse(stored));
            return { installed: true as const };
        },
        async uninstall(accountId: string): Promise<void> {
            await vault.delete(accountId, GENERATED_IMAGES_PLUGIN_ID);
        },
    };
}

export const generatedImagesPlugin = createGeneratedImagesPlugin(pluginSecretVault);
