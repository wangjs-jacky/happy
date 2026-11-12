import type { RouteHistoryState } from './browserNavigation';

type BrowserRouteTarget = Pick<Window, 'history' | 'location' | 'addEventListener' | 'removeEventListener'>;

/** Track actual browser entries using React Navigation's history.state.id. */
export function observeBrowserRoute(target: BrowserRouteTarget, sync: (state: RouteHistoryState) => void): () => void {
    const history = target.history;
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    const route = () => `${target.location.pathname}${target.location.search}${target.location.hash ?? ''}`;
    const entryId = (): string | null => typeof history.state?.id === 'string' ? history.state.id : null;
    let active = true;
    let entries = [{ id: entryId(), route: route() }];
    let cursor = 0;
    const publish = () => sync({ stack: entries.map(entry => entry.route), cursor });
    const alignBeforeMutation = () => {
        const id = entryId();
        if (entries[cursor].id === id) return;
        const index = id === null ? -1 : entries.findIndex(entry => entry.id === id);
        if (index >= 0) cursor = index;
        else {
            entries = [{ id, route: route() }];
            cursor = 0;
        }
    };
    const pop = () => {
        if (!active) return;
        const id = entryId();
        const matches = id === null ? [] : entries.flatMap((entry, index) => entry.id === id ? [index] : []);
        if (matches.length === 1) {
            cursor = matches[0];
            entries[cursor] = { id, route: route() };
        } else {
            // An entry predating this App mount is not a safe in-app back target.
            entries = [{ id, route: route() }];
            cursor = 0;
        }
        publish();
    };
    const hashChange = () => {
        if (!active || entries[cursor].route === route()) return;
        // Direct hash navigation has no reliable React Navigation entry id.
        entries = [{ id: entryId(), route: route() }];
        cursor = 0;
        publish();
    };
    const push: History['pushState'] = function (this: History, ...args) {
        if (active) alignBeforeMutation();
        pushState.apply(this, args);
        if (!active) return;
        entries = [...entries.slice(0, cursor + 1), { id: entryId(), route: route() }];
        cursor = entries.length - 1;
        publish();
    };
    const replace: History['replaceState'] = function (this: History, ...args) {
        if (active) alignBeforeMutation();
        replaceState.apply(this, args);
        if (!active) return;
        entries[cursor] = { id: entryId(), route: route() };
        publish();
    };
    history.pushState = push;
    history.replaceState = replace;
    target.addEventListener('popstate', pop);
    target.addEventListener('hashchange', hashChange);
    publish();
    return () => {
        active = false;
        target.removeEventListener('popstate', pop);
        target.removeEventListener('hashchange', hashChange);
        if (history.pushState === push) history.pushState = pushState;
        if (history.replaceState === replace) history.replaceState = replaceState;
    };
}
