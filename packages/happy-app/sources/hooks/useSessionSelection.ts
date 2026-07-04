import { create } from 'zustand';

type SessionSelectionState = {
    active: boolean;
    selectedIds: Set<string>;
    enterSelection: (sessionId: string) => void;
    toggleSelection: (sessionId: string) => void;
    replaceSelectedIds: (sessionIds: Iterable<string>) => void;
    clearSelection: () => void;
};

export const useSessionSelection = create<SessionSelectionState>()((set) => ({
    active: false,
    selectedIds: new Set<string>(),
    enterSelection: (sessionId) => set({
        active: true,
        selectedIds: new Set([sessionId]),
    }),
    toggleSelection: (sessionId) => set((state) => {
        const selectedIds = new Set(state.selectedIds);
        if (selectedIds.has(sessionId)) {
            selectedIds.delete(sessionId);
        } else {
            selectedIds.add(sessionId);
        }

        return {
            active: selectedIds.size > 0,
            selectedIds,
        };
    }),
    replaceSelectedIds: (sessionIds) => {
        const selectedIds = new Set(sessionIds);
        set({
            active: selectedIds.size > 0,
            selectedIds,
        });
    },
    clearSelection: () => set({
        active: false,
        selectedIds: new Set<string>(),
    }),
}));
