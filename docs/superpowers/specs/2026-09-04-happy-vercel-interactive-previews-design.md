# Happy Vercel Interactive Previews Design

## Summary

Happy will provide a first-party, account-scoped way to publish Agent-generated static interaction drafts to Vercel. A Happy user connects one Vercel account or team once from Settings. Happy Server stores that installation credential encrypted and uses it for every machine, project, and session owned by the same Happy account.

The Agent creates preview files only inside a Happy-issued workspace. The execution machine uploads those files directly to a private OSS staging prefix. Happy Server verifies the staged manifest, streams each object to Vercel, creates a Preview Deployment, and records its high-entropy public URL. OSS staging is removed after publication; Happy Server schedules deletion of the Vercel deployment 24 hours later even when the execution machine is offline.

The same release stops Ego browser steps from replacing the entire right capability panel. Browser progress remains available from a **View progress** action attached to the relevant Skill entry and opens in a separate anchored popover. Published interaction drafts render as read-only cards and open outside the capability panel. Users return to chat to answer the Agent; preview-page clicks are never sent back to the Agent.

## Confirmed Product Decisions

- PC Web is the first client target.
- The primary Ego entry is a **View progress** action on the Skill row with an anchored popover.
- Vercel authorization is stored centrally by Happy and scoped to one Happy account, not one machine and not the entire Happy installation.
- Happy Server publishes to Vercel; long-lived provider credentials never leave the server.
- Only workspaces created by Happy's preview tool are publishable. Happy never scans for or exposes arbitrary localhost services or project directories.
- The first version accepts static interaction drafts only. It does not run package managers, framework builds, server functions, or user build commands.
- Preview URLs are public to anyone who has the high-entropy URL and are marked not to be indexed.
- Publication happens automatically when the Agent finishes a Happy-created interaction draft; there is no per-preview user confirmation.
- Preview pages are display-only from Happy's perspective. The page may contain normal client-side interactions, but no click or form event is reported to Happy or the Agent.
- OSS is a private temporary staging layer. The Happy Server filesystem is never used as preview storage.
- Happy begins Vercel deployment deletion 24 hours after successful publication and retries provider failures until Vercel confirms removal.

## Goals

- Let a user connect Vercel once and reuse it from every Happy execution machine.
- Turn a generated static draft into a remotely accessible URL without requiring the user to understand localhost, Vercel CLI, or deployment commands.
- Keep Vercel credentials out of prompts, clients, execution machines, logs, and preview content.
- Avoid persistent preview bytes on the resource-constrained Happy Server host.
- Make publication retryable across transient execution-machine or network failures by staging privately in OSS.
- Delete staging and deployment data predictably and expose expiry clearly in the UI.
- Preserve the normal capability hub while Ego browser progress is being reported.

## Non-goals

- Proxying arbitrary localhost ports.
- Publishing an existing user repository or arbitrary filesystem directory.
- Vite, Next.js, React framework, server-rendered, edge-function, or backend deployments in the first version.
- Production-domain promotion, custom domains, aliases, Git integration, environment variables, analytics, or billing management.
- Password-protected previews or Happy-authenticated preview pages.
- Capturing preview-page clicks, selections, form submissions, or telemetry for the Agent.
- Mobile-native preview creation or management UI in the first version.
- Supporting Cloudflare Tunnel or another hosting provider in the first version.

## External Prerequisites

Happy must be registered as a Vercel connectable account integration. The integration configuration supplies a client ID, client secret, redirect URL, and the minimum Vercel API permissions required to upload deployment files, create and delete Preview Deployments, and create or resolve the dedicated preview project. These values are deployment configuration, not repository secrets.

Production also requires the existing S3-compatible object storage configuration. Preview objects reuse the configured private bucket under a dedicated prefix; no bucket-wide policy change may broaden public access. An operator may use a separate bucket, but the application contract depends only on private S3-compatible operations.

When either provider is unconfigured, the server reports an explicit unavailable capability. The App hides automatic publication and Settings explains which operator configuration is missing. It never falls back to a production Paws Web deployment, a local filesystem, Vercel CLI, or another hosting provider.

## Architecture

