# Task 12 report — isolated MCP App sandbox endpoint

Commit message: `feat(server): serve isolated MCP App sandbox`

## Delivered

- Added fail-closed origin/configuration helpers for `HAPPY_MCP_APP_SANDBOX_ORIGIN` and comma-separated `HAPPY_MCP_APP_PARENT_ORIGINS`. Sandbox Host, requested parent, and request Host are normalized and matched exactly; the parent must remain a different origin.
- Added canonical base64url CSP metadata handling with only `connectDomains`, `resourceDomains`, and `frameDomains`, an 8 KiB encoded ceiling, 32-origin category ceilings, deduplication, strict HTTPS production origins, and development-only loopback HTTP.
- Added exact sandbox-host-only `GET /mcp-app-sandbox/host` and `/mcp-app-sandbox/host.js` routes before static fallback. Invalid/missing configuration, Host, parent, or CSP data returns the same no-store `{ "error": "Not found" }` response.
- Added exact `OPTIONS` deny routes because the server's global wildcard CORS plugin otherwise answered sandbox preflight. Sandbox responses explicitly disable route CORS and remove every `Access-Control-Allow-*` header.
- Extended the existing deterministic Host Shell generator to emit a separate server HTML/external JavaScript asset from the same esbuild bundle while leaving the native inline Host Shell byte-for-byte unchanged.
- The external proxy bootstrap revalidates the exact `parentOrigin`, exact `document.referrer` origin, cross-origin top-window isolation, exact parent `event.source`/`event.origin`, and the 256 KiB bridge ceiling. Every parent-facing `postMessage` uses the validated exact target origin.
- Excluded every unmatched `/mcp-app-sandbox/*` URL from the self-hosted SPA fallback without changing normal Web routes.

## TDD evidence

- Initial RED: both requested suites failed collection because `mcpAppSandboxSecurity` and `mcpAppSandboxRoutes` did not exist (2 failed suites, 0 tests collected).
- Pure helper GREEN: the first security implementation passed 27/27 tests.
- Route/registration RED: the route suite still failed module resolution, and the new SPA exclusion regression failed because `isSpaFallbackExcludedUrl` did not exist.
- CORS self-review RED: the nine-test route suite had 1 failure because global `@fastify/cors` returned `204` for an attacker preflight. Exact deny routes changed it to the required no-store 404 with no allow-origin header.
- Origin normalization RED: the 29-test helper suite had 2 failures because URL parsing normalized `/.` and `/%2e` back to `/`. Raw authority-only validation now rejects both before URL canonicalization.
- Double-origin RED: the 30-test helper suite had 1 failure because an explicitly allowlisted same-origin parent was accepted. Configuration now fails closed if any parent allowlist entry equals the sandbox origin.
- Final focused GREEN: 2 requested files, 40/40 tests. API/static regression adds 4/4 passing tests. Existing native Host Shell suite passes 20/20.

## Exact response contract

HTML 200 responses set:

```text
Cache-Control: no-store
Content-Type: text/html; charset=utf-8
Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: <declared resources>; media-src blob: <declared resources>; font-src data: <declared resources>; connect-src <declared connects or 'none'>; frame-src 'self' <declared frames>; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors <exact parent>
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=(), clipboard-write=()
Cross-Origin-Resource-Policy: cross-origin
```

JavaScript 200 responses set `text/javascript; charset=utf-8`, `no-store`, `nosniff`, and `Cross-Origin-Resource-Policy: same-origin`. Neither route emits permissive CORS.

## Generated-asset evidence

- `packages/happy-server/sources/app/api/generated/mcpAppHostShellAssets.ts`: 362,781 bytes, deterministic server HTML plus external JavaScript.
- Generated external JavaScript VM smoke: 350,594 bytes; emitted exactly one `sandbox-proxy-ready` to target `https://paws.example`; installed two Host/proxy listeners; no wildcard parent target.
- `git diff --exit-code 348e985e -- packages/happy-app/sources/components/tools/mcpApps/generated/hostShellBundle.ts`: exit 0. Native output remains 361,233 bytes and unchanged from the Task 12 baseline.

## Verification

```text
pnpm --filter happy-app run build:mcp-app-host-shell
exit 0

pnpm --filter happy-server-self-host exec vitest run sources/app/api/mcpAppSandboxSecurity.spec.ts sources/app/api/routes/mcpAppSandboxRoutes.spec.ts
Test Files  2 passed (2)
Tests       40 passed (40)

pnpm --filter happy-server-self-host exec vitest run sources/app/api/publicShareDocumentSecurity.spec.ts
Test Files  1 passed (1)
Tests       4 passed (4)

pnpm --filter happy-app exec vitest run sources/components/tools/mcpApps/hostShell.test.ts
Test Files  1 passed (1)
Tests       20 passed (20)

pnpm --filter happy-server-self-host typecheck
exit 0

node packages/happy-app/scripts/build-mcp-app-host-shell.cjs --check
exit 0

git diff --check
exit 0
```

## Files changed

- `packages/happy-app/scripts/build-mcp-app-host-shell.cjs`
- `packages/happy-server/sources/app/api/api.ts`
- `packages/happy-server/sources/app/api/publicShareDocumentSecurity.spec.ts`
- `packages/happy-server/sources/app/api/generated/mcpAppHostShellAssets.ts`
- `packages/happy-server/sources/app/api/mcpAppSandboxSecurity.ts`
- `packages/happy-server/sources/app/api/mcpAppSandboxSecurity.spec.ts`
- `packages/happy-server/sources/app/api/routes/mcpAppSandboxRoutes.ts`
- `packages/happy-server/sources/app/api/routes/mcpAppSandboxRoutes.spec.ts`

## Self-review / concerns

- No configuration, allowlist, CSP query, resource URI, HTML payload, connector/account context, or bridge message is logged. Failure bodies and cache headers are deliberately identical.
- Production accepts HTTPS only. Local HTTP works only with `NODE_ENV=development` and exact `localhost`, `127.0.0.1`, or `[::1]`; no implicit test/non-production relaxation exists.
- Canonical CSP JSON has fixed key order and rejects alternate encoding, unknown keys, duplicates that change canonical bytes, paths normalized by `URL`, directive separators, credentials, wildcard hosts, and over-limit input.
- The checked-in native shell is unchanged; the new server asset is additive. Task 13 must consume the emitted `{ type: "sandbox-proxy-ready", parentOrigin }` handshake and keep exact source/origin targeting. Real two-origin browser/Caddy verification remains the Task 14 runtime gate.
- The two pre-existing untracked Task 14 E2E paths remain untouched and are excluded from staging.
