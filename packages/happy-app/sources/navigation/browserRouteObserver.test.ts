import { expect, test, vi } from 'vitest';
import { observeBrowserRoute } from './browserRouteObserver';

function fixture() {
    const events = new EventTarget();
    const location = { pathname: '/', search: '', hash: '' };
    const history = { state: { id: 'initial' } as any, pushState: vi.fn(), replaceState: vi.fn() };
    const navigate = (data: unknown, _title: string, route?: string | URL | null) => {
        const url = new URL(String(route), 'http://fixture.test');
        Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash });
        history.state = data;
    };
    history.pushState.mockImplementation(navigate);
    history.replaceState.mockImplementation(navigate);
    const target = { history, location, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } as unknown as Window;
    const sync = vi.fn();
    const pop = (id: string | null, route: string) => {
        navigate(id === null ? null : { id }, '', route);
        events.dispatchEvent(new Event('popstate'));
    };
    return { target, history, sync, pop, events };
}

test('replaces the current entry without enabling a back target outside the App', () => {
    const f = fixture(); const stop = observeBrowserRoute(f.target, f.sync);
    f.target.history.replaceState({ id: 'initial' }, '', '/new');
    expect(f.sync).toHaveBeenLastCalledWith({ stack: ['/new'], cursor: 0 });
    stop();
});

test('tracks repeated URLs, hash routes and native browser back/forward by entry identity', () => {
    const f = fixture(); const stop = observeBrowserRoute(f.target, f.sync);
    f.target.history.pushState({ id: 'second' }, '', '/');
    f.target.history.pushState({ id: 'third' }, '', '/session/example?file=readme#L4');
    f.pop('initial', '/');
    expect(f.sync).toHaveBeenLastCalledWith({ stack: ['/', '/', '/session/example?file=readme#L4'], cursor: 0 });
    f.pop('third', '/session/example?file=readme#L4');
    expect(f.sync.mock.lastCall?.[0].cursor).toBe(2);
    f.pop('second', '/');
    f.target.history.pushState({ id: 'fourth' }, '', '/projects');
    expect(f.sync).toHaveBeenLastCalledWith({ stack: ['/', '/', '/projects'], cursor: 2 });
    stop();
});

test('resets at an unknown pre-App entry instead of inventing an in-app back target', () => {
    const f = fixture(); const stop = observeBrowserRoute(f.target, f.sync);
    f.target.history.pushState({ id: 'second' }, '', '/new');
    f.pop('older-unknown', '/');
    expect(f.sync).toHaveBeenLastCalledWith({ stack: ['/'], cursor: 0 });
    stop();
});

test('handles untracked hash navigation conservatively without inventing a back entry', () => {
    const f = fixture(); const stop = observeBrowserRoute(f.target, f.sync);
    f.target.location.hash = '#heading';
    f.events.dispatchEvent(new Event('hashchange'));
    expect(f.sync).toHaveBeenLastCalledWith({ stack: ['/#heading'], cursor: 0 });
    stop();
});

test('restores owned wrappers and deactivates callbacks retained by a later wrapper', () => {
    const f = fixture(); const originalPush = f.history.pushState;
    const originalReplace = f.history.replaceState;
    const stop = observeBrowserRoute(f.target, f.sync);
    const observedPush = f.target.history.pushState;
    const outer: History['pushState'] = function (this: History, ...args) { observedPush.apply(this, args); };
    f.target.history.pushState = outer;
    stop();
    f.target.history.pushState(null, '', '/new');
    f.pop('initial', '/');
    expect(f.sync).toHaveBeenCalledTimes(1);
    expect(f.target.history.pushState).toBe(outer);
    expect(f.target.history.replaceState).toBe(originalReplace);
    expect(originalPush).toHaveBeenCalledOnce();
});
