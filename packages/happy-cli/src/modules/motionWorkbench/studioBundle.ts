/** Build an isolated editor from the user's installed GPL runtime; never ship it in Paws sources. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import type { BuildOptions, BuildResult, Plugin } from 'esbuild';
import { studioHostEntry } from './studioHostEntry';

export type NativeStudio = { origin: string; base: string; api: string; version: string; state: Record<string, unknown> };
type Bundler = { build(options: BuildOptions): Promise<BuildResult> };
export class NativeStudioRequestError extends Error { constructor(readonly status: number) { super(`Editor request failed (${status})`); } }

export async function readNativeResponse(url: string, options: RequestInit = {}, limit = 4 * 1024 * 1024): Promise<{ bytes: Buffer; mime: string }> {
    const response = await fetch(url, { ...options, redirect: 'error', signal: options.signal ?? AbortSignal.timeout(30000) });
    if (!response.ok || !response.body) throw new NativeStudioRequestError(response.status);
    if (Number(response.headers.get('content-length')) > limit) throw new Error('Editor resource exceeds size limit');
    const chunks: Buffer[] = []; let length = 0;
    const reader = response.body.getReader();
    try {
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > limit) throw new Error('Editor resource exceeds size limit');
            chunks.push(Buffer.from(chunk.value));
        }
    } finally { await reader.cancel().catch(() => {}); }
    return { bytes: Buffer.concat(chunks), mime: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
}

async function installedRuntime(version: string): Promise<string> {
    const candidates: string[] = [];
    if (process.env.PAWS_MOTIONHARNESS_RUNTIME) candidates.push(process.env.PAWS_MOTIONHARNESS_RUNTIME);
    else {
        if (process.platform !== 'darwin') throw new Error('Configure PAWS_MOTIONHARNESS_RUNTIME on this execution machine');
        const cache = join(homedir(), 'Library/Caches/mh/runtime');
        for (const directory of await readdir(cache)) candidates.push(join(cache, directory));
    }
    const matches: string[] = [];
    for (const candidate of candidates) {
        try {
            const pkg = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8')) as { name?: string; version?: string };
            if (pkg.name !== '@motionharness/cli' || pkg.version !== version) continue;
            const studio = JSON.parse(await readFile(join(candidate, 'node_modules/@motionharness/studio/package.json'), 'utf8')) as { license?: string };
            if (studio.license !== 'GPL-3.0-only') continue;
            matches.push(await realpath(candidate));
        } catch { /* Unrelated or incomplete native cache. */ }
    }
    if (matches.length !== 1) throw new Error('Configure the matching PAWS_MOTIONHARNESS_RUNTIME; runtime selection is ambiguous or unavailable');
    return matches[0];
}

/** Only document fields needed by Studio cross the boundary, without native access URLs/leases. */
export function publicStudioState(native: Record<string, unknown>): Record<string, unknown> {
    const keys = ['schema', 'buildId', 'generation', 'sourceRevision', 'error', 'preparing', 'sourceCurrent', 'documentConflict',
        'historyOperation', 'document', 'history', 'undoHistory', 'editHistory', 'uiPreferences', 'sourceAssets', 'assets', 'export', 'projectDirectory'];
    return { ...Object.fromEntries(keys.filter(key => key in native).map(key => [key, native[key]])), styles: [] };
}

