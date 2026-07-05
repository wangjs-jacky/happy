import { describe, expect, it } from 'vitest';

const {
    parseOtaTarget,
    stableUuid,
    virtualizeManifest,
} = require('../../ota-server/code/index.js');

const manifest = {
    id: '8b432995-9786-c524-8bfa-44e3704cfb92',
    createdAt: '2026-07-05T16:26:36.746Z',
    runtimeVersion: '21',
    launchAsset: { url: 'https://example.com/bundle.js' },
    assets: [],
    metadata: {},
    extra: {
        display: {
            title: 'feat(app): restore my agents sidebar launcher',
        },
    },
};

describe('happy ota server targeting', () => {
    it('parses locked and latest OTA targets from Expo extra params', () => {
        expect(parseOtaTarget('ota-target-stamp="1783268796746", ota-target-generation="1783272000000"')).toEqual({
            stamp: '1783268796746',
            generation: '1783272000000',
        });

        expect(parseOtaTarget('ota-target-stamp="latest", ota-target-generation=1783272100000')).toEqual({
            stamp: 'latest',
            generation: '1783272100000',
        });

        expect(parseOtaTarget('ota-target-stamp="../bad"')).toBeNull();
    });

    it('creates stable UUIDs for the same virtual update identity', () => {
        expect(stableUuid('same')).toBe(stableUuid('same'));
        expect(stableUuid('same')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(stableUuid('same')).not.toBe(stableUuid('different'));
    });

    it('virtualizes a historical manifest into a newer launchable update', () => {
        const virtual = virtualizeManifest(manifest, {
            stamp: '1783268796746',
            generation: '1783272000000',
        });

        expect(virtual).not.toBe(manifest);
        expect(virtual.id).not.toBe(manifest.id);
        expect(Date.parse(virtual.createdAt)).toBeGreaterThan(Date.parse(manifest.createdAt));
        expect(virtual.launchAsset).toBe(manifest.launchAsset);
        expect(virtual.extra.display).toBe(manifest.extra.display);
        expect(virtual.extra.otaTarget).toEqual({
            mode: 'locked',
            stamp: '1783268796746',
            generation: '1783272000000',
            originalUpdateId: manifest.id,
            virtualUpdateId: virtual.id,
        });
    });

    it('virtualizes latest with the same generation path used for unlock', () => {
        const virtual = virtualizeManifest(manifest, {
            stamp: 'latest',
            generation: '1783272100000',
        });

        expect(virtual.extra.otaTarget.mode).toBe('latest');
        expect(virtual.extra.otaTarget.stamp).toBe('latest');
        expect(Date.parse(virtual.createdAt)).toBe(1783272100000);
    });
});
