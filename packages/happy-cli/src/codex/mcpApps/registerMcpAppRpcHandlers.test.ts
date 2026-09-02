import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { McpAppBindingRegistry } from './McpAppBindingRegistry';
import {
    MCP_APP_CHUNK_BYTES,
    MCP_APP_MAX_ACTIVE_RESOURCES,
    MCP_APP_MAX_HTML_BYTES,
    MCP_APP_RESOURCE_TTL_MS,
    registerMcpAppRpcHandlers,
    type McpAppResourceChunkResponse,
    type McpAppResourceOpenResponse,
    type McpAppRpcResponse,
} from './registerMcpAppRpcHandlers';

type Handler = (request: unknown) => Promise<unknown>;

function createHarness(options?: {
    now?: () => number;
    readMcpResource?: ReturnType<typeof vi.fn>;
}) {
    const handlers = new Map<string, Handler>();
    const registry = new McpAppBindingRegistry();
    const client = {
        readMcpResource: options?.readMcpResource ?? vi.fn(async () => ({
            contents: [{
                uri: 'ui://demo/index.html',
                mimeType: 'text/html;profile=mcp-app',
                text: '<main>App</main>',
            }],
        })),
    };
    const registration = registerMcpAppRpcHandlers({
        rpcHandlerManager: {
            registerHandler(method: string, handler: Handler) {
                handlers.set(method, handler);
            },
            unregisterHandler(method: string) {
                handlers.delete(method);
            },
        },
        client,
        bindingRegistry: registry,
        now: options?.now,
    });

    return { client, handlers, registration, registry };
}

function bind(registry: McpAppBindingRegistry, options?: { connectorId?: string; callId?: string }) {
    const callId = options?.callId ?? 'call-1';
    registry.bindStarted({
        callId,
        threadId: 'thread-1',
        server: 'demo',
        resourceUri: 'ui://demo/index.html',
        input: {},
        ...(options?.connectorId ? { connectorId: options.connectorId } : {}),
    });
    return callId;
}

async function open(
    handler: Handler,
    callId = 'call-1',
): Promise<McpAppRpcResponse<McpAppResourceOpenResponse>> {
    return await handler({ callId }) as McpAppRpcResponse<McpAppResourceOpenResponse>;
}

async function chunk(
    handler: Handler,
    resourceId: string,
    offset: number,
): Promise<McpAppRpcResponse<McpAppResourceChunkResponse>> {
    return await handler({ resourceId, offset }) as McpAppRpcResponse<McpAppResourceChunkResponse>;
}

function opened(response: McpAppRpcResponse<McpAppResourceOpenResponse>): McpAppResourceOpenResponse {
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.code);
    return response.value;
}

