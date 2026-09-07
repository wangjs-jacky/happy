# Cloudflare temporary interaction previews

The Happy `publish_preview` tool accepts `provider: "cloudflare"` alongside the default `vercel` channel. Both require a workspace issued by `create_preview`; arbitrary directories and existing localhost ports are never accepted.

Ask the assistant: “用 Cloudflare 发布临时交互预览。” The settings page lists Cloudflare separately from the Vercel account connection, and preview cards show the chosen channel.

Cloudflare uses a Quick Tunnel and requires `cloudflared` on the session machine's PATH. It needs neither a Cloudflare account nor Happy Server Vercel/OSS configuration. Update the CLI and start a new session to expose the new tool parameter. Update the app to render Cloudflare channel metadata.

The CLI snapshots only the validated manifest assets, verifies their hashes and sizes, and serves them on a randomly allocated loopback port. Requests are restricted to GET/HEAD and exact asset paths; files cannot be changed through the public endpoint. The original workspace can be removed without changing the snapshot.

The tunnel is owned by the running session and expires when that session stops, when cloudflared exits, or after 24 hours, whichever occurs first. Turning off the machine or losing network access also makes the link unavailable. There is no guaranteed 24-hour uptime. Normal shutdown emits an expired card; abrupt machine failure may leave the last known card visible until its deadline.

Each session can run up to three previews. Repeating a successful Cloudflare publication returns its existing link. Failed starts retain the workspace for retry. Starting a different provider for an already-published workspace requires a new workspace. Cloudflare previews are represented in the encrypted session event history; they are not Vercel deployments and are not stored in the server's Vercel deployment registry.

## Verification

- Preview asset boundary tests cover immutable snapshots, undeclared/traversal paths, malformed requests, writes, changed assets and canceled startup.
- Codex bridge regression checks preserve the provider argument.
- App tests cover Cloudflare labeling and session lifetime alongside existing Vercel states.
- A real Quick Tunnel served the pelican HTML with the same SHA-256 as its source, and normal closure emitted the expired state.
