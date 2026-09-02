import { describe, expect, it } from 'vitest';
import type { ThreadItem } from '../codexAppServerTypes';
import { CodexMcpAppAdapter } from './CodexMcpAppAdapter';

type McpToolCallItem = Extract<ThreadItem, { type: 'mcpToolCall' }>;

const localCodexFixture = {
    type: 'mcpToolCall',
    id: 'call-local',
    server: 'demo',
    tool: 'show_dashboard',
    status: 'completed',
    arguments: { period: 'week' },
    result: {
        content: [{ type: 'text', text: 'done' }],
        structuredContent: { count: 1 },
        _meta: { privateViewState: 'opaque' },
    },
    appContext: {
        resourceUri: 'ui://demo/dashboard.html',
        templateId: 'dashboard-template',
        appName: 'Demo Dashboard',
        actionName: 'Show dashboard',
        connectorId: 'connector-local',
    },
} satisfies McpToolCallItem;

const upstreamCodexFixture = {
    type: 'mcpToolCall',
    id: 'call-upstream',
    server: 'upstream-demo',
    tool: 'read_data',
    status: 'completed',
    arguments: { source: 'latest' },
    result: { content: [] },
    readOnlyHint: true,
    appContext: {
        resourceUri: 'ui://upstream-demo/view.html',
        futureAdditiveField: { retainedByCodex: true },
    },
} satisfies McpToolCallItem;

const deprecatedCodexFixture = {
    type: 'mcpToolCall',
    id: 'call-deprecated',
    server: 'legacy-demo',
    tool: 'show_legacy',
    status: 'completed',
    arguments: null,
    result: { content: [{ type: 'text', text: 'legacy' }] },
    mcpAppResourceUri: 'ui://legacy-demo/view.html',
} satisfies McpToolCallItem;

describe('CodexMcpAppAdapter', () => {
    const adapter = new CodexMcpAppAdapter();

    it('normalizes the local Codex templateId fixture without exposing additive metadata', () => {
        expect(adapter.normalizeItem(localCodexFixture)).toEqual({
            callId: 'call-local',
            server: 'demo',
            tool: 'show_dashboard',
            input: { period: 'week' },
            presentation: {
                version: 1,
                server: 'demo',
                resourceUri: 'ui://demo/dashboard.html',
                appName: 'Demo Dashboard',
                actionName: 'Show dashboard',
            },
            result: {
                version: 1,
                state: 'available',
                content: [{ type: 'text', text: 'done' }],
                structuredContent: { count: 1 },
                _meta: { privateViewState: 'opaque' },
            },
        });
    });

    it('accepts the upstream readOnlyHint fixture and unknown app-context fields', () => {
        expect(adapter.normalizeItem(upstreamCodexFixture)).toMatchObject({
            callId: 'call-upstream',
            input: { source: 'latest' },
            presentation: {
                version: 1,
                server: 'upstream-demo',
                resourceUri: 'ui://upstream-demo/view.html',
            },
            result: { version: 1, state: 'available', content: [] },
        });
    });

    it('accepts the deprecated top-level MCP App resource URI fixture', () => {
        expect(adapter.normalizeItem(deprecatedCodexFixture)).toMatchObject({
            callId: 'call-deprecated',
            input: {},
            presentation: {
                version: 1,
                server: 'legacy-demo',
                resourceUri: 'ui://legacy-demo/view.html',
            },
        });
    });

    it('accepts deprecated snake-case app-context resource URI metadata', () => {
        const normalized = adapter.normalizeItem({
            ...localCodexFixture,
            id: 'call-snake-case',
            appContext: {
                resource_uri: 'ui://demo/deprecated.html',
            },
        });

        expect(normalized.presentation?.resourceUri).toBe('ui://demo/deprecated.html');
    });

    it('keeps non-ui MCP calls ordinary and omits App result metadata', () => {
        const normalized = adapter.normalizeItem({
            ...localCodexFixture,
            id: 'call-http',
            appContext: { resourceUri: 'https://example.com/not-an-app.html' },
        });

        expect(normalized.presentation).toBeUndefined();
        expect(normalized.result).toBeUndefined();
    });

    it('marks a serialized multibyte result over 256 KiB unavailable', () => {
        const normalized = adapter.normalizeItem({
            ...localCodexFixture,
            id: 'call-oversize',
            result: {
                content: [],
                structuredContent: { payload: '界'.repeat(90_000) },
            },
        });

        expect(normalized.result).toEqual({
            version: 1,
            state: 'unavailable',
            code: 'MCP_APP_RESULT_TOO_LARGE',
        });
    });
});
