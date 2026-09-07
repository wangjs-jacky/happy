const listeners = new Set<(key: string) => void>();

export type AdvisorImageSource = { uri: string; release: () => void };

export function subscribeAdvisorImageChanges(listener: (key: string) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function notifyAdvisorImageChanged(key: string): void {
    listeners.forEach((listener) => listener(key));
}