```text
Agent calls create_preview(title)
│
├─ Happy MCP server allocates PreviewWorkspace
│  └─ ~/.happy/previews/<sessionId>/<previewId>/
│
├─ Agent writes the static draft inside that exact directory
│
└─ Agent calls publish_preview(previewId)
   │
   ├─ Happy CLI validates real paths, symlinks, count, types, and size
   ├─ POST /v1/sessions/:sessionId/previews/:previewId/draft
   │  └─ Happy Server returns short-lived OSS upload descriptors
   ├─ Happy CLI uploads each file directly to private OSS
   ├─ POST /v1/sessions/:sessionId/previews/:previewId/publish
   │  ├─ server revalidates manifest + OSS object metadata
   │  ├─ server streams objects to Vercel's file API
   │  ├─ server creates a Preview Deployment
   │  ├─ server records URL + deployment ID + expiresAt
   │  └─ server deletes the OSS staging prefix
   └─ CLI emits an interactive-preview session event
      ├─ chat renders InteractivePreviewCard
      └─ capability models expose the latest live preview

Happy Server cleanup loop
├─ retries failed/abandoned OSS staging cleanup
├─ deletes Vercel deployments whose expiresAt <= now
└─ prunes old terminal metadata after the UI retention window
```

`create_preview` and `publish_preview` are separate tools because Happy cannot infer when arbitrary file writes are complete. “Automatic publication” means the built-in Agent instruction requires `publish_preview` immediately after a requested interaction draft is complete; it does not mean Happy watches every HTML file on the machine.

## Vercel Connection

### Installation flow

Settings contains a **Temporary previews** screen with one Vercel connection row. Connecting opens the Vercel integration installation flow in a browser or popup. Happy binds the callback state to the authenticated Happy account, enforces a short expiry and one-time use, and exchanges the returned code on Happy Server.

The encrypted credential record includes the Vercel access token and configuration identifier. Non-secret metadata includes the selected account/team ID and display name, the dedicated preview project ID, connection state, and last successful use time. The credential uses the existing `HANDY_MASTER_SECRET`-derived encryption mechanism with a provider-specific key path.

The integration installation determines a single Vercel scope. A user who wants a different personal account or team disconnects and reconnects. Happy never silently deploys into a different Vercel scope.

### Dedicated project

The first successful publication resolves or creates one project named `happy-previews` in the connected scope. Every interaction draft becomes a unique Preview Deployment in this project. Happy explicitly creates a non-production deployment (`target: null` in the Vercel API contract), never requests production promotion, and treats any unexpected production alias as a failed safety check.

If an unrelated `happy-previews` project already exists, Happy does not overwrite its configuration. It records a conflict and asks the user to reconnect or let Happy create a collision-safe name derived from the integration configuration ID.

### Disconnect and provider revocation

Disconnecting immediately prevents new publications and removes the encrypted credential. Happy best-effort deletes active Happy-owned deployments before discarding access. If provider deletion fails, the UI warns that the user must remove remaining deployments or the integration from Vercel; Happy never retains a plaintext credential for later cleanup.

## Preview Workspace and File Contract

`create_preview` returns an opaque preview ID plus an absolute directory created under Happy's configured home. `publish_preview` accepts only that ID; it never accepts an arbitrary directory argument. The registry is scoped to the current authenticated session and process. Publication resolves every path with `realpath` and rejects entries that escape the workspace, including symlinks and hard-link anomalies where detectable.

The first-version limits are:

- 100 files per preview.
- 10 MiB total uncompressed bytes.
- 5 MiB per file.
- One required root `index.html`.
- Relative POSIX paths up to 240 UTF-8 bytes with no empty, dot, parent, control-character, or backslash segment.
- No hidden files, `.env` variants, source maps, archives, executables, package manifests, lockfiles, or server configuration.

Allowed content is static HTML, CSS, JavaScript modules, JSON data, plain text, common raster images, SVG, icons, and WOFF/WOFF2 fonts. The allowlist is defined once in `happy-wire` and enforced independently by CLI and server. The server trusts neither the filename MIME claim nor the client hash without checking OSS metadata and bounded content signatures where applicable.

