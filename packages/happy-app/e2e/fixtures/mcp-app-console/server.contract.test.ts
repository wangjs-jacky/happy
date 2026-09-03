import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { dirname } from 'node:path';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { startMcpAppFixture, type RunningMcpAppFixture } from './server.js';

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));

function expectBundledMcpAppResource(resource: Awaited<ReturnType<Client['readResource']>>): void {
    expect(resource.contents).toHaveLength(1);
    expect(resource.contents[0]).toMatchObject({
        uri: 'ui://paws-release-readiness/app.html',
        mimeType: 'text/html;profile=mcp-app',
    });
    expect(resource.contents[0]).toHaveProperty('text');
    const html = resource.contents[0] && 'text' in resource.contents[0]
        ? resource.contents[0].text
        : '';
    expect(html).toContain('mcp-example-root');
    expect(html).toContain('Paws Release Readiness');
    expect(html).toContain('approve-release-readiness');
    const script = /<script>([\s\S]+)<\/script>/u.exec(html)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script!, { filename: 'mcp-app-fixture.js' })).not.toThrow();
}

describe('local MCP App fixture contract', () => {
    let fixture: RunningMcpAppFixture | undefined;
    let client: Client | undefined;

    afterEach(async () => {
        await client?.close();
        client = undefined;
        await fixture?.close();
        fixture = undefined;
    });

    it('exposes a UI resource and preserves structured tool output over real HTTP MCP', async () => {
        fixture = await startMcpAppFixture({ port: 0 });
        client = new Client({ name: 'paws-console-e2e', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL(fixture.mcpUrl)));

        const tools = await client.listTools();
        const tool = tools.tools.find((candidate) => candidate.name === 'show-release-readiness');

        expect(tool).toMatchObject({
            name: 'show-release-readiness',
            title: 'Show Release Readiness',
            _meta: {
                ui: { resourceUri: 'ui://paws-release-readiness/app.html' },
            },
        });

        const resource = await client.readResource({ uri: 'ui://paws-release-readiness/app.html' });
        expectBundledMcpAppResource(resource);

        const result = await client.callTool({
            name: 'show-release-readiness',
            arguments: {
                releaseName: 'Paws MCP Apps PR 1',
                checks: [
                    { name: 'Protocol metadata preserved', passed: true },
                    { name: 'Structured content preserved', passed: true },
                    { name: 'UI resource reachable', passed: true },
                    { name: 'Happy Web host available', passed: false },
                ],
            },
        });

        expect(result).toMatchObject({
            content: [{ type: 'text', text: 'Paws MCP Apps PR 1: 3/4 checks passed (75%).' }],
            structuredContent: {
                releaseName: 'Paws MCP Apps PR 1',
                passed: 3,
                total: 4,
                percent: 75,
                status: 'needs-attention',
                checks: [
                    { name: 'Protocol metadata preserved', passed: true },
                    { name: 'Structured content preserved', passed: true },
                    { name: 'UI resource reachable', passed: true },
                    { name: 'Happy Web host available', passed: false },
                ],
            },
        });

        const approval = await client.callTool({
            name: 'approve-release-readiness',
            arguments: { releaseName: 'Paws MCP Apps PR 1' },
        });
        expect(approval).toMatchObject({ structuredContent: {
            approval: 'approved', releaseName: 'Paws MCP Apps PR 1',
        } });
    });

    it('serves the same bundled MCP App over stdio', async () => {
        client = new Client({ name: 'paws-console-stdio-e2e', version: '1.0.0' });
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: ['--import', 'tsx', 'main.ts', '--stdio'],
            cwd: fixtureDirectory,
            stderr: 'pipe',
        });
        await client.connect(transport);

        const resource = await client.readResource({ uri: 'ui://paws-release-readiness/app.html' });
        expectBundledMcpAppResource(resource);
    });
});
