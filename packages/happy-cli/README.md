# Paws — Happy fork

> Fork of [slopus/happy](https://github.com/slopus/happy) with personal enhancements, published as [`@wangjs-jacky/paws`](https://www.npmjs.com/package/@wangjs-jacky/paws). Source: [wangjs-jacky/happy](https://github.com/wangjs-jacky/happy).

Code on the go — control AI coding agents from your phone, browser, or terminal.

Free. Open source. Code anywhere.

## Installation

```bash
npm install -g @wangjs-jacky/paws
```

This installs both the `paws` and `happy` commands (they are identical).

> **Note:** the `happy` command name conflicts with the official `happy` / `happy-coder` npm packages. If you have one of them installed globally, remove it first (`npm rm -g happy happy-coder`), or install with `--force` and use `paws`.

## Server

By default this fork connects to the maintainer's self-hosted relay server. All session data is **end-to-end encrypted** before leaving your device — the relay only ever sees ciphertext.

To use your own relay, deploy [happy-server](https://github.com/wangjs-jacky/happy/tree/jacky-main/packages/happy-server) and point the CLI (and the mobile/web app) at it:

```bash
# one-off
HAPPY_SERVER_URL=https://your-server.example.com happy

# or persist it in ~/.happy/settings.json
{
  "serverUrl": "https://your-server.example.com",
  "webappUrl": "https://your-webapp.example.com"
}
```

## Usage

### Claude Code (default)

```bash
happy
# or
happy claude
```

This will:
1. Start a Claude Code session
2. Display a QR code to connect from your mobile device or browser
3. Allow real-time session control — all communication is end-to-end encrypted
4. Start new sessions directly from your phone or web while your computer is online

### More agents

```
happy codex
happy gemini
happy openclaw

# or any ACP-compatible CLI
happy acp opencode
happy acp -- custom-agent --flag
```

## Daemon

The daemon is a background service that stays running on your machine. It lets you spawn and manage coding sessions remotely — from your phone or the web app — without needing an open terminal.

```bash
happy daemon start
happy daemon stop
happy daemon status
happy daemon list
```

The daemon starts automatically when you run `happy`, so you usually don't need to manage it manually.

### Keeping the daemon running across reboots

If you want the daemon to come back automatically after a reboot — without opening a `happy` session first — start it from your shell profile so it inherits your normal user session context (PATH, keychain access, OAuth credentials):

```bash
# ~/.zshrc or ~/.bashrc
if [[ -o interactive ]] && [[ -z "$HAPPY_DAEMON_CHECKED" ]]; then
    export HAPPY_DAEMON_CHECKED=1
    () {
        local state=$HOME/.happy/daemon.state.json
        local pid=$(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$state" 2>/dev/null | grep -oE '[0-9]+')
        if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
            happy daemon start >/dev/null 2>&1
        fi
    } &!
fi
```

The first interactive shell after a reboot triggers the start; subsequent shells short-circuit because the daemon is already running.

> **macOS users:** prefer this shell-init approach over a `launchd` LaunchAgent. A LaunchAgent runs in an agent domain that is **detached from your GUI/Aqua login session**, which means the bundled `claude-agent-sdk` cannot reach the macOS keychain and silently fails authentication ("Failed to authenticate. API Error: 401 terminated", `duration_api_ms: 0`). If you must use launchd, your wrapper has to read the OAuth access token from `~/.claude/.credentials.json` and export it as `CLAUDE_CODE_OAUTH_TOKEN` before exec'ing the daemon — and you'll need to handle token rotation yourself.

## Authentication

```bash
happy auth login
happy auth logout
```

Happy uses cryptographic key pairs for authentication — your private key stays on your machine. All session data is end-to-end encrypted before leaving your device.

To connect third-party agent APIs:

```bash
happy connect gemini
happy connect claude
happy connect codex
happy connect status
```

## Commands

| Command | Description |
|---------|-------------|
| `happy` | Start Claude Code session (default) |
| `happy codex` | Start Codex mode |
| `happy gemini` | Start Gemini CLI session |
| `happy openclaw` | Start OpenClaw session |
| `happy acp` | Start any ACP-compatible agent |
| `happy resume <id>` | Resume a previous session |
| `happy notify` | Send push notification to your devices |
| `happy doctor` | Diagnostics & troubleshooting |

---

## Advanced

### Environment Variables

| Variable | Description |
|----------|-------------|
| `HAPPY_SERVER_URL` | Custom server URL (default: maintainer's self-hosted relay) |
| `HAPPY_WEBAPP_URL` | Custom web app URL (default: maintainer's self-hosted webapp) |
| `HAPPY_HOME_DIR` | Custom home directory for Happy data (default: `~/.happy`) |
| `HAPPY_DISABLE_CAFFEINATE` | Disable macOS sleep prevention |
| `HAPPY_EXPERIMENTAL` | Enable experimental features |

### Sandbox (experimental)

Happy can run agents inside an OS-level sandbox to restrict file system and network access.

```bash
happy sandbox configure
happy sandbox status
happy sandbox disable
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
- For Gemini: `npm install -g @google/gemini-cli` + `happy connect gemini`

## License

MIT
