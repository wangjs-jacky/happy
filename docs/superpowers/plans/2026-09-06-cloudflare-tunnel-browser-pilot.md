# Paws Cloudflare Tunnel Browser Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 App、CLI、daemon 和旧 IP 入口的前提下，让浏览器通过 `https://paws.rodeo` 灰度使用 Paws。

**Architecture:** Web HTML 在启动前仅为已批准的生产 host 注入同源 Server URL。阿里云 ECS 上的 `cloudflared` 通过出站 Tunnel 接收 `paws.rodeo` 流量，并转给只监听 `127.0.0.1:8081` 的 Caddy 入口；现有 `47.115.228.20:8443` 始终独立保留。

**Tech Stack:** Expo Web static export, Node.js deployment scripts, Caddy, Cloudflare DNS, Cloudflare Tunnel (`cloudflared`), systemd, Vitest/Node test runner, Ego browser E2E.

**Spec:** `docs/superpowers/specs/2026-09-06-cloudflare-tunnel-browser-pilot-design.md`

## Global Constraints

- 保留阿里云服务器 `47.115.228.20`，不讨论备案、换服务器或购买其他域名。
- 第一阶段只迁移浏览器；App、CLI、daemon 的默认 URL 不得改变。
- `https://47.115.228.20:8443` 在试用期保持可用且不重定向到域名。
- Tunnel origin 固定为 `http://127.0.0.1:8081`，8081 不得绑定公网地址。
- Tunnel token 和 Cloudflare 凭据不得写入仓库、命令输出、CI 日志或设计文档。
- 不启用 Cloudflare Access、Cache Everything、Rocket Loader 或非官方优选 IP。
- 任何生产写操作、DNS nameserver 切换、Cloudflare public hostname 创建和部署都需要用户在执行阶段再次明确授权。
- 浏览器操作只能使用 Ego browser。
- 根工作区保持 clean `main == origin/main`；实现必须在 sibling worktree 中完成。

---

### Task 1: Web 运行时同源地址注入

**Files:**
- Create: `scripts/inject-web-runtime-server-config.mjs`
- Create: `scripts/inject-web-runtime-server-config.test.mjs`
- Modify: `.github/workflows/web-production-deploy.yml`
- Modify: `scripts/deploy-web.sh`
- Modify: `scripts/web-production-deploy.test.mjs`
- Modify: `scripts/deploy-web.test.mjs`

**Interfaces:**
- Produces `injectWebRuntimeServerConfig(html: string): string`.
- Injected browser contract: for HTTPS host `paws.rodeo` or `47.115.228.20`, set `globalThis.__HAPPY_CONFIG__.serverUrl = globalThis.location.origin` before the Expo bundle runs.
- Does not modify `packages/happy-app/sources/sync/serverConfig.ts`, CLI defaults, native build configuration, or OTA runtime files.

- [ ] **Step 1: Write failing injector unit tests.** Cover `paws.rodeo`, the existing IP with port 8443, an unrelated host, idempotent reinjection, preservation of existing `__HAPPY_CONFIG__` keys, and rejection when `</head>` is absent.

```js
test('uses the current origin only for approved production web hosts', () => {
  const output = injectWebRuntimeServerConfig('<html><head></head><body></body></html>');
  const script = extractManagedScript(output);
  assert.equal(runInjectedScript(script, 'https://paws.rodeo').serverUrl, 'https://paws.rodeo');
  assert.equal(runInjectedScript(script, 'https://47.115.228.20:8443').serverUrl, 'https://47.115.228.20:8443');
  assert.equal(runInjectedScript(script, 'https://preview.example').serverUrl, undefined);
});
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `node --test scripts/inject-web-runtime-server-config.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the fail-closed HTML injector.** Use fixed markers and an inline IIFE; do not interpolate environment input into JavaScript.

