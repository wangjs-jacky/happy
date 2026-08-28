# Codex shared app-server PoC

This PoC lets a Paws Codex session connect to an already-running Codex
app-server through its Unix control socket instead of spawning a private
`codex app-server --listen stdio://` child process.

The default remains the existing private-process mode. Shared mode is opt-in:

```bash
HAPPY_CODEX_APP_SERVER_MODE=shared paws codex --resume <codex-thread-id>
```

The default socket is:

```text
${CODEX_HOME:-$HOME/.codex}/app-server-control/app-server-control.sock
```

A custom absolute socket path can be selected with:

```bash
HAPPY_CODEX_APP_SERVER_MODE=shared \
HAPPY_CODEX_APP_SERVER_SOCKET=/absolute/path/to/app-server.sock \
paws codex --resume <codex-thread-id>
```

## Behavior

- Each Paws process opens its own WebSocket connection over the Unix socket.
- Every connection performs an independent `initialize` handshake.
- Multiple Paws clients can `thread/resume` the same thread in one app-server.
- Disconnecting Paws closes only its client connection. It never terminates the
  shared app-server process.
- A failed initialize handshake closes the partially opened socket.
- Paws' existing stdio transport and sandbox wrapper remain unchanged when
  shared mode is not enabled.

## Current boundaries

- Paws does not start, stop, restart, or upgrade the shared Codex app-server.
- The shared server and Paws client must use compatible app-server protocols.
- Codex Desktop local projects currently use a private stdio app-server, so
  they cannot join this PoC until Desktop itself is pointed at the same Unix
  socket. Its remote/SSH path is the candidate for that follow-up.
- Approval requests may be visible on multiple connected controllers; the
  first valid response wins. Production rollout needs an explicit active
  controller policy.
- Process-wide settings such as the app-server launch-time service tier are
  owned by the shared server rather than an individual Paws connection.

## Verification

The unit test uses a real WebSocket server on a temporary Unix socket and
checks two clients resuming one thread, notification fan-out, independent
disconnect, configuration validation, and initialize failure cleanup.

The integration test starts one isolated official Codex app-server in a
temporary `CODEX_HOME`, connects two Paws clients, persists a thread through
the first connection, and resumes that same thread through the second.

```bash
pnpm exec vitest run --project unit \
  src/codex/codexAppServerSharedConnection.test.ts

PAWS_CODEX_INTEGRATION_BIN=/path/to/codex \
pnpm exec vitest run --project integration-empty \
  src/codex/codexSharedAppServer.integration.test.ts
```
