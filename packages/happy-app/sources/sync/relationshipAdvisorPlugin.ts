import { z } from 'zod';

import { apiSocket } from './apiSocket';

const relationshipAdvisorPluginStatusSchema = z.discriminatedUnion('installed', [
    z.object({ installed: z.literal(false) }),
    z.object({
        installed: z.literal(true),
        baseUrl: z.string(),
        model: z.string(),
        keyHint: z.string(),
    }),
]);

export type RelationshipAdvisorPluginStatus = z.infer<typeof relationshipAdvisorPluginStatusSchema>;

export interface RelationshipAdvisorPluginConfiguration {
    apiKey: string;
    baseUrl: string;
    model: string;
}

async function readStatus(response: Response): Promise<RelationshipAdvisorPluginStatus> {
    if (!response.ok) throw new Error(`Relationship advisor plugin request failed: ${response.status}`);
    return relationshipAdvisorPluginStatusSchema.parse(await response.json());
}

export async function getRelationshipAdvisorPluginStatus(): Promise<RelationshipAdvisorPluginStatus> {
    return readStatus(await apiSocket.request('/v1/plugins/relationship-advisor'));
}

export async function installRelationshipAdvisorPlugin(
    configuration: RelationshipAdvisorPluginConfiguration,
): Promise<RelationshipAdvisorPluginStatus> {
    return readStatus(await apiSocket.request('/v1/plugins/relationship-advisor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configuration),
    }));
}

export async function uninstallRelationshipAdvisorPlugin(): Promise<RelationshipAdvisorPluginStatus> {
    return readStatus(await apiSocket.request('/v1/plugins/relationship-advisor', {
        method: 'DELETE',
    }));
}
