import { readFile } from 'node:fs/promises';
import { interactivePreviewEventSchema, type InteractivePreviewEvent } from '@slopus/happy-wire';
import { z } from 'zod';
import type { ResolvedPreviewWorkspace } from './previewWorkspace';

type FetchLike = (url: string, init?: any) => Promise<Response>;
const draftResponseSchema = z.object({ previewId: z.uuid(), uploads: z.array(z.object({
    assetId: z.string(), method: z.literal('POST'), uploadUrl: z.url(), formFields: z.record(z.string(), z.string()),
})) });

async function expectOk(response: Response, phase: string): Promise<Response> {
    if (!response.ok) throw new Error(`Interactive preview ${phase} failed (HTTP ${response.status})`);
    return response;
}

export async function publishPreviewWorkspace(input: {
    serverUrl: string; token: string; sessionId: string; workspace: ResolvedPreviewWorkspace; fetchImpl?: FetchLike;
}): Promise<InteractivePreviewEvent> {
    const fetchImpl = input.fetchImpl || (fetch as unknown as FetchLike);
    const server = input.serverUrl.replace(/\/$/, '');
    const authHeaders = { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' };
    const previewBaseUrl = `${server}/v1/sessions/${encodeURIComponent(input.sessionId)}/previews/${encodeURIComponent(input.workspace.manifest.previewId)}`;
    const draftResponse = await expectOk(await fetchImpl(
        `${previewBaseUrl}/draft`,
        { method: 'POST', headers: authHeaders, body: JSON.stringify(input.workspace.manifest), redirect: 'error' },
    ), 'draft creation');
    const draft = draftResponseSchema.parse(await draftResponse.json());
    if (draft.previewId !== input.workspace.manifest.previewId) throw new Error('Preview draft descriptor did not match workspace');
    const files = new Map(input.workspace.files.map((file) => [file.assetId, file.absolutePath]));
    for (const upload of draft.uploads) {
        const absolutePath = files.get(upload.assetId); if (!absolutePath) throw new Error('Preview upload descriptor did not match workspace');
        const form = new FormData(); for (const [name, value] of Object.entries(upload.formFields)) form.append(name, value);
        form.append('file', new Blob([await readFile(absolutePath)]));
        await expectOk(await fetchImpl(upload.uploadUrl, { method: 'POST', body: form, redirect: 'error' }), 'asset upload');
        await expectOk(await fetchImpl(
            `${previewBaseUrl}/assets/${encodeURIComponent(upload.assetId)}/uploaded`,
            { method: 'POST', headers: { Authorization: `Bearer ${input.token}` }, redirect: 'error' },
        ), 'asset completion');
    }
    const published = await expectOk(await fetchImpl(
        `${previewBaseUrl}/publish`,
        { method: 'POST', headers: { Authorization: `Bearer ${input.token}` }, redirect: 'error' },
    ), 'publication');
    return interactivePreviewEventSchema.parse((await published.json() as { preview: unknown }).preview);
}
