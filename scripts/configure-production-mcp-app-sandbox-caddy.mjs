import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MCP_APP_SANDBOX_CADDY_BLOCK_START = '# paws-mcp-app-sandbox:start';
export const MCP_APP_SANDBOX_CADDY_BLOCK_END = '# paws-mcp-app-sandbox:end';

function normalizeHttpsOrigin(raw, label) {
    if (!raw || raw.trim() !== raw || /[\s;'"\\?#]/u.test(raw)) {
        throw new Error(`${label} must be an exact HTTPS origin`);
    }
    let url;
    try { url = new URL(raw); } catch { throw new Error(`${label} must be an exact HTTPS origin`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
        || url.search || url.hash || !url.hostname || url.hostname.includes('*') || url.hostname.endsWith('.')) {
        throw new Error(`${label} must be an exact HTTPS origin`);
    }
    return url.origin;
}

function braceDelta(line) {
    const content = line.split('#', 1)[0];
    return (content.match(/{/g) ?? []).length - (content.match(/}/g) ?? []).length;
}

function blockEnd(lines, start, label) {
    let depth = 0;
    for (let index = start; index < lines.length; index += 1) {
        depth += braceDelta(lines[index]);
        if (index > start && depth === 0) return index;
        if (depth < 0) break;
    }
    throw new Error(`${label} is unbalanced`);
}

function findManagedRange(lines) {
    const starts = [];
    const ends = [];
    for (const [index, line] of lines.entries()) {
        if (line.trim() === MCP_APP_SANDBOX_CADDY_BLOCK_START) starts.push(index);
        if (line.trim() === MCP_APP_SANDBOX_CADDY_BLOCK_END) ends.push(index);
    }
    if (starts.length === 0 && ends.length === 0) return null;
    if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
        throw new Error('Existing managed MCP App sandbox Caddy block is incomplete or duplicated');
    }
    return { start: starts[0], end: ends[0] };
}

function managedLines(indentation) {
    return [
        MCP_APP_SANDBOX_CADDY_BLOCK_START,
        'route {',
        '    @paws_mcp_app_host path /mcp-app-sandbox/host /mcp-app-sandbox/host.js',
        '    reverse_proxy @paws_mcp_app_host localhost:3005',
        '    respond 404',
        '}',
        MCP_APP_SANDBOX_CADDY_BLOCK_END,
    ].map((line) => `${indentation}${line}`);
}

export function configureProductionMcpAppSandboxCaddy(source, options) {
    const sandboxOrigin = normalizeHttpsOrigin(options?.sandboxOrigin, 'Sandbox origin');
    const rawParents = options?.parentOrigins;
    if (!Array.isArray(rawParents) || rawParents.length === 0) {
        throw new Error('At least one Paws parent origin is required');
    }
    const parentOrigins = [...new Set(rawParents.map((origin) => normalizeHttpsOrigin(origin, 'Parent origin')))];
    if (parentOrigins.includes(sandboxOrigin)) {
        throw new Error('Sandbox origin must use a different origin from every Paws parent origin');
    }

    const hadFinalNewline = source.endsWith('\n');
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const globalManagedRange = findManagedRange(lines);
    const sandboxHost = new URL(sandboxOrigin).host;
    const acceptedSiteLabels = new Set([sandboxHost, sandboxOrigin]);
    const siteStarts = lines.flatMap((line, index) => {
        const match = /^\s*(\S+)\s*\{\s*$/u.exec(line);
        return match && acceptedSiteLabels.has(match[1]) ? [index] : [];
    });
    if (siteStarts.length !== 1) {
        throw new Error(siteStarts.length === 0
            ? `Caddy site block not found for already-provisioned sandbox: ${sandboxHost}`
            : `Multiple Caddy site blocks found for sandbox: ${sandboxHost}`);
    }
    const siteStart = siteStarts[0];
    const siteEnd = blockEnd(lines, siteStart, `Sandbox Caddy site ${sandboxHost}`);
    if (globalManagedRange
        && (globalManagedRange.start <= siteStart || globalManagedRange.end >= siteEnd)) {
        throw new Error('Existing managed MCP App sandbox Caddy block is outside the sandbox site');
    }

    const unmanagedSiteLines = lines.slice(siteStart + 1, siteEnd).filter((_line, offset) => {
        if (!globalManagedRange) return true;
        const absoluteIndex = siteStart + 1 + offset;
        return absoluteIndex < globalManagedRange.start || absoluteIndex > globalManagedRange.end;
    });
    const requestHandler = unmanagedSiteLines.find((line) => (
        /^\s*(?:handle|handle_path|route|respond|reverse_proxy|rewrite|redir|file_server|php_fastcgi|import)\b/u.test(line)
    ));
    if (requestHandler) {
        throw new Error('Provisioned sandbox site must not contain unmanaged request handlers');
    }

    const siteIndent = lines.slice(siteStart + 1, siteEnd)
        .find((line) => line.trim().length > 0)?.match(/^\s*/u)?.[0]
        ?? `${lines[siteStart].match(/^\s*/u)?.[0] ?? ''}    `;
    const replacement = managedLines(siteIndent);
    if (globalManagedRange) {
        lines.splice(globalManagedRange.start, globalManagedRange.end - globalManagedRange.start + 1, ...replacement);
    } else {
        const prefix = siteEnd > siteStart + 1 && lines[siteEnd - 1].trim() !== '' ? [''] : [];
        lines.splice(siteEnd, 0, ...prefix, ...replacement);
    }
    let result = lines.join('\n');
    if (hadFinalNewline && !result.endsWith('\n')) result += '\n';
    if (!hadFinalNewline && result.endsWith('\n')) result = result.slice(0, -1);
    return result;
}

export async function runConfigureProductionMcpAppSandboxCaddy(args = process.argv.slice(2)) {
    const [inputPath, outputPath, sandboxOrigin, parentOriginsRaw] = args;
    if (!inputPath || !outputPath || !sandboxOrigin || !parentOriginsRaw) {
        throw new Error('Usage: node scripts/configure-production-mcp-app-sandbox-caddy.mjs <input> <output> <sandbox-origin> <comma-separated-parent-origins>');
    }
    const source = await readFile(inputPath, 'utf8');
    const configured = configureProductionMcpAppSandboxCaddy(source, {
        sandboxOrigin,
        parentOrigins: parentOriginsRaw.split(',').map((origin) => origin.trim()),
    });
    if (configured === source) {
        process.stdout.write('unchanged\n');
        return 'unchanged';
    }
    const temporaryPath = join(dirname(outputPath), `.paws-mcp-app-caddy-${process.pid}-${Date.now()}.tmp`);
    try {
        await writeFile(temporaryPath, configured, { encoding: 'utf8', mode: 0o600 });
        await rename(temporaryPath, outputPath);
    } finally {
        await rm(temporaryPath, { force: true });
    }
    process.stdout.write('changed\n');
    return 'changed';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await runConfigureProductionMcpAppSandboxCaddy().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'MCP App sandbox Caddy configuration failed'}\n`);
        process.exitCode = 1;
    });
}
