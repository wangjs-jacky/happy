import { useEffect, useMemo, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { storage } from '@/sync/storage';
import { useIsFocused } from '@react-navigation/native';

interface UseDraftOptions {
    autoSaveInterval?: number;
}

// Each session owns its pending value and timer. Editing only reschedules the
// timer; leaving the session flushes that session's latest committed text.
export function useDraft(
    sessionId: string | null | undefined,
    value: string,
    onChange: (value: string) => void,
    { autoSaveInterval = 2000 }: UseDraftOptions = {},
) {
    const isFocused = useIsFocused();
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const draft = useMemo(() => {
        const state = {
            value,
            saved: value,
            clearedValue: null as string | null,
            timer: null as ReturnType<typeof setTimeout> | null,
            cancel() {
                if (state.timer !== null) clearTimeout(state.timer);
                state.timer = null;
            },
            flush() {
                state.cancel();
                if (!sessionId || state.value === state.saved) return;
                storage.getState().updateSessionDraft(sessionId, state.value);
                state.saved = state.value;
            },
        };
        return state;
        // Value deliberately seeds only a new session, never an ordinary edit.
    }, [sessionId]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
            if (next === 'background' || next === 'inactive') draft.flush();
        });
        return () => {
            subscription.remove();
            draft.flush();
        };
    }, [draft]);

    useEffect(() => {
        if (draft.clearedValue === value) return;
        draft.clearedValue = null;
        draft.value = value;
    }, [draft, value]);

    useEffect(() => {
        if (!sessionId || !isFocused || draft.clearedValue !== null) return;
        const saved = storage.getState().sessions[sessionId]?.draft;
        if (saved && !draft.value) {
            draft.value = saved;
            draft.saved = saved;
            onChangeRef.current(saved);
        }
    }, [draft, sessionId, isFocused]);

    useEffect(() => {
        draft.cancel();
        if (draft.value !== draft.saved) {
            if (!isFocused || !draft.value.trim() !== !draft.saved.trim()) {
                draft.flush();
            } else {
                draft.timer = setTimeout(() => draft.flush(), autoSaveInterval);
            }
        }
        return () => draft.cancel();
    }, [draft, value, isFocused, autoSaveInterval]);

    const clearDraft = useCallback(() => {
        draft.cancel();
        // The composer may unmount before its cleared value renders. Suppress
        // the sent value until the next actual edit instead of resurrecting it.
        draft.clearedValue = draft.value;
        draft.value = '';
        draft.saved = '';
        if (sessionId) storage.getState().updateSessionDraft(sessionId, null);
    }, [draft, sessionId]);

    return { clearDraft };
}
