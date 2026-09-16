# Paws agents-party POC

This is a source fork of [agents-party](https://github.com/1gr14/agents-party/tree/af00afbd49b3235c2084cff9849ef12353073484), with its real Party SQLite/API, Chat, Composer, Sidebar, virtualized lists and theme. Paws SDK runs the agents. Market data is always explicitly synthetic and is not investment advice. This is a local POC, not a deployment or trading tool.

## Build and normal live entry

From the worktree root, with Node 24 and pnpm 10.11.0:

```sh
pnpm install --filter @wangjs-jacky/paws-agent-party... --frozen-lockfile --ignore-scripts
pnpm --filter @wangjs-jacky/paws-agent build
pnpm --filter @wangjs-jacky/paws-agent-party build
pnpm --filter @wangjs-jacky/paws-agent-party start
```

The last command always constructs the real SDK. There is no mock-model switch in production. It prints a loopback URL and the **path** to its access-token file, never the token. Open that URL locally, copy the file's content into the password field, then connect to your Paws SDK server through its normal QR authorization. The default SDK server field is `http://47.115.228.20:3005`; edit it before linking if necessary. No Paws account secret belongs in this page. Credentials remain only in the service process memory.

An optional `#token=<local-access-token>` URL fragment bootstraps access and is immediately removed with `history.replaceState`; the fragment is never sent in an HTTP request. Prefer manual entry when sharing links or screens. The local token is retained in this tab's `sessionStorage` for reloads. Every API/attachment fetch uses a Bearer header. Images are fetched as authorized blobs and their object URLs are revoked on replacement/unmount. Do not put tokens in query strings or logs.

Choose an online machine and explicitly enter its working directory. Select each role's engine (`codex`, `claude`, `gemini`, `opencode`). Start with “单 Agent 连接检查”; “完整会诊” runs eight initial turns: moderator opening, three specialist analyses, three challenges, moderator synthesis. PNG/JPEG/WebP inputs support text-only, image-only, and mixed submissions: at most four files, each at most 10 MiB. Model/provider image support still needs a live check.

Click a participant's name for durable execution details. Recipient chips independently address terminal-run follow-ups; no selection means moderator. Details show stored party/run/participant/task/public-message/localId/session/root-turn associations. `sourceMessageId` identifies the durable **turn-end event**, not a text fragment. Missing fields indicate an unobserved/unreached stage. Public history contains only statements and submitted tasks; raw SDK records remain in the owner-only details panel. Pending permissions must be handled in the linked original Paws session; this service never auto-approves them. The original-session link uses the project's Paws Web origin, `https://47.115.228.20:8443/session/<id>`.

“停止协调” ends coordination/observation; already accepted remote work may continue. It does not prove remote process termination. Late-created session IDs remain visible. Closing the browser leaves server work running. Stopping/restarting the service marks unfinished runs/follow-ups interrupted and never automatically replays them. Reopen the page to reload saved Party/run state; reconnect your Paws account to read remote details. Request IDs deduplicate accepted retries; there is no end-to-end exactly-once guarantee. If a submission response is uncertain, retry in the same dialog/draft to retain its request ID; closing/reloading discards that pending client draft, so check saved history before starting again.

Data defaults to `packages/paws-agent-party/.data`; an explicit directory can be supplied with `PAWS_AGENT_PARTY_DATA_DIR=/absolute/path`. Only one process may own a data directory. The service binds loopback and validates Host/Origin; do not expose it with a tunnel, reverse proxy, or public bind. Static assets are public on loopback; APIs and images are authenticated. Keep the data directory and access token private. No daemon/global CLI changes are required by this package.

## Test-only local entry

```sh
pnpm --filter @wangjs-jacky/paws-agent-party build
pnpm --filter @wangjs-jacky/paws-agent-party start:test
```

This explicitly separate entry injects `test/fake-sdk.ts` and labels the page **“测试替身，非真实 Agent”**. It uses real Party storage and encrypted message APIs, but deterministic SDK boundary fixtures, not an encrypted relay or a real model. Its default data is `.data-test`, separate from normal `.data`. It prints only the local URL and token-file path. This entry is useful for UI interaction checks and cannot satisfy live Agent acceptance.

## Verification and remaining gates

```sh
pnpm --filter @wangjs-jacky/paws-agent-party test
pnpm --filter @wangjs-jacky/paws-agent-party typecheck
pnpm --filter @wangjs-jacky/paws-agent-party build
pnpm --filter @wangjs-jacky/paws-agent-party exec tsx test/smoke.ts
```

The smoke test starts the built service twice in temporary directories: first its real, disconnected SDK adapter (HTML/assets/auth checks), then the explicit SDK fixture (eight turns through real Party SQLite/encryption plus durable provenance). It cleans up its own temporary data. Neither pass means a model ran.

Live A1 (one real response), A3 (eight real responses), and the live image part of A2 require normal account QR approval, an available online machine/provider, and model access. They remain unverified. No browser, screenshots or visual acceptance are claimed by this implementation. The controller owns any authorized Ego browser check; screenshot choice remains pending. Overall acceptance is **部分完成（整体未完成）** until the live/browser gates are evaluated.

UI Before source is upstream commit `af00afbd49b3235c2084cff9849ef12353073484`; local Task 2 base is `b18af4088a356dcb1169b82752b118a6db5b9c96`. There was no runnable local UI at that local base. See [UPSTREAM.md](./UPSTREAM.md) for imported paths, adaptations, and licensing. Fonts use system fallbacks with no external font requests.
