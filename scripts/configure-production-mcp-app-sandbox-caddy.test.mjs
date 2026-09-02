import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    MCP_APP_SANDBOX_CADDY_BLOCK_END,
    MCP_APP_SANDBOX_CADDY_BLOCK_START,
    configureProductionMcpAppSandboxCaddy,
    runConfigureProductionMcpAppSandboxCaddy,
} from './configure-production-mcp-app-sandbox-caddy.mjs';

const source = `{
    grace_period 10s
}

paws.example:8443 {
    respond "paws"
}

sandbox.paws.example {
    header X-Existing "preserved"
}

metrics.example {
    reverse_proxy localhost:9090
}
`;

test('adds an exact-path managed block only inside the provisioned sandbox site', () => {
    const configured = configureProductionMcpAppSandboxCaddy(source, {
        sandboxOrigin: 'https://sandbox.paws.example',
        parentOrigins: ['https://paws.example:8443'],
    });

    assert.match(configured, new RegExp(MCP_APP_SANDBOX_CADDY_BLOCK_START));
    assert.match(configured, new RegExp(MCP_APP_SANDBOX_CADDY_BLOCK_END));
    assert.match(configured, /@paws_mcp_app_host path \/mcp-app-sandbox\/host \/mcp-app-sandbox\/host\.js/);
    assert.match(configured, /reverse_proxy @paws_mcp_app_host localhost:3005/);
    assert.match(configured, /respond 404/);
    assert.match(configured, /header X-Existing "preserved"/);
    assert.match(configured, /metrics\.example \{\n    reverse_proxy localhost:9090\n\}/);
    assert.match(configured, /paws\.example:8443 \{\n    respond "paws"\n\}/);
});

test('is idempotent and replaces only its own complete managed block', () => {
    const once = configureProductionMcpAppSandboxCaddy(source, {
        sandboxOrigin: 'https://sandbox.paws.example',
        parentOrigins: ['https://paws.example:8443'],
    });
    const twice = configureProductionMcpAppSandboxCaddy(once, {
        sandboxOrigin: 'https://sandbox.paws.example',
        parentOrigins: ['https://paws.example:8443'],
    });

    assert.equal(twice, once);
    assert.equal(twice.match(new RegExp(MCP_APP_SANDBOX_CADDY_BLOCK_START, 'g'))?.length, 1);
});

test('fails closed for missing, same-origin, non-HTTPS, and incomplete managed sites', () => {
    assert.throws(() => configureProductionMcpAppSandboxCaddy(source, {
        sandboxOrigin: 'https://missing.example', parentOrigins: ['https://paws.example:8443'],
    }), /site block not found/i);
    assert.throws(() => configureProductionMcpAppSandboxCaddy(source, {
        sandboxOrigin: 'https://sandbox.paws.example', parentOrigins: ['https://sandbox.paws.example'],
    }), /different origin/i);
    assert.throws(() => configureProductionMcpAppSandboxCaddy(source, {
        sandboxOrigin: 'http://sandbox.paws.example', parentOrigins: ['https://paws.example:8443'],
    }), /HTTPS/i);
    assert.throws(() => configureProductionMcpAppSandboxCaddy(
        source.replace('    header X-Existing "preserved"', `    ${MCP_APP_SANDBOX_CADDY_BLOCK_START}`),
        { sandboxOrigin: 'https://sandbox.paws.example', parentOrigins: ['https://paws.example:8443'] },
    ), /incomplete/i);
    assert.throws(() => configureProductionMcpAppSandboxCaddy(
        source.replace('    header X-Existing "preserved"', '    respond "placeholder"'),
        { sandboxOrigin: 'https://sandbox.paws.example', parentOrigins: ['https://paws.example:8443'] },
    ), /unmanaged request handlers/i);
});

test('does not create or mutate the output file when validation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paws-mcp-caddy-'));
    const input = join(directory, 'Caddyfile');
    const absentOutput = join(directory, 'absent-output');
    const existingOutput = join(directory, 'existing-output');
    await writeFile(input, source);
    await writeFile(existingOutput, 'untouched');
    try {
        await assert.rejects(runConfigureProductionMcpAppSandboxCaddy([
            input, absentOutput, 'https://missing.example', 'https://paws.example:8443',
        ]), /site block not found/i);
        await assert.rejects(readFile(absentOutput), { code: 'ENOENT' });
        await assert.rejects(runConfigureProductionMcpAppSandboxCaddy([
            input, existingOutput, 'https://missing.example', 'https://paws.example:8443',
        ]), /site block not found/i);
        assert.equal(await readFile(existingOutput, 'utf8'), 'untouched');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