Generated deployments include a Happy-owned `vercel.json` that selects a static, non-production deployment and sets `X-Robots-Tag: noindex, nofollow, noarchive`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`. Agent-supplied Vercel configuration is rejected.

## OSS Staging

Preview staging objects use opaque identifiers under:

```text
private/interactive-previews/<accountId>/<previewId>/<assetId>
```

The user-controlled relative filename exists only in the database manifest and Vercel file manifest; it is never interpolated into an OSS key. Upload descriptors expire after ten minutes and authorize one expected object size. Objects remain private and are not served through `S3_PUBLIC_URL`.

The execution machine uploads directly to OSS. The server marks an asset uploaded only after checking its exact object size. Publication reads no more than the reserved size, uploads files to Vercel one at a time, and limits the process to two concurrent publication jobs per server instance. This bounds Happy Server memory while preserving throughput for small drafts.

After Vercel accepts the deployment, Happy deletes the staging prefix. An application cleanup loop retries abandoned or failed drafts until deletion succeeds. An OSS lifecycle rule scoped only to `private/interactive-previews/` is a defense-in-depth fallback; it must not target attachments, public session shares, or OTA prefixes.

## Data Model

`InteractivePreview`:

- `id`: cryptographically random UUID created by Happy CLI.
- `accountId`, `sessionId`: owner and source session.
- `title`: bounded display title.
- `status`: `draft | uploading | publishing | ready | failed | deleting | expired`.
- `vercelDeploymentId`, `vercelUrl`: nullable provider result.
- `stagingGeneration`: opaque OSS generation.
- `publishedAt`, `expiresAt`: nullable lifecycle timestamps.
- `errorCode`: bounded stable error identifier; no provider secrets or raw response body.
- `createdAt`, `updatedAt`.

`InteractivePreviewAsset`:

- composite ownership by preview and generation.
- opaque asset ID.
- validated relative filename, MIME type, byte size, SHA-256, storage key, and upload timestamp.

The account/session relations cascade database metadata when their owner is deleted. Object and Vercel cleanup is attempted before metadata removal; failures retain a retryable tombstone. Ready previews are indexed by `expiresAt`; drafts are indexed by status and update time.

Vercel credentials reuse the existing per-account encrypted service-token storage through a dedicated provider store rather than adding plaintext token columns.

## Server API

Authenticated endpoints:

- `GET /v1/connect/vercel/status`
- `GET /v1/connect/vercel/params`
- `GET /v1/connect/vercel/callback` (state-authenticated provider callback)
- `DELETE /v1/connect/vercel`
- `POST /v1/sessions/:sessionId/previews/:previewId/draft`
- `POST /v1/sessions/:sessionId/previews/:previewId/assets/:assetId/uploaded`
- `POST /v1/sessions/:sessionId/previews/:previewId/publish`
- `GET /v1/sessions/:sessionId/previews`
- `DELETE /v1/sessions/:sessionId/previews/:previewId`

Draft creation is idempotent by `accountId + sessionId + previewId`. Asset completion is idempotent by preview generation and asset ID. Publish returns an existing ready deployment for the same immutable manifest, returns the current publishing status for a duplicate in-flight request, and rejects a different manifest under the same preview ID.

All owner routes verify both `request.userId` and session ownership. Callback errors redirect to a fixed configured Happy Web origin with a small status code; provider error text and tokens never enter the query string.

## Agent and CLI Integration

The first-party Happy MCP bridge adds:

- `create_preview({ title }) -> { previewId, directory }`
- `publish_preview({ previewId }) -> { url, expiresAt }`

Both tools are available to Codex, Claude, and other first-party Happy Agent backends through the existing per-session HTTP MCP server and stdio bridge. They are safe for automatic approval only by exact first-party tool name. Any crafted name containing the substring remains untrusted.

`publish_preview` performs local validation before requesting an upload draft, uploads files directly using presigned descriptors, finalizes each object, and waits for the server's bounded publication response. On success it emits one typed session event containing preview ID, title, URL, state, and expiry. It then deletes the local workspace. On failure it preserves the workspace for a bounded retry window and returns an actionable, secret-free error.

The built-in system prompt states that remote Paws clients cannot open localhost, that requested interaction drafts must use the Happy preview tools, that only Happy-issued workspaces are publishable, and that the Agent must never put secrets or private user data into a public preview. It does not instruct Agents to invoke Vercel CLI or Cloudflare directly.

## PC Web Experience

### Settings

**Settings → Temporary previews** shows:

- operator availability: Happy Server, OSS staging, and Vercel integration configuration;
- disconnected state with **Connect Vercel**;
- connected Vercel user/team and dedicated project;
- **Reconnect** and **Disconnect** actions;
- the public-link and 24-hour-retention disclosure.

The popup callback refreshes connection status without requiring a full application reload. All colors, hover, selected, pressed, border, and shadow states use current Unistyles semantic tokens.

### Preview result

A successful typed preview event renders `InteractivePreviewCard` in chat with title, provider, expiration, **Open preview**, and **Copy link**. The expired state disables opening and says that the deployment has been removed. The card never embeds provider credentials, OSS paths, account/team IDs, or local paths.

On PC Web, **Open preview** uses a separate browser tab or app window. It does not replace the right capability panel and does not embed a privileged same-origin frame. The preview cannot message the Happy application.

### Ego progress

`SessionCapabilityHub` no longer returns `BrowserStepsPanel` whenever any browser step exists. Browser-step messages remain in the session-derived model. In the Skills detail list, an Ego skill with browser steps gains **View progress**. Activating it opens an anchored desktop popover containing the existing latest-frame preview and timeline; closing it restores focus to the trigger.

If a precise Skill-to-step association is unavailable in legacy messages, all browser steps for the current session attach to the most recent Ego skill invocation. New browser-step events include a stable run ID so concurrent or repeated runs remain separated. The ordinary capability summary, folder browser, generated images, actions, and quick prompts remain usable while Ego runs.

The popover follows the current PC visual baseline: compact type hierarchy, semantic surfaces, a hairline divider, theme-derived shadow, keyboard focus containment, Escape-to-close, and a viewport-bounded internal scroll area. Mobile keeps its current non-popover presentation until separately designed.

## Lifecycle and Cleanup

- Draft upload descriptors: ten-minute expiry.
- Abandoned/failed OSS staging: application cleanup after one hour; OSS prefix lifecycle is a maximum-24-hour fallback.
- Ready Vercel deployment: deletion becomes due 24 hours from `publishedAt`; the scheduler normally starts it within one minute.
- Cleanup cadence: at least once per minute, using an idempotent compare-and-set transition to `deleting`.
- Provider or OSS deletion failure: retain the row and retry with bounded exponential backoff.
- Successful Vercel deletion: mark `expired`, clear URL from owner API responses, and remove any remaining staging objects.
- Terminal metadata: retain status long enough for old chat cards to render “expired,” then prune after 30 days.

The scheduler runs on Happy Server, so cleanup does not depend on the originating Mac being online. Multiple server replicas may execute the loop; row claims prevent duplicate active work, and provider deletion remains idempotent.

## Error Handling

- Missing Vercel connection: return `PREVIEW_PROVIDER_NOT_CONNECTED` and link the user to Settings.
- Expired or removed integration: disable new publication, retain staged data only for its normal cleanup window, and request reconnection.
- Invalid workspace or file: fail locally before any upload and name only the safe relative path.
- OSS upload interruption: reuse the same immutable draft and retry missing assets.
- Manifest mismatch or missing object: fail closed and never create a deployment.
- Vercel rate limit or transient 5xx: bounded retry honoring `Retry-After`; retain OSS staging for retry.
- Vercel validation/build error: mark failed with a stable summary and remove staging after the retry window.
- Deployment succeeds but response is lost: reconcile by a Happy preview identifier attached to Vercel deployment metadata before creating another deployment.
- OSS cleanup fails after successful publication: keep the deployment ready, retain cleanup state, and retry asynchronously.
- Expiry deletion fails: remove the URL from Happy APIs at `expiresAt`, display expired in clients, and continue provider deletion retries. A user who retained the direct Vercel URL may still reach it until Vercel confirms deletion, so the product promises scheduled deletion rather than impossible provider-independent exact removal.
- Server restart: recover non-terminal drafts, publishing jobs, and expired deployments from database state.

## Security and Privacy

- Vercel access tokens are encrypted at rest using a provider- and account-scoped key derivation path.
- Tokens are never returned by an API, sent to a client, embedded in a presigned URL, written to logs, or passed to an Agent.
- OAuth/integration state is short-lived, single-use, account-bound, and compared in constant time where applicable.
- Provider requests use explicit allowlisted Vercel API origins and hard timeouts; redirects are not followed to arbitrary origins while credentials are attached.
- OSS upload policies bind bucket, opaque key, size, and expiry. Staging objects are private.
- Session ownership, preview ownership, and asset generation are checked on every mutation.
- Path traversal, symlinks, hidden credential files, oversized files, unsupported types, and provider configuration files are rejected.
- Public previews carry high-entropy Vercel URLs and noindex headers but are still public. Settings and the Agent prompt state this plainly.
- Preview content receives no Happy token, cookie, API origin, session ID, postMessage bridge, or callback endpoint.
- Logs use preview IDs and stable error codes, never file bodies, complete public URLs, OSS signed URLs, authorization codes, or provider tokens.

## Metrics and Resource Limits

The production server currently has two CPU cores, 1.8 GiB RAM, and limited memory headroom. The publication pipeline therefore processes files sequentially and allows at most two concurrent Vercel publication jobs per server instance. It never buffers a complete preview bundle or writes preview content to local disk.

New metrics cover draft creation, OSS upload completion/failure, Vercel publication duration/result, active publication jobs, staged bytes, cleanup result, expired deployment backlog, and provider rate limits. Alerts should focus on a growing cleanup backlog, repeated provider authorization failures, memory pressure, and publication latency.

## Testing and Verification

### Unit tests

- Wire schemas reject unknown states, path traversal, unsafe files, and limit violations.
- Provider credential storage encrypts with the correct account/provider path and never exposes token fields.
- Vercel integration callback validates state, configuration scope, provider errors, and token exchange failures.
- Vercel client uploads exact bytes and SHA references, creates only Preview Deployments, never promotes production, and deletes by recorded deployment ID.
- OSS storage creates opaque keys, bounded presigned uploads, exact-size completion checks, sequential reads, and prefix-scoped cleanup.
- Lifecycle transitions are idempotent and retain retry state when either provider fails.
- CLI workspace registry rejects arbitrary directories, symlinks, hidden files, unsupported types, count/size overflow, and session mismatches.
- MCP bridge forwards both preview tools and exact-name permission handling remains fail-closed.
- App API and settings state cover unavailable, disconnected, connecting, connected, expired, and disconnecting states.
- Message projection and cards cover publishing, ready, failed, and expired previews.
- Browser-step routing keeps the capability hub mounted and groups steps by Ego run.

### Integration tests

- A local S3-compatible store plus a fake Vercel HTTP server exercises draft creation, direct upload, publication, OSS removal, event emission, expiry, and deletion retry.
- Server restart tests recover `publishing` and `deleting` rows without duplicate deployments.
- Two concurrent publishes verify the per-instance concurrency limit and idempotency keys.
- Account A cannot query, upload, publish, delete, or reuse credentials belonging to Account B.

### PC Web tests

- Playwright connects/disconnects a mocked Vercel integration and verifies popup callback refresh.
- A ready event renders the preview card, copy action, expiry, and external open behavior.
- Browser steps do not replace the capability hub.
- The Ego Skill row opens and closes the anchored progress popover by pointer, keyboard, and Escape.
- Narrow-height and non-default dark-theme captures verify scroll bounds, semantic interaction states, and trigger focus restoration.

### Live smoke test

After the Vercel integration credentials and production OSS prefix are configured, publish a deterministic three-file fixture through the real Happy flow. Verify the URL returns the expected HTML with noindex headers, the OSS staging prefix is empty after success, the deployment target is Preview rather than Production, no token appears in logs or responses, and explicit test cleanup removes the deployment. The destructive 24-hour behavior is covered with a test clock and a short-lived non-production fixture rather than leaving a real test deployment for a day.

## Rollout

1. Deploy the database migration and server capability in a disabled state.
2. Configure the private OSS preview prefix and Vercel integration credentials.
3. Run the real deterministic smoke test and cleanup it explicitly.
4. Release the CLI/MCP tools and built-in prompt.
5. Release PC Web Settings, chat card, and Ego progress popover.
6. Enable automatic preview publication for accounts with a connected Vercel integration.
7. Monitor publication errors, memory, OSS staging age, and Vercel cleanup backlog before widening concurrency.

Older clients ignore the new typed preview event and continue rendering the Agent's textual URL. New clients treat an unavailable server capability as disconnected and never attempt direct Vercel CLI deployment. The previously proposed prompt-only direct-hosting behavior is superseded by this managed service and should not be merged independently without reconciling its instructions.
