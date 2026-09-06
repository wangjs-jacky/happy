import { describe, expect, it } from 'vitest';
import { createAttachmentSelectionGuard } from './attachmentSelectionGeneration';

describe('attachment selection generation', () => {
    it('keeps concurrent captures valid until an explicit invalidation boundary', () => {
        const guard = createAttachmentSelectionGuard(4);
        const first = guard.capture();
        const second = guard.capture();

        expect(guard.isCurrent(first)).toBe(true);
        expect(guard.isCurrent(second)).toBe(true);

        guard.invalidate();

        expect(guard.isCurrent(first)).toBe(false);
        expect(guard.isCurrent(second)).toBe(false);
        expect(guard.isCurrent(guard.capture())).toBe(true);
    });

    it('invalidates prior captures when the external draft is replaced', () => {
        const guard = createAttachmentSelectionGuard(10);
        const priorDraft = guard.capture();

        guard.replaceDraft(11);

        expect(guard.isCurrent(priorDraft)).toBe(false);
        expect(guard.isCurrent(guard.capture())).toBe(true);
    });

    it('permanently invalidates captures when the owning instance unmounts', () => {
        const guard = createAttachmentSelectionGuard(2);
        const mounted = guard.capture();

        guard.unmount();

        expect(guard.isCurrent(mounted)).toBe(false);
        expect(guard.isCurrent(guard.capture())).toBe(false);
    });

    it('does not accept a token captured by a newer hook instance', () => {
        const first = createAttachmentSelectionGuard(1);
        const second = createAttachmentSelectionGuard(1);

        expect(first.isCurrent(second.capture())).toBe(false);
        expect(second.isCurrent(first.capture())).toBe(false);
    });
});
