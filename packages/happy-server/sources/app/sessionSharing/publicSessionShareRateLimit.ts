export function createFixedWindowRateLimiter(options: {
    max: number;
    windowMs: number;
    now?: () => number;
}) {
    const now = options.now ?? Date.now;
    const entries = new Map<string, { count: number; windowStart: number }>();

    return {
        allow(key: string): boolean {
            const currentTime = now();
            const entry = entries.get(key);
            if (!entry || currentTime - entry.windowStart >= options.windowMs) {
                entries.set(key, { count: 1, windowStart: currentTime });
                if (entries.size > 10_000) {
                    for (const [candidate, value] of entries) {
                        if (currentTime - value.windowStart >= options.windowMs) entries.delete(candidate);
                    }
                }
                return true;
            }
            if (entry.count >= options.max) return false;
            entry.count += 1;
            return true;
        },
    };
}
