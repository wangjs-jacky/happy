import { describe, expect, it } from 'vitest';
import { resolveNewSessionModeSelection } from './newSessionModeSelection';

describe('resolveNewSessionModeSelection', () => {
    it('resolves raw draft default sentinels to code defaults', () => {
        expect(resolveNewSessionModeSelection({
            agent: 'claude',
            permissionMode: 'default',
            modelMode: 'default',
            effortLevel: null,
            agentDefaultOverrides: {},
        })).toEqual({
            permissionMode: 'bypassPermissions',
            modelMode: 'opus',
            effortLevel: 'medium',
        });
    });

    it('uses agent default overrides instead of raw draft default sentinels', () => {
        expect(resolveNewSessionModeSelection({
            agent: 'codex',
            permissionMode: 'default',
            modelMode: 'default',
            effortLevel: null,
            agentDefaultOverrides: {
                codex: {
                    permissionMode: 'safe-yolo',
                    modelMode: 'gpt-5.4',
                    effortLevel: 'xhigh',
                },
            },
        })).toEqual({
            permissionMode: 'safe-yolo',
            modelMode: 'gpt-5.4',
            effortLevel: 'xhigh',
        });
    });

    it('prefers an override over stale stored code defaults', () => {
        expect(resolveNewSessionModeSelection({
            agent: 'claude',
            permissionMode: 'bypassPermissions',
            modelMode: 'opus',
            effortLevel: 'medium',
            agentDefaultOverrides: {
                claude: {
                    permissionMode: 'plan',
                    modelMode: 'sonnet',
                    effortLevel: 'xhigh',
                },
            },
        })).toEqual({
            permissionMode: 'plan',
            modelMode: 'sonnet',
            effortLevel: 'xhigh',
        });
    });

    it('keeps explicit non-default draft picks', () => {
        expect(resolveNewSessionModeSelection({
            agent: 'codex',
            permissionMode: 'read-only',
            modelMode: 'gpt-5.5',
            effortLevel: 'high',
            agentDefaultOverrides: {
                codex: {
                    permissionMode: 'yolo',
                    modelMode: 'gpt-5.4',
                    effortLevel: 'xhigh',
                },
            },
        })).toEqual({
            permissionMode: 'read-only',
            modelMode: 'gpt-5.5',
            effortLevel: 'high',
        });
    });
});
