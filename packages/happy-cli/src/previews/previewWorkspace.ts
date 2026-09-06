import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { PREVIEW_LIMITS, validateInteractivePreviewManifest, type InteractivePreviewManifest } from '@slopus/happy-wire';

const MIME_BY_EXTENSION: Record<string, string> = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript',
    '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
};

type Workspace = { sessionId: string; previewId: string; title: string; path: string };
export type ResolvedPreviewWorkspace = {
    manifest: InteractivePreviewManifest;
    files: Array<{ assetId: string; absolutePath: string }>;
};

function assetId(path: string): string { return `asset_${createHash('sha256').update(path).digest('hex').slice(0, 24)}`; }
function inside(root: string, candidate: string): boolean { const rel = relative(root, candidate); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }

function assertSignature(extension: string, bytes: Buffer): void {
    if (extension === '.png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG signature');
    if ((extension === '.jpg' || extension === '.jpeg') && !(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error('Invalid JPEG signature');
    if (extension === '.gif' && !['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) throw new Error('Invalid GIF signature');
    if (extension === '.webp' && !(bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')) throw new Error('Invalid WebP signature');
}

export class PreviewWorkspaceRegistry {
    private readonly workspaces = new Map<string, Workspace>();
    constructor(private readonly root = join(tmpdir(), 'happy-interactive-previews', randomUUID())) {}

    async create(sessionId: string, title: string): Promise<Workspace> {
        if (!title.trim() || title.trim().length > 160) throw new Error('Invalid preview title');
        const previewId = randomUUID(); const path = join(this.root, sessionId.replace(/[^A-Za-z0-9_-]/g, '_'), previewId);
        await mkdir(path, { recursive: true, mode: 0o700 });
        const workspace = { sessionId, previewId, title: title.trim(), path: await realpath(path) };
        this.workspaces.set(previewId, workspace); return workspace;
    }

    async resolveForPublish(sessionId: string, previewId: string): Promise<ResolvedPreviewWorkspace> {
        const workspace = this.workspaces.get(previewId);
        if (!workspace || workspace.sessionId !== sessionId) throw new Error('Preview workspace not found for session');
        const rootInfo = await lstat(workspace.path);
        if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Preview workspace root was replaced');
        const canonicalRoot = await realpath(workspace.path);
        if (canonicalRoot !== workspace.path) throw new Error('Preview workspace root changed');
        const paths: string[] = [];
        const walk = async (directory: string): Promise<void> => {
            for (const entry of await readdir(directory, { withFileTypes: true })) {
                if (entry.name.startsWith('.')) throw new Error('Hidden preview files are not allowed');
                const absolutePath = join(directory, entry.name); const info = await lstat(absolutePath);
                if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed in preview workspaces');
                if (info.isDirectory()) await walk(absolutePath); else if (info.isFile()) paths.push(absolutePath); else throw new Error('Unsupported preview file');
            }
        };
        await walk(canonicalRoot); paths.sort();
        if (paths.length > PREVIEW_LIMITS.maxFiles) throw new Error('Preview file limit exceeded');
        let total = 0; const files: ResolvedPreviewWorkspace['files'] = [];
        const assets = [];
        for (const absolutePath of paths) {
            const canonical = await realpath(absolutePath); if (!inside(canonicalRoot, canonical)) throw new Error('Preview path escapes workspace');
            const rel = relative(canonicalRoot, canonical).split(sep).join('/'); const extension = extname(rel).toLowerCase();
            const mimeType = MIME_BY_EXTENSION[extension]; if (!mimeType) throw new Error(`Unsupported preview file type: ${extension || 'none'}`);
            const bytes = await readFile(canonical); if (bytes.length > PREVIEW_LIMITS.maxFileBytes) throw new Error('Preview file size limit exceeded');
            total += bytes.length; if (total > PREVIEW_LIMITS.maxTotalBytes) throw new Error('Preview total byte limit exceeded');
            assertSignature(extension, bytes);
            const id = assetId(rel); files.push({ assetId: id, absolutePath: canonical });
            assets.push({ id, path: rel, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mimeType });
        }
        return { manifest: validateInteractivePreviewManifest({ version: 1, previewId, title: workspace.title, assets }), files };
    }

    async remove(sessionId: string, previewId: string): Promise<void> {
        const workspace = this.workspaces.get(previewId); if (!workspace || workspace.sessionId !== sessionId) return;
        this.workspaces.delete(previewId); await rm(workspace.path, { recursive: true, force: true });
    }
}
