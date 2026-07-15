import { z } from "zod";
import { Fastify } from "../types";
import { getPublicUrl } from "@/storage/files";
import { uploadImage } from "@/storage/uploadImage";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { log } from "@/utils/log";

const MAX_SHARE_IMAGE_SIZE = 3 * 1024 * 1024;

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

export function openBirdShareRoutes(app: Fastify) {
    app.post('/v1/openbird/share-image', {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({
                    image: z.object({
                        width: z.number(),
                        height: z.number(),
                        thumbhash: z.string(),
                        path: z.string(),
                        url: z.string()
                    })
                }),
                400: z.object({ error: z.string() }),
                500: z.object({ error: z.literal('Failed to upload share image') })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const body = request.body;
        const image = Buffer.isBuffer(body)
            ? body
            : body instanceof ArrayBuffer
                ? Buffer.from(body)
                : ArrayBuffer.isView(body)
                    ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
                    : null;

        if (!image || image.length === 0) {
            return reply.code(400).send({ error: 'Missing image body' });
        }
        if (image.length > MAX_SHARE_IMAGE_SIZE) {
            return reply.code(400).send({ error: 'Share image is too large' });
        }

        try {
            const shareImage = await uploadImage(
                userId,
                'openbird',
                'share',
                `openbird:${userId}:${Date.now()}:${randomKeyNaked(8)}`,
                image,
            );

            return reply.send({
                image: { ...shareImage, url: getPublicUrl(shareImage.path, resolveBaseUrl(request)) }
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to upload OpenBird share image: ${error}`);
            return reply.code(500).send({ error: 'Failed to upload share image' });
        }
    });
}
