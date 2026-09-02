/**
 * Session-local authority binding MCP App operations to the Codex tool call
 * and thread that created them.
 */

import { isDeepStrictEqual } from 'node:util';
import type { McpAppResultV1 } from '@slopus/happy-wire';

export type McpAppBinding = Readonly<{
    callId: string;
    threadId: string;
    server: string;
    resourceUri: string;
    input: Record<string, unknown>;
    result?: McpAppResultV1;
    trustedOriginCallId?: string;
    connectorId?: string;
    appName?: string;
    actionName?: string;
}>;

type StartedMcpAppBinding = Omit<McpAppBinding, 'result' | 'trustedOriginCallId'>;
type TerminalMcpAppCompletion = Readonly<{
    result?: McpAppResultV1;
    succeeded: boolean;
}>;

export class McpAppBindingError extends Error {
    readonly code = 'MCP_APP_ORIGIN_MISMATCH' as const;

    constructor(callId: string) {
        super(`MCP App origin does not match call ${callId}`);
        this.name = 'McpAppBindingError';
    }
}

export class McpAppBindingRegistry {
    private readonly bindings = new Map<string, McpAppBinding>();
    private readonly terminalCompletions = new Map<string, TerminalMcpAppCompletion>();

    bindStarted(binding: StartedMcpAppBinding): void {
        const existing = this.bindings.get(binding.callId);
        if (existing) {
            const { result: _result, trustedOriginCallId: _trustedOriginCallId, ...started } = existing;
            if (!isDeepStrictEqual(started, binding)) {
                throw new McpAppBindingError(binding.callId);
            }
            return;
        }

        if (!binding.resourceUri.startsWith('ui://')) {
            throw new McpAppBindingError(binding.callId);
        }
        this.bindings.set(binding.callId, Object.freeze({ ...binding }));
    }

    complete(callId: string, result: McpAppResultV1 | undefined, succeeded: boolean): void {
        const binding = this.get(callId);
        const completion = Object.freeze({
            succeeded,
            ...(result !== undefined ? { result } : {}),
        });
        const terminalCompletion = this.terminalCompletions.get(callId);
        if (terminalCompletion) {
            if (!isDeepStrictEqual(terminalCompletion, completion)) {
                throw new McpAppBindingError(callId);
            }
            return;
        }

        this.bindings.set(callId, Object.freeze({
            ...binding,
            ...(result !== undefined ? { result } : {}),
            ...(succeeded && binding.connectorId ? { trustedOriginCallId: callId } : {}),
        }));
        this.terminalCompletions.set(callId, completion);
    }

    get(callId: string): McpAppBinding {
        const binding = this.bindings.get(callId);
        if (!binding) {
            throw new McpAppBindingError(callId);
        }
        return binding;
    }

    clear(): void {
        this.bindings.clear();
        this.terminalCompletions.clear();
    }
}
