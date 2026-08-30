import { describe, expect, it, vi } from 'vitest';
import { createFixedWindowRateLimiter } from './publicSessionShareRateLimit';

describe('public session share rate limiting', () => {
    it('limits each caller independently and opens a fresh window after expiry', () => {
        const now = vi.fn(() => 1_000);
        const limiter = createFixedWindowRateLimiter({ max: 2, windowMs: 60_000, now });

        expect(limiter.allow('owner-a')).toBe(true);
        expect(limiter.allow('owner-a')).toBe(true);
        expect(limiter.allow('owner-a')).toBe(false);
        expect(limiter.allow('owner-b')).toBe(true);

        now.mockReturnValue(61_001);
        expect(limiter.allow('owner-a')).toBe(true);
    });
});
