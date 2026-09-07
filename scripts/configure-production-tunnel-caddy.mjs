import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const START = '# paws-cloudflare-tunnel:start';
const END = '# paws-cloudflare-tunnel:end';
const RESERVED_MATCHER = '@paws_tunnel_wrong_host';
const DYNAMIC_MATCHER = '@paws_tunnel_dynamic';
// Only known application directives can be moved into a handle block. Imports
// and site-wide options need explicit reconciliation against the real config.
const APPLICATION_DIRECTIVES = new Set([
    'abort', 'basic_auth', 'encode', 'error', 'file_server', 'forward_auth',
    'handle', 'handle_path', 'header', 'intercept', 'invoke', 'log_append',
    'log_name', 'log_skip', 'map', 'method', 'metrics', 'php_fastcgi', 'push',
    'redir', 'request_body', 'request_header', 'respond', 'reverse_proxy',
    'rewrite', 'root', 'route', 'templates', 'tracing', 'try_files', 'uri', 'vars',
]);

// Like the sandbox transformer, structural braces are standalone unquoted
// tokens. Braces in placeholders, comments, and quoted values are not blocks.
function scan(source) {
    const tokens = [];
    const comments = [];
    let index = 0;
    let line = 0;
    while (index < source.length) {
        if (/\s/u.test(source[index])) {
            if (source[index] === '\n') line += 1;
            index += 1;
            continue;
        }
        if (source[index] === '#') {
            const end = source.indexOf('\n', index);
            comments.push({ line, text: source.slice(index, end < 0 ? source.length : end).trim() });
            index = end < 0 ? source.length : end;
            continue;
        }
        const start = index;
        const firstLine = line;
        const quote = ['"', '`'].includes(source[index]) ? source[index++] : null;
        if (quote) {
            let closed = false;
            while (index < source.length) {
                if (quote === '"' && source[index] === '\\') {
                    index += 1;
                    if (source[index] === '\n') line += 1;
                    index += 1;
                } else if (source[index] === quote) {
                    index += 1;
                    closed = true;
                    break;
                } else {
                    if (source[index] === '\n') line += 1;
                    index += 1;
                }
            }
            if (!closed) throw new Error('Caddyfile contains an unterminated quoted value');
        } else {
            while (index < source.length && !/\s/u.test(source[index])) index += 1;
        }
        const text = source.slice(start, index);
        if (!quote && text.startsWith('<<')) throw new Error('Unsupported Caddyfile heredoc; reconcile before Tunnel activation');
        tokens.push({ text, line: firstLine, endLine: line, quoted: Boolean(quote) });
    }
    const blocks = [];
    const stack = [];
    let headerStart = 0;
    for (const [index, token] of tokens.entries()) {
        token.depth = stack.length;
        if (token.quoted) continue;
        if (token.text === '{') {
            if (stack.length === 0) blocks.push({ header: tokens.slice(headerStart, index), open: index });
            stack.push(index);
        } else if (token.text === '}') {
            const open = stack.pop();
            if (open === undefined) throw new Error('Caddyfile contains unbalanced structural braces');
            tokens[open].close = index;
            if (stack.length === 0) {
                blocks.at(-1).close = index;
                headerStart = index + 1;
            }
        }
    }
    if (stack.length !== 0) throw new Error('Caddyfile contains unbalanced structural braces');
    if (headerStart !== tokens.length) throw new Error('Unsupported Caddyfile content outside site blocks');
    return { tokens, comments, blocks };
}

function managedRange(lines, comments, blocks, tokens, port) {
    const markers = comments.filter((comment) => [START, END].includes(comment.text)
        && lines[comment.line].trim() === comment.text);
    if (markers.length === 0) return null;
    if (markers.length !== 2 || markers[0].text !== START || markers[1].text !== END) {
        throw new Error('Existing managed Tunnel block is incomplete or duplicated');
    }
    const start = markers[0].line;
    const end = markers[1].line;
    const inside = tokens.filter((token) => token.line > start && token.line < end);
    const site = blocks.find((block) => block.header[0] === inside[0]);
    if (!site || site.header.length !== 1 || site.header[0].text !== `http://:${port}`
        || inside.at(-1) !== tokens[site.close]) {
        throw new Error('Existing managed Tunnel markers must enclose exactly one Tunnel site');
    }
    return { start, end, site };
}

