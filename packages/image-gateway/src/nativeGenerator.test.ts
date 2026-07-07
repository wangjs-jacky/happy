import { describe, expect, it } from 'vitest';
import { buildNativeImageRequest } from './nativeGenerator';

describe('buildNativeImageRequest', () => {
    it('passes only the fixed native image generation contract to the worker command', () => {
        const request = buildNativeImageRequest({
            id: 'job_123',
            prompt: 'make an editorial image of a public image gateway',
            status: 'running',
            size: '1024x1024',
            estimatedCostCents: 40,
            requesterIpHash: 'ip_hash',
            userAgentHash: 'ua_hash',
            createdAt: '2026-07-07T08:00:00.000Z',
            updatedAt: '2026-07-07T08:00:00.000Z',
        });

        expect(request).toEqual({
            jobId: 'job_123',
            prompt: 'make an editorial image of a public image gateway',
            options: {
                size: '1024x1024',
                output: 'png',
                count: 1,
            },
        });
        expect(JSON.stringify(request)).not.toContain('requesterIpHash');
    });
});
