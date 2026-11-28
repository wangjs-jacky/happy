import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const PUBLIC_SHARE_CADDY_BLOCK_START = '# paws-public-session-share:start';
export const PUBLIC_SHARE_CADDY_BLOCK_END = '# paws-public-session-share:end';
export const WEB_OSS_CADDY_BLOCK_START = '# paws-web-oss:start';
export const WEB_OSS_CADDY_BLOCK_END = '# paws-web-oss:end';
export const LEGACY_WEB_REDIRECT_CADDY_BLOCK_START = '# paws-web-legacy-redirect:start';
export const LEGACY_WEB_REDIRECT_CADDY_BLOCK_END = '# paws-web-legacy-redirect:end';
export const PRODUCTION_CADDY_GRACE_PERIOD = '10s';
export const PRODUCTION_WEB_OSS_HOST = 'happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com';
export const PRODUCTION_WEB_OSS_ORIGIN = `https://${PRODUCTION_WEB_OSS_HOST}`;
const REQUIRED_BACKEND_PATHS = ['/v1/*', '/v2/*', '/v3/*', '/v4/*', '/files/*', '/health'];
const CANVAS_PUBLIC_FILES = [
    String.raw`index\.html`,
    String.raw`canvas\.(?:css|js)`,
    String.raw`canvas\.js\.LEGAL\.txt`,
    String.raw`NOTICE\.txt`,
    String.raw`DSH-Image-Gen-LICENSE\.txt`,
    String.raw`tldraw-LICENSE\.md`,
    String.raw`upstream-build\.json`,
    String.raw`assets/fonts/[A-Za-z0-9_-]+\.woff2`,
    String.raw`assets/icons/icon/[A-Za-z0-9_-]+\.svg`,
    String.raw`assets/icons/icon/icon-names\.json`,
    String.raw`assets/translations/[A-Za-z0-9_-]+\.json`,
    String.raw`assets/embed-icons/[A-Za-z0-9_-]+\.png`,
].join('|');

const PUBLIC_SHARE_CADDY_LINES = [
    PUBLIC_SHARE_CADDY_BLOCK_START,
    '@public_session_share path /share/*',
    'header @public_session_share {',
    '    Cache-Control "no-store"',
    `    Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' ${PRODUCTION_WEB_OSS_ORIGIN}; style-src 'self' 'unsafe-inline' ${PRODUCTION_WEB_OSS_ORIGIN}; img-src 'self' data: blob: https: http:; media-src 'self' blob: https: http:; connect-src 'self' https: http:; font-src 'self' data: ${PRODUCTION_WEB_OSS_ORIGIN}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"`,
    '    X-Robots-Tag "noindex, nofollow, noarchive"',
    '    X-Content-Type-Options "nosniff"',
    '    Referrer-Policy "no-referrer"',
    '}',
    PUBLIC_SHARE_CADDY_BLOCK_END,
];

export const PROJECT_CANVAS_CADDY_LINES = Object.freeze([
    '@paws_canvas_prefix path /dsh-image-canvas /dsh-image-canvas/*',
    'handle @paws_canvas_prefix {',
    '    @paws_canvas_file {',
    '        method GET HEAD',
    `        path_regexp paws_canvas ^/dsh-image-canvas/([a-f0-9]{40})/(${CANVAS_PUBLIC_FILES})$`,
    '    }',
    '    handle @paws_canvas_file {',
    '        encode zstd gzip',
    '        rewrite * /web/releases/{re.paws_canvas.1}/dsh-image-canvas/{re.paws_canvas.2}?',
    `        reverse_proxy ${PRODUCTION_WEB_OSS_ORIGIN} {`,
    `            header_up Host ${PRODUCTION_WEB_OSS_HOST}`,
    '            header_up -Authorization',
    '            header_up -Cookie',
    '            header_down -Set-Cookie',
    '            header_down -Content-Disposition',
    '            header_down +Vary Accept-Encoding',
    '            header_down X-Content-Type-Options nosniff',
    '            header_down X-Frame-Options SAMEORIGIN',
    '        }',
    '    }',
    '    handle {',
    '        respond 404',
    '    }',
    '}',
]);

