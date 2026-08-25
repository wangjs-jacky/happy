import { z } from 'zod';

import { pluginSecretVault } from '@/modules/plugin-secrets/pluginSecretVault';

interface PluginSecretVault {
    set: (accountId: string, pluginId: string, value: string) => Promise<void>;
    get: (accountId: string, pluginId: string) => Promise<string | null>;
    delete: (accountId: string, pluginId: string) => Promise<void>;
}

const RELATIONSHIP_ADVISOR_PLUGIN_ID = 'relationship-advisor';

const relationshipAdvisorConfigurationSchema = z.object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url(),
    model: z.string().min(1),
});

export interface RelationshipAdvisorConfiguration {
    apiKey: string;
    baseUrl: string;
    model: string;
}

export interface RelationshipAdvisorPluginStreamInput {
    userId: string;
    messages: Array<{ role: 'user' | 'assistant'; text: string }>;
    imageUrls: string[];
    signal?: AbortSignal;
}

function normalizeConfiguration(configuration: RelationshipAdvisorConfiguration): RelationshipAdvisorConfiguration {
    return relationshipAdvisorConfigurationSchema.parse({
        apiKey: configuration.apiKey.trim(),
        baseUrl: configuration.baseUrl.trim().replace(/\/+$/, ''),
        model: configuration.model.trim(),
    });
}

function parseStoredConfiguration(stored: string): RelationshipAdvisorConfiguration {
    return relationshipAdvisorConfigurationSchema.parse(JSON.parse(stored));
}

export function createRelationshipAdvisorPlugin(vault: PluginSecretVault) {
    return {
        async install(accountId: string, configuration: RelationshipAdvisorConfiguration): Promise<void> {
            const normalized = normalizeConfiguration(configuration);
            await vault.set(accountId, RELATIONSHIP_ADVISOR_PLUGIN_ID, JSON.stringify(normalized));
        },
        async getStatus(accountId: string) {
            const stored = await vault.get(accountId, RELATIONSHIP_ADVISOR_PLUGIN_ID);
            if (!stored) return { installed: false as const };
            const configuration = parseStoredConfiguration(stored);
            return {
                installed: true as const,
                baseUrl: configuration.baseUrl,
                model: configuration.model,
                keyHint: configuration.apiKey.length > 4
                    ? configuration.apiKey.slice(-4)
                    : '••••',
            };
        },
        async requireConfiguration(accountId: string): Promise<RelationshipAdvisorConfiguration> {
            const stored = await vault.get(accountId, RELATIONSHIP_ADVISOR_PLUGIN_ID);
            if (!stored) throw new Error('Relationship advisor plugin is not installed');
            return parseStoredConfiguration(stored);
        },
        async uninstall(accountId: string): Promise<void> {
            await vault.delete(accountId, RELATIONSHIP_ADVISOR_PLUGIN_ID);
        },
    };
}

export function createRelationshipAdvisorPluginRuntime(
    plugin: { requireConfiguration: (accountId: string) => Promise<RelationshipAdvisorConfiguration> },
    providerStream: (
        input: RelationshipAdvisorPluginStreamInput,
        configuration: RelationshipAdvisorConfiguration,
    ) => AsyncIterable<{ text: string }>,
) {
    return {
        async *stream(input: RelationshipAdvisorPluginStreamInput): AsyncGenerator<{ text: string }> {
            const configuration = await plugin.requireConfiguration(input.userId);
            yield* providerStream(input, configuration);
        },
    };
}

export const relationshipAdvisorPlugin = createRelationshipAdvisorPlugin(pluginSecretVault);
