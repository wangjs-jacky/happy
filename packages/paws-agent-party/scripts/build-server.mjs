import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

await Promise.all([
  rm(new URL('../dist/server.mjs', import.meta.url), { force: true }),
  rm(new URL('../dist/server.mjs.map', import.meta.url), { force: true }),
]);
await build({
  entryPoints: [new URL('../src/server/http.ts', import.meta.url).pathname],
  outfile: new URL('../dist/server.mjs', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
});