const WEB_OSS_CADDY_LINES = [
    WEB_OSS_CADDY_BLOCK_START,
    '@paws_web_asset path /_expo/* /assets/* /desktop-skins/* /.well-known/* /canvaskit.wasm /favicon.ico /favicon-active.ico /metadata.json',
    `redir @paws_web_asset ${PRODUCTION_WEB_OSS_ORIGIN}{uri} 302`,
    ...PROJECT_CANVAS_CADDY_LINES,
    'handle {',
    '    header >Cache-Control "no-store"',
    '    rewrite * /web/current/index.html',
    `    reverse_proxy ${PRODUCTION_WEB_OSS_ORIGIN} {`,
    `        header_up Host ${PRODUCTION_WEB_OSS_HOST}`,
    '        header_down -Content-Disposition',
    '        header_down Content-Type "text/html; charset=utf-8"',
    '    }',
    '}',
    WEB_OSS_CADDY_BLOCK_END,
];

const LEGACY_WEB_REDIRECT_CADDY_LINES = [
    LEGACY_WEB_REDIRECT_CADDY_BLOCK_START,
    'redir https://47.115.228.20:8443{uri} 308',
    LEGACY_WEB_REDIRECT_CADDY_BLOCK_END,
];

function braceDelta(line) {
    const content = line.split('#', 1)[0];
    return (content.match(/{/g) ?? []).length - (content.match(/}/g) ?? []).length;
}

function findManagedRange(lines, startMarker, endMarker) {
    const start = lines.findIndex((line) => line.trim() === startMarker);
    const end = lines.findIndex((line) => line.trim() === endMarker);
    if ((start < 0) !== (end < 0) || (start >= 0 && end < start)) {
        throw new Error(`Existing managed Caddy block is incomplete: ${startMarker}`);
    }
    return start < 0 ? null : { start, end };
}

function findBlockEnd(lines, start) {
    let depth = 0;
    for (let index = start; index < lines.length; index += 1) {
        depth += braceDelta(lines[index]);
        if (index > start && depth === 0) return index;
    }
    throw new Error(`Caddy block is unbalanced at line ${start + 1}`);
}

function configureLegacyWebRedirect(lines, siteAddress = ':8080') {
    const siteStart = lines.findIndex((line) => line.trim() === `${siteAddress} {`);
    if (siteStart < 0) return;
    const siteEnd = findBlockEnd(lines, siteStart);
    const siteLines = lines.slice(siteStart + 1, siteEnd);
    const managedRange = findManagedRange(
        siteLines,
        LEGACY_WEB_REDIRECT_CADDY_BLOCK_START,
        LEGACY_WEB_REDIRECT_CADDY_BLOCK_END,
    );
    const referencesLegacyDirectory = siteLines.some((line) => line.includes('/var/www/happy-web'));
    if (!managedRange && !referencesLegacyDirectory) return;

    const unmanagedLines = siteLines.filter((line, index) => (
        !managedRange || index < managedRange.start || index > managedRange.end
    ));
    const allowedLegacyDirective = /^\s*(?:root\s+\*\s+\/var\/www\/happy-web|encode\s+\S+(?:\s+\S+)*|try_files\s+\{path\}\s+\/index\.html|file_server)\s*$/;
    const unexpectedDirective = unmanagedLines.find((line) => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('#') && !allowedLegacyDirective.test(line);
    });
    if (unexpectedDirective) {
        throw new Error(`Unexpected directive in ${siteAddress} legacy Web site: ${unexpectedDirective.trim()}`);
    }

    const indentation = siteLines.find((line) => line.trim().length > 0)?.match(/^\s*/)?.[0] ?? '\t';
    lines.splice(
        siteStart + 1,
        siteEnd - siteStart - 1,
        ...LEGACY_WEB_REDIRECT_CADDY_LINES.map((line) => `${indentation}${line}`),
    );
}

