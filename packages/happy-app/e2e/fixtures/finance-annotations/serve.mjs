import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '../../..');
const output = resolve(process.env.HAPPY_FINANCE_EVIDENCE_DIR || '/tmp/paws-finance-annotations-e2e', 'site');
await mkdir(output, { recursive: true });
await build({ entryPoints: [resolve(here, 'main.tsx')], outfile: resolve(output, 'bundle.js'), bundle: true, resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.ts', '.tsx', '.js', '.android.js', '.json'], platform: 'browser', format: 'iife', jsx: 'automatic', sourcemap: true, define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true', global: 'globalThis', 'process.env': '{}'  }, alias: { 'react-native': 'react-native-web', 'react-native-unistyles': resolve(here, 'theme.ts'), '@': resolve(app, 'sources') } });
await writeFile(resolve(output, 'index.html'), '<!doctype html><html lang="zh" translate="no" class="notranslate"><meta name="google" content="notranslate"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paws K 线 · 组件验收</title><style>html,body,#root{height:100%;}*{box-sizing:border-box;}</style><div id="root"></div><script>window.__errors=[];window.addEventListener("error",e=>window.__errors.push(e.message));window.addEventListener("unhandledrejection",e=>window.__errors.push(String(e.reason)));</script><script src="/bundle.js"></script></html>');
const server = createServer(async (req, res) => {
    const name = req.url?.split('?')[0] === '/bundle.js' ? 'bundle.js' : req.url?.split('?')[0] === '/bundle.js.map' ? 'bundle.js.map' : 'index.html';
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.map') ? 'application/json' : 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store'); res.end(await readFile(resolve(output, name)));
});
server.listen(49819, '127.0.0.1', () => process.stdout.write('Finance actual-component fixture: http://127.0.0.1:49819/?theme=light\n'));