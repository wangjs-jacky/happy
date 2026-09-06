import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const RUNTIME_CONFIG_START = '<!-- paws-web-runtime-server-config:start -->';
export const RUNTIME_CONFIG_END = '<!-- paws-web-runtime-server-config:end -->';

const managed = `${RUNTIME_CONFIG_START}<script>(function(){var l=globalThis.location;if(!l||l.protocol!=="https:"||!["paws.rodeo","47.115.228.20"].includes(l.hostname))return;globalThis.__HAPPY_CONFIG__=Object.assign({},globalThis.__HAPPY_CONFIG__,{serverUrl:l.origin});})();</script>${RUNTIME_CONFIG_END}`;

export function injectWebRuntimeServerConfig(html) {
    const startCount = html.split(RUNTIME_CONFIG_START).length - 1;
    const endCount = html.split(RUNTIME_CONFIG_END).length - 1;

    if (startCount !== endCount || startCount > 1) {
        throw new Error('Web entry has an incomplete managed runtime configuration block.');
    }
    if (startCount === 1) {
        const start = html.indexOf(RUNTIME_CONFIG_START);
        const end = html.indexOf(RUNTIME_CONFIG_END, start);
        if (end < start) {
            throw new Error('Web entry has an incomplete managed runtime configuration block.');
        }
        return `${html.slice(0, start)}${managed}${html.slice(end + RUNTIME_CONFIG_END.length)}`;
    }

    const headEnd = html.search(/<\/head\s*>/i);
    if (headEnd < 0) {
        throw new Error('Web entry has no </head>.');
    }
    return `${html.slice(0, headEnd)}${managed}${html.slice(headEnd)}`;
}

async function main() {
    const [indexPath] = process.argv.slice(2);
    if (!indexPath) {
        throw new Error('Usage: node scripts/inject-web-runtime-server-config.mjs <index.html>');
    }
    const source = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, injectWebRuntimeServerConfig(source), 'utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await main();
}
