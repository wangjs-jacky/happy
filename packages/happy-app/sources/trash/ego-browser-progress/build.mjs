// Controlled component regression: production Skills/steps UI, synthetic session data only.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dir = fileURLToPath(new URL('.', import.meta.url));
const replacements = new Set(['react-native-unistyles', '@expo/vector-icons', '@/text', '@/hooks/useAttachmentImage', '@/sync/openSessionImageViewer', 'react-native-gesture-handler', 'react-native-safe-area-context', '../SessionImageViewer']);
const output = await build({ absWorkingDir: root, entryPoints: [path.join(dir, 'fixture.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
    alias: { 'react-native': 'react-native-web' },
    plugins: [{ name: 'controlled-boundaries', setup(b) { b.onResolve({ filter: /.*/ }, args => replacements.has(args.path) ? { path: path.join(dir, 'boundaries.tsx') } : undefined); } }],
});
const html = '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ego Skills 隔离回归</title><style>html,body,#root{margin:0;min-height:100vh;background:#101e2a;color:#e9f3fa;font-family:system-ui}button{font:inherit;padding:10px;margin:6px}</style><div id="root"></div><script src="/bundle.js"></script></html>';
createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(req.url === '/bundle.js' ? output.outputFiles[0].contents : html);
}).listen(4388, '127.0.0.1', () => console.log('Ego Skills fixture http://127.0.0.1:4388/'));
