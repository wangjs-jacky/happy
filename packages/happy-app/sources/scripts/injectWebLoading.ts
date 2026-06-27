/**
 * Injects a first-paint loading placeholder into the web build's index.html.
 *
 * Why a post-export script instead of app/+html.tsx:
 * the web target uses `web.output: "single"` (SPA). In that mode Expo
 * generates index.html from its built-in template and ignores the <body>
 * customisations in app/+html.tsx. The web bundle is large, so before the
 * JS parses/executes the screen is blank. This injects a pure-CSS spinner
 * that hides itself automatically once React mounts into #root
 * (selector `#root:not(:empty) ~ #app-loading`) — no JS, zero risk.
 *
 * Run after `expo export --platform web` (wired into the `export:web` script).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const indexPath = join(process.cwd(), 'dist', 'index.html');

if (!existsSync(indexPath)) {
    console.error(`[injectWebLoading] ${indexPath} not found. Run "expo export --platform web" first.`);
    process.exit(1);
}

let html = readFileSync(indexPath, 'utf8');

if (html.includes('id="app-loading"')) {
    console.log('[injectWebLoading] placeholder already present, skipping.');
    process.exit(0);
}

const anchor = '<div id="root"></div>';
if (!html.includes(anchor)) {
    console.error('[injectWebLoading] could not find the <div id="root"></div> anchor in index.html.');
    process.exit(1);
}

const placeholder = `
    <div id="app-loading">
      <div id="app-loading-spinner"></div>
      <div id="app-loading-text">Paws 加载中…</div>
    </div>
    <style id="app-loading-style">
      #app-loading { position: fixed; inset: 0; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background-color: #000; color: #6b6b76; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 14px; letter-spacing: 0.02em; }
      @media (prefers-color-scheme: light) { #app-loading { background-color: #fff; color: #888; } }
      #app-loading-spinner { width: 38px; height: 38px; border: 3px solid rgba(127, 127, 127, 0.18); border-top-color: #00ff88; border-radius: 50%; animation: app-loading-spin 0.8s linear infinite; }
      @keyframes app-loading-spin { to { transform: rotate(360deg); } }
      /* Once React renders content into #root, the placeholder hides itself. */
      #root:not(:empty) ~ #app-loading { display: none; }
    </style>`;

html = html.replace(anchor, anchor + placeholder);
writeFileSync(indexPath, html, 'utf8');
console.log('[injectWebLoading] injected first-paint loading placeholder into dist/index.html.');
