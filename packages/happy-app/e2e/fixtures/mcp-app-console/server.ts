import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Readable } from 'node:stream';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { buildMcpAppFixtureHtml } from './build.js';

const RESOURCE_URI = 'ui://paws-release-readiness/app.html';

const checkSchema = z.object({
    name: z.string().min(1),
    passed: z.boolean(),
});

const outputSchema = z.object({
    releaseName: z.string(),
    passed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    percent: z.number().int().min(0).max(100),
    status: z.enum(['ready', 'needs-attention']),
    checks: z.array(checkSchema),
});

type ReadinessOutput = z.infer<typeof outputSchema>;

export type RunningMcpAppFixture = {
    mcpUrl: string;
    close: () => Promise<void>;
};

export async function loadAppHtml(): Promise<string> {
    const html = await buildMcpAppFixtureHtml();
    if (!html.includes('approve-release-readiness')) {
        throw new Error('MCP App bundle is missing its SDK initialization marker');
    }
    return html;
}

export function createMcpAppServer(html: string): McpServer {
    const server = new McpServer({
        name: 'Paws MCP App Console E2E Fixture',
        version: '1.0.0',
    });

    registerAppTool(server, 'show-release-readiness', {
        title: 'Show Release Readiness',
        description: 'Shows deterministic release-readiness checks in an MCP App.',
        inputSchema: {
            releaseName: z.string().min(1),
            checks: z.array(checkSchema).min(1),
        },
        outputSchema: outputSchema.shape,
        annotations: { readOnlyHint: true },
        _meta: { ui: { resourceUri: RESOURCE_URI } },
    }, async ({ releaseName, checks }): Promise<CallToolResult> => {
        const passed = checks.filter((check) => check.passed).length;
        const total = checks.length;
        const percent = Math.round((passed / total) * 100);
        const structuredContent: ReadinessOutput = {
            releaseName,
            passed,
            total,
            percent,
            status: passed === total ? 'ready' : 'needs-attention',
            checks,
        };

        return {
            content: [{
                type: 'text',
                text: `${releaseName}: ${passed}/${total} checks passed (${percent}%).`,
            }],
            structuredContent,
        };
    });

    registerAppResource(server, RESOURCE_URI, RESOURCE_URI, {
        mimeType: RESOURCE_MIME_TYPE,
    }, async (): Promise<ReadResourceResult> => ({
        contents: [{
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
        }],
    }));

    server.registerTool('approve-release-readiness', {
        title: 'Approve Release Readiness',
        description: 'Returns a deterministic mediated action result for Host E2E.',
        inputSchema: { releaseName: z.string().min(1) },
        outputSchema: { approval: z.literal('approved'), releaseName: z.string() },
        annotations: { readOnlyHint: true },
    }, async ({ releaseName }): Promise<CallToolResult> => ({
        content: [{ type: 'text', text: `Approved ${releaseName}.` }],
        structuredContent: { approval: 'approved', releaseName },
    }));

    return server;
}

export async function startMcpAppFixture(options: { port: number }): Promise<RunningMcpAppFixture> {
    const html = await loadAppHtml();
    const httpServer = createHttpServer(async (request, response) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== '/mcp') {
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end('{"error":"Not found"}');
            return;
        }
        const mcpServer = createMcpAppServer(html);
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });

        try {
            await mcpServer.connect(transport);
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const requestHeaders = new Headers();
            for (const [name, value] of Object.entries(request.headers)) {
                if (value !== undefined) requestHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
            const webRequest = new Request(`http://127.0.0.1${request.url ?? '/mcp'}`, {
                method: request.method,
                headers: requestHeaders,
                body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
            });
            const webResponse = await transport.handleRequest(webRequest);
            response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
            if (webResponse.body) Readable.fromWeb(webResponse.body as never).pipe(response);
            else response.end();
        } catch {
            if (!response.headersSent) {
                response.writeHead(500, { 'content-type': 'application/json' });
                response.end(JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal server error' },
                    id: null,
                }));
            }
        } finally {
            response.once('close', () => {
                void transport.close();
                void mcpServer.close();
            });
        }
    });
    await listen(httpServer, options.port);
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
        await closeServer(httpServer);
        throw new Error('MCP App fixture did not expose a TCP address');
    }

    return {
        mcpUrl: `http://127.0.0.1:${address.port}/mcp`,
        close: () => closeServer(httpServer),
    };
}

function listen(server: HttpServer, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
}

function closeServer(server: HttpServer): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}
