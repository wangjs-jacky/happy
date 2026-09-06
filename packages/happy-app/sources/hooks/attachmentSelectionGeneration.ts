export type AttachmentSelectionToken = Readonly<{
    instanceEpoch: number;
    draftEpoch: number;
    invalidationEpoch: number;
}>;

export interface AttachmentSelectionGuard {
    capture(): AttachmentSelectionToken;
    isCurrent(token: AttachmentSelectionToken): boolean;
    invalidate(): void;
    replaceDraft(draftEpoch: number): void;
    unmount(): void;
}

let nextInstanceEpoch = 1;

export function createAttachmentSelectionGuard(initialDraftEpoch: number): AttachmentSelectionGuard {
    const instanceEpoch = nextInstanceEpoch++;
    let draftEpoch = initialDraftEpoch;
    let invalidationEpoch = 0;
    let mounted = true;

    const capture = (): AttachmentSelectionToken => ({
        instanceEpoch,
        draftEpoch,
        invalidationEpoch,
    });

    return {
        capture,
        isCurrent: (token) => mounted
            && token.instanceEpoch === instanceEpoch
            && token.draftEpoch === draftEpoch
            && token.invalidationEpoch === invalidationEpoch,
        invalidate: () => {
            invalidationEpoch++;
        },
        replaceDraft: (nextDraftEpoch) => {
            draftEpoch = nextDraftEpoch;
        },
        unmount: () => {
            mounted = false;
            invalidationEpoch++;
        },
    };
}
