const IOS_SCANNER_TRANSITION_SETTLE_MS = 500;

export function waitForIosScannerTransition(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, IOS_SCANNER_TRANSITION_SETTLE_MS);
    });
}
