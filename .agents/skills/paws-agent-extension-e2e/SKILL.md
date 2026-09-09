---
name: paws-agent-extension-e2e
description: Design, run, or maintain deterministic end-to-end acceptance for a Paws Agent SDK browser consumer or Chromium extension. Use for encrypted local protocol fixtures, Playwright browser-harness Cases, Ego Lite real-host validation, recordings, and evidence. Do not use for unit-only tests, generic web UI automation, or production-account testing.
---

# Paws Agent Extension E2E

Prove the extension at the strongest authorized layer while keeping the test disposable and reproducible.

## Start here

1. Read repository instructions for the consumer package.
2. Run `node .agents/skills/paws-agent-extension-e2e/scripts/check-harness-contract.mjs` from the repository root. Treat failure as harness drift that must be understood before running E2E.
3. Read [references/e2e-acceptance-contract.md](references/e2e-acceptance-contract.md).
4. Inspect the consumer, its built output, and the existing fixture/harness before changing tests.
5. If the SDK integration itself is missing or changing, also use `$paws-agent-extension`.

## Select the proof layer

Use the lowest layer that answers the user's question, and name it precisely:

| Layer | Current command | What it proves |
| --- | --- | --- |
| Static gate | `pnpm --filter @wangjs-jacky/paws-agent-chrome verify` | types, unit behavior, build output, smoke shell |
| Protocol E2E | `pnpm --filter @wangjs-jacky/paws-agent-chrome test:e2e` | built bundles in Chromium against a disposable encrypted protocol fixture |
| Headed/recorded protocol E2E | `test:e2e:headed` / `test:e2e:record` | same Case with visible execution or H.264 evidence |
| Ego Lite real-host | `test:e2e:ego` / `test:e2e:ego:record` | unpacked extension registration, real `chrome-extension://` ownership, real extension storage, and process-restart reconnect |

The protocol harness is not proof that a branded Chromium host installed the unpacked extension. The real-host Case is not permission to use the user's normal profile or a production account.

## Build a durable Case

- Give every E2E flow a stable Case ID and emit a machine-readable JSON result on success.
- Drive built consumer bundles through public SDK APIs. Do not mock away account linking, encryption, resource calls, or realtime update handling.
- Use a temporary loopback server that implements only the required protocol boundary.
- Use disposable browser contexts or profiles and deterministic fixture records.
- Assert protocol side effects, not just visible text: auth polling, spawn count, exact directory approval, decrypted prompt content, request-resolution RPC count, and persisted storage keys.
- Capture visible evidence at meaningful Case stages. A contact sheet supplements individual screenshots; it does not replace them.
- Clean browser processes, CDP connections, fixture sockets/servers, temporary profiles, and raw artifacts even when launch or an assertion fails.

## Maintain the security boundary

- Never use production credentials, a production account, or the user's regular Ego Lite profile.
- Never print tokens, secrets, content keys, QR authorization responses, or extension storage values.
- Verify that a page-positioned iframe renders Agent-request details without approve/reject controls and without sending a permission RPC.
- Keep loopback host permissions out of the production manifest. Add them only to the disposable test build.
- The fixture may authorize its own generated QR link; it must not impersonate or mutate a real account.

## Run safely

Static and protocol E2E checks may run when they are part of the requested verification. Ego Lite launches a real application, so state the exact command and obtain explicit user confirmation before running it unless the current request already explicitly authorizes real-host validation.

Run from the repository root:

```bash
pnpm --filter @wangjs-jacky/paws-agent-chrome test:e2e
```

On macOS, only after real-host authorization:

```bash
pnpm --filter @wangjs-jacky/paws-agent-chrome test:e2e:ego
```

Use record variants only when evidence media is requested. After recording, validate codec, pixel format, dimensions, duration, and decodability; keep the JSON result and individual screenshots alongside the video.

## Report the result

Include:

- Case ID and pass/fail;
- commit SHA and exact command;
- host and mode;
- assertions proven;
- side effects and cleanup status;
- artifact paths or stable commit-specific URLs;
- explicit limitations and any skipped higher proof layer.

Do not call a smoke screenshot “E2E,” a Playwright-injected harness “installed extension,” or a stitched contact sheet “the run.”
