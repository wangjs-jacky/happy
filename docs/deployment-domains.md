# Paws public domains

The approved domain split is:

| Public origin | Purpose |
| --- | --- |
| `https://paws.rodeo` | Existing Paws landing site on Cloudflare Pages (`paws-landing`) |
| `https://www.paws.rodeo` | 301 redirect to the landing origin, preserving path and query |
| `https://app.paws.rodeo` | Paws Web and same-origin APIs through the existing Cloudflare Tunnel |
| `https://47.115.228.20:8443` | Existing production deployment and fallback origin |

Web artifacts still deploy through the main-branch Web production workflow and
OSS atomic activation. No new Web server, client endpoint migration, or OTA is
required for the domain split. The runtime injector recognizes the application
subdomain before loading the bundle. It retains the former apex application
origin for migration/rollback compatibility; the landing site does not use this
injected HTML.

## Tunnel origin contract

The public `app.paws.rodeo` ingress targets `http://127.0.0.1:8081` with
`originRequest.httpHostHeader: paws.rodeo`. This intentionally preserves the
existing internal Caddy Host guard and deployment health probe. The internal
Host is a routing identifier, independent of the apex public DNS destination.
Do not remove the override without coordinating a Caddy guard/probe migration.
TLS verification is not disabled; the Tunnel origin is the existing HTTP
loopback listener.

Dynamic cache bypass must match `app.paws.rodeo`, including `/health`, `/v1/`,
`/v2/`, `/v3/`, `/v4/`, `/files/`, and `/v1/updates`. Keep WebSockets enabled.
The Pages apex custom domain must be associated with the landing project before
pointing its DNS record to `paws-landing-eo4.pages.dev`.

## Ordered migration and verification

1. Add the app Tunnel ingress (with the internal Host override), its proxied
   CNAME, and dynamic cache bypass while preserving the existing apex ingress.
2. Deploy the app-aware runtime injector through the normal main workflow.
3. Verify app HTML/runtime origin, API cache bypass, assets and WebSocket 101;
   `pnpm tunnel:check-dns` checks zone NS separately from the app DNS/TLS and
   `pnpm tunnel:verify` targets the app subdomain and old fallback.
4. Associate the Pages apex domain and switch only the apex CNAME to Pages.
   Verify the landing content, documentation routes and www redirect.
5. Remove the former apex Tunnel ingress and restrict the dynamic cache rule to
   the app host after propagation. Preserve the www/TXT records and nameservers.

Retain the pre-migration Cloudflare records/configuration for rollback. The old
IP origin remains usable throughout; do not restart Server or daemon, overwrite
application data, or alter mobile endpoints as part of this migration.