function configureGracePeriod(lines) {
    const firstDirective = lines.findIndex((line) => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('#');
    });

    if (firstDirective < 0 || lines[firstDirective].trim() !== '{') {
        lines.unshift(
            '{',
            `\tgrace_period ${PRODUCTION_CADDY_GRACE_PERIOD}`,
            '}',
            '',
        );
        return;
    }

    let globalEnd = -1;
    let depth = 0;
    for (let index = firstDirective; index < lines.length; index += 1) {
        depth += braceDelta(lines[index]);
        if (index > firstDirective && depth === 0) {
            globalEnd = index;
            break;
        }
    }
    if (globalEnd < 0) throw new Error('Caddy global options block is unbalanced');

    const gracePeriod = lines.findIndex(
        (line, index) => index > firstDirective && index < globalEnd && /^\s*grace_period\s+/.test(line),
    );
    if (gracePeriod >= 0) {
        const indentation = lines[gracePeriod].match(/^\s*/)?.[0] ?? '\t';
        lines[gracePeriod] = `${indentation}grace_period ${PRODUCTION_CADDY_GRACE_PERIOD}`;
        return;
    }

    const firstOption = lines.slice(firstDirective + 1, globalEnd).find((line) => line.trim().length > 0);
    const indentation = firstOption?.match(/^\s*/)?.[0] ?? '\t';
    lines.splice(firstDirective + 1, 0, `${indentation}grace_period ${PRODUCTION_CADDY_GRACE_PERIOD}`);
}

