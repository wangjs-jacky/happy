---
name: paws-agent-extension
description: Build or change a Paws-owned client, browser extension, desktop surface, or internal tool on top of @wangjs-jacky/paws-agent. Use for SDK authentication, encrypted machine/session/message flows, reconnect behavior, client storage, and safe Agent-request UX. Do not use for unrelated Happy/Paws app work or a server-protocol redesign.
---

# Paws Agent Extension

Build first-party SDK consumers without bypassing the SDK's authentication, encryption, or permission boundaries.

## Start here

1. Read the repository instructions that apply to the target package.
2. Run `node .agents/skills/paws-agent-extension/scripts/check-repo-contract.mjs` from the repository root. Stop and inspect SDK drift if it fails.
3. Inspect the public entry points in `packages/paws-agent/src/index.ts`, `browser.ts`, or `node.ts`; do not import private SDK internals from a consumer.
4. Read [references/sdk-extension-contract.md](references/sdk-extension-contract.md) before designing or changing the integration.
5. Use `packages/paws-agent-chrome` as the first-party browser example, not as a template to copy wholesale.

## Choose the surface

- Browser extension or embedded browser UI: import the core client from `@wangjs-jacky/paws-agent` and browser adapters from `@wangjs-jacky/paws-agent/browser`.
- Node CLI, daemon, or trusted desktop backend: use `@wangjs-jacky/paws-agent/node` for file-backed credentials.
- Webpage script without an extension boundary: treat the page as untrusted. Do not persist account secrets there or add request-approval controls.

Keep rendering, page-context capture, and host-specific storage in the consumer package. Keep transport, encryption, resources, event normalization, and account-link protocol in the SDK.

## Implement the lifecycle

Follow this order unless the public API changes:

1. Create a `CredentialProvider` appropriate to the host.
2. If credentials are absent, start account linking, show the QR URL, and wait with cancellation and a bounded timeout.
3. Construct `PawsAgentClient` with the selected server URL and credential provider.
4. Subscribe before `connect()` so the UI cannot miss connection or realtime events.
5. Connect, list active machines, then spawn or resume a session.
6. Handle `requestToApproveDirectoryCreation` as an explicit second spawn with the exact returned directory.
7. Load history, send messages, and reconcile realtime messages by stable IDs.
8. Unsubscribe and call `dispose()` on teardown, account reset, or server change.

Model connection and linking as explicit UI states. Preserve the user's chosen machine, directory, and session separately from credentials so logout and new-session behavior remain intentional.

## Preserve trust boundaries

- Store credentials only in host-owned storage such as `chrome.storage.local` or the SDK's Node credential provider.
- Never expose the token, secret, content keypair, or credential storage values to page scripts, logs, DOM attributes, screenshots, or test output.
- An embedded or page-positioned surface may render the complete `AgentRequest`, but must not approve or reject it. Resolution stays in a trusted Paws-owned client.
- Keep page context opt-in and visibly controllable. Include only the title, URL, and selection required for the prompt.
- Do not add production host permissions merely to support local E2E. Inject loopback permissions only into a disposable test build.
- Use a configurable server URL; do not fork encryption or protocol behavior per environment.

## Validate the change

Run the narrow checks first, then the consumer gate:

```bash
pnpm --filter @wangjs-jacky/paws-agent typecheck
pnpm --filter @wangjs-jacky/paws-agent test
pnpm --filter <consumer-package> typecheck
pnpm --filter <consumer-package> test
pnpm --filter <consumer-package> build
```

For `@wangjs-jacky/paws-agent-chrome`, use its single static gate:

```bash
pnpm --filter @wangjs-jacky/paws-agent-chrome verify
```

When the request includes end-to-end browser validation, also use `$paws-agent-extension-e2e`. Do not start a browser, Ego Lite, a development server, or a production account flow unless the user has authorized that runtime validation.

Report which layer was proven: SDK unit/integration, consumer static/build, disposable protocol E2E, or real-host acceptance. Never describe a lower layer as proof of a higher one.
