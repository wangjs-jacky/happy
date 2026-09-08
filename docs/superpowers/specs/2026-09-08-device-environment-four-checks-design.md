# Device Environment Four-Check Design

## Goal

Expand the existing GitHub CLI fleet-alignment screen into a safe development-environment health view. The first release adds Paws CLI, Ego Lite/Ego CLI, Cloudflare Wrangler, and cloudflared across every registered machine while retaining the existing GitHub CLI scan, preview, and apply behavior.

The feature must answer two different questions without conflating them:

1. Is this tool and its account/runtime ready on each machine?
2. When a trusted target and installer are available, can Happy align it safely?

## Scope

### Included

- One fleet scan returns observations for GitHub CLI plus the four new checks.
- Paws CLI reports installed version, npm latest version, executable ownership, and whether it is aligned.
- Ego reports Ego Lite app version, Ego CLI version, bundled Chromium version, bundled Node version, PATH/onboarding readiness, and whether the app and CLI versions agree.
- Wrangler reports installed version, npm latest version, authentication status, and bounded account display names.
- cloudflared reports installed version, Homebrew stable version, and whether a tunnel login certificate is present.
- Offline machines remain visible and are skipped without erasing results already returned by other machines.
- GitHub CLI keeps its existing preview-and-apply flow.
- Paws CLI may preview and apply an npm global install/upgrade only when the resolved `paws` executable is proven to belong to the selected npm global prefix. Otherwise it is inspect-only with local repair guidance.
- Ego, Wrangler, and cloudflared are inspect-only in this release.

### Excluded

- Reading or returning Cloudflare tokens, OAuth credentials, cookies, complete account IDs, Wrangler configuration contents, or raw process output.
- Inspecting per-site login state in Ego.
- Installing or upgrading Ego Lite, Wrangler, or cloudflared.
- Logging into GitHub or Cloudflare on the user's behalf.
- Changing Cloudflare accounts or selecting deployment targets.
- General-purpose arbitrary command execution.

## Chosen Approach

Use a component-capability protocol: every observation shares bounded installation and status fields, while component-specific details are carried by a discriminated `details` object. Planning and applying are allowed only for adapters that explicitly declare alignment support.

This is preferred over:

- Reusing the GitHub-only schema, because its literal GitHub authentication and Homebrew fields would misrepresent npm, app-bundle, and inspect-only components.
- Creating a separate RPC for every tool, because that duplicates fleet timeout, offline, stale-result, and redaction behavior.

## Protocol

`EnvironmentComponentId` becomes:

- `github-cli`
- `paws-cli`
- `ego-browser`
- `cloudflare-wrangler`
- `cloudflared`

Each observation contains:

- component identity, platform, architecture, support, and inspection timestamp;
- installed flag, installed version, and resolved executable;
- source kind (`homebrew`, `npm-global`, `app-managed`, or `none`), source availability, latest version, and ownership verification;
- capability (`alignable` or `inspect-only`);
- optional authentication status with a bounded provider, masked principal, and at most eight bounded account labels;
- a discriminated details payload for GitHub, Paws, Ego, Wrangler, or cloudflared;
- a bounded reason code, never raw stdout/stderr.

Inspect requests accept up to five unique component IDs. A desired target remains a single component per request so preview approval and daemon-local plan issuance retain their current atomicity. Apply requests continue to carry exactly one desired state and one daemon-issued plan.

Unknown or failed observations use the requested component identity and do not invent GitHub authentication fields.

## Daemon Adapters

All subprocesses use argument arrays, fixed executable resolution, bounded output, and timeouts. Parsers accept only expected version/authentication shapes and discard the original output.

### Paws CLI

- Run the resolved executable with `--version`; this must exit before authentication or session creation.
- Query the npm registry through the npm CLI using a bounded timeout.
- Resolve the global npm prefix and prove the executable is owned by that prefix before offering alignment.
- Apply with the matching npm executable and an exact package version.
- Re-inspect after apply and require exact target equality.

### Ego Lite and Ego CLI

