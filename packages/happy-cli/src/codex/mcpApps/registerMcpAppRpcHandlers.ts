import { createHash, randomBytes } from 'node:crypto';
import { logger } from '@/ui/logger';
import type { McpResourceReadParams, McpResourceReadResponse } from '../codexAppServerTypes';
import type { McpAppErrorCode, McpAppRpcResponse } from './CodexMcpAppAdapter';
import type { McpAppBindingRegistry } from './McpAppBindingRegistry';

export const MCP_APP_MAX_HTML_BYTES = 5 * 1024 * 1024;
export const MCP_APP_CHUNK_BYTES = 256 * 1024;
export const MCP_APP_MAX_ACTIVE_RESOURCES = 8;
export const MCP_APP_RESOURCE_TTL_MS = 2 * 60 * 1000;

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

export type { McpAppRpcResponse } from './CodexMcpAppAdapter';

type BufferedResource = {
    resourceId: string;
    callId: string;
    bytes: Uint8Array;
    sha256: string;
    expiresAt: number;
};

export type McpAppRpcHandlerManager = {
    registerHandler(method: string, handler: (request: any) => any): void;
    unregisterHandler(method: string): void;
};

type McpResourceClient = {
    readMcpResource(
        params: McpResourceReadParams,
        options?: { signal?: AbortSignal },
    ): Promise<McpResourceReadResponse>;
};

const summaries: Record<McpAppErrorCode, string> = {
    MCP_APP_UNSUPPORTED: 'This App is not supported.',
    MCP_APP_SESSION_OFFLINE: 'The session is no longer available.',
    MCP_APP_BINDING_NOT_FOUND: 'This App resource is no longer available.',
    MCP_APP_ORIGIN_MISMATCH: 'Waiting for the trusted App origin.',
    MCP_APP_RESOURCE_NOT_FOUND: 'The App resource was not found.',
    MCP_APP_INVALID_RESOURCE: 'The App resource is invalid.',
    MCP_APP_RESOURCE_TOO_LARGE: 'The App resource is too large.',
    MCP_APP_RESULT_TOO_LARGE: 'The App result is too large.',
    MCP_APP_TOOL_NOT_ALLOWED: 'This App action is not allowed.',
    MCP_APP_PERMISSION_DENIED: 'Permission was denied.',
    MCP_APP_SANDBOX_UNAVAILABLE: 'The App sandbox is unavailable.',
    MCP_APP_BRIDGE_PROTOCOL: 'The App bridge protocol failed.',
    MCP_APP_TIMEOUT: 'The App request timed out.',
    MCP_APP_INTERNAL: 'The App resource could not be loaded.',
};

function failure<T>(code: McpAppErrorCode, retryable: boolean): McpAppRpcResponse<T> {
    logger.debug(`[McpAppRpc] ${code}`);
    return { ok: false, error: { code, retryable, summary: summaries[code] } };
}

function validOpenRequest(request: unknown): request is McpAppResourceOpenRequest {
    const candidate = request && typeof request === 'object'
        ? request as Record<string, unknown>
        : undefined;
    return typeof candidate?.callId === 'string' && candidate.callId.length > 0;
}

function validChunkRequest(request: unknown): request is McpAppResourceChunkRequest {
    const candidate = request && typeof request === 'object'
        ? request as Record<string, unknown>
        : undefined;
    return typeof candidate?.resourceId === 'string' && candidate.resourceId.length > 0
        && Number.isInteger(candidate.offset) && (candidate.offset as number) >= 0;
}

function primaryResourceBytes(
    response: unknown,
    expectedUri: string,
): Uint8Array | null {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
        return null;
    }
    const typedResponse = response as McpResourceReadResponse;
    if (!Array.isArray(typedResponse.contents) || typedResponse.contents.length !== 1) {
        return null;
    }
    const content = typedResponse.contents[0];
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
        return null;
    }
    if (content.uri !== expectedUri || content.mimeType !== 'text/html;profile=mcp-app') {
        return null;
    }
    if (typeof content.text === 'string' && content.blob === undefined) {
        return Buffer.from(content.text, 'utf8');
    }
    if (typeof content.blob === 'string' && content.text === undefined) {
        const bytes = Buffer.from(content.blob, 'base64');
        return bytes.byteLength > 0 || content.blob.length === 0 ? bytes : null;
    }
    return null;
}