describe('registerMcpAppRpcHandlers', () => {
    it('returns a safe not-found envelope for an unknown binding', async () => {
        const { handlers } = createHarness();

        await expect(open(handlers.get('mcpAppResourceOpen')!, 'missing')).resolves.toEqual({
            ok: false,
            error: expect.objectContaining({
                code: 'MCP_APP_BINDING_NOT_FOUND',
                retryable: false,
            }),
        });
    });

    it('waits for a connector origin instead of reading an untrusted App resource', async () => {
        const { client, handlers, registry } = createHarness();
        bind(registry, { connectorId: 'connector-1' });

        await expect(open(handlers.get('mcpAppResourceOpen')!)).resolves.toEqual({
            ok: false,
            error: expect.objectContaining({
                code: 'MCP_APP_ORIGIN_MISMATCH',
                retryable: true,
            }),
        });
        expect(client.readMcpResource).not.toHaveBeenCalled();
    });

    it('reads a trusted App primary resource exactly once with its origin call ID', async () => {
        const { client, handlers, registry } = createHarness();
        bind(registry, { connectorId: 'connector-1' });
        registry.complete('call-1', undefined, true);

        await expect(open(handlers.get('mcpAppResourceOpen')!)).resolves.toMatchObject({ ok: true });
        expect(client.readMcpResource.mock.calls[0][0]).toEqual({
            threadId: 'thread-1',
            server: 'demo',
            uri: 'ui://demo/index.html',
            originCallId: 'call-1',
        });
        expect(client.readMcpResource).toHaveBeenCalledTimes(1);
    });

    it('reads an ordinary configured server resource only in its binding thread', async () => {
        const { client, handlers, registry } = createHarness();
        bind(registry);

        await expect(open(handlers.get('mcpAppResourceOpen')!)).resolves.toMatchObject({ ok: true });
        expect(client.readMcpResource.mock.calls[0][0]).toEqual({
            threadId: 'thread-1',
            server: 'demo',
            uri: 'ui://demo/index.html',
        });
    });

    it.each([
        ['URI', { uri: 'ui://demo/other.html', mimeType: 'text/html;profile=mcp-app', text: '<main>App</main>' }],
        ['MIME', { uri: 'ui://demo/index.html', mimeType: 'text/html', text: '<main>App</main>' }],
    ])('rejects a primary resource with a mismatched %s', async (_kind, content) => {
        const readMcpResource = vi.fn(async () => ({ contents: [content] }));
        const { handlers, registry } = createHarness({ readMcpResource });
        bind(registry);

        await expect(open(handlers.get('mcpAppResourceOpen')!)).resolves.toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'MCP_APP_INVALID_RESOURCE' }),
        });
    });

    it('rejects HTML over the five MiB decoded limit before buffering it', async () => {
        const readMcpResource = vi.fn(async () => ({
            contents: [{
                uri: 'ui://demo/index.html',
                mimeType: 'text/html;profile=mcp-app',
                text: 'x'.repeat(MCP_APP_MAX_HTML_BYTES + 1),
            }],
        }));
        const { handlers, registry } = createHarness({ readMcpResource });
        bind(registry);

        await expect(open(handlers.get('mcpAppResourceOpen')!)).resolves.toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'MCP_APP_RESOURCE_TOO_LARGE' }),
        });
    });

    it('converts malformed Codex resource responses into a safe invalid-resource envelope', async () => {
        const readMcpResource = vi.fn(async () => null) as any;
        const { handlers, registry } = createHarness({ readMcpResource });
        bind(registry);

        await expect(open(handlers.get('mcpAppResourceOpen')!)).resolves.toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'MCP_APP_INVALID_RESOURCE', retryable: false }),
        });
    });

    it('returns fixed-size contiguous chunks with the verified hash metadata', async () => {
        const html = 'x'.repeat(MCP_APP_CHUNK_BYTES + 13);
        const readMcpResource = vi.fn(async () => ({
            contents: [{
                uri: 'ui://demo/index.html',
                mimeType: 'text/html;profile=mcp-app',
                text: html,
            }],
        }));
        const { handlers, registry } = createHarness({ readMcpResource });
        bind(registry);
        const resource = opened(await open(handlers.get('mcpAppResourceOpen')!));
        const chunkHandler = handlers.get('mcpAppResourceChunk')!;

        const first = await chunk(chunkHandler, resource.resourceId, 0);
        expect(first).toMatchObject({ ok: true, value: { offset: 0, nextOffset: MCP_APP_CHUNK_BYTES } });
        if (!first.ok) throw new Error(first.error.code);
        expect(Buffer.from(first.value.dataBase64, 'base64')).toHaveLength(MCP_APP_CHUNK_BYTES);

        const second = await chunk(chunkHandler, resource.resourceId, first.value.nextOffset!);
        expect(second).toMatchObject({ ok: true, value: { offset: MCP_APP_CHUNK_BYTES } });
        if (!second.ok) throw new Error(second.error.code);
        expect(second.value.nextOffset).toBeUndefined();
        expect(Buffer.from(second.value.dataBase64, 'base64').toString('utf8')).toBe('x'.repeat(13));
        expect(resource.sha256).toBe(createHash('sha256').update(html, 'utf8').digest('hex'));
    });

    it('issues distinct unguessable resource capabilities', async () => {
        const { handlers, registry } = createHarness();
        bind(registry, { callId: 'call-1' });
        bind(registry, { callId: 'call-2' });
        const openHandler = handlers.get('mcpAppResourceOpen')!;

        const first = opened(await open(openHandler, 'call-1'));
        const second = opened(await open(openHandler, 'call-2'));

        expect(first.resourceId).not.toBe(second.resourceId);
        expect(first.resourceId).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    });

    it('evicts the oldest buffered resource after eight active capabilities', async () => {
        const { handlers, registry } = createHarness();
        const openHandler = handlers.get('mcpAppResourceOpen')!;
        for (let index = 0; index <= MCP_APP_MAX_ACTIVE_RESOURCES; index++) {
            bind(registry, { callId: `call-${index}` });
        }
        const resources: McpAppResourceOpenResponse[] = [];
        for (let index = 0; index <= MCP_APP_MAX_ACTIVE_RESOURCES; index++) {
            resources.push(opened(await open(openHandler, `call-${index}`)));
        }

        await expect(chunk(handlers.get('mcpAppResourceChunk')!, resources[0].resourceId, 0)).resolves.toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'MCP_APP_RESOURCE_NOT_FOUND' }),
        });
    });

    it('expires a resource two minutes after its last access', async () => {
        let now = 100;
        const { handlers, registry } = createHarness({ now: () => now });
        bind(registry);
        const resource = opened(await open(handlers.get('mcpAppResourceOpen')!));
        await chunk(handlers.get('mcpAppResourceChunk')!, resource.resourceId, 0);
        now += MCP_APP_RESOURCE_TTL_MS - 1;
        await expect(chunk(handlers.get('mcpAppResourceChunk')!, resource.resourceId, 0)).resolves.toMatchObject({ ok: true });
        now += MCP_APP_RESOURCE_TTL_MS + 1;

        await expect(chunk(handlers.get('mcpAppResourceChunk')!, resource.resourceId, 0)).resolves.toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'MCP_APP_RESOURCE_NOT_FOUND' }),
        });
    });

    it('destroys an unopened resource at the two-minute expiry boundary', async () => {
        vi.useFakeTimers();
        try {
            const { handlers, registry } = createHarness();
            bind(registry);
            const resource = opened(await open(handlers.get('mcpAppResourceOpen')!));

            await vi.advanceTimersByTimeAsync(MCP_APP_RESOURCE_TTL_MS);

            await expect(chunk(handlers.get('mcpAppResourceChunk')!, resource.resourceId, 0)).resolves.toEqual({
                ok: false,
                error: expect.objectContaining({ code: 'MCP_APP_RESOURCE_NOT_FOUND' }),
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['expired', 'missing binding'] as const)(
        'clears the scheduled expiry timer when chunk access finds a %s resource',
        async (state) => {
            vi.useFakeTimers();
            try {
                let now = 100;
                const { handlers, registry } = createHarness({ now: () => now });
                bind(registry);
                const resource = opened(await open(handlers.get('mcpAppResourceOpen')!));
                expect(vi.getTimerCount()).toBe(1);

                if (state === 'expired') {
                    now += MCP_APP_RESOURCE_TTL_MS;
                } else {
                    registry.clear();
                }
                await chunk(handlers.get('mcpAppResourceChunk')!, resource.resourceId, 0);

                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        },
    );

    it('moves registered RPC methods to a replacement session manager', async () => {
        const { handlers, registration, registry } = createHarness();
        const replacementHandlers = new Map<string, Handler>();
        bind(registry);

        registration.rebind({
            registerHandler(method: string, handler: Handler) {
                replacementHandlers.set(method, handler);
            },
            unregisterHandler(method: string) {
                replacementHandlers.delete(method);
            },
        });

        expect(handlers.has('mcpAppResourceOpen')).toBe(false);
        expect(handlers.has('mcpAppResourceChunk')).toBe(false);
        await expect(open(replacementHandlers.get('mcpAppResourceOpen')!)).resolves.toMatchObject({ ok: true });
    });

    it('unregisters and clears capabilities on session cleanup', async () => {
        const { handlers, registration, registry } = createHarness();
        bind(registry);
        const resource = opened(await open(handlers.get('mcpAppResourceOpen')!));

        registration.dispose();

        expect(handlers.has('mcpAppResourceOpen')).toBe(false);
        expect(handlers.has('mcpAppResourceChunk')).toBe(false);
        await expect(chunk(async (request) => registration.resourceChunk(request), resource.resourceId, 0)).resolves.toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'MCP_APP_SESSION_OFFLINE' }),
        });
    });

    it('aborts an in-flight resource open when the session disconnects', async () => {
        let wasAborted = false;
        const readMcpResource = vi.fn((_params: unknown, options?: { signal?: AbortSignal }) => {
            if (!options?.signal) throw new Error('missing abort signal');
            return new Promise((_resolve, reject) => {
                options.signal?.addEventListener('abort', () => {
                    wasAborted = true;
                    reject(new Error('aborted'));
                }, { once: true });
            });
        });
        const { handlers, registration, registry } = createHarness({ readMcpResource });
        bind(registry);

        const pending = open(handlers.get('mcpAppResourceOpen')!);
        await vi.waitFor(() => expect(readMcpResource).toHaveBeenCalledTimes(1));
        registration.dispose();

        await expect(pending).resolves.toEqual({
            ok: false,
            error: expect.objectContaining({ code: 'MCP_APP_SESSION_OFFLINE' }),
        });
        expect(wasAborted).toBe(true);
    });
});
