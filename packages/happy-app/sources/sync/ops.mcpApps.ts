import { McpAppHostError, type McpAppErrorCode } from '@/components/tools/mcpApps/types';
import type { RpcCallOptions } from './apiSocket';

export const MCP_APP_RESOURCE_START_TIMEOUT_MS = 30_000;
export const MCP_APP_CHUNK_INACTIVITY_TIMEOUT_MS = 15_000;
export const MCP_APP_INTERACTIVE_TIMEOUT_MS = 30_000;

export type McpAppResourceOpenRequest = {
    callId: string;
};

export type McpAppResourceOpenResponse = {
    resourceId: string;
    uri: string;
    mimeType: 'text/html;profile=mcp-app';
    byteLength: number;
    sha256: string;
    encoding: 'utf8';
    ui?: {
        csp?: unknown;
        permissions?: unknown;
        prefersBorder?: boolean;
    };
};

export type McpAppResourceChunkRequest = {
    resourceId: string;
    offset: number;
};

export type McpAppResourceChunkResponse = {
    offset: number;
    dataBase64: string;
    nextOffset?: number;
};

export type McpAppResourceReadRequest = {
    callId: string;
    uri: string;
};

export type McpAppResourceReadResponse = {
    contents: unknown[];
    _meta?: unknown;
};

export type McpAppToolCallRequest = {
    callId: string;
    tool: string;
    arguments?: Record<string, unknown>;
    _meta?: unknown;
};

export type McpAppToolCallResponse = {
    content: unknown[];
    structuredContent?: unknown;
    _meta?: unknown;
    isError?: boolean;
};

export type McpAppRpcResponse<T> =
    | { ok: true; value: T }
    | { ok: false; error: { code: McpAppErrorCode; retryable: boolean; summary: string } };

export type McpAppSessionRpc = (
    sessionId: string,
    method: string,
    params: unknown,
    options?: RpcCallOptions,
) => Promise<unknown>;

export interface McpAppResourceRpcClient {
    openResource(
        sessionId: string,
        input: McpAppResourceOpenRequest,
        signal?: AbortSignal,
    ): Promise<McpAppResourceOpenResponse>;
    readResourceChunk(
        sessionId: string,
        input: McpAppResourceChunkRequest,
        signal?: AbortSignal,
    ): Promise<McpAppResourceChunkResponse>;
    readSecondaryResource(
        sessionId: string,
        input: McpAppResourceReadRequest,
        signal?: AbortSignal,
    ): Promise<McpAppResourceReadResponse>;
    callTool(
        sessionId: string,
        input: McpAppToolCallRequest,
        signal?: AbortSignal,
    ): Promise<McpAppToolCallResponse>;
}

const ERROR_CODES = new Set<McpAppErrorCode>([
    'MCP_APP_UNSUPPORTED',
    'MCP_APP_SESSION_OFFLINE',
    'MCP_APP_BINDING_NOT_FOUND',
    'MCP_APP_ORIGIN_MISMATCH',
    'MCP_APP_RESOURCE_NOT_FOUND',
    'MCP_APP_INVALID_RESOURCE',
    'MCP_APP_RESOURCE_TOO_LARGE',
    'MCP_APP_RESULT_TOO_LARGE',
    'MCP_APP_TOOL_NOT_ALLOWED',
    'MCP_APP_PERMISSION_DENIED',
    'MCP_APP_SANDBOX_UNAVAILABLE',
    'MCP_APP_BRIDGE_PROTOCOL',
    'MCP_APP_TIMEOUT',
    'MCP_APP_INTERNAL',
]);

function internalError(): McpAppHostError {
    return new McpAppHostError(
        'MCP_APP_INTERNAL',
        false,
        'The App request could not be completed.',
    );
}

function normalizeResponse<T>(response: unknown): T {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
        throw internalError();
    }
    const envelope = response as Record<string, unknown>;
    if (envelope.ok === true && 'value' in envelope) {
        return envelope.value as T;
    }
    if (envelope.ok !== false || !envelope.error || typeof envelope.error !== 'object'
        || Array.isArray(envelope.error)) {
        throw internalError();
    }
    const error = envelope.error as Record<string, unknown>;
    if (typeof error.code !== 'string' || !ERROR_CODES.has(error.code as McpAppErrorCode)
        || typeof error.retryable !== 'boolean' || typeof error.summary !== 'string') {
        throw internalError();
    }
    throw new McpAppHostError(
        error.code as McpAppErrorCode,
        error.retryable,
        error.summary,
    );
}

function isTimeout(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return error.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(error.message);
}

function cancellationError(): McpAppHostError {
    return new McpAppHostError(
        'MCP_APP_SESSION_OFFLINE',
        true,
        'The session is no longer available.',
    );
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) throw cancellationError();
    let removeAbortListener = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(cancellationError());
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    });
    try {
        return await Promise.race([promise, aborted]);
    } finally {
        removeAbortListener();
    }
}

export function createMcpAppResourceRpcClient(sessionRPC: McpAppSessionRpc): McpAppResourceRpcClient {
    const request = async <T>(
        sessionId: string,
        method: string,
        params: unknown,
        timeoutMs: number,
        signal?: AbortSignal,
    ): Promise<T> => {
        try {
            const response = await abortable(
                sessionRPC(sessionId, method, params, { timeoutMs }),
                signal,
            );
            return normalizeResponse<T>(response);
        } catch (error) {
            if (error instanceof McpAppHostError) throw error;
            if (signal?.aborted) throw cancellationError();
            if (isTimeout(error)) {
                throw new McpAppHostError('MCP_APP_TIMEOUT', true, 'The App request timed out.');
            }
            throw internalError();
        }
    };

    return {
        openResource: (sessionId, input, signal) => request<McpAppResourceOpenResponse>(
            sessionId,
            'mcpAppResourceOpen',
            input,
            MCP_APP_RESOURCE_START_TIMEOUT_MS,
            signal,
        ),
        readResourceChunk: (sessionId, input, signal) => request<McpAppResourceChunkResponse>(
            sessionId,
            'mcpAppResourceChunk',
            input,
            MCP_APP_CHUNK_INACTIVITY_TIMEOUT_MS,
            signal,
        ),
        readSecondaryResource: (sessionId, input, signal) => request<McpAppResourceReadResponse>(
            sessionId,
            'mcpAppResourceRead',
            input,
            MCP_APP_INTERACTIVE_TIMEOUT_MS,
            signal,
        ),
        callTool: (sessionId, input, signal) => request<McpAppToolCallResponse>(
            sessionId,
            'mcpAppToolCall',
            input,
            MCP_APP_INTERACTIVE_TIMEOUT_MS,
            signal,
        ),
    };
}

export const mcpAppResourceRpcClient = createMcpAppResourceRpcClient(
    async (sessionId, method, params, options) => {
        const { apiSocket } = await import('./apiSocket');
        return apiSocket.sessionRPC(sessionId, method, params, options);
    },
);
