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

function structuralLines(lines) {
    const result = [];
    let quote = null;
    let heredocDelimiter = null;
    for (const line of lines) {
        const content = Array.from({ length: line.length }, () => ' ');
        let commentStart = -1;
        let index = 0;
        let tokenStart = quote === null;
        if (heredocDelimiter !== null) {
            while (index < line.length && /\s/u.test(line[index])) index += 1;
            const delimiterEnd = index + heredocDelimiter.length;
            const closesHeredoc = line.startsWith(heredocDelimiter, index)
                && (delimiterEnd === line.length || /\s/u.test(line[delimiterEnd]));
            if (!closesHeredoc) {
                result.push({ content: content.join(''), commentStart });
                continue;
            }
            index = delimiterEnd;
            heredocDelimiter = null;
            tokenStart = false;
        }

        let escaped = false;
        let pendingHeredoc = null;
        for (; index < line.length; index += 1) {
            const character = line[index];
            if (escaped) { escaped = false; continue; }
            if (quote) {
                if (character === '\\') { escaped = true; continue; }
                if (character === quote) quote = null;
                continue;
            }
            if (character === '\\') { escaped = true; tokenStart = false; continue; }
            if (character === '#') { commentStart = index; break; }
            if (character === '"' || character === "'" || character === '`') {
                quote = character;
                tokenStart = false;
                continue;
            }
            if (tokenStart && line.startsWith('<<', index)) {
                if (pendingHeredoc !== null) throw new Error('Caddyfile contains a malformed heredoc token');
                const match = /^<<([A-Za-z0-9_][A-Za-z0-9_-]*)/u.exec(line.slice(index));
                const delimiter = match?.[1];
                const delimiterEnd = delimiter ? index + 2 + delimiter.length : index + 2;
                if (!delimiter || (delimiterEnd < line.length && !/\s/u.test(line[delimiterEnd]))) {
                    throw new Error('Caddyfile contains a malformed heredoc token');
                }
                pendingHeredoc = delimiter;
                index = delimiterEnd - 1;
                tokenStart = false;
                continue;
            }
            content[index] = character;
            tokenStart = /\s/u.test(character);
        }
        if (escaped) throw new Error('Caddyfile contains an unterminated escape');
        if (pendingHeredoc !== null) {
            if (quote !== null) throw new Error('Caddyfile contains a malformed heredoc token');
            heredocDelimiter = pendingHeredoc;
        }
        result.push({ content: content.join(''), commentStart });
    }
    if (quote !== null) throw new Error('Caddyfile contains an unterminated quoted value');
    if (heredocDelimiter !== null) throw new Error('Caddyfile contains an unterminated heredoc');
    return result;
}

function braceDelta(content) {
    return (content.match(/{/g) ?? []).length - (content.match(/}/g) ?? []).length;
}

function blockEnd(structure, start, label) {
    let depth = 0;
    for (let index = start; index < structure.length; index += 1) {
        depth += braceDelta(structure[index].content);
        if (index > start && depth === 0) return index;
        if (depth < 0) break;
    }
    throw new Error(`${label} is unbalanced`);
}

function findManagedRange(lines, structure) {
    const starts = [];
    const ends = [];
    for (const [index, line] of lines.entries()) {
        const comment = structure[index].commentStart >= 0 ? line.slice(structure[index].commentStart).trim() : '';
        if (line.trim() === MCP_APP_SANDBOX_CADDY_BLOCK_START && comment === MCP_APP_SANDBOX_CADDY_BLOCK_START) starts.push(index);
        if (line.trim() === MCP_APP_SANDBOX_CADDY_BLOCK_END && comment === MCP_APP_SANDBOX_CADDY_BLOCK_END) ends.push(index);
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

    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const withoutCrLf = source.replaceAll('\r\n', '');
    if (withoutCrLf.includes('\r') || (newline === '\r\n' && withoutCrLf.includes('\n'))) {
        throw new Error('Caddyfile contains mixed or unsupported line endings');
    }
    const hadFinalNewline = source.endsWith(newline);
    const lines = source.split(newline);
    const structure = structuralLines(lines);
    const globalManagedRange = findManagedRange(lines, structure);
    const sandboxHost = new URL(sandboxOrigin).host;
    const acceptedSiteLabels = new Set([sandboxHost, sandboxOrigin]);
    const siteStarts = lines.flatMap((_line, index) => {
        const match = /^\s*(\S+)\s*\{\s*$/u.exec(structure[index].content);
        return match && acceptedSiteLabels.has(match[1]) ? [index] : [];
    });
    if (siteStarts.length !== 1) {
        throw new Error(siteStarts.length === 0
            ? `Caddy site block not found for already-provisioned sandbox: ${sandboxHost}`
            : `Multiple Caddy site blocks found for sandbox: ${sandboxHost}`);
    }
    const siteStart = siteStarts[0];
    const siteEnd = blockEnd(structure, siteStart, `Sandbox Caddy site ${sandboxHost}`);
    if (globalManagedRange
        && (globalManagedRange.start <= siteStart || globalManagedRange.end >= siteEnd)) {
        throw new Error('Existing managed MCP App sandbox Caddy block is outside the sandbox site');
    }

    for (let index = siteStart + 1; index < siteEnd; index += 1) {
        if (globalManagedRange && index >= globalManagedRange.start && index <= globalManagedRange.end) continue;
        const trimmed = lines[index].trim();
        if (trimmed !== '' && !trimmed.startsWith('#')) {
            throw new Error('Provisioned sandbox site must contain only comments outside the managed block');
        }
    }

    if (globalManagedRange) {
        const existingIndent = lines[globalManagedRange.start].match(/^\s*/u)?.[0] ?? '';
        const expected = managedLines(existingIndent);
        const actual = lines.slice(globalManagedRange.start, globalManagedRange.end + 1);
        if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) {
            throw new Error('Existing managed MCP App sandbox Caddy block was modified');
        }
        lines.splice(globalManagedRange.start, globalManagedRange.end - globalManagedRange.start + 1, ...expected);
    } else {
        const siteIndent = lines.slice(siteStart + 1, siteEnd)
            .find((line) => line.trim().length > 0)?.match(/^\s*/u)?.[0]
            ?? `${lines[siteStart].match(/^\s*/u)?.[0] ?? ''}    `;
        const prefix = siteEnd > siteStart + 1 && lines[siteEnd - 1].trim() !== '' ? [''] : [];
        lines.splice(siteEnd, 0, ...prefix, ...managedLines(siteIndent));
    }
    let result = lines.join(newline);
    if (hadFinalNewline && !result.endsWith(newline)) result += newline;
    if (!hadFinalNewline && result.endsWith(newline)) result = result.slice(0, -newline.length);
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
