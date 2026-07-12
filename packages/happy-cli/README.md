# Paws CLI

> Independently maintained Paws CLI, published as [`@wangjs-jacky/paws`](https://www.npmjs.com/package/@wangjs-jacky/paws). Paws originated from the MIT-licensed [Happy](https://github.com/slopus/happy) project but now has its own product and release line. Source: [wangjs-jacky/happy](https://github.com/wangjs-jacky/happy).

Code on the go — control AI coding agents from your phone, browser, or terminal.

Free. Open source. Code anywhere.

## Installation

```bash
npm install -g @wangjs-jacky/paws
```

This installs `paws` as the primary command and `happy` as a compatibility alias.

> **Note:** the `happy` command name conflicts with the official `happy` / `happy-coder` npm packages. If you have one of them installed globally, remove it first (`npm rm -g happy happy-coder`), or install with `--force` and use `paws`.

## Server

By default Paws connects to the relay configured by the current build. Session payloads are end-to-end encrypted before synchronization; relay infrastructure still processes operational metadata needed for routing and delivery.

To use your own relay, deploy [happy-server](https://github.com/wangjs-jacky/happy/tree/main/packages/happy-server) and point the CLI (and the mobile/web app) at it:

```bash
# one-off
HAPPY_SERVER_URL=https://your-server.example.com paws

# or persist it in ~/.happy/settings.json
{
  "serverUrl": "https://your-server.example.com",
  "webappUrl": "https://your-webapp.example.com"
}
```

## Usage

### Claude Code (default)

```bash
paws
# or
paws claude
```

This will:
1. Start a Claude Code session
2. Display a QR code to connect from your mobile device or browser
3. Allow real-time session control — all communication is end-to-end encrypted
4. Start new sessions directly from your phone or web while your computer is online

### More agents

```
paws codex
paws gemini
paws openclaw

# or any ACP-compatible CLI
paws acp opencode
paws acp -- custom-agent --flag
```

## Daemon

The daemon is a background service that stays running on your machine. It lets you spawn and manage coding sessions remotely — from your phone or the web app — without needing an open terminal.

```bash
paws daemon start
paws daemon stop
paws daemon status
paws daemon list
```

The daemon starts automatically when you run `paws`, so you usually don't need to manage it manually.

### Keeping the daemon running across reboots

If you want the daemon to come back automatically after a reboot — without opening a `paws` session first — start it from your shell profile so it inherits your normal user session context (PATH, keychain access, OAuth credentials):

```bash
# ~/.zshrc or ~/.bashrc
if [[ -o interactive ]] && [[ -z "$HAPPY_DAEMON_CHECKED" ]]; then
    export HAPPY_DAEMON_CHECKED=1
    () {
        local state=$HOME/.happy/daemon.state.json
        local pid=$(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$state" 2>/dev/null | grep -oE '[0-9]+')
        if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
            paws daemon start >/dev/null 2>&1
        fi
    } &!
fi
```

The first interactive shell after a reboot triggers the start; subsequent shells short-circuit because the daemon is already running.

> **macOS users:** prefer this shell-init approach over a `launchd` LaunchAgent. A LaunchAgent runs in an agent domain that is **detached from your GUI/Aqua login session**, which means the bundled `claude-agent-sdk` cannot reach the macOS keychain and silently fails authentication ("Failed to authenticate. API Error: 401 terminated", `duration_api_ms: 0`). If you must use launchd, your wrapper has to read the OAuth access token from `~/.claude/.credentials.json` and export it as `CLAUDE_CODE_OAUTH_TOKEN` before exec'ing the daemon — and you'll need to handle token rotation yourself.

## Authentication

```bash
paws auth login
paws auth logout
```

Paws uses cryptographic key pairs for authentication — your private key stays on your machine. Session payloads are end-to-end encrypted before synchronization.

To connect third-party agent APIs:

```bash
paws connect gemini
paws connect claude
paws connect codex
paws connect status
```

## Commands

| Command | Description |
|---------|-------------|
| `paws` | Start Claude Code session (default) |
| `paws codex` | Start Codex mode |
| `paws gemini` | Start Gemini CLI session |
| `paws openclaw` | Start OpenClaw session |
| `paws acp` | Start any ACP-compatible agent |
| `paws resume <id>` | Resume a previous session |
| `paws notify` | Send push notification to your devices |
| `paws doctor` | Diagnostics & troubleshooting |

---

## Advanced

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HAPPY_SERVER_URL` | Custom server URL (default: maintainer's self-hosted relay) |
| `HAPPY_WEBAPP_URL` | Custom web app URL (default: maintainer's self-hosted webapp) |
| `HAPPY_HOME_DIR` | Custom home directory for Paws data (default: `~/.happy`) |
| `HAPPY_DISABLE_CAFFEINATE` | Disable macOS sleep prevention |
| `HAPPY_EXPERIMENTAL` | Enable experimental features |

### Sandbox (experimental)

Paws can run agents inside an OS-level sandbox to restrict file system and network access.

```bash
paws sandbox configure
paws sandbox status
paws sandbox disable
```

### Building from source

```bash
git clone https://github.com/wangjs-jacky/happy
cd happy
pnpm install
pnpm --filter @wangjs-jacky/paws run build
node packages/happy-cli/bin/happy.mjs --help
```

## Requirements

- Node.js >= 20.0.0
- For Claude: `claude` CLI installed & logged in
- For Codex: `codex` CLI installed & logged in
- For Gemini: `npm install -g @google/gemini-cli` + `paws connect gemini`

## License

MIT
