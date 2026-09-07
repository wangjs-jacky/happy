import { create } from 'zustand';

export type SessionListLoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export interface SessionListSyncState {
    bootstrap: SessionListLoadStatus;
    history: SessionListLoadStatus;
}

// Refresh state is separate from session contents: cached rows remain readable
// during loading and failure, and all sidebar layouts expose the same retry.
export const useSessionListSyncState = create<SessionListSyncState>(() => ({
    bootstrap: 'idle', history: 'idle',
}));
