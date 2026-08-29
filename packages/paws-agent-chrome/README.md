# Paws Agent Chrome Bubble

Private Manifest V3 proof of concept for embedding Paws Agent sessions in a Chromium page.

## Build and verify

```bash
pnpm --filter @wangjs-jacky/paws-agent-chrome verify
```

The unpacked extension is written to `packages/paws-agent-chrome/dist`.

## End-to-end test

```bash
pnpm --filter @wangjs-jacky/paws-agent-chrome test:e2e
pnpm --filter @wangjs-jacky/paws-agent-chrome test:e2e:headed
pnpm --filter @wangjs-jacky/paws-agent-chrome test:e2e:record
```

`[PAWS-CHROME-BUBBLE-01]` runs the built content and panel bundles in a real Chromium page against a temporary local server that implements the account-link, encrypted SDK snapshot, Socket.IO RPC, session, and message boundaries. It covers QR linking, stored browser credentials, online machine selection, directory approval, page context, session creation, remote reply rendering, reset, and reconnect after reload without touching a production account.

The harness cannot prove command-line installation in Google Chrome because current branded Chrome builds ignore `--load-extension`. Ego Lite host compatibility therefore remains a separate unpacked-extension acceptance step.

## Load in Ego Lite

1. Open `chrome://extensions` in Ego Lite.
2. Enable Developer mode.
3. Choose **Load unpacked** and select `packages/paws-agent-chrome/dist`.
4. Open an ordinary `http` or `https` page. The Paws button appears at the bottom-right.
5. Open the bubble, link the extension by QR code, choose an online machine and remote directory, then send a message.

The strongest manual regression is to confirm that the newly created session appears in the existing Paws client, reply there, and observe the reply in the browser bubble.

## Acceptance checklist

Run the checks in this order so a failure can be assigned to the right layer:

1. **Extension shell:** the paw appears once, expands without moving the host page, collapses, and survives a page refresh.
2. **Account link:** the QR code is approved by the existing Paws client and the extension reconnects after another refresh without asking to link again.
3. **Remote session:** an online machine can be selected, a new remote directory requires explicit approval, and the first message creates a session.
4. **Cross-client sync:** the new session appears in the existing Paws client; messages sent from either client appear in the other client.
5. **Page context:** with context enabled, the remote prompt contains the page title, URL, and selected text; with it disabled, only the typed prompt is sent.
6. **Recovery:** taking the machine offline produces a visible error, bringing it back online reconnects, and choosing **New session** does not append to the previous session.

The automated `verify` command covers type safety, page-context formatting, build output, injection, expansion, and the signed-out setup screen. Loading `dist` in Ego Lite is still required for the account-link and cross-client checks because browser automation cannot silently approve or install an unpacked extension in that host.
