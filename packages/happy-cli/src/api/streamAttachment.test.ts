import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { streamResponseBodyToFile } from './apiSession';

/**
 * Real HTTP server, no mocks (per repo test convention). Verifies the plaintext
 * audio/video download lane streams to disk with byte-for-byte fidelity, stays
 * off the heap for large payloads, and cleans up partial files on failure.
 */
describe('streamResponseBodyToFile', () => {
    let server: Server;
    let baseUrl: string;
    let handler: (req: any, res: any) => void;
    let tmp: string;

    beforeEach(async () => {
        handler = (_req, res) => res.end();
        server = createServer((req, res) => handler(req, res));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        tmp = await mkdtemp(join(tmpdir(), 'happy-stream-'));
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(tmp, { recursive: true, force: true });
    });

    it('streams body to disk byte-for-byte', async () => {
        const payload = randomBytes(5 * 1024 * 1024); // 5MB
        handler = (_req, res) => {
            res.writeHead(200, { 'Content-Type': 'video/mp4' });
            res.end(payload);
        };
        const dest = join(tmp, 'clip.mp4');
        const response = await fetch(baseUrl);
        await streamResponseBodyToFile(response, dest);

        const written = await readFile(dest);
        expect(written.length).toBe(payload.length);
        expect(createHash('sha256').update(written).digest('hex')).toBe(
            createHash('sha256').update(payload).digest('hex'),
        );
    });

    it('does not buffer the whole payload on the JS heap', async () => {
        // 64MB payload; assert heap growth stays well under the file size,
        // proving the data flowed through streams rather than an arrayBuffer.
        const size = 64 * 1024 * 1024;
        const chunk = randomBytes(1024 * 1024);
        handler = (_req, res) => {
            res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
            let sent = 0;
            const pump = () => {
                while (sent < size) {
                    sent += chunk.length;
                    if (!res.write(chunk)) {
                        res.once('drain', pump);
                        return;
                    }
                }
                res.end();
            };
            pump();
        };
        const dest = join(tmp, 'big.mp3');
        global.gc?.();
        const before = process.memoryUsage().heapUsed;
        const response = await fetch(baseUrl);
        await streamResponseBodyToFile(response, dest);
        const after = process.memoryUsage().heapUsed;

        expect((await stat(dest)).size).toBe(size);
        // Heap should not grow by anything close to the 64MB file size.
        expect(after - before).toBeLessThan(size / 2);
    });

    it('removes the partial file when the stream breaks mid-transfer', async () => {
        handler = (_req, res) => {
            res.writeHead(200, { 'Content-Length': '10485760' }); // claim 10MB
            res.write(randomBytes(1024 * 1024)); // send 1MB...
            // ...then hard-destroy the socket after the client has the body open,
            // so the break happens mid-stream (in pipeline), not during fetch().
            setTimeout(() => res.socket?.destroy(), 50);
        };
        const dest = join(tmp, 'broken.mp4');
        const response = await fetch(baseUrl);
        await expect(streamResponseBodyToFile(response, dest)).rejects.toThrow(/stream-to-disk failed/);
        expect(existsSync(dest)).toBe(false);
    });
});
