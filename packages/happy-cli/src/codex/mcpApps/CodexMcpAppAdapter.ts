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
