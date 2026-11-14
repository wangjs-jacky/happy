import * as React from 'react';
import { mergeSessionPrompts, visibleSessionPrompts, type SessionPrompt, type SessionPromptNavigation } from '@/sync/sessionPromptIndex';

/** Directory pagination owns its cursor; it never uses the transcript window cursor. */
const EMPTY_PROMPTS: SessionPrompt[] = [];
export function useSessionPromptIndex(adapter: SessionPromptNavigation | undefined, open: boolean, visiblePrompts = EMPTY_PROMPTS) {
    const [state, setState] = React.useState<{ key?: string; prompts: SessionPrompt[]; hasMore: boolean; loading: boolean; error: boolean }>(
        { key: adapter?.key, prompts: [], hasMore: true, loading: false, error: false });
    const current = React.useRef(adapter); current.current = adapter;
    const cursor = React.useRef<number | undefined>(undefined);
    const request = React.useRef<object | null>(null);
    const initialized = React.useRef(false);
    React.useEffect(() => {
        cursor.current = undefined; request.current = null; initialized.current = false;
        setState({ key: adapter?.key, prompts: [], hasMore: true, loading: false, error: false });
        return () => { request.current = null; };
    }, [adapter]);
    React.useEffect(() => {
        if (!adapter || !visiblePrompts.length) return;
        setState(previous => previous.key === adapter.key
            ? { ...previous, prompts: mergeSessionPrompts(previous.prompts, visiblePrompts) } : previous);
    }, [adapter, visiblePrompts]);
    const load = React.useCallback(async () => {
        if (!adapter || request.current) return;
        const ticket = {}; request.current = ticket;
        const owns = () => current.current === adapter && request.current === ticket;
        setState(previous => ({ ...previous, loading: true, error: false }));
        try {
            const page = await adapter.readPage(cursor.current, owns);
            if (!owns()) return;
            cursor.current = page.beforeSeq;
            initialized.current = true;
            setState(previous => ({ key: adapter.key, prompts: mergeSessionPrompts(previous.prompts, page.prompts),
                hasMore: page.hasMore, loading: false, error: false }));
        } catch {
            if (owns()) setState(previous => ({ ...previous, loading: false, error: true }));
        } finally { if (owns()) request.current = null; }
    }, [adapter]);
    React.useEffect(() => { if (open && !initialized.current) void load(); }, [open, load]);
    // During a session/account render switch never expose the previous directory.
    const visible = state.key === adapter?.key ? state : { prompts: [], hasMore: true, loading: false, error: false };
    return { ...visible, prompts: React.useMemo(() => visibleSessionPrompts(visible.prompts), [visible.prompts]), load };
}
