/** Session-owned Cloudflare Quick Tunnels serving only validated, immutable preview assets. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type InteractivePreviewEvent, validateInteractivePreviewManifest } from '@slopus/happy-wire';
import type { ResolvedPreviewWorkspace } from './previewWorkspace';

const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Snapshot before serving: subsequent file edits, symlinks and workspace removal cannot expose host files. */
export async function createPreviewAssetServer(workspace: ResolvedPreviewWorkspace): Promise<Server> {
    const manifest = validateInteractivePreviewManifest(workspace.manifest);
    const files = new Map(workspace.files.map((file) => [file.assetId, file.absolutePath]));
    const assets = new Map<string, { bytes: Buffer; mimeType: string }>();
    for (const asset of manifest.assets) {
        const path = files.get(asset.id);
        if (!path) throw new Error('Preview asset is missing');
        const bytes = await readFile(path);
        if (bytes.length !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
            throw new Error('Preview asset changed after validation');
        }
        assets.set(`/${asset.path}`, { bytes, mimeType: asset.mimeType });
    }
    const server = createServer((request, response) => {
        response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { Allow: 'GET, HEAD' }).end();
            return;
        }
        let path: string;
        try { path = decodeURIComponent((request.url || '/').split('?')[0]); }
        catch { response.writeHead(400).end(); return; }
        const asset = assets.get(path.endsWith('/') ? `${path}index.html` : path);
        if (!asset) { response.writeHead(404).end(); return; }
        response.writeHead(200, { 'Content-Type': asset.mimeType, 'Content-Length': asset.bytes.length, 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : asset.bytes);
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    return server;
}

export type CloudflarePreview = { preview: InteractivePreviewEvent; stop: () => void };

/** No account credentials, arbitrary ports, shell execution or directory listings are accepted. */
export async function startCloudflarePreview(
    workspace: ResolvedPreviewWorkspace,
    onExpired: (preview: InteractivePreviewEvent) => void,
    signal?: AbortSignal,
): Promise<CloudflarePreview> {
    signal?.throwIfAborted();
    const server = await createPreviewAssetServer(workspace);
    let child: ChildProcess | undefined;
    let configDirectory: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ready: InteractivePreviewEvent | undefined;
    let stopped = false;
    const stop = (): void => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        process.removeListener('exit', stop);
        child?.kill('SIGKILL');
        server.closeAllConnections();
        server.close();
        if (configDirectory) void rm(configDirectory, { recursive: true, force: true }).catch(() => {});
        if (ready) onExpired({ ...ready, state: 'expired', url: undefined, expiresAt: Date.now() });
    };
    signal?.addEventListener('abort', stop, { once: true });
    process.once('exit', stop);
    try {
        // An explicit empty configuration prevents inheriting a user's named tunnel or ingress rules.
        configDirectory = await mkdtemp(join(tmpdir(), 'happy-cloudflare-preview-'));
        const configPath = join(configDirectory, 'config.yml');
        await writeFile(configPath, '{}\n', { mode: 0o600 });
        signal?.throwIfAborted();
        const address = server.address();
        if (!address || typeof address === 'string' || stopped) throw new Error('Preview was stopped');
        child = spawn('cloudflared', ['tunnel', '--config', configPath, '--url', `http://127.0.0.1:${address.port}`, '--no-autoupdate'], {
            stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
            env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TUNNEL_'))),
        });
        const tunnel = child;
        const url = await new Promise<string>((resolve, reject) => {
            let output = '';
            let candidate: string | undefined;
            const timeout = setTimeout(() => fail(new Error('Cloudflare preview startup timed out. Check network access and retry.')), 45_000);
            const cleanup = (): void => {
                clearTimeout(timeout);
                signal?.removeEventListener('abort', aborted);
                tunnel.stdout?.removeListener('data', receive);
                tunnel.stderr?.removeListener('data', receive);
                tunnel.stdout?.resume();
                tunnel.stderr?.resume();
            };
            const fail = (error: Error): void => { cleanup(); reject(error); };
            const aborted = (): void => fail(new Error('Cloudflare preview was stopped'));
            const receive = (chunk: Buffer): void => {
                output = (output + chunk.toString()).slice(-16_384);
                candidate ||= output.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/)?.[0];
                if (candidate && output.includes('Registered tunnel connection')) { cleanup(); resolve(candidate); }
            };
            tunnel.stdout?.on('data', receive);
            tunnel.stderr?.on('data', receive);
            tunnel.once('error', () => fail(new Error('Unable to start cloudflared. Install cloudflared on the session machine and retry.')));
            tunnel.once('exit', () => { fail(new Error('Cloudflare preview tunnel exited')); stop(); });
            signal?.addEventListener('abort', aborted, { once: true });
            if (signal?.aborted) aborted();
        });
        if (stopped || signal?.aborted) throw new Error('Cloudflare preview was stopped');
        const publishedAt = Date.now();
        ready = { version: 1, id: workspace.manifest.previewId, title: workspace.manifest.title,
            provider: 'cloudflare', mode: 'tunnel', state: 'ready', url, publishedAt, expiresAt: publishedAt + MAX_LIFETIME_MS };
        timer = setTimeout(stop, MAX_LIFETIME_MS);
        timer.unref();
        return { preview: ready, stop };
    } catch (error) {
        stop();
        // Abort may race with creation of the private config directory.
        if (configDirectory) await rm(configDirectory, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}
