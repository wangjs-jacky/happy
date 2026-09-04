import { describe, expect, it, vi } from 'vitest';

import {
    serializeSessionStartupTrace,
    traceStartup,
} from './sessionStartupTrace';

describe('session startup trace serialization', () => {
    it('retains only the startup trace allowlist', () => {
        const serialized = serializeSessionStartupTrace({
            traceId: 'trace-1',
            stage: 'web.session.hydrated',
            timestamp: 1_725_000_000_000,
            duration: 321,
            outcome: 'error',
            sessionId: 'session-1',
            machineId: 'machine-1',
            errorCode: 'session-hydration-failed',
            token: 'token-canary',
            secret: 'secret-canary',
            apiKey: 'key-canary',
            ciphertext: 'ciphertext-canary',
            prompt: 'prompt-canary',
            message: 'message-canary',
            directory: '/private/directory-canary',
            dataEncryptionKey: 'encryption-key-canary',
            downloadUrl: 'https://download.invalid/canary',
            uploadUrl: 'https://upload.invalid/canary',
            authorization: 'Bearer authorization-canary',
            infrastructureAddress: 'https://relay.internal.invalid',
            error: 'raw-error-canary',
            stack: 'raw-stack-canary',
            arbitrary: 'arbitrary-canary',
        });

        expect(JSON.parse(serialized)).toEqual({
            traceId: 'trace-1',
            stage: 'web.session.hydrated',
            timestamp: 1_725_000_000_000,
            duration: 321,
            outcome: 'error',
            sessionId: 'session-1',
            machineId: 'machine-1',
            errorCode: 'session-hydration-failed',
        });
        expect(serialized).not.toContain('canary');
    });

    it('logs only the serialized allowlisted object', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        try {
            traceStartup({
                traceId: 'trace-2',
                stage: 'web.spawn.clicked',
                timestamp: 1_725_000_000_100,
                outcome: 'success',
                token: 'token-canary',
            });

            expect(info).toHaveBeenCalledOnce();
            expect(info).toHaveBeenCalledWith(JSON.stringify({
                traceId: 'trace-2',
                stage: 'web.spawn.clicked',
                timestamp: 1_725_000_000_100,
                outcome: 'success',
            }));
        } finally {
            info.mockRestore();
        }
    });
});
