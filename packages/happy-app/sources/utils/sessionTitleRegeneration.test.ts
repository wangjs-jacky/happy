import { describe, expect, it } from 'vitest';
import type { Metadata, Session } from '@/sync/storageTypes';
import { canRegenerateSessionTitle } from './sessionTitleRegeneration';

function session(metadata: Partial<Metadata> | null, presence: Session['presence'] = 'online'): Session {
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: presence === 'online',
        activeAt: 1,
        metadata: metadata ? {
            path: '/repo',
            host: 'mac',
            ...metadata,
        } : null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        presence,
    };
}

describe('canRegenerateSessionTitle', () => {
    it('uses the explicit regenerate title capability when present', () => {
        expect(canRegenerateSessionTitle(session({
            flavor: 'claude',
            capabilities: { regenerateTitle: true },
        }))).toBe(true);
    });

    it('allows legacy Claude sessions that predate the capability flag', () => {
        expect(canRegenerateSessionTitle(session({
            claudeSessionId: 'claude-session-1',
        }))).toBe(true);
    });

    it('allows legacy Codex sessions that predate the capability flag', () => {
        expect(canRegenerateSessionTitle(session({
            flavor: 'codex',
            codexThreadId: 'codex-thread-1',
        }))).toBe(true);
    });

    it('does not infer support for unsupported providers or disconnected sessions', () => {
        expect(canRegenerateSessionTitle(session({
            flavor: 'gemini',
            capabilities: { regenerateTitle: false },
        }))).toBe(false);
        expect(canRegenerateSessionTitle(session({
            flavor: 'claude',
            capabilities: { regenerateTitle: true },
        }, 123))).toBe(false);
    });
});
