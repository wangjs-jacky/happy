/**
 * Lossless compatibility boundary between Codex MCP tool items and the
 * provider-neutral MCP App fields carried by Session Protocol events.
 */

import { Buffer } from 'node:buffer';
import {
    mcpAppPresentationV1Schema,
    type McpAppPresentationV1,
    type McpAppResultV1,
} from '@slopus/happy-wire';
import type { ThreadItem } from '../codexAppServerTypes';

const MAX_MCP_APP_RESULT_BYTES = 256 * 1024;

export type McpAppErrorCode =
    | 'MCP_APP_UNSUPPORTED'
    | 'MCP_APP_SESSION_OFFLINE'
    | 'MCP_APP_BINDING_NOT_FOUND'
    | 'MCP_APP_ORIGIN_MISMATCH'
    | 'MCP_APP_RESOURCE_NOT_FOUND'
    | 'MCP_APP_INVALID_RESOURCE'
    | 'MCP_APP_RESOURCE_TOO_LARGE'
    | 'MCP_APP_RESULT_TOO_LARGE'
    | 'MCP_APP_TOOL_NOT_ALLOWED'
    | 'MCP_APP_PERMISSION_DENIED'
    | 'MCP_APP_SANDBOX_UNAVAILABLE'
    | 'MCP_APP_BRIDGE_PROTOCOL'
    | 'MCP_APP_TIMEOUT'
    | 'MCP_APP_INTERNAL';

export type McpAppRpcResponse<T> =
    | { ok: true; value: T }
    | { ok: false; error: { code: McpAppErrorCode; retryable: boolean; summary: string } };

const MCP_APP_ERROR_CODES = new Set<McpAppErrorCode>([
    'MCP_APP_UNSUPPORTED', 'MCP_APP_SESSION_OFFLINE', 'MCP_APP_BINDING_NOT_FOUND',
    'MCP_APP_ORIGIN_MISMATCH', 'MCP_APP_RESOURCE_NOT_FOUND', 'MCP_APP_INVALID_RESOURCE',
    'MCP_APP_RESOURCE_TOO_LARGE', 'MCP_APP_RESULT_TOO_LARGE', 'MCP_APP_TOOL_NOT_ALLOWED',
    'MCP_APP_PERMISSION_DENIED', 'MCP_APP_SANDBOX_UNAVAILABLE', 'MCP_APP_BRIDGE_PROTOCOL',
    'MCP_APP_TIMEOUT', 'MCP_APP_INTERNAL',
]);

/** Converts legacy generic-RPC errors to the opaque App-safe envelope. */
export function normalizeMcpAppRpcResponse<T>(response: unknown): McpAppRpcResponse<T> {
    const internal = (): McpAppRpcResponse<T> => ({
        ok: false,
        error: { code: 'MCP_APP_INTERNAL', retryable: false, summary: 'The App request could not be completed.' },
    });
    if (!response || typeof response !== 'object' || Array.isArray(response)) return internal();
    const candidate = response as Record<string, unknown>;
    if (candidate.ok === true && 'value' in candidate) return { ok: true, value: candidate.value as T };
    const error = candidate.error;
    if (candidate.ok !== false || !error || typeof error !== 'object' || Array.isArray(error)) return internal();
    const safeError = error as Record<string, unknown>;
    if (typeof safeError.code !== 'string' || !MCP_APP_ERROR_CODES.has(safeError.code as McpAppErrorCode)
        || typeof safeError.retryable !== 'boolean' || typeof safeError.summary !== 'string') return internal();
    return {
        ok: false,
        error: {
            code: safeError.code as McpAppErrorCode,
            retryable: safeError.retryable,
            summary: safeError.summary,
        },
    };
}

function optionalDisplayName(value: unknown, maxLength: number): string | undefined {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength
        ? value
        : undefined;
}

export interface NormalizedCodexMcpAppCall {
    callId: string;
    server: string;
    tool: string;
    input: Record<string, unknown>;
    connectorId?: string;
    presentation?: McpAppPresentationV1;
    result?: McpAppResultV1;
}

export class CodexMcpAppAdapter {
    normalizeItem(item: Extract<ThreadItem, { type: 'mcpToolCall' }>): NormalizedCodexMcpAppCall {
        const input = item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)
            ? item.arguments as Record<string, unknown>
            : {};
        const normalized: NormalizedCodexMcpAppCall = {
            callId: item.id,
            server: item.server,
            tool: item.tool,
            input,
        };

        const resourceUri = item.appContext?.resourceUri
            ?? item.appContext?.resource_uri
            ?? item.mcpAppResourceUri;
        const appName = optionalDisplayName(item.appContext?.appName, 160);
        const actionName = optionalDisplayName(item.appContext?.actionName, 160);
        const connectorId = typeof item.appContext?.connectorId === 'string'
            && item.appContext.connectorId.length > 0
            ? item.appContext.connectorId
            : undefined;
        const presentationCandidate = {
            version: 1 as const,
            server: item.server,
            resourceUri,
            ...(appName ? { appName } : {}),
            ...(actionName ? { actionName } : {}),
        };
        const parsedPresentation = mcpAppPresentationV1Schema.safeParse(presentationCandidate);
        if (!parsedPresentation.success) {
            return normalized;
        }

        if (connectorId) {
            normalized.connectorId = connectorId;
        }
        normalized.presentation = parsedPresentation.data;
        const rawResult = item.result;
        if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
            return normalized;
        }

        const candidate: McpAppResultV1 = {
            version: 1,
            state: 'available',
            content: Array.isArray(rawResult.content) ? rawResult.content : [],
            ...(rawResult.structuredContent !== undefined
                ? { structuredContent: rawResult.structuredContent }
                : {}),
            ...(rawResult._meta !== undefined ? { _meta: rawResult._meta } : {}),
        };
        const serializedCandidate = JSON.stringify(candidate);
        normalized.result = Buffer.byteLength(serializedCandidate, 'utf8') > MAX_MCP_APP_RESULT_BYTES
            ? { version: 1, state: 'unavailable', code: 'MCP_APP_RESULT_TOO_LARGE' }
            : candidate;

        return normalized;
    }
}
