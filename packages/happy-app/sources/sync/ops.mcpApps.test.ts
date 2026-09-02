import { describe, expect, it } from 'vitest';
import {
    MCP_APP_CHUNK_INACTIVITY_TIMEOUT_MS,
    MCP_APP_RESOURCE_START_TIMEOUT_MS,
    createMcpAppResourceRpcClient,
} from './ops.mcpApps';

describe('MCP App RPC operations', () => {
    it('uses the typed resource methods and approved timeout budgets', async () => {
        const calls: Array<{ sessionId: string; method: string; params: unknown; timeoutMs?: number }> = [];
        const client = createMcpAppResourceRpcClient(async (sessionId, method, params, options) => {
            calls.push({ sessionId, method, params, timeoutMs: options?.timeoutMs });
            if (method === 'mcpAppResourceOpen') {
                return {
                    ok: true,
                    value: {
                        resourceId: 'resource-1',
                        uri: 'ui://demo/index.html',
                        mimeType: 'text/html;profile=mcp-app',
                        byteLength: 1,
                        sha256: 'a'.repeat(64),
                        encoding: 'utf8',
                    },
                };
            }
            return { ok: true, value: { offset: 0, dataBase64: 'eA==' } };
        });

        await client.openResource('session-1', { callId: 'call-1' });
        await client.readResourceChunk('session-1', { resourceId: 'resource-1', offset: 0 });

        expect(calls).toEqual([
            {
                sessionId: 'session-1',
                method: 'mcpAppResourceOpen',
                params: { callId: 'call-1' },
                timeoutMs: MCP_APP_RESOURCE_START_TIMEOUT_MS,
            },
            {
                sessionId: 'session-1',
                method: 'mcpAppResourceChunk',
                params: { resourceId: 'resource-1', offset: 0 },
                timeoutMs: MCP_APP_CHUNK_INACTIVITY_TIMEOUT_MS,
            },
        ]);
        expect(MCP_APP_RESOURCE_START_TIMEOUT_MS).toBe(30_000);
        expect(MCP_APP_CHUNK_INACTIVITY_TIMEOUT_MS).toBe(15_000);
    });

    it('maps transport timeouts to a safe retryable timeout error', async () => {
        const client = createMcpAppResourceRpcClient(async () => {
            const error = new Error('private socket details');
            error.name = 'TimeoutError';
            throw error;
        });

        await expect(client.openResource('session-1', { callId: 'call-1' })).rejects.toMatchObject({
            code: 'MCP_APP_TIMEOUT',
            retryable: true,
            summary: 'The App request timed out.',
        });
    });

    it('rejects legacy and malformed envelopes without exposing their details', async () => {
        const client = createMcpAppResourceRpcClient(async () => ({ error: 'SECRET raw exception' }));

        await expect(client.openResource('session-1', { callId: 'call-1' })).rejects.toMatchObject({
            code: 'MCP_APP_INTERNAL',
            retryable: false,
            summary: 'The App request could not be completed.',
        });
    });

    it('cancels a pending call and ignores its later transport completion', async () => {
        let settle!: (value: unknown) => void;
        const transport = new Promise<unknown>((resolve) => {
            settle = resolve;
        });
        const client = createMcpAppResourceRpcClient(async () => transport);
        const controller = new AbortController();
        const pending = client.openResource('session-1', { callId: 'call-1' }, controller.signal);

        controller.abort();

        await expect(pending).rejects.toMatchObject({
            code: 'MCP_APP_SESSION_OFFLINE',
            retryable: true,
        });
        settle({ ok: false, error: { code: 'MCP_APP_INTERNAL', retryable: false, summary: 'late' } });
        await Promise.resolve();
    });
});