- Resolve `ego-browser` from PATH and the documented `~/.local/bin` candidate.
- Parse `ego-browser --version` for CLI, Chromium, and Node versions.
- On macOS, read the known Ego Lite `Info.plist` version without launching the app.
- Mark ready only when the app exists, the CLI resolves, the output parses, and app/CLI versions match.
- Do not open a task space or inspect browser data during a health scan.

### Cloudflare Wrangler

- Resolve `wrangler`, parse `wrangler --version`, and query the npm latest version.
- Run `wrangler whoami` with bounded output and timeout.
- Return only authenticated/missing/unknown plus sanitized display labels; discard email addresses, IDs, permissions, tokens, paths, and raw output.
- Account labels are display-only and never used to authorize an operation.

### cloudflared

- Resolve `cloudflared`, parse `cloudflared --version`, and read Homebrew formula metadata when available.
- Check only for the existence of the conventional tunnel certificate path; never read or return certificate contents.
- Treat certificate presence as tunnel-login readiness, not proof that a tunnel is healthy.

## App Model and UI

Keep the existing GitHub alignment controls, but rename the page summary to development environment health. A scan refreshes all five observations per online machine.

Each machine card contains compact component rows with:

- component name and ready/warning/unknown state;
- installed version and latest/paired version where meaningful;
- authentication/runtime readiness summary;
- a concise reason and up to three safe local repair commands.

GitHub and eligible Paws rows can be selected for their own preview/apply operation. Inspect-only rows never appear in the confirmation dialog. A failed component does not hide successful observations from the same machine.

## Safety and Privacy

- Wire schemas are strict, bounded, and reject duplicate component IDs.
- The daemon never returns raw output or exception text.
- Authentication commands do not log their environment or response.
- Cloudflare account IDs, tokens, cookies, email addresses, certificate contents, and configuration contents are excluded from the protocol.
- Repair commands are static allowlisted strings.
- Apply remains protected by daemon-local issuance, expiry, re-inspection, fingerprint validation, and per-component in-flight locks.
- Fleet changes invalidate new previews but do not erase results for an already-dispatched batch.

## User-Observable Cases

| Case | Passing result |
| --- | --- |
| ENV-01 Fleet scan | Every online machine shows GitHub plus four new component results; offline machines remain visible and skipped. |
| ENV-02 Paws health | The card shows installed/latest Paws versions without creating an authentication flow or session. |
| ENV-03 Paws alignment | A verified npm-owned Paws installation can be previewed, approved, upgraded, and re-verified; unverified ownership produces manual guidance. |
| ENV-04 Ego readiness | The card shows Ego Lite, Ego CLI, Chromium, and Node versions and flags missing PATH/onboarding or an app/CLI mismatch. |
| ENV-05 Wrangler account | The card distinguishes installed/not installed and authenticated/missing/unknown, with only sanitized account display labels. |
| ENV-06 cloudflared readiness | The card shows its version and distinguishes certificate present/missing without claiming tunnel health. |
| ENV-07 Isolation | A failure or timeout in one component leaves the other component observations usable. |
| ENV-08 Existing GitHub flow | GitHub scan, preview, approval, apply, timeout, stale-plan, and repair behavior remain unchanged. |

## Testing and Delivery

- Parser and adapter tests are written first and observed failing before implementation.
- Wire tests cover strict bounds, duplicate rejection, discriminated details, and secret-shaped extra-field rejection.
- Service tests cover mixed inspect-only/alignable adapters, per-component failures, issuance, apply locks, and redaction.
- App model/hook/component tests cover all eight cases, including offline and partial failure states.
- Run targeted unit tests, package typechecks, and the relevant workspace suite.
- Capture Before from the base revision and After from the implemented revision at matching desktop dimensions.
- Perform an independent code review, targeted PC interaction review, and one-to-one browser E2E for scan and Paws preview/apply UI behavior.
- Deliver the final screenshot and playable verification video through Happy before creating the PR.

## Assumptions

- macOS is the only platform on which Ego app pairing and automatic Homebrew/npm alignment are supported in this release.
- Linux machines may still report CLI-only observations where parsers support them, but unsupported app-specific checks are explicit.
- Network-derived latest versions and account checks may time out independently and appear as unknown without blocking local version results.