```js
export const RUNTIME_CONFIG_START = '<!-- paws-web-runtime-server-config:start -->';
export const RUNTIME_CONFIG_END = '<!-- paws-web-runtime-server-config:end -->';

export function injectWebRuntimeServerConfig(html) {
  const managed = `${RUNTIME_CONFIG_START}<script>(function(){var l=globalThis.location;if(!l||l.protocol!=="https:"||!["paws.rodeo","47.115.228.20"].includes(l.hostname))return;globalThis.__HAPPY_CONFIG__=Object.assign({},globalThis.__HAPPY_CONFIG__,{serverUrl:l.origin});})();</script>${RUNTIME_CONFIG_END}`;
  // Replace an existing complete managed block; otherwise insert before </head>.
  // Throw on one-sided markers or a missing </head>.
}
```

- [ ] **Step 4: Add the injector to both production Web build paths.** Run it after Expo export/loading injection and before release stamping and immutable upload.

```bash
node scripts/inject-web-runtime-server-config.mjs packages/happy-app/dist/index.html
node scripts/stamp-web-release.mjs \
  packages/happy-app/dist/index.html \
  packages/happy-app/dist/.paws-release-revision \
  "$GITHUB_SHA"
```

- [ ] **Step 5: Extend deployment contract tests.** Assert that CI and `deploy-web.sh` call the injector exactly once before `stamp-web-release.mjs`; assert the canonical build origin remains `https://47.115.228.20:8443` so native/CLI defaults are untouched.

- [ ] **Step 6: Run focused and regression tests.**

Run:

```bash
node --test scripts/inject-web-runtime-server-config.test.mjs
node --test scripts/web-production-deploy.test.mjs scripts/deploy-web.test.mjs
pnpm --filter happy-app typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit the independently reviewable Web change.**

```bash
git add scripts/inject-web-runtime-server-config.mjs \
  scripts/inject-web-runtime-server-config.test.mjs \
  scripts/deploy-web.sh scripts/deploy-web.test.mjs \
  scripts/web-production-deploy.test.mjs .github/workflows/web-production-deploy.yml
git commit -m "feat(web): select production server from browser origin"
```

### Task 2: Caddy loopback Tunnel listener

**Files:**
- Create: `scripts/configure-production-tunnel-caddy.mjs`
- Create: `scripts/configure-production-tunnel-caddy.test.mjs`
- Modify: `.github/workflows/web-production-deploy.yml`
- Modify: `scripts/web-production-deploy.test.mjs`

**Interfaces:**
- Produces `configureProductionTunnelCaddy(source, { publicSiteAddress, tunnelListenAddress, tunnelHost }): string`.
- Defaults are exactly `47.115.228.20:8443`, `http://127.0.0.1:8081`, and `paws.rodeo`.
- The configured Tunnel origin/service remains `http://127.0.0.1:8081`; generated Caddy syntax is `http://:8081` plus `bind 127.0.0.1`. An IP site label creates a Host matcher, not a network bind.
- The generated site copies canonical application-routing directives without listener/TLS directives. An ordered `route` runs the exact Host guard first, then deferred dynamic response headers, then a `handle` preserving normal application directive sorting.
- Tunnel-only `Cache-Control: no-store` on `/v1/*`, `/v2/*`, `/v3/*`, `/v4/*`, `/files/*`, `/health`, and `/v1/updates*` is a prerequisite before activation. 旧 IP 响应头保持不变。

- [ ] **Step 1: Write failing Caddy transformation tests.** Cover creation, refresh after canonical route changes, exact Host guard, loopback-only address, removal of `tls`/`bind`, `/v1/updates` coverage through `/v1/*`, idempotence, malformed braces, missing canonical site, incomplete markers, and refusal to overwrite an unmanaged 8081 block.