export function configureProductionTunnelCaddy(source, {
    publicSiteAddress = '47.115.228.20:8443',
    tunnelListenAddress = 'http://127.0.0.1:8081',
    tunnelHost = 'paws.rodeo',
} = {}) {
    const listen = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/u.exec(tunnelListenAddress);
    if (!listen || Number(listen[1]) > 65535) throw new Error('Tunnel origin must be an explicit HTTP IPv4 loopback address and port');
    const port = listen[1];
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(tunnelHost)) {
        throw new Error('Tunnel host must be one exact lowercase DNS hostname');
    }
    if (!publicSiteAddress || /[\s{}#"`]/u.test(publicSiteAddress)) throw new Error('Invalid canonical site address');
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const normalized = source.replaceAll('\r\n', '\n');
    if (normalized.includes('\r') || (newline === '\r\n' && source.replaceAll('\r\n', '').includes('\n'))) {
        throw new Error('Unsupported mixed Caddyfile line endings');
    }
    const lines = normalized.split('\n');
    const { tokens, comments, blocks } = scan(normalized);
    const managed = managedRange(lines, comments, blocks, tokens, port);
    const canonical = blocks.filter((block) => block.header.some((token) => token.text === publicSiteAddress));
    if (canonical.length !== 1 || canonical[0].header.length !== 1) throw new Error('Exactly one standalone canonical site block is required');
    const site = canonical[0];
    for (const block of blocks) {
        if (block === managed?.site) continue;
        // Quoted labels need Caddy's full decoding rules before their port can
        // be trusted. Refuse them instead of letting a same-port host route
        // precede the generated guard on the shared loopback server.
        if (block.header.some((token) => token.quoted)) {
            throw new Error('Unsupported quoted Caddy site address; reconcile before Tunnel activation');
        }
        const addresses = block.header.flatMap((token) => token.text.split(',')).filter(Boolean);
        // Caddy accepts paths and expands environment placeholders in labels.
        // Neither is safe for raw port scanning: it can hide a shared listener
        // whose unmanaged Host route runs before our guard. Only literal HTTP(S)
        // host/port labels supported by this transformer may reach that scan.
        if (addresses.some((address) => !/^(?:https?:\/\/)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[0-9a-fA-F:.]+\])?(?::\d+(?:-\d+)?)?$/u.test(address)
            || /^(?:https?:\/\/)?$/u.test(address))) {
            throw new Error('Unsupported nonliteral or path-bearing Caddy site address; reconcile before Tunnel activation');
        }
        const usesTunnelPort = addresses.some((address) => {
            const range = /:(\d+)(?:-(\d+))?$/u.exec(address);
            return range && Number(range[1]) <= Number(port) && Number(range[2] ?? range[1]) >= Number(port);
        });
        if (usesTunnelPort) {
            throw new Error(`Refusing to overwrite an unmanaged listener on port ${port}`);
        }
    }
    const open = tokens[site.open];
    const close = tokens[site.close];
    if (tokens[site.open + 1]?.line === open.line || tokens[site.close - 1]?.line === close.line) {
        throw new Error('Unsupported inline canonical site block');
    }
    const remove = new Set();
    for (let index = site.open + 1; index < site.close; index += 1) {
        const token = tokens[index];
        if ([RESERVED_MATCHER, DYNAMIC_MATCHER].includes(token.text)) throw new Error('Canonical site uses a reserved Tunnel matcher');
        if (token.endLine !== token.line) throw new Error('Unsupported multiline quoted value in canonical site');
        const firstOnLine = tokens[index - 1].line < token.line;
        if (firstOnLine && token.text === 'import') throw new Error('Unsupported import in canonical site');
        if (token.depth !== 1 || !firstOnLine || token.text === '}') continue;
        if (['tls', 'bind'].includes(token.text)) {
            let lastLine = token.line;
            for (let next = index + 1; next < site.close && tokens[next].line === token.line; next += 1) {
                if (tokens[next].text === '{' && !tokens[next].quoted) lastLine = tokens[tokens[next].close].line;
            }
            for (let line = token.line; line <= lastLine; line += 1) remove.add(line);
        } else if (!token.text.startsWith('@') && !APPLICATION_DIRECTIVES.has(token.text)) {
            throw new Error(`Unsupported canonical application directive: ${token.text}`);
        }
    }
    const application = lines.slice(open.line + 1, close.line)
        .filter((_, index) => !remove.has(open.line + 1 + index))
        .map((line) => `        ${line}`);
    // An IP in a site label adds a Host matcher, not a network bind. Use a
    // port-only HTTP label plus bind, so paws.rodeo reaches the exact Host guard.
    // route preserves guard/header ordering; handle preserves normal directive
    // sorting within copied routes (asset redirects before the SPA fallback).
    // Defer the header assignment so copied routes/upstreams cannot replace it.
    const generated = [START, `http://:${port} {`, '    bind 127.0.0.1',
        `    ${RESERVED_MATCHER} not host ${tunnelHost}`,
        `    ${DYNAMIC_MATCHER} path /v1/* /v2/* /v3/* /v4/* /files/* /health /v1/updates*`, '    route {',
        `        respond ${RESERVED_MATCHER} 421`,
        `        header ${DYNAMIC_MATCHER} >Cache-Control no-store`, '        handle {',
        ...application, '        }', '    }', '}', END];
    if (managed) {
        lines.splice(managed.start, managed.end - managed.start + 1, ...generated);
        return lines.join(newline);
    }
    return source + (source.endsWith(newline) ? newline : newline + newline) + generated.join(newline) + newline;
}

async function main() {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath || !outputPath) throw new Error('Usage: node scripts/configure-production-tunnel-caddy.mjs <input> <output>');
    const source = await readFile(inputPath, 'utf8');
    const configured = configureProductionTunnelCaddy(source);
    await writeFile(outputPath, configured, 'utf8');
    process.stdout.write(configured === source ? 'unchanged\n' : 'changed\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
