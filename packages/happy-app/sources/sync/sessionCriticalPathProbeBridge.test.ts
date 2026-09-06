import { afterEach, describe, expect, it } from 'vitest';

import { markSessionCriticalPathAppStage } from './sessionCriticalPathProbeBridge';

describe('session critical path probe bridge', () => {
    afterEach(() => {
        delete (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe;
    });

    it('forwards each allowlisted app milestone to its fixed document-probe method', () => {
        // Catches an app milestone being disconnected from the document-start measurement probe.
        const calls: string[] = [];
        (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe = {
            initFreshDeepLink: () => calls.push('root'),
            markFreshLatestMessageComplete: () => calls.push('latest'),
            markRouteNavigation: () => calls.push('route'),
        };

        expect(markSessionCriticalPathAppStage('web.root.module_ready')).toBe(true);
        expect(markSessionCriticalPathAppStage('web.session.latest_message_painted')).toBe(true);
        expect(markSessionCriticalPathAppStage('web.session.route_painted')).toBe(true);
        expect(calls).toEqual(['root', 'latest', 'route']);
    });

    it('returns false for missing, unknown, and throwing probe methods', () => {
        // Catches optional diagnostics changing normal application rendering.
        expect(markSessionCriticalPathAppStage('web.root.module_ready')).toBe(false);
        (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe = {
            markFreshHeaderVisible: () => { throw new Error('probe unavailable'); },
        };
        expect(markSessionCriticalPathAppStage('web.root.module_ready')).toBe(false);
        expect(markSessionCriticalPathAppStage('unknown' as any)).toBe(false);
    });
});