export function registerMcpAppRpcHandlers(options: {
    rpcHandlerManager: McpAppRpcHandlerManager;
    client: McpResourceClient;
    bindingRegistry: McpAppBindingRegistry;
    now?: () => number;
}) {
    const now = options.now ?? (() => Date.now());
    const resources = new Map<string, BufferedResource>();
    const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const inFlightReads = new Set<AbortController>();
    let rpcHandlerManager = options.rpcHandlerManager;
    let disposed = false;

    const removeResource = (resourceId: string): void => {
        const timer = expiryTimers.get(resourceId);
        if (timer) clearTimeout(timer);
        expiryTimers.delete(resourceId);
        resources.delete(resourceId);
    };
    const scheduleExpiry = (resource: BufferedResource): void => {
        const previous = expiryTimers.get(resource.resourceId);
        if (previous) clearTimeout(previous);
        const timer = setTimeout(() => {
            const current = resources.get(resource.resourceId);
            if (!current) return;
            if (current.expiresAt <= now()) {
                removeResource(current.resourceId);
                return;
            }
            scheduleExpiry(current);
        }, Math.max(0, resource.expiresAt - now()));
        timer.unref?.();
        expiryTimers.set(resource.resourceId, timer);
    };
    const clearBufferedResources = (): void => {
        for (const resourceId of [...resources.keys()]) removeResource(resourceId);
    };
    const abortInFlightReads = (): void => {
        for (const controller of inFlightReads) controller.abort();
        inFlightReads.clear();
    };

    const resourceOpen = async (request: unknown): Promise<McpAppRpcResponse<McpAppResourceOpenResponse>> => {
        try {
            if (disposed) return failure('MCP_APP_SESSION_OFFLINE', true);
            if (!validOpenRequest(request)) return failure('MCP_APP_BINDING_NOT_FOUND', false);
            if (!options.bindingRegistry.has(request.callId)) return failure('MCP_APP_BINDING_NOT_FOUND', false);

        const binding = options.bindingRegistry.get(request.callId);
        if (binding.connectorId && !binding.trustedOriginCallId) {
            return failure('MCP_APP_ORIGIN_MISMATCH', true);
        }

        const params: McpResourceReadParams = {
            threadId: binding.threadId,
            server: binding.server,
            uri: binding.resourceUri,
            ...(binding.trustedOriginCallId ? { originCallId: request.callId } : {}),
        };

        const abortController = new AbortController();
        inFlightReads.add(abortController);
        let response: McpResourceReadResponse;
        try {
            response = await options.client.readMcpResource(params, { signal: abortController.signal });
        } catch {
            return failure(disposed ? 'MCP_APP_SESSION_OFFLINE' : 'MCP_APP_INTERNAL', true);
        } finally {
            inFlightReads.delete(abortController);
        }
        if (disposed) return failure('MCP_APP_SESSION_OFFLINE', true);

        const bytes = primaryResourceBytes(response, binding.resourceUri);
        if (!bytes) return failure('MCP_APP_INVALID_RESOURCE', false);
        if (bytes.byteLength > MCP_APP_MAX_HTML_BYTES) {
            return failure('MCP_APP_RESOURCE_TOO_LARGE', false);
        }

        while (resources.size >= MCP_APP_MAX_ACTIVE_RESOURCES) {
            const oldestResourceId = resources.keys().next().value as string | undefined;
            if (!oldestResourceId) break;
            removeResource(oldestResourceId);
        }
        const resourceId = randomBytes(32).toString('base64url');
        const buffered: BufferedResource = {
            resourceId,
            callId: request.callId,
            bytes,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            expiresAt: now() + MCP_APP_RESOURCE_TTL_MS,
        };
        resources.set(resourceId, buffered);
        scheduleExpiry(buffered);

        return {
            ok: true,
            value: {
                resourceId,
                uri: binding.resourceUri,
                mimeType: 'text/html;profile=mcp-app',
                byteLength: bytes.byteLength,
                sha256: buffered.sha256,
                encoding: 'utf8',
            },
        };
        } catch {
            return failure('MCP_APP_INTERNAL', true);
        }
    };

    const resourceChunk = async (request: unknown): Promise<McpAppRpcResponse<McpAppResourceChunkResponse>> => {
        try {
            if (disposed) return failure('MCP_APP_SESSION_OFFLINE', true);
            if (!validChunkRequest(request)) return failure('MCP_APP_RESOURCE_NOT_FOUND', false);
        const resource = resources.get(request.resourceId);
        if (!resource || resource.expiresAt <= now() || !options.bindingRegistry.has(resource.callId)) {
            if (resource) removeResource(resource.resourceId);
            return failure('MCP_APP_RESOURCE_NOT_FOUND', false);
        }
        if (request.offset >= resource.bytes.byteLength) {
            return failure('MCP_APP_INVALID_RESOURCE', false);
        }

        resource.expiresAt = now() + MCP_APP_RESOURCE_TTL_MS;
        scheduleExpiry(resource);
        const bytes = resource.bytes.subarray(request.offset, request.offset + MCP_APP_CHUNK_BYTES);
        const nextOffset = request.offset + bytes.byteLength;
        return {
            ok: true,
            value: {
                offset: request.offset,
                dataBase64: Buffer.from(bytes).toString('base64'),
                ...(nextOffset < resource.bytes.byteLength ? { nextOffset } : {}),
            },
        };
        } catch {
            return failure('MCP_APP_INTERNAL', true);
        }
    };

    const register = (manager: McpAppRpcHandlerManager): void => {
        manager.registerHandler('mcpAppResourceOpen', resourceOpen);
        manager.registerHandler('mcpAppResourceChunk', resourceChunk);
    };
    const unregister = (manager: McpAppRpcHandlerManager): void => {
        manager.unregisterHandler('mcpAppResourceOpen');
        manager.unregisterHandler('mcpAppResourceChunk');
    };
    register(rpcHandlerManager);

    return {
        resourceOpen,
        resourceChunk,
        rebind(nextRpcHandlerManager: McpAppRpcHandlerManager): void {
            if (disposed || nextRpcHandlerManager === rpcHandlerManager) return;
            unregister(rpcHandlerManager);
            abortInFlightReads();
            clearBufferedResources();
            rpcHandlerManager = nextRpcHandlerManager;
            register(rpcHandlerManager);
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            abortInFlightReads();
            clearBufferedResources();
            unregister(rpcHandlerManager);
        },
    };
}
