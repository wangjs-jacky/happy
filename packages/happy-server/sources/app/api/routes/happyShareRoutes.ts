import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { Fastify } from "../types";
import { getLocalFilesDir, isLocalStorage, putLocalFile, s3bucket, s3client } from "@/storage/files";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { log } from "@/utils/log";

const MAX_SHARE_HTML_SIZE = 2 * 1024 * 1024;
const SHARE_ID_PATTERN = /^[a-zA-Z0-9_-]{16,48}$/;

function resolveBaseUrl(request: { headers: Record<string, string | string[] | undefined> }): string {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
    const xfHost = request.headers['x-forwarded-host'];
    const xfProto = request.headers['x-forwarded-proto'];
    const host = (Array.isArray(xfHost) ? xfHost[0] : xfHost) ?? request.headers.host;
    const proto = (Array.isArray(xfProto) ? xfProto[0] : xfProto) ?? 'http';
    if (typeof host === 'string' && host.length > 0) {
        return `${proto}://${host}`;
    }
    return `http://localhost:${process.env.PORT || '3005'}`;
}

function getSharePath(id: string): string {
    return `public/shares/${id}.html`;
}

async function readObjectAsBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

export function happyShareRoutes(app: Fastify) {
    app.post('/v1/share/session', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                html: z.string().min(1).max(MAX_SHARE_HTML_SIZE),
                title: z.string().max(240).optional(),
            }),
            response: {
                200: z.object({
                    id: z.string(),
                    url: z.string(),
                }),
                400: z.object({ error: z.string() }),
                500: z.object({ error: z.literal('Failed to publish share page') }),
            },
        },
    }, async (request, reply) => {
        const body = request.body as { html: string; title?: string };
        const bytes = Buffer.from(body.html, 'utf8');
        if (bytes.length > MAX_SHARE_HTML_SIZE) {
            return reply.code(400).send({ error: 'Share page is too large' });
        }

        const id = randomKeyNaked(20);
        const filePath = getSharePath(id);
        try {
            if (isLocalStorage()) {
                await putLocalFile(filePath, bytes);
            } else {
                await s3client.putObject(s3bucket, filePath, bytes);
            }
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to publish Happy share page: ${error}`);
            return reply.code(500).send({ error: 'Failed to publish share page' });
        }

        return reply.send({
            id,
            url: `${resolveBaseUrl(request)}/share/${id}`,
        });
    });

    app.get('/share/:id', async (request, reply) => {
        const id = (request.params as { id?: string }).id;
        if (typeof id !== 'string' || !SHARE_ID_PATTERN.test(id)) {
            return reply.code(404).send('Not found');
        }

        const filePath = getSharePath(id);
        let html: Buffer;
        try {
            if (isLocalStorage()) {
                const baseDir = path.resolve(getLocalFilesDir());
                const fullPath = path.resolve(baseDir, filePath);
                if (!fullPath.startsWith(baseDir + path.sep) || !fs.existsSync(fullPath)) {
                    return reply.code(404).send('Not found');
                }
                html = fs.readFileSync(fullPath);
            } else {
                const stream = await s3client.getObject(s3bucket, filePath);
                html = await readObjectAsBuffer(stream);
            }
        } catch (error) {
            return reply.code(404).send('Not found');
        }

        reply
            .header('Content-Security-Policy', "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            .header('X-Content-Type-Options', 'nosniff')
            .type('text/html; charset=utf-8')
            .send(html);
    });
}
