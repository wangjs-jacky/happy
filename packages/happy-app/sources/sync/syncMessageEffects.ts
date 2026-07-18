export function notifyReadyEvent(
    sessionId: string,
    hasReadyEvent: boolean | undefined,
    onReady: (sessionId: string) => void,
): void {
    if (hasReadyEvent) onReady(sessionId);
}
