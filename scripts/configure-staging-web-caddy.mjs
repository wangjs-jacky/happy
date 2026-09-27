import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const STAGING_WEB_BLOCK_START = '# paws-web-staging:start';
export const STAGING_WEB_BLOCK_END = '# paws-web-staging:end';
export const STAGING_WEB_ORIGIN = 'https://47.115.228.20:8444';

const STAGING_WEB_BLOCK = `${STAGING_WEB_BLOCK_START}
47.115.228.20:8444 {
    tls /etc/caddy/ip-letsencrypt-fullchain.pem /etc/caddy/ip-letsencrypt-key.pem
    encode zstd gzip
    header {
        X-Robots-Tag "noindex, nofollow, noarchive"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
        Cache-Control "no-store"
    }
    @backend path /v1/* /v2/* /v3/* /v4/* /files/* /health /socket.io/* /socket/*
    handle @backend {
        reverse_proxy 100.116.134.122:3305 {
            stream_close_delay 5m
        }
    }
    @validate {
        path /
        header Accept *text/plain*
    }
    handle @validate {
        reverse_proxy 100.116.134.122:3305 {
            stream_close_delay 5m
        }
    }
    handle {
        root * /var/www/paws-web-staging/current
        try_files {path} /index.html
        file_server
    }
}
${STAGING_WEB_BLOCK_END}`;

/** Add an isolated site without editing any existing production Caddy lines. */
export function configureStagingWebCaddy(source) {
    const startCount = source.split(STAGING_WEB_BLOCK_START).length - 1;
    const endCount = source.split(STAGING_WEB_BLOCK_END).length - 1;
    if (startCount !== endCount || startCount > 1) {
        throw new Error('Existing staging Caddy block is incomplete or duplicated');
    }
    if (startCount === 1) {
        const start = source.indexOf(STAGING_WEB_BLOCK_START);
        const end = source.indexOf(STAGING_WEB_BLOCK_END, start) + STAGING_WEB_BLOCK_END.length;
        if (source.slice(start, end) !== STAGING_WEB_BLOCK) {
            throw new Error('Existing staging Caddy block differs from the expected configuration');
        }
        return source;
    }
    if (/^\s*[^\n#]*:8444\s*\{/m.test(source)) {
        throw new Error('Port 8444 is already used by an unmanaged Caddy site');
    }
    return `${source.trimEnd()}\n\n${STAGING_WEB_BLOCK}\n`;
}

async function main() {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath || !outputPath) {
        throw new Error('Usage: node scripts/configure-staging-web-caddy.mjs <input> <output>');
    }
    const source = await readFile(inputPath, 'utf8');
    const configured = configureStagingWebCaddy(source);
    await writeFile(outputPath, configured, 'utf8');
    process.stdout.write(configured === source ? 'unchanged\n' : 'changed\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
