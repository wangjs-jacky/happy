// Set by sync before its first initialization await; invalidated at logout start.
// This must not depend on AuthContext's post-render global mirror.
let scope: { key: string; serverUrl: string } | null = null;
const listeners = new Set<() => void>();
export function setFirstSubmissionScope(key: string, serverUrl: string) {
    scope = { key, serverUrl }; listeners.forEach(listener => listener());
}
export function clearFirstSubmissionScope() {
    scope = null; listeners.forEach(listener => listener());
}
export const getFirstSubmissionScope = () => scope;
export function subscribeFirstSubmissionScope(listener: () => void) {
    listeners.add(listener); return () => { listeners.delete(listener); };
}
