import { open, realpath, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const failure = (error: unknown) => ({ success: false as const, error: error instanceof Error ? error.message : String(error) });

/** Dedicated methods make older CLIs fail closed rather than silently ignore a scope flag. */
export function createWorkspaceFileHandlers(workingDirectory: string) {
    const locks = new Map<string, Promise<unknown>>();
    const scoped = async (path: string) => {
        if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error('Invalid workspace path');
        const lexical = resolve(workingDirectory, path);
        const inside = (target: string, root: string) => { const child = relative(root, target); return !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep); };
        if (!inside(lexical, resolve(workingDirectory))) throw new Error('Access denied: outside workspace');
        const [root, target] = await Promise.all([realpath(workingDirectory), realpath(lexical)]);
        if (!inside(target, root)) throw new Error('Access denied: symlink outside workspace');
        return target;
    };
    const readBytes = async (path: string, limit: number) => {
        const file = await open(path, 'r');
        try {
            const info = await file.stat();
            if (!info.isFile()) throw new Error('Not a regular file');
            if (info.size > limit) throw new Error('Workspace file too large');
            // Bounded read even if another process grows the file after stat.
            const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
            let offset = 0;
            while (offset < bytes.length) {
                const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
                if (!bytesRead) break;
                offset += bytesRead;
            }
            if (offset > limit) throw new Error('Workspace file too large');
            if (offset > info.size) throw new Error('File changed during read; retry');
            return bytes.subarray(0, offset);
        } finally { await file.close(); }
    };
    return {
        async read(data: { path: string }) {
            try { const bytes = await readBytes(await scoped(data.path), 10 * 1024 * 1024); return { success: true as const, content: bytes.toString('base64'), hash: hash(bytes) }; }
            catch (error) { return failure(error); }
        },
        async list(data: { path: string }) {
            try {
                const entries = await readdir(await scoped(data.path), { withFileTypes: true });
                return { success: true as const, entries: entries.map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' as const : entry.isFile() ? 'file' as const : 'other' as const })) };
            } catch (error) { return failure(error); }
        },
        async write(data: { path: string; content: string; expectedHash?: string | null }) {
            try {
                if (typeof data.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.expectedHash)) throw new Error('Expected file hash required');
                if (typeof data.content !== 'string' || data.content.length > Math.ceil(2 * 1024 * 1024 / 3) * 4) throw new Error('Workspace file too large');
                const bytes = Buffer.from(data.content, 'base64');
                if (bytes.length > 2 * 1024 * 1024) throw new Error('Workspace file too large');
                const path = await scoped(data.path);
                const previous = locks.get(path) ?? Promise.resolve();
                const operation = previous.catch(() => {}).then(async () => {
                    if (hash(await readBytes(path, 2 * 1024 * 1024)) !== data.expectedHash) throw new Error('File hash mismatch; reload before saving');
                    await writeFile(path, bytes);
                    return { success: true as const, hash: hash(bytes) };
                });
                locks.set(path, operation);
                try { return await operation; } finally { if (locks.get(path) === operation) locks.delete(path); }
            } catch (error) { return failure(error); }
        },
    };
}
export function registerWorkspaceFileHandlers(manager: RpcHandlerManager, directory: string) {
    const handlers = createWorkspaceFileHandlers(directory);
    manager.registerHandler('workspaceReadFile', handlers.read);
    manager.registerHandler('workspaceListDirectory', handlers.list);
    manager.registerHandler('workspaceWriteFile', handlers.write);
}
