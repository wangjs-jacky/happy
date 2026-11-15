type BotsRuntime = NonNullable<Window['PawsBots']>;
// Cache code and scoped styles, never a ticket, lease, mounted tree or account data.
// Returning to Bots still creates a fresh account-bound mount.
const libraries = new WeakMap<Document, Map<string, Promise<BotsRuntime>>>();

export function loadBotsAssets(entry: string, css: string): Promise<BotsRuntime> {
    let cache = libraries.get(document);
    if (!cache) { cache = new Map(); libraries.set(document, cache); }
    const key = JSON.stringify([entry, css]);
    const existing = cache.get(key);
    if (existing) return existing;
    const script = document.createElement('script');
    const style = document.createElement('link');
    script.async = true; script.src = entry;
    style.rel = 'stylesheet'; style.href = css;
    const loaded = (node: HTMLScriptElement | HTMLLinkElement) => new Promise<void>((resolve, reject) => {
        node.onload = () => resolve();
        node.onerror = () => reject(new Error('Bots workspace asset failed to load'));
    });
    // Fetch independent resources together, but mount only after both are ready.
    const ready = Promise.allSettled([loaded(style), loaded(script)]).then(results => {
        if (results.some(result => result.status === 'rejected') || !window.PawsBots) {
            throw new Error('Bots workspace assets are unavailable');
        }
        return window.PawsBots;
    }).catch(error => {
        cache!.delete(key); style.remove(); script.remove();
        throw error;
    });
    cache.set(key, ready);
    document.head.appendChild(style); document.head.appendChild(script);
    return ready;
}
