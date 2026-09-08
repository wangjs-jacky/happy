import { afterEach, expect, it, vi } from 'vitest';
import { ensureSessionHydratedWithRetry } from './ensureSessionHydratedWithRetry';
const hydrate = vi.hoisted(() => vi.fn());
vi.mock('./sync', () => ({ sync: { ensureSessionHydrated: hydrate } }));
vi.mock('./sessionCriticalPathProbeBridge', () => ({ markSessionCriticalPathHydrationRetry: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('stops retries before any request under a changed owner', async () => {
    vi.useFakeTimers();
    let current = true;
    hydrate.mockImplementation(async () => { current = false; return false; });
    const attempt = ensureSessionHydratedWithRetry('old-session', () => current);
    await vi.runAllTimersAsync();
    expect(await attempt).toBe(false);
    expect(hydrate).toHaveBeenCalledTimes(1);
});
