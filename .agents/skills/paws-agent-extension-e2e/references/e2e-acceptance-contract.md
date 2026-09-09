# Paws Agent extension E2E acceptance contract

Use this reference to create or review a browser-extension acceptance Case. The current exemplar lives in `packages/paws-agent-chrome`.

## Two complementary Cases

### `PAWS-CHROME-BUBBLE-01`: disposable protocol E2E

`scripts/e2e.mjs` launches Chromium and injects the built content/panel bundles into a normal fixture page. A small test-only `chrome.runtime` and storage adapter lets the built extension code execute without claiming it was installed by Chrome.

The fixture in `test/e2eFixtureServer.mjs` supplies the actual remote protocol boundaries required by the SDK:

- QR account-link request and authorization polling;
- encrypted credentials and compatible encrypted machine/session records;
- HTTP snapshots and Socket.IO updates/RPC;
- spawn response requesting exact directory approval, then success;
- encrypted message send/history/realtime reply;
- session state containing a high-privilege Agent request.

Required assertions:

1. Exactly one bubble is injected and collapsed geometry is correct.
2. The QR flow completes and credentials survive reload.
3. Only an active fixture machine is selected.
4. The first spawn requests directory approval and the approved retry happens exactly once.
5. The decrypted remote prompt contains typed text and the enabled title, URL, and selection context.
6. The encrypted remote reply renders in the bubble.
7. Complete Agent-request details render, no approval button exists, and zero resolution RPCs occur.
8. New-session reset clears conversation state without unlinking; reload reconnects from persisted credentials.
9. Page errors are empty and all temporary resources close.

### `PAWS-EGO-LITE-HOST-01`: real-host acceptance

`scripts/egoE2e.mjs` starts the installed Ego Lite binary with a temporary user-data directory, an unpacked disposable test build, and CDP on a random loopback port. The fixture page disables self-injection.

It must add proof that the protocol harness cannot provide:

1. Ego Lite lists the unpacked extension in `chrome://extensions`.
2. The iframe source is owned by a real `chrome-extension://<id>` origin.
3. Credentials and config live in real `chrome.storage.local`.
4. The same extension ID and storage survive a complete Ego Lite process restart using the disposable profile.
5. Launch/CDP failure still terminates the complete child process group and removes the temporary profile.

Never run this Case against the user's regular profile. Never loosen the production manifest: `PAWS_EXTENSION_INCLUDE_LOCALHOST=1` is only for the disposable test build created by the command.

## Evidence contract

Each visible acceptance stage should have an individual screenshot. The current real-host Case captures:

1. extension installed;
2. collapsed bubble;
3. account-link QR;
4. linked target selection;
5. directory approval;
6. remote reply;
7. safe read-only Agent request;
8. restarted and reconnected.

When recording is requested:

- protocol E2E records the live Playwright page video;
- Ego Lite assembles the ordered real-host screenshots because CDP attachment does not provide Playwright context recording;
- output must decode and report H.264, `yuv420p`, and `1280x720`;
- preserve individual screenshots and JSON output so the evidence is auditable;
- use a commit-SHA URL for durable remote evidence. Branch URLs are mutable.

Call an assembled Ego Lite video “staged real-host evidence,” not a literal continuous screen recording.

## Porting the harness to another SDK consumer

1. Keep the encrypted fixture server shared where protocol behavior is identical.
2. Give the consumer its own stable Case ID and assertion list.
3. Exercise the consumer's built output and host-owned storage adapter.
4. Replace only selectors and host-specific assertions; preserve protocol and permission-boundary assertions.
5. Add teardown before adding recording so failures cannot strand browsers or profiles.
6. Make the plain protocol Case portable. Resolve a configured browser binary first, then fall back to Playwright Chromium.
7. Keep macOS-only real-host logic separate from portable CI.

## Failure ownership

| Failure | Likely layer |
| --- | --- |
| Package type/build failure | consumer or SDK compile contract |
| Fixture auth/snapshot/RPC mismatch | SDK protocol or fixture drift |
| UI selector/geometry failure | consumer interaction contract |
| Playwright harness passes but Ego install fails | host packaging/registration |
| Reload works but full restart fails | host storage or lifecycle cleanup |
| Agent request sends a resolution call | security boundary regression |
| Video exists but fails probe | evidence pipeline, not product behavior |
