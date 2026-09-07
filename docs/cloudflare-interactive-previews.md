# Cloudflare temporary interaction previews

All new previews use Cloudflare. Call `create_preview`, write public static files only inside its issued workspace, then `publish_preview` with `mode: "tunnel"` (default) or `mode: "hosted"`. Arbitrary folders and localhost ports are never accepted. Update the CLI and start a new session to expose the new mode parameter; update the server and app together.

## Anonymous tunnel

Requires `cloudflared` on the session machine, no Cloudflare account or server staging configuration. Only manifest-declared, hash-verified assets are snapshotted and served over loopback; GET/HEAD only, no writes or directory exposure. At most three tunnels per session. Repeated publication reuses its running link.

The link stops on session shutdown, cloudflared exit, network loss or local shutdown, and at most 24 hours after publication. Normal shutdown emits an expired card; abrupt failure may leave a last-known card until its deadline. This is not cloud hosting or guaranteed 24-hour uptime.

## Cloud hosting (Pages)

In Settings > Temporary previews, configure the Cloudflare **Account ID** and a scoped **API Token** with **Account / Cloudflare Pages / Edit**, limited to that Cloudflare account. This is a token connection, not OAuth or anonymous hosting. Use Happy over HTTPS for transmitting credentials. Tokens are encrypted server-side in the separate `provider:cloudflare` namespace; they are never returned by status, put in preview manifests or stored in App/browser settings.

The server still requires a dedicated private `PREVIEW_S3_BUCKET` and its S3/OSS connection configuration for bounded staging. No Vercel OAuth environment variables are used. Token verification provisions one empty, ownership-marked Pages project per Happy account / Cloudflare account combination. Reconnecting may leave an empty managed project; unrelated projects are not modified.

Verified files are uploaded using Pages upload JWTs and its BLAKE3(base64 contents + extension) asset key format. Each publication gets a unique non-production branch and reconciliation metadata. Happy owns the multipart `_headers` configuration (noindex, nosniff, no-referrer, no-store); no build scripts, Functions or agent-provided worker/config are deployed.

Published links survive local/session shutdown. The server schedules deletion after 24 hours, with minute-interval cleanup, durable leases, retry/backoff, and restart reconciliation. This is scheduled removal, not a hard access-control expiry: provider outages, server downtime or revoked credentials can delay actual removal. Pages quotas and platform limits still apply. Do not publish secrets or content that needs guaranteed access revocation.

Disconnecting stops new hosted publication and attempts to remove existing hosted deployments. A cleanup warning means an operator must check/remove remaining Pages deployments; do not assume the card's expired state proves remote deletion. Tunnels are unaffected.

## Removal of the old integration

Vercel OAuth routes, token handling, deployment client, publishing options and settings UI are removed. Historical migration files, physical database column names (`@map`) and legacy event decoding are retained solely to avoid destructive schema/history changes. No database migration is required.

**Before production rollout:** drain/delete any old Vercel previews using the previous version or the Vercel dashboard, and revoke old integration tokens. The Cloudflare service only operates on rows with a new `cf-` staging-generation marker. Legacy rows and encrypted tokens are deliberately not relabeled, sent to Cloudflare, silently pruned or claimed as cleaned. They remain available for an operator's migration audit. Mixed old/new server versions must not publish concurrently during rollout because connection fence columns are shared.

## Verification boundaries

Unit tests cover Pages request formats, scoped deletion, owned projects, encrypted credentials, static boundaries, settings and tool arguments. Persisted integration tests exercise Prisma/PGlite, HTTP routes, S3 staging, restart recovery and cleanup with a provider fault-injection double. They do not prove a real Cloudflare account deployment. Live hosted upload/read/delete requires an authorized account connection and must be recorded separately.
