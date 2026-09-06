import { create } from 'zustand';
import type { AttachmentPreview } from './attachmentTypes';

let attachmentDraftEpoch = 0;

export const composeDraftAttachmentSelectionGeneration = {
    currentDraftEpoch: () => attachmentDraftEpoch,
    invalidate: () => {
        attachmentDraftEpoch++;
    },
};

// Route-independent, memory-only state: File/blob references survive navigation
// without serializing private attachment locations to disk.
export const useComposeDraft = create<{
    text: string;
    revision: number;
    images: AttachmentPreview[];
    setText: (text: string) => void;
    setImages: (update: AttachmentPreview[] | ((current: AttachmentPreview[]) => AttachmentPreview[])) => void;
}>((set) => ({
    text: '', revision: 0, images: [],
    setText: (text) => set(state => text === state.text ? state : { text, revision: state.revision + 1 }),
    setImages: (update) => set(state => ({ images: typeof update === 'function' ? update(state.images) : update })),
}));

export function clearComposeDraft() {
    composeDraftAttachmentSelectionGeneration.invalidate();
    useComposeDraft.setState(state => ({ text: '', images: [], revision: state.revision + 1 }));
}