export async function buildStudioBundle(native: NativeStudio): Promise<{ bytes: Buffer; sha256: string; uncompressedBytes: number }> {
    if (native.version !== '0.1.8') throw new Error('This editor adapter currently supports MotionHarness 0.1.8');
    const runtime = await installedRuntime(native.version);
    const bundler = createRequire(join(runtime, 'package.json'))('esbuild') as Bundler;
    const buildRoot = `${native.origin}${native.base}/build/${encodeURIComponent(String(native.state.generation))}/`;
    const html = (await readNativeResponse(native.origin + native.base + '/')).bytes.toString('utf8');
    const imports = (JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] || '{}') as { imports?: Record<string, string> }).imports ?? {};
    const platform = new Map(Object.entries(imports).map(([specifier, path]) => [new URL(path, native.origin).href, specifier]));
    const nativeModules: Plugin = { name: 'paws-native-composition', setup(build) {
        build.onResolve({ filter: /^paws:composition$/ }, () => ({ path: buildRoot + 'discovery.js', namespace: 'paws-native' }));
        build.onResolve({ filter: /.*/, namespace: 'paws-native' }, async args => {
            if (!args.path.startsWith('.') && !args.path.startsWith('/') && !args.path.includes('://')) {
                return build.resolve(args.path, { resolveDir: runtime, kind: 'import-statement' });
            }
            const url = new URL(args.path, args.importer).href;
            const specifier = platform.get(url);
            if (specifier) return build.resolve(specifier, { resolveDir: runtime, kind: 'import-statement' });
            if (!url.startsWith(buildRoot) || !/\.m?js$/.test(new URL(url).pathname)) throw new Error('Composition import is outside its native build');
            return { path: url, namespace: 'paws-native' };
        });
        build.onLoad({ filter: /.*/, namespace: 'paws-native' }, async args => ({ contents: (await readNativeResponse(args.path)).bytes.toString('utf8'), loader: 'js' }));
        // Native build CSS already includes both Studio and author styles.
        build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'css' }));
        build.onLoad({ filter: /[/\\]studio[/\\]CompositionStudio\.js$/ }, async args => {
            let source = await readFile(args.path, 'utf8');
            const timer = 'const timer = setInterval(report, 100);\n        return () => clearInterval(timer);';
            if (!source.includes(timer)) throw new Error('Installed Studio observer contract changed');
            source = source.replace(timer, 'const stopView = studioSession.subscribe(report), stopPlayback = playback.subscribe(report);\n        return () => { stopView(); stopPlayback(); };');
            source = source.replace('agentHook: !props.managedTutorial', 'agentHook: false');
            source = source.replace("setFailure(String(cause));", "{ setFailure(String(cause)); window.dispatchEvent(new CustomEvent('paws-native-diagnostic', { detail: cause instanceof Error ? cause.stack : String(cause) })); }");
            return { contents: source, loader: 'js', resolveDir: resolve(args.path, '..') };
        });
        // The native export preview uses a polling loop. Paws owns export delivery.
        build.onLoad({ filter: /[/\\]studio[/\\]studio-product\.js$/ }, async args => {
            const source = await readFile(args.path, 'utf8');
            if (!source.includes('export: true')) throw new Error('Installed Studio feature contract changed');
            return { contents: source.replace('export: true', 'export: false'), loader: 'js', resolveDir: resolve(args.path, '..') };
        });
    } };
    let css = '';
    for (const path of native.state.styles as string[]) {
        const url = new URL(path, buildRoot);
        if (!url.href.startsWith(buildRoot)) throw new Error('Style is outside native build');
        const source = (await readNativeResponse(url.href)).bytes.toString('utf8');
        for (const match of source.matchAll(/url\(\s*("[^"]*"|'[^']*'|[^)]*)\s*\)/gi)) {
            const reference = match[1].trim().replace(/^["']|["']$/g, '');
            if (!reference.startsWith('data:') && !reference.startsWith('#')) throw new Error('External Studio CSS resources require explicit packaging');
        }
        css += source;
    }
    css += '\n.studio-notes-foot{display:none!important}';
    const result = await bundler.build({
        stdin: { contents: studioHostEntry, sourcefile: 'paws-motion-host.js', resolveDir: runtime, loader: 'js' },
        bundle: true, write: false, outfile: 'paws-motion-host.js', format: 'esm', platform: 'browser', target: 'chrome120',
        minifyWhitespace: true, minifySyntax: true, keepNames: true, legalComments: 'inline', nodePaths: [join(runtime, 'node_modules')], plugins: [nativeModules],
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    const script = result.outputFiles?.find(file => file.path.endsWith('.js'))?.text;
    if (!script) throw new Error('Editor bundle was not produced');
    if (script.includes(native.base) || css.includes(native.base)) throw new Error('Native credentials must stay on the execution machine');
    const licenseText = await readFile(join(runtime, 'node_modules/@motionharness/studio/LICENSE'), 'utf8');
    const payload = Buffer.from(JSON.stringify({ script, css, license: 'GPL-3.0-only', licenseText, runtimeVersion: native.version,
        modifications: 'Paws transport, event-driven project host and view subscription adapter. Original installed runtime remains unchanged.' }));
    if (payload.length > 24 * 1024 * 1024) throw new Error('Editor bundle exceeds size limit');
    const bytes = gzipSync(payload);
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), uncompressedBytes: payload.length };
}
