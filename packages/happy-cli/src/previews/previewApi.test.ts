import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { publishPreviewWorkspace } from './previewApi';

describe('publishPreviewWorkspace', () => {
    it('creates a draft, uploads directly to OSS, completes assets, and publishes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'preview-api-')); const file = join(root, 'index.html'); await writeFile(file, '<h1>x</h1>');
        const previewId = '11111111-1111-4111-8111-111111111111'; const assetId = 'asset_index';
        const calls: string[] = [];
        const fetchImpl = vi.fn(async (url: string, init?: any) => {
            calls.push(`${init?.method || 'GET'} ${url}`);
            if (url.endsWith('/connect/cloudflare/status')) return new Response(JSON.stringify({ available: true, connected: true }));
            if (url.endsWith('/draft')) return new Response(JSON.stringify({ previewId, uploads: [{ assetId, method: 'POST', uploadUrl: 'https://oss.test/upload?Signature=secret', formFields: { key: 'opaque' } }] }), { status: 200 });
            if (url.startsWith('https://oss.test/')) return new Response(null, { status: 204 });
            if (url.endsWith('/uploaded')) return new Response(JSON.stringify({ success: true }), { status: 200 });
            return new Response(JSON.stringify({ preview: { version: 1, provider: 'cloudflare', mode: 'hosted', id: previewId, title: 'Draft', state: 'ready', url: 'https://draft.pages.dev', publishedAt: 1, expiresAt: 2 } }), { status: 200 });
        });
        const result = await publishPreviewWorkspace({ serverUrl: 'https://happy.test', token: 'happy-token', sessionId: 'session-1',
            workspace: { manifest: { version: 1, previewId, title: 'Draft', assets: [{ id: assetId, path: 'index.html', size: 10, sha256: 'a'.repeat(64), mimeType: 'text/html' }] }, files: [{ assetId, absolutePath: file }] }, fetchImpl: fetchImpl as any });
        expect(result.url).toBe('https://draft.pages.dev');
        expect(calls).toEqual([
            'GET https://happy.test/v1/connect/cloudflare/status',
            `POST https://happy.test/v1/sessions/session-1/previews/${previewId}/draft`, 'POST https://oss.test/upload?Signature=secret',
            `POST https://happy.test/v1/sessions/session-1/previews/${previewId}/assets/${assetId}/uploaded`,
            `POST https://happy.test/v1/sessions/session-1/previews/${previewId}/publish`,
        ]);
        expect(JSON.stringify(result)).not.toContain('Signature=secret');
    });
    it('asks for account configuration before uploading anything and never falls back to a tunnel', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ available: true, connected: false })));
        await expect(publishPreviewWorkspace({ serverUrl: 'https://happy.test', token: 'happy-token', sessionId: 'session',
            workspace: {} as any, fetchImpl })).rejects.toThrow('Connect Cloudflare in Settings');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
