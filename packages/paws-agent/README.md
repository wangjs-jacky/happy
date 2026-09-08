# Paws Agent

Browser-safe SDK and CLI for controlling Paws agent sessions remotely. The first release is supported for Paws-owned clients.

Unlike the local runner, `paws-agent` is a remote control plane for listing machines, spawning or resuming sessions, sending messages, reading history, resolving requests, monitoring state, and stopping sessions.

## Installation

After the beta version is available on npm (see Release status below):

```bash
npm install @wangjs-jacky/paws-agent@next
# Or install the remote-control CLI:
npm install -g @wangjs-jacky/paws-agent@next
```

From the monorepo:

```bash
pnpm --filter @wangjs-jacky/paws-agent build
```

Or link globally:

```bash
pnpm --filter @wangjs-jacky/paws-agent link --global
```

## Authentication

Paws Agent uses account authentication via QR code, the same flow as linking a device in the Paws app.

```bash
# Authenticate by scanning the QR code with the Paws mobile app
paws-agent auth login

# Check authentication status
paws-agent auth status

# Clear stored credentials
paws-agent auth logout
```

Credentials are stored at `~/.happy/agent.key`.

## Commands

### List sessions

```bash
# List all sessions
paws-agent list

# List only active sessions
paws-agent list --active

# Output as JSON
paws-agent list --json
```

### List machines

```bash
# List all machines
paws-agent machines

# List only active machines
paws-agent machines --active

# Output as JSON
paws-agent machines --json
```

### Spawn on a machine

```bash
# Spawn a session on a specific machine
paws-agent spawn --machine <machine-id> --path ~/project

# Let the daemon create the directory if needed
paws-agent spawn --machine <machine-id> --path ~/new-project --create-dir

# Choose a specific agent
paws-agent spawn --machine <machine-id> --path ~/project --agent codex

# Output as JSON
paws-agent spawn --machine <machine-id> --path ~/project --json
```

### Session status

```bash
# Get live session state (supports ID prefix matching)
paws-agent status <session-id>

# Output as JSON
paws-agent status <session-id> --json
```

### Resume a session

```bash
paws-agent resume <session-id>
```

### Send a message

```bash
# Send a message to a session
paws-agent send <session-id> "Fix the login bug"

# Send with yolo permissions
paws-agent send <session-id> "Ship it" --yolo

# Send and wait for the agent to finish
paws-agent send <session-id> "Run the tests" --wait

# Output as JSON
paws-agent send <session-id> "Hello" --json
```

### Message history

```bash
# View message history
paws-agent history <session-id>

# Limit to last N messages
paws-agent history <session-id> --limit 10

# Output as JSON
paws-agent history <session-id> --json
```

### Stop a session

```bash
paws-agent stop <session-id>
```

### Approve a request

```bash
paws-agent approve <session-id> <request-id>
```

### Wait for idle

```bash
# Wait for agent to become idle (default 300s timeout)
paws-agent wait <session-id>

# Custom timeout
paws-agent wait <session-id> --timeout 60
```

Exit code 0 when agent becomes idle, 1 on timeout.

## Environment Variables

- `HAPPY_SERVER_URL` - compatibility API server URL override
- `PAWS_HOME_DIR` - credential home directory override
- `HAPPY_HOME_DIR` - legacy-compatible credential home override

## Session ID Matching

All commands that accept a `<session-id>` support prefix matching. You can provide the first few characters of a session ID and the CLI will resolve the full ID.

Machine-aware commands such as `spawn --machine <machine-id>` also support ID prefix matching.

## Encryption

All machine and session data is end-to-end encrypted. New records use AES-256-GCM with per-record keys. Existing records created by other clients are decrypted using the appropriate key scheme (AES-256-GCM or legacy NaCl secretbox).

## Requirements

- Node.js >= 20.19.0
- A Paws account for authentication

## SDK

```ts
import { PawsAgentClient } from '@wangjs-jacky/paws-agent';
import { createDefaultFileCredentialProvider } from '@wangjs-jacky/paws-agent/node';

const client = new PawsAgentClient({
  serverUrl: process.env.HAPPY_SERVER_URL!,
  credentials: createDefaultFileCredentialProvider(),
});

await client.connect();
const machines = await client.machines.list({ active: true });
const root = await client.machines.browseDirectory({
  machineId: machines[0].id,
});

if (root.success) {
  console.log(root.home, root.directories);
}
await client.dispose();
```

`machines.browseDirectory()` delegates to the selected machine's encrypted
machine RPC. The daemon resolves symlinks, rejects paths outside the canonical
home directory, and returns directories only; it does not expose file contents
or command execution through this SDK method.

## Release status

Registry availability is established by `npm view @wangjs-jacky/paws-agent@0.1.0-beta.2 version`, not by a source tag or a green preparation run. Before the first successful publication, use workspace linking or an exact verified tarball. Publication runs in GitHub Actions using the repository's `NPM_TOKEN` when available; otherwise npm trusted publishing must already be configured. A local npm login is not required for this workflow.

The beta includes the connection fixes used by paws-agent-chrome v0.0.5: `syncing` is emitted during initial synchronization, followed by a reusable `snapshot` event before `ready`. Consumers can reuse that snapshot instead of downloading machines and sessions again. Individual session reads and realtime session updates require the Paws `/v2/sessions/:id` endpoint and never fall back to fetching the full session list.

Maintainers prepare the version and changelog on a dedicated release PR branch with:

```bash
git switch -c release/paws-agent-v0.1.0
pnpm --filter @wangjs-jacky/paws-agent release:prepare -- 0.1.0
```

This flow:
- updates the package manifest and deterministic changelog without committing, tagging, or pushing `main`
- requires a PR titled `chore(agent): release paws-agent vX.Y.Z` from the matching `release/paws-agent-vX.Y.Z` branch
- creates the immutable tag only after that release PR merges
- dispatches the tag-gated workflow to build, test and upload an exact candidate tarball (this first run does **not** publish)
- requires downloading that tarball, running `node packages/paws-agent/scripts/verify-pack.mjs --prepare-browser <tarball>`, and opening the emitted `browserFixture` in Ego to verify `window.__PAWS_AGENT_VERIFY__ === 'ready'`
- publishes only after a maintainer dispatches the same workflow/tag with `ego_verified_sha256` set to the SHA-256 of that verified tarball; the rebuilt artifact must match exactly or publication fails closed
- rolls `latest` back and deprecates a failed stable version when registry credentials permit

The workflow maps prereleases to `next` and stable versions to `latest`, compares an already-existing registry version to the local tarball byte-for-byte, and repeats clean Node, CJS, CLI and isolated E2E checks. `verify:pack` prepares a browser consumer but reports `pending-ego-verification`; it does not launch a browser or claim browser acceptance. Do not approve a digest from build success alone. GitHub Actions keeps the tarball and checks for 90 days; npm and the immutable Git tag are the permanent release record.

## License

MIT
