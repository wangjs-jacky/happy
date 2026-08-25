import { z } from 'zod';

import { apiSocket } from './apiSocket';

const generatedImagesPluginStatusSchema = z.object({ installed: z.boolean() });

export type GeneratedImagesPluginStatus = z.infer<typeof generatedImagesPluginStatusSchema>;

async function readStatus(response: Response): Promise<GeneratedImagesPluginStatus> {
    if (!response.ok) throw new Error(`Generated images plugin request failed: ${response.status}`);
    return generatedImagesPluginStatusSchema.parse(await response.json());
}

export async function getGeneratedImagesPluginStatus(): Promise<GeneratedImagesPluginStatus> {
    return readStatus(await apiSocket.request('/v1/plugins/generated-images-gallery'));
}

export async function installGeneratedImagesPlugin(): Promise<GeneratedImagesPluginStatus> {
    return readStatus(await apiSocket.request('/v1/plugins/generated-images-gallery', { method: 'PUT' }));
}

export async function uninstallGeneratedImagesPlugin(): Promise<GeneratedImagesPluginStatus> {
    return readStatus(await apiSocket.request('/v1/plugins/generated-images-gallery', { method: 'DELETE' }));
}
