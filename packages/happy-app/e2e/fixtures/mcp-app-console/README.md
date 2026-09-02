# MCP App console fixture

Deterministic MCP App used to verify Paws across two real browser origins. It exposes
`show-release-readiness` over Streamable HTTP or stdio and serves a single-file
`text/html;profile=mcp-app` resource at
`ui://paws-release-readiness/app.html`.

The fixture deliberately uses the versions already pinned by `happy-app`:
`@modelcontextprotocol/ext-apps@1.7.5`, MCP SDK `1.29.0`, and esbuild `0.27.2`.
It has no private lockfile or checked-in bundle.

```bash
pnpm --filter happy-app exec tsx e2e/fixtures/mcp-app-console/build.ts
pnpm --filter happy-app exec vitest run \
  --config e2e/fixtures/mcp-app-console/vitest.config.ts
PORT=3107 pnpm --filter happy-app exec tsx e2e/fixtures/mcp-app-console/main.ts
```

For the full local two-origin case, use canonical loopback origins on different
ports: the Paws Web test origin is the parent, while the local Happy Server
origin serves `/mcp-app-sandbox/host`. Configure the test Codex session with the
fixture URL above, set the three required `HAPPY_*MCP_APP*` E2E variables, and
run `mcp-app-host-evidence.spec.ts`. This exercises the production Web adapter,
generated Proxy/Host Shell, official App API, MCP resource, and structured tool
result. Only authentication/session transport may use the existing local E2E
environment; the expected App DOM is never inserted by the harness.

Prepare the originating call with this deterministic input so the named Web
cases can assert the exact structured result:

```json
{
  "releaseName": "Paws MCP Apps Host E2E",
  "checks": [
    { "name": "Protocol metadata preserved", "passed": true },
    { "name": "Structured content preserved", "passed": true },
    { "name": "Different-origin sandbox active", "passed": true },
    { "name": "Mediated actions active", "passed": true }
  ]
}
```

Then run:

```bash
HAPPY_E2E_WEB_URL='http://localhost:<web-port>/<authenticated-query>' \
HAPPY_MCP_APP_SANDBOX_ORIGIN='http://localhost:<server-port>' \
HAPPY_MCP_APP_E2E_SESSION_ID='<prepared-live-session-id>' \
HAPPY_E2E_RECORD=1 \
HAPPY_MCP_APP_EVIDENCE_DIR="$PWD/artifacts/mcp-apps-web" \
pnpm --filter happy-app exec playwright test e2e/mcp-app-host-evidence.spec.ts
```

The same command is the production gate with the approved HTTPS origins. A
local pass does not replace the post-merge production-origin run.