export function configureProductionWebCaddy(source, siteAddress = '47.115.228.20:8443') {
    const hadFinalNewline = source.endsWith('\n');
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    configureGracePeriod(lines);
    const siteStart = lines.findIndex((line) => line.trim() === `${siteAddress} {`);
    if (siteStart < 0) throw new Error(`Caddy site block not found: ${siteAddress}`);

    let depth = 0;
    let siteEnd = -1;
    for (let index = siteStart; index < lines.length; index += 1) {
        depth += braceDelta(lines[index]);
        if (index > siteStart && depth === 0) {
            siteEnd = index;
            break;
        }
    }
    if (siteEnd < 0) throw new Error(`Caddy site block is unbalanced: ${siteAddress}`);

    const siteLines = lines.slice(siteStart + 1, siteEnd);
    const publicShareRange = findManagedRange(
        siteLines,
        PUBLIC_SHARE_CADDY_BLOCK_START,
        PUBLIC_SHARE_CADDY_BLOCK_END,
    );
    if (publicShareRange) {
        siteLines.splice(publicShareRange.start, publicShareRange.end - publicShareRange.start + 1);
    }

    const existingWebRange = findManagedRange(
        siteLines,
        WEB_OSS_CADDY_BLOCK_START,
        WEB_OSS_CADDY_BLOCK_END,
    );
    let webInsertionIndex;
    let webIndentation;
    if (existingWebRange) {
        webInsertionIndex = existingWebRange.start;
        webIndentation = siteLines[existingWebRange.start].match(/^\s*/)?.[0] ?? '\t';
        siteLines.splice(existingWebRange.start, existingWebRange.end - existingWebRange.start + 1);
    } else {
        const legacyHandleStart = siteLines.findIndex((line, index) => {
            if (!/^\s*handle\s*\{\s*$/.test(line)) return false;
            const end = findBlockEnd(siteLines, index);
            return siteLines.slice(index, end + 1).some((candidate) => candidate.includes('/var/www/happy-web'));
        });
        if (legacyHandleStart < 0) {
            throw new Error(`Legacy Web filesystem handler not found in ${siteAddress}`);
        }
        const legacyHandleEnd = findBlockEnd(siteLines, legacyHandleStart);
        webInsertionIndex = legacyHandleStart;
        webIndentation = siteLines[legacyHandleStart].match(/^\s*/)?.[0] ?? '\t';
        siteLines.splice(legacyHandleStart, legacyHandleEnd - legacyHandleStart + 1);
    }
    siteLines.splice(
        webInsertionIndex,
        0,
        ...WEB_OSS_CADDY_LINES.map((line) => `${webIndentation}${line}`),
    );

    const backendIndex = siteLines.findIndex((line) => /^\s*@backend\s+path\s+/.test(line));
    if (backendIndex < 0) throw new Error(`@backend path matcher not found in ${siteAddress}`);
    const indentation = siteLines[backendIndex].match(/^\s*/)?.[0] ?? '\t';
    const backendTokens = siteLines[backendIndex].trim().split(/\s+/);
    const additionalBackendPaths = backendTokens
        .slice(2)
        .filter((token) => token !== '/share/*' && !REQUIRED_BACKEND_PATHS.includes(token));
    siteLines[backendIndex] = `${indentation}@backend path ${[...REQUIRED_BACKEND_PATHS, ...additionalBackendPaths].join(' ')}`;
    siteLines.splice(
        backendIndex,
        0,
        ...PUBLIC_SHARE_CADDY_LINES.map((line) => `${indentation}${line}`),
    );

    lines.splice(siteStart + 1, siteEnd - siteStart - 1, ...siteLines);
    configureLegacyWebRedirect(lines);
    const result = lines.join('\n');
    if (result.includes('/var/www/happy-web')) {
        throw new Error('Configured Caddyfile still references the legacy Web directory');
    }
    return hadFinalNewline && !result.endsWith('\n') ? `${result}\n` : result;
}

function topLevelLineIndexes(lines) {
    const indexes = [];
    let depth = 0;
    for (let index = 0; index < lines.length; index += 1) {
        if (depth === 0) indexes.push(index);
        depth += braceDelta(lines[index]);
        if (depth < 0) throw new Error('Unbalanced secondary OSS fallback configuration.');
    }
    if (depth !== 0) throw new Error('Unbalanced secondary OSS fallback configuration.');
    return indexes;
}

const directiveLines = lines => lines.map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const normalizedDirective = line => line.trim().replace(/\s+/g, ' ');

function assertLegacyOssFallback(site, topLevel, start, end, directBody) {
    const assetMatchers = topLevel.filter(index => /^\s*@oss(?:\s|$)/.test(site[index]));
    const assetHandlers = topLevel.filter(index => /^\s*handle\s+@oss\s*\{\s*$/.test(site[index]));
    const expectedMatcher = '@oss path /_expo/* /assets/* /desktop-skins/* /canvaskit.wasm /favicon.ico /favicon-active.ico /metadata.json';
    if (assetMatchers.length !== 1 || normalizedDirective(site[assetMatchers[0]]) !== expectedMatcher || assetHandlers.length !== 1) {
        throw new Error('Expected the unique canonical legacy OSS asset matcher and handler.');
    }
    const assetEnd = findBlockEnd(site, assetHandlers[0]);
    const assetBody = directiveLines(site.slice(assetHandlers[0] + 1, assetEnd)).map(normalizedDirective);
    if (assetBody.length !== 1 || assetBody[0] !== `redir ${PRODUCTION_WEB_OSS_ORIGIN}{uri} 302`) {
        throw new Error('Expected the canonical legacy OSS asset redirect.');
    }
    const shell = directBody.filter(line => !/^header\s+>?Cache-Control(?:\s|$)/i.test(line)).map(normalizedDirective);
    if (shell.length !== 2 || shell[0] !== 'rewrite * /web/current/index.html'
        || shell[1] !== `reverse_proxy ${PRODUCTION_WEB_OSS_ORIGIN} {`) {
        throw new Error('Expected the canonical legacy OSS SPA fallback directives.');
    }
    const proxyStart = site.findIndex((line, index) => index > start && index < end && normalizedDirective(line) === shell[1]);
    const proxyEnd = findBlockEnd(site, proxyStart);
    const options = directiveLines(site.slice(proxyStart + 1, proxyEnd)).map(normalizedDirective);
    const expectedOptions = [`header_up Host ${PRODUCTION_WEB_OSS_HOST}`, 'header_down -Content-Disposition',
        'header_down Content-Type "text/html; charset=utf-8"'];
    if (options.length !== expectedOptions.length || options.some((line, index) => line !== expectedOptions[index])) {
        throw new Error('Expected the canonical legacy OSS SPA proxy options.');
    }
}

// Scope the policy to one top-level application shell. Old secondary configs
// have no managed Web markers, so admit only their exact legacy OSS identity.
function configureSpaHtmlCachePolicy(site) {
    const range = findManagedRange(site, WEB_OSS_CADDY_BLOCK_START, WEB_OSS_CADDY_BLOCK_END);
    const markers = site.filter(line => /\bpaws-web-oss\b/i.test(line));
    if (markers.length && (!range || markers.length !== 2
        || site.filter(line => line.trim() === WEB_OSS_CADDY_BLOCK_START).length !== 1
        || site.filter(line => line.trim() === WEB_OSS_CADDY_BLOCK_END).length !== 1)) {
        throw new Error('Managed OSS Web handler not found or ambiguous in the secondary site.');
    }
    const topLevel = topLevelLineIndexes(site);
    const fallbacks = topLevel.filter(index => /^\s*handle\s*\{\s*$/.test(site[index]));
    if (fallbacks.length !== 1) throw new Error('Expected one top-level managed OSS SPA fallback in the secondary site.');
    const start = fallbacks[0];
    const end = findBlockEnd(site, start);
    if (range && (start <= range.start || end >= range.end || !topLevel.includes(range.start) || !topLevel.includes(range.end))) {
        throw new Error('Expected one managed OSS SPA fallback inside the approved Web block.');
    }
    const body = site.slice(start + 1, end);
    const directBody = directiveLines(topLevelLineIndexes(body).map(index => body[index]));
    const rewrites = body.filter(line => /^\s*rewrite\s+/.test(line));
    const proxies = body.filter(line => /^\s*reverse_proxy\s+/.test(line));
    if (rewrites.length !== 1 || proxies.length !== 1 || !directBody.includes(rewrites[0].trim()) || !directBody.includes(proxies[0].trim())
        || !/^\s*rewrite\s+\*\s+\/web\/current\/index\.html\s*$/.test(rewrites[0])
        || ![ `reverse_proxy ${PRODUCTION_WEB_OSS_ORIGIN}`, `reverse_proxy ${PRODUCTION_WEB_OSS_ORIGIN} {` ].includes(proxies[0].trim())) {
        throw new Error('Expected the canonical direct rewrite and proxy in the managed OSS SPA fallback.');
    }
    if (!range) assertLegacyOssFallback(site, topLevel, start, end, directBody);
    const existing = [];
    for (let index = start + 1; index < end; index += 1) {
        if (/^\s*header\s+>?Cache-Control(?:\s|$)/i.test(site[index])) existing.push(index);
        if (/^\s*Cache-Control\s+/i.test(site[index])) {
            throw new Error('Unsupported block Cache-Control policy in the secondary SPA fallback.');
        }
    }
    if (existing.length > 1) throw new Error('Ambiguous Cache-Control policies in the secondary SPA fallback.');
    const index = existing[0] ?? start + 1;
    const indentation = site[index].match(/^\s*/)?.[0] ?? '        ';
    const policy = `${indentation}header >Cache-Control "no-store"`;
    if (existing.length) site[index] = policy;
    else site.splice(index, 0, policy);
}

export function configureSecondaryCanvasCaddy(source, siteAddress = '121.43.32.242:8443') {
    if (siteAddress !== '121.43.32.242:8443') throw new Error('Expected the approved secondary canvas site address.');
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    configureGracePeriod(lines);
    const start = lines.findIndex(line => line.trim() === `${siteAddress} {`);
    if (start < 0) throw new Error(`Caddy site block not found: ${siteAddress}`);
    const end = findBlockEnd(lines, start);
    const site = lines.slice(start + 1, end);
    const range = findManagedRange(site, '# paws-secondary-canvas:start', '# paws-secondary-canvas:end');
    if (range) site.splice(range.start, range.end - range.start + 1);
    if (site.some(line => /paws_canvas|dsh-image-canvas/.test(line))) {
        throw new Error('Found an unmanaged canvas handler in the secondary site; review before replacing it.');
    }
    configureSpaHtmlCachePolicy(site);
    const indentation = site.find(line => line.trim())?.match(/^\s*/)?.[0] ?? '    ';
    const canvas = ['# paws-secondary-canvas:start', ...PROJECT_CANVAS_CADDY_LINES, '# paws-secondary-canvas:end'];
    site.unshift(...canvas.map(line => indentation + line));
    lines.splice(start + 1, end - start - 1, ...site);
    return lines.join('\n');
}

async function main() {
    const [inputPath, outputPath, siteAddress] = process.argv.slice(2);
    if (!inputPath || !outputPath) {
        throw new Error('Usage: node scripts/configure-production-web-caddy.mjs <input> <output> [site-address|--secondary-canvas]');
    }
    const source = await readFile(inputPath, 'utf8');
    const configured = siteAddress === '--secondary-canvas'
        ? configureSecondaryCanvasCaddy(source) : configureProductionWebCaddy(source, siteAddress);
    await writeFile(outputPath, configured, 'utf8');
    process.stdout.write(configured === source ? 'unchanged\n' : 'changed\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
