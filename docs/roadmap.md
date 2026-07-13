# Paws Roadmap

Paws is an independently maintained remote-control surface for AI coding agents. This roadmap describes product direction, not a promise of delivery dates. Work should preserve the core loop: start an agent on a computer, continue from another device, and keep the session private and recoverable.

## Shipped Foundations

- Paws-branded Android, preview, development, and web builds.
- Public `@wangjs-jacky/paws` CLI with `paws` as the primary command and `happy` as a compatibility alias.
- Claude Code, Codex, Gemini, OpenCode, and ACP-compatible agent launch paths.
- Daemon-based remote session creation and current-session attach.
- End-to-end encrypted session sync with a self-hostable Fastify/Socket.IO server.
- Image attachments, HEIC normalization, generated-image recovery, galleries, and style agents.
- Direct Android FCM notifications and foreground notification handling.
- Session management, capability panel, skills discovery, screenshots, finance cards, health-agent surfaces, and Agent spaces.
- Self-hosted Android OTA with isolated preview/production channels and per-PR version targeting.
- npm, GitHub Release, preview OTA, and production OTA delivery paths.

## Current Priorities

### 1. Reliability Before More Surface Area

- Make full workspace typecheck and unit tests required merge checks.
- Triage runtime dependency advisories and establish routine dependency maintenance.
- Reduce session lifecycle, reconnect, queue ordering, daemon spawn, and attachment failure modes.
- Keep rollback and version diagnostics available for every production delivery path.

### 2. Finish Existing User Flows

- Resolve navigation and back-stack inconsistencies across session-management and settings flows.
- Make attachment upload, download, preview, retry, and cleanup behavior consistent across platforms.
- Finish first-run guidance for pairing, daemon setup, remote spawning, and self-host configuration.
- Improve offline and degraded-network status so users can distinguish local agent, daemon, relay, and push failures.

### 3. Sustainable Paws Architecture

- Split high-change hotspots in App sync, session configuration, and provider runners without changing protocol behavior.
- Keep shared wire schemas explicit and test-compatible across App, CLI, Agent, and Server.
- Preserve internal compatibility identifiers only where they are part of stored data, public APIs, package names, or migration paths.
- Treat upstream Happy as historical origin/reference, not an integration branch or delivery dependency.

### 4. Distribution and Self-Hosting

- Keep the npm CLI install path and Android release path reproducible from `main`.
- Document and test single-machine `paws server` and Docker self-host paths.
- Improve release naming so stable Android builds, previews, CLI versions, and OTA versions are easy to distinguish.
- Add health checks and migration/backup guidance for long-running self-host deployments.

### 5. Community Readiness

- Keep bilingual onboarding, contribution guidance, privacy terms, and product metadata synchronized with releases.
- Add issue and PR templates once external contribution volume justifies them.
- Publish concise release notes with screenshots or verification evidence for user-visible changes.
- Use real user feedback and opt-in analytics to prioritize reliability work over feature count.

## Later Bets

These are valuable but should not outrank reliability and onboarding:

- First-class workspaces and daemon-managed checkouts across machines.
- Multi-agent fan-out, orchestration, and result comparison.
- Scheduled agents and maintenance workflows.
- Deeper GitHub, Linear, and MCP integrations.
- Web push and smarter multi-device notification routing.
- Embedded terminal and richer file editing/diff workflows.
- Voice as a complete agent-control surface.

## Decision Rules

When priorities conflict:

1. Prevent data loss, privacy regressions, broken upgrades, and unreachable sessions.
2. Fix the main remote-control loop before adding a new panel or integration.
3. Prefer changes with automated regression coverage and a reversible release path.
4. Keep PRs focused; land protocol, native-runtime, and storage changes with explicit migration notes.
5. Do not measure Paws progress by distance from the historical upstream repository.
