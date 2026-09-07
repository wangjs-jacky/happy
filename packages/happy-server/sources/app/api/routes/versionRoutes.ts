import { z } from "zod";
import { type Fastify } from "@/app/api/types";
import * as semver from 'semver';
import { createNativeReleaseCatalog, newestNativeRelease } from '@/app/api/routes/nativeReleases';

export function versionRoutes(app: Fastify) {
    const getReleases = createNativeReleaseCatalog();
    const responseSchema = z.object({
        status: z.enum(['update-available', 'up-to-date', 'unknown', 'unsupported']),
        updateUrl: z.string().nullable(),
        update_required: z.boolean(), // Legacy field means available, not forced.
        update_url: z.string().nullable(),
        version: z.string().optional(),
        runtime_version: z.string().optional(),
        release_url: z.string().optional(),
    });
    const noUpdate = (status: 'up-to-date' | 'unknown' | 'unsupported') =>
        ({ status, updateUrl: null, update_required: false, update_url: null });
    app.post('/v1/version', {
        schema: {
            body: z.object({
                platform: z.string().max(30),
                version: z.string().max(80),
                app_id: z.string().max(200),
                channel: z.string().max(80).optional(),
                runtime_version: z.string().max(80).optional(),
            }),
            response: {
                200: responseSchema,
                503: responseSchema,
            }
        }
    }, async (request, reply) => {
        const { platform, version, app_id, channel, runtime_version } = request.body;
        const expectedChannel = app_id === 'build.paws' ? 'production'
            : app_id === 'build.paws.preview' ? 'preview' : null;
        if (platform.toLowerCase() !== 'android' || !expectedChannel || (channel && channel !== expectedChannel)) {
            return reply.send(noUpdate('unsupported'));
        }
        // A display version may come from an OTA and does not identify an old
        // binary. Only a request with the native runtime can establish this.
        if (!runtime_version || !/^[1-9]\d*$/.test(runtime_version)
            || !Number.isSafeInteger(Number(runtime_version)) || !semver.valid(version)) {
            return reply.send(noUpdate('unknown'));
        }
        try {
            const currentRuntime = Number(runtime_version);
            const releases = await getReleases();
            // A partial catalog can still offer a verified upgrade, but cannot
            // establish that a channel with failed lookups is up to date.
            const unavailable = releases.unavailableChannels?.includes(expectedChannel);
            if (unavailable && !releases.some(r => r.channel === expectedChannel)) return reply.code(503).send(noUpdate('unknown'));
            if (!releases.some(r => r.channel === expectedChannel)) return reply.send(noUpdate('unknown'));
            const release = newestNativeRelease(releases, expectedChannel, { runtime: currentRuntime, version });
            if (!release) return unavailable ? reply.code(503).send(noUpdate('unknown')) : reply.send(noUpdate('up-to-date'));
            const available = currentRuntime <= release.runtime && semver.lte(version, release.version)
                && (currentRuntime < release.runtime || semver.lt(version, release.version));
            if (!available) return unavailable ? reply.code(503).send(noUpdate('unknown')) : reply.send(noUpdate('up-to-date'));
            return reply.send({ status: 'update-available', update_required: true,
                updateUrl: release.url, update_url: release.url, version: release.version,
                runtime_version: String(release.runtime), release_url: release.releaseUrl });
        } catch (error) {
            request.log.warn({ err: error }, 'Native release check failed');
            return reply.code(503).send(noUpdate('unknown'));
        }
    });
}
