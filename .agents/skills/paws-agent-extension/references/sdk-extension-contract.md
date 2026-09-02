# Paws Agent SDK extension contract

Use this reference when implementing or reviewing a Paws Agent SDK consumer. The source files remain authoritative; run the Skill's contract check before relying on this summary.

## Public entry points

| Entry point | Intended host | Important exports |
| --- | --- | --- |
| `@wangjs-jacky/paws-agent` | Every supported host | `PawsAgentClient`, error and event/resource types |
| `@wangjs-jacky/paws-agent/browser` | Extension or browser-owned context | `BrowserCredentialProvider`, `startBrowserAccountLink`, browser storage types |
| `@wangjs-jacky/paws-agent/node` | CLI, daemon, trusted Node process | File-backed credential helpers |

Consumer packages must not import `src/**` or copy encryption/transport code. Build the workspace SDK before building a consumer; package scripts should encode this through `pretypecheck`, `prebuild`, or an equivalent prepare step.

## Authentication flow

`startBrowserAccountLink({ serverUrl, credentials, signal?, timeoutMs? })` returns:

```ts
type BrowserAccountLinkSession = {
  publicKey: string;
  qrUrl: string;
  waitForAuthorization(options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  }): Promise<PawsCredentials>;
};
```

The SDK generates the temporary keypair, polls the account-link endpoint, decrypts the authorization bundle, derives the content keypair, and persists the result through the supplied `CredentialProvider`. The consumer owns QR rendering, cancellation UX, and status text.

For browser extensions, adapt host-owned storage to `KeyValueStorage` and pass it to `BrowserCredentialProvider`. Do not serialize or inspect credential material elsewhere in the consumer.

## Client and resource flow

```ts
const client = new PawsAgentClient({
  serverUrl,
  credentials,
  storage, // optional AgentStorage for host state needed by SDK features
  reconnect,
  logger,
});

const unsubscribe = client.subscribe(handleEvent);
await client.connect();
const machines = await client.machines.list({ active: true });
```

The client exposes:

- `machines.list({ active? })`
- `sessions.list({ active? })`, `get`, `spawn`, `resume`, and `stop`
- `messages.history(sessionId, { limit? })` and `send`
- `requests.approve` and `reject`
- `subscribe`, `connect`, `disconnect`, and `dispose`

`sessions.spawn` is a discriminated result. When it returns `requestToApproveDirectoryCreation`, show the returned directory and require an explicit user action before repeating the call with `approvedNewDirectoryCreation: true`. Do not pre-approve or substitute a different directory.

Subscribe before connecting. The event stream can report connection state, decrypted messages, session changes, Agent requests, and normalized errors. Deduplicate messages by stable message ID because history and realtime delivery can overlap.

## Ownership boundaries

```text
Consumer package
├─ UI and interaction state
├─ host storage adapter
├─ optional page-context composition
└─ trusted/untrusted presentation boundary

@wangjs-jacky/paws-agent
├─ account-link protocol
├─ credentials abstraction
├─ HTTP and Socket.IO transport
├─ record/session encryption compatibility
├─ machines, sessions, messages, requests
└─ normalized realtime events and errors
```

Change the SDK only for behavior that belongs to every consumer or requires protocol/encryption knowledge. Keep host-specific behavior in the extension or client package.

## Current first-party browser example

`packages/paws-agent-chrome` demonstrates:

- a Manifest V3 content script that injects exactly one isolated iframe;
- `chrome.storage.local` adapted to the browser credential provider;
- QR linking followed by automatic connection;
- active-machine selection, explicit directory approval, session creation, and message sync;
- optional title/URL/selection prompt context;
- complete but read-only Agent-request rendering inside the page-positioned iframe;
- persisted reconnect and new-session reset.

Reuse the architecture and invariants, not the package name, visual design, hard-coded dimensions, or DOM implementation.

## Error and teardown rules

- Expose connection/auth/protocol errors as actionable UI state without logging secrets.
- Abort an in-flight link when the user cancels, changes server, signs out, or unloads the host.
- Unsubscribe before replacing a client.
- Dispose the previous client before creating a new one.
- Clear credentials only for an explicit unlink/logout action; starting a new remote session must not unlink the device.