```js
test('creates a loopback-only paws.rodeo listener from canonical routes', () => {
  const configured = configureProductionTunnelCaddy(canonicalFixture);
  assert.match(configured, /http:\/\/:8081 \{\n    bind 127\.0\.0\.1/);
  assert.match(configured, /@paws_tunnel_wrong_host not host paws\.rodeo/);
  assert.match(configured, /respond @paws_tunnel_wrong_host 421/);
  assert.match(configured, /@backend path \/v1\/\* \/v2\/\*/);
  assert.doesNotMatch(tunnelBlock(configured), /^\s*tls\b/m);
  assert.equal(tunnelBlock(configured).match(/^\s*bind\b/gm)?.length, 1);
});
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `node --test scripts/configure-production-tunnel-caddy.test.mjs`

Expected: FAIL because the configurator does not exist.

- [ ] **Step 3: Implement the managed Caddy transformer.** Preserve unrelated sites byte-for-byte, use brace-aware top-level directive parsing, and reject path-bearing, quoted, environment/placeholder-dependent or other nonliteral unmanaged site labels before reserved-port scanning. Generate these ordered guards and deferred headers before copied routes; the inner `handle` retains normal directive sorting:

```caddyfile
# paws-cloudflare-tunnel:start
http://:8081 {
    bind 127.0.0.1
    @paws_tunnel_wrong_host not host paws.rodeo
    @paws_tunnel_dynamic path /v1/* /v2/* /v3/* /v4/* /files/* /health /v1/updates*
    route {
        respond @paws_tunnel_wrong_host 421
        header @paws_tunnel_dynamic >Cache-Control no-store
        handle {
            # synchronized application routes follow
        }
    }
}
# paws-cloudflare-tunnel:end
```

- [ ] **Step 4: Chain both Caddy configurators in the workflow.** The existing Web configurator runs first; its output becomes the Tunnel configurator input. Use one candidate file and one existing rollback backup so the activation remains atomic.

```bash
node scripts/configure-production-web-caddy.mjs "$current_caddy" "$web_caddy"
node scripts/configure-production-tunnel-caddy.mjs "$web_caddy" "$next_caddy"
caddy validate --config "$next_caddy"
```

- [ ] **Step 5: Add pre-reload safety checks on the ECS.** Reject a candidate whose adapted JSON listens on `0.0.0.0:8081`, `[::]:8081`, or contains a Tunnel origin other than loopback.

- [ ] **Step 6: Add post-reload loopback smoke checks.** Run on the ECS over the existing deployment SSH path. The workflow must reject a health response lacking exactly one `Cache-Control: no-store` header; local real-Caddy acceptance must cover all dynamic path families, file 404, wrong-Host 421, asset/SPA routing, and unchanged old-IP headers.

```bash
curl --fail --silent --show-error \
  --header 'Host: paws.rodeo' http://127.0.0.1:8081/health >/dev/null
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --header 'Host: invalid.example' http://127.0.0.1:8081/health)" = '421'
ss -lnt | grep -F '127.0.0.1:8081'
```

- [ ] **Step 7: Run Caddy and deployment contract tests.**

Run:

```bash
node --test scripts/configure-production-web-caddy.test.mjs
node --test scripts/configure-production-tunnel-caddy.test.mjs
node --test scripts/web-production-deploy.test.mjs
```

Expected: all PASS.

- [ ] **Step 8: Commit the independently reviewable origin change.**

```bash
git add scripts/configure-production-tunnel-caddy.mjs \
  scripts/configure-production-tunnel-caddy.test.mjs \
  scripts/web-production-deploy.test.mjs .github/workflows/web-production-deploy.yml
git commit -m "feat(ops): add loopback origin for Paws Tunnel"
```

### Task 3: Domain verification and rollback tooling

**Files:**
- Create: `scripts/verify-production-tunnel.mjs`
- Create: `scripts/verify-production-tunnel.test.mjs`
- Create: `scripts/check-production-tunnel-dns.mjs`
- Create: `scripts/check-production-tunnel-dns.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `pnpm tunnel:check-dns` for read-only nameserver, CNAME/flattened record, and certificate readiness checks.
- Produces `pnpm tunnel:verify` for domain health, HTML revision, asset redirect, API no-cache headers, and WebSocket handshake checks.
- Both commands are read-only and accept no Cloudflare credentials.
- Dynamic domain probes keep strict cache-bypass checks. The file probe separately accepts the observed credential-free HTTP 404 with `Content-Type: text/plain; charset=utf-8`; its wording is irrelevant, but redirects, challenges, unexpected statuses, HTML/SPA fallback, and caching must still fail.

- [ ] **Step 1: Write failing tests using local fixture HTTP/DNS adapters.** Assert failures for stale nameservers, redirect to the IP, cached `/health`, mismatched Web revision, challenge HTML, and a failed `/v1/updates` upgrade.

- [ ] **Step 2: Run tests and verify they fail because the scripts are absent.**

Run: `node --test scripts/check-production-tunnel-dns.test.mjs scripts/verify-production-tunnel.test.mjs`

- [ ] **Step 3: Implement strict read-only checkers.** Export dependency-injected functions for tests and use these fixed production defaults only in CLI mode:

```js
export const TUNNEL_ORIGIN = 'https://paws.rodeo';
export const FALLBACK_ORIGIN = 'https://47.115.228.20:8443';
export const EXPECTED_ZONE = 'paws.rodeo';
```

- [ ] **Step 4: Add package scripts.**

```json
{
  "scripts": {
    "tunnel:check-dns": "node scripts/check-production-tunnel-dns.mjs",
    "tunnel:verify": "node scripts/verify-production-tunnel.mjs"
  }
}
```

- [ ] **Step 5: Run focused tests and existing production Web verifiers.**

Run:

```bash
node --test scripts/check-production-tunnel-dns.test.mjs scripts/verify-production-tunnel.test.mjs
node --test scripts/verify-web-release.test.mjs scripts/verify-web-rollback.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit the verification tools.**

```bash
git add package.json scripts/check-production-tunnel-dns.mjs \
  scripts/check-production-tunnel-dns.test.mjs \
  scripts/verify-production-tunnel.mjs scripts/verify-production-tunnel.test.mjs
git commit -m "test(ops): add Paws Tunnel production verification"
```

### Task 4: Code review and old-IP readiness deployment

**Files:**
- Review only: all files changed in Tasks 1–3
- Runtime read-only inspection: `/etc/caddy/Caddyfile` on `47.115.228.20`

**Interfaces:**
- Consumes the Web injector, loopback Caddy configurator, and verification commands.
- Produces a merged `main` revision whose old IP remains production-ready and whose loopback origin is ready but not externally reachable.

- [ ] **Step 1: Re-establish read-only SSH access.** Use the registered `macbook-air -> aliyun` path or an explicitly installed current-machine deployment key. Read `/etc/caddy/Caddyfile`, `systemctl status caddy`, `ss -lnt`, and the active upstream; do not change anything.

- [ ] **Step 2: Compare the real Caddy structure with transformer fixtures.** If the production file contains top-level directives not covered by the tests, add an anonymized fixture and failing test before adjusting the transformer.

- [ ] **Step 3: Run the complete pre-PR gate.**

```bash
pnpm install --frozen-lockfile
node --test scripts/inject-web-runtime-server-config.test.mjs \
  scripts/configure-production-web-caddy.test.mjs \
  scripts/configure-production-tunnel-caddy.test.mjs \
  scripts/check-production-tunnel-dns.test.mjs \
  scripts/verify-production-tunnel.test.mjs \
  scripts/web-production-deploy.test.mjs \
  scripts/deploy-web.test.mjs
pnpm --filter happy-app typecheck
git diff --check
```

- [ ] **Step 4: Confirm scope before external mutation.** The diff must contain no change to `packages/happy-cli/src/configuration.ts`, `packages/happy-app/sources/sync/serverConfig.ts`, daemon LaunchAgents, Server defaults, OTA runtime mappings, or IP redirect behavior.

- [ ] **Step 5: Push the branch and open a PR only after the user authorizes implementation.** Do not merge yet.

- [ ] **Step 6: Review the PR, then obtain explicit authorization to merge.** Merging triggers the production Web workflow and a Caddy reload, so PR approval alone is not merge authorization.

- [ ] **Step 7: After authorized merge, wait for the Web production workflow and verify the old entry first.**

Run:

```bash
node scripts/verify-web-release.mjs \
  https://47.115.228.20:8443 packages/happy-app/dist/index.html
curl --fail --silent --show-error https://47.115.228.20:8443/health >/dev/null
```

Expected: workflow success, old origin 200, expected main revision, and no redirect to `paws.rodeo`.

- [ ] **Step 8: Verify the ECS-only origin.** Through SSH, confirm valid Host returns 200, invalid Host returns 421, and `ss` shows only `127.0.0.1:8081`. Before any Tunnel public hostname activation, confirm dynamic responses carry the Tunnel-only `Cache-Control: no-store` prerequisite and old-IP response headers are unchanged.

### Task 5: Move authoritative DNS to Cloudflare

**Files:**
- No repository files
- External state: registrar nameservers and Cloudflare zone `paws.rodeo`

**Interfaces:**
- Produces an active Cloudflare zone while preserving a complete export of the prior DNS state.
- Does not create the production Tunnel hostname until the zone and certificate are ready.

- [ ] **Step 1: Obtain fresh DNS evidence.** Record current NS, SOA, A/AAAA/CNAME/MX/TXT/CAA records and TTLs. Save the export outside Git because it may contain verification records.

- [ ] **Step 2: Add `paws.rodeo` to Cloudflare Free plan.** Review Cloudflare's imported records line by line against the export; keep mail and verification records DNS-only.

- [ ] **Step 3: Identify the three existing apex A records.** Confirm `172.232.24.161`, `172.234.25.42`, and `172.232.24.235` are parking records before scheduling their replacement. If any serves real traffic, stop and redesign the cutover.

- [ ] **Step 4: Obtain explicit authorization for the nameserver change.** This is an external DNS mutation and can affect every service under the domain.

- [ ] **Step 5: Replace the registrar nameservers with the exact two nameservers assigned by Cloudflare.** Do not invent or reuse nameservers from another zone.

- [ ] **Step 6: Wait until Cloudflare reports zone `Active`.** Use read-only DNS checks from at least two public resolvers; do not continue merely because the dashboard saved the change.

- [ ] **Step 7: Wait for Universal SSL coverage of `paws.rodeo`.** Confirm an HTTPS certificate is issued before exposing the application hostname.

### Task 6: Install the connector and activate the browser pilot

**Files:**
- No repository files
- Remote state: `cloudflared` package and systemd service on `47.115.228.20`
- External state: Cloudflare Tunnel `paws-web-pilot` and hostname `paws.rodeo`

**Interfaces:**
- Consumes the active Cloudflare zone and verified Caddy loopback origin.
- Produces `https://paws.rodeo -> http://127.0.0.1:8081` without opening a new inbound port.

- [ ] **Step 1: Read the ECS OS/package architecture and firewall state.** Select Cloudflare's official package for the detected distribution; do not pipe an unpinned third-party install script into a shell.

- [ ] **Step 2: Verify outbound connectivity before installation.** Confirm TCP 7844 and HTTPS 443 to Cloudflare endpoints are reachable. Do not open inbound 7844 or 8081.

- [ ] **Step 3: Create remote-managed Tunnel `paws-web-pilot`.** Copy its token through a secret-safe channel; never print it or store it in shell history.

- [ ] **Step 4: Install `cloudflared` as a systemd service using the secret token.** Configure restart-on-failure and start with connector protocol HTTP/2 for the initial mainland baseline.

```ini
[Service]
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --protocol http2 run --token-file /etc/cloudflared/paws-web-pilot.token
Restart=on-failure
RestartSec=5s
```

- [ ] **Step 5: Restrict the token file and validate the process.** Require root ownership, mode 600, active systemd status, and multiple established connector sessions without token text in journal output.

- [ ] **Step 6: Create the public hostname.** Configure exactly `paws.rodeo` to service `http://127.0.0.1:8081`; do not enable `noTLSVerify`, Access, or an origin hostname override.

- [ ] **Step 7: Replace only the confirmed parking apex records with the Tunnel DNS record.** Leave unrelated MX/TXT/CAA/subdomain records unchanged.

- [ ] **Step 8: Apply conservative Cloudflare behavior.** Keep standard caching; add bypass rules for `/v1/*`, `/v2/*`, `/v3/*`, `/v4/*`, `/files/*`, `/health`, and `/v1/updates*`. Keep WebSockets enabled and Rocket Loader disabled.

- [ ] **Step 9: Run automated verification.**

Run:

```bash
pnpm tunnel:check-dns
pnpm tunnel:verify
```

Expected: DNS active, certificate valid, health 200/no-cache, current Web revision, assets reachable, and WebSocket handshake not challenged or cached.

### Task 7: Ego browser acceptance and 24-hour observation

**Files:**
- No repository files unless a product defect is found; defects require a separate fix task/PR.

**Interfaces:**
- Produces evidence that the domain works for a real authenticated browser without regressing the IP fallback.

- [ ] **Step 1: Open `https://paws.rodeo` only with Ego browser.** Verify certificate, no Cloudflare challenge loop, no redirect to the IP, and correct release revision.

- [ ] **Step 2: Complete a real login/pairing flow.** A different origin has separate browser storage, so an existing IP login session is not expected to transfer automatically.

- [ ] **Step 3: Run one real conversation.** Create a session, send a message, observe streaming/realtime completion, refresh, and reconnect after a brief network interruption.

- [ ] **Step 4: Exercise files and sharing.** Upload one small file, download it, open one public share in a private window, and record whether any generated absolute URL still uses the IP.

- [ ] **Step 5: Check GitHub connection separately.** If its callback returns to `https://47.115.228.20:8443`, record the known pilot limitation and do not broaden this rollout to “fully domain-based.”

- [ ] **Step 6: Repeat a minimal smoke test on the fallback IP.** Verify homepage, health, login state appropriate to that origin, session list, and one message round.

- [ ] **Step 7: Observe for at least 24 hours.** Compare domain and IP for first-content latency, API response duration, WebSocket disconnects/reconnects, 5xx counts, Cloudflare 52x errors, and connector restarts.

- [ ] **Step 8: Decide from evidence.** Keep the browser pilot only if it has no material reliability regression. “Cloudflare feels faster” is not sufficient evidence.

### Task 8: Practise and document rollback

**Files:**
- No repository files unless operational documentation is updated after the drill.

**Interfaces:**
- Produces a verified return to the old IP without data migration or App/CLI changes.

- [ ] **Step 1: Before the live pilot, record rollback state.** Capture the Tunnel ID, public hostname record, prior parking DNS records, Caddy backup path, and current Web release revision outside Git.

- [ ] **Step 2: Test the fastest rollback path.** Disable/delete the `paws.rodeo` public hostname record, leave Cloudflare nameservers in place, and confirm the old IP remains healthy. Re-enable the hostname only after the test passes.

- [ ] **Step 3: Define connector rollback.** Stop and disable only the `cloudflared` service for `paws-web-pilot`; do not stop Caddy or Paws Server.

- [ ] **Step 4: Define Caddy rollback.** Restore only the guarded backup created by the authorized Web deployment, validate it, reload Caddy, and verify old IP health before removing the backup.

- [ ] **Step 5: Record recovery expectations.** DNS/Tunnel rollback may take resolver-cache time, but the explicit IP fallback should work immediately because it never depends on Cloudflare.

## Final execution gate

Completing this document does not authorize implementation. Before Task 1 begins, the user chooses an execution mode. Before Task 4 merge, Task 5 nameserver change, and Task 6 hostname activation, the executor must obtain separate explicit authorization because each step changes production or third-party state.
