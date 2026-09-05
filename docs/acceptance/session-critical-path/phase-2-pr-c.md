# Phase 2 PR C acceptance contract

PR C establishes trustworthy startup attribution and functional correctness. It
may pass attribution completeness while the final latency gate fails. PR D owns
the final latency improvement. A missing stage, retry, old full-list request,
insufficient samples, or privacy failure cannot be relabeled a latency-only miss.

## Case ledger

Record each case as `pass | fail | blocked | not-required`, with its immutable
build revision, command/result, sanitized evidence artifact, and reason. `blocked`
means a required environment or measurement capability is unavailable; `fail`
means an executed assertion failed. `not-required` needs a specific approved scope
reason and cannot excuse C1–C7 for the complete PR C branch. The status below is a
template, not a claim that a browser round has run.

| Case | Exact operation and assertion | Evidence / gate | Status before execution |
|---|---|---|---|
| C1 Fresh deep link | Open a known populated session in a fresh authenticated document; target header and latest complete message paint; no loading retry and zero exact `/v1/sessions` requests. | At least five cold + five warm deep-link samples; P50 ≤ 2000 ms and P95 ≤ 4000 ms in **each** cohort; all deep-link milestones. | blocked |
| C2 New-session navigation | Click send once from Compose; create one session, accept one local first-message receipt, and paint that target route. | At least five cold + five warm spawn samples; route-paint P50 ≤ 7000 ms and P95 ≤ 10000 ms in each cohort; mandatory spawn stages. | blocked |
| C3 Real processor ready | Real processor registers the message-consumption path; initiating Web client receives its encrypted nonterminal ready event. Route navigation alone never proves readiness. | Same spawn samples; browser receipt P50 ≤ 10000 ms and P95 ≤ 15000 ms in each cohort; worker processor stages and browser ready stage. | blocked |
| C4 First-message integrity | Send a safe synthetic first message; verify exactly one accepted local receipt and exactly one processor consumption/acknowledgement; refresh and exercise the authorized retry case to check neither loss nor duplication. | Functional observation plus component-local consume/ack evidence; retry exercises are separate negative/control rounds and never included among passing latency samples. No model-inference latency limit. | blocked |
| C5 History continuation | With more than one history page, initial layout fetches no older page. One wheel/trackpad gesture at the end fetches one next page; repeated events during the same request do not duplicate it. | Before/after sanitized screenshots and request-count assertions; `sessionHistoryScrollIntent` and `SessionHistoryList` tests. | blocked |
| C6 Message range continuity | Seed a latest range and an older cached range with a middle gap; explicitly paginate until every middle message is reachable, with no duplicated rows or lost latest messages. | Per-case sanitized screenshots, `sessionMessageFrontier` and `sync.messageVisibility` tests. | blocked |
| C7 Picker cancellation | Start image/media/PDF selection, then separately unmount, clear, or reset the draft before resolution. Old results cannot reappear; a newer valid selection survives old completion. | One result per cancellation trigger, sanitized screenshots, generation/picker/ComposeHome tests. | blocked |

Run only Ego for actual webpages. Use an authorized production-like deployment
of the exact branch revision, authenticated test account, online selectable
machine and a known populated session. This document does not authorize a
deployment, publishing, or exposing a private account. Record every meaningful
completed browser round with a sanitized screenshot; functional and latency
verdicts remain separate. In a local-only implementation round, all browser
statuses stay blocked pending their execution.

## Document-start installation and samples

From the repository root, print the self-contained Phase 2 expression:

```sh
pnpm --silent --filter happy-app run perf:session-critical-path \
  --origin <https-origin> --session-id <known-session-id> \
  --mode print-phase-2-ego-probe
```

The compatibility parameters are validated but are not embedded in the Phase 2
probe. Install the expression **before every application script**, using a verified
Ego document-start injection capability. At this time `document.readyState` must
be `loading` and `document.scripts` empty. Missing injection support, fetch/XHR
hooks, or ResourceTiming collection blocks measurement. Never substitute a
post-navigation evaluation, screen polling, console-log replay, or manual timing
marks. Switching between Phase 1 and Phase 2 requires a new document.

For C1, in that same document-start callback, arm the returned probe before any
app script with `probe.configureSample({ kind: 'deep-link', cache: 'cold' })`
(or `warm`). The app's root-module bridge invokes `initFreshDeepLink` once. Do
not invoke it manually after root initialization. For C2–C4, let the Compose page
boot, then call `probe.configureSample({ kind: 'spawn', cache: 'cold' })` (or
`warm`) immediately before the one send click. The actual app trace invokes
`startNewTextSession` synchronously at click and supplies its later fixed events.
Do not call the lifecycle marking methods from Ego: those methods exist for the
application bridge, not to manufacture missing stages.

Both cache classifications use a new document and a newly armed measurement.
Cold means an empty HTTP/static asset cache; warm means those assets were primed
by a separate untimed load of the same build. Keep test authentication intact and
record the verified cache treatment without exporting storage. Same-document
reuse of hydrated session state is not a substitute for a warm fresh-document
sample. If the environment cannot control/verify the cache treatment, record
`blocked`, not a guessed classification. Never discard failed or retrying rounds
to make a cohort pass; report those rounds separately and repeat only after the
cause is understood.

The probe uses only `performance.now()` and navigation `startTime` in its own
browser. C1 is navigation start → latest-message paint after the target route and
all required prerequisites. C2 is actual send click → target route paint. C3 is
actual send click → encrypted nonterminal processor-ready receipt. Server, daemon
and worker clock readings are never subtracted from browser times.

The application adapter passes only a fixed stage name (or no arguments for a
fixed method). It passes no timestamps, trace IDs, session IDs, machine IDs or
message data. Probe absence/failure is swallowed by application instrumentation;
the probe itself latches failures so collection still fails closed. Existing
runtime duplicate suppression prevents repeated ready packets creating extra
milestones; a duplicated milestone delivered to the probe remains invalid.

Mandatory C1 stages:

```text
web.root.module_ready
web.fonts.critical_ready
web.crypto.ready
web.credentials.ready
web.route.mounted
web.session.snapshot_started
web.session.snapshot_completed
web.messages.latest_started
web.messages.latest_completed
web.session.store_committed
web.session.latest_message_painted
```

Mandatory C2–C4 stages:

```text
web.spawn.clicked
web.session.hydrated
web.first_message.queued
web.session.navigated
web.session.route_painted
web.processor.ready_received
web.first_agent_event_received
web.turn.completed
```

The order is causal, not globally serial: fonts/crypto and snapshot/latest work
can overlap. Each operation completes after its start; final store follows both
latest and snapshot completion; latest paint follows all C1 prerequisites.
Hydration precedes queue receipt, then navigation, then route paint. Processor
ready can arrive before route paint; first agent activity follows ready and local
queue acceptance; turn completion follows all spawn milestones. Application
milestones belonging solely to the other sample kind, or emitted outside an armed
interval, cannot satisfy the active sample. Duplicate active milestones or a
backwards browser clock invalidate collection.

The snapshot stage pair measures the live route's snapshot hydration operation.
It occurs exactly once whether the route uses an immediate session/encryption
cache hit, waits for an existing hydration, or performs a targeted fetch. A cache
hit is an instantaneous route operation, not a claimed network transfer. Earlier
active-bootstrap network time is outside this route-specific snapshot span; it
is still inside C1's browser navigation-to-paint duration. Failed or cancelled
operations do not emit a successful completion stage.

The C1 interval freezes on latest-message paint; spawn freezes only at turn
completion, so a late legacy request before completion still fails. Each sample
and its resources freeze independently; later requests, buffer eviction and new
samples cannot alter old evidence. Re-arming an unfinished sample, repeated start,
or explicitly observed `probe.markRetry()` permanently invalidates the document.
Any retry seen by the operator must be reported; absence of a retry callback is
not proof that no retry occurred.

Call `probe.collect()` after completion, and save exactly its returned object.
For multiple documents concatenate only their `resources` arrays and `samples`
arrays, preserving every sample. Do not add fields or derive replacement values:

```json
{
  "resources": [{ "name": "https://redacted.invalid/resource" }],
  "samples": [
    { "kind": "deep-link", "cache": "cold", "retryCount": 0, "deepLinkInteractiveMs": 1800 },
    { "kind": "spawn", "cache": "cold", "retryCount": 0, "spawnRoutePaintMs": 6500, "processorReadyMs": 9000 }
  ]
}
```

This abbreviated example is deliberately insufficient to pass the sample gate.
The actual aggregate needs at least five cold and five warm observations for
each of deep-link and spawn (at least 20 sample objects). Both spawn metrics must
be present in every spawn sample; deep-link samples contain only their own metric.

```sh
pnpm --silent --filter happy-app run perf:session-critical-path \
  --origin <https-origin> --session-id <known-session-id> \
  --mode evaluate-phase-2-json --input <redacted-measurement-json-path>
node --test packages/happy-app/scripts/check-session-critical-path.test.mjs
```

For structurally valid, complete, retry-free evidence, stdout is exactly
`{ ok, sampleCount, deepLink, spawnRoutePaint, processorReady, legacySessionCalls }`.
Every metric reports numeric `min`, `p50`, `p95`, `max` over its pooled observations;
`ok` checks both cold and warm cohorts separately, so a fast warm cohort cannot
hide a slow cold cohort. Percentiles use nearest rank: sort ascending and select
the 1-based index `ceil(p * n)`. Boundary values pass; 1 ms above either cohort's
P50/P95 threshold fails. A latency-only miss still prints these metrics to stdout
and exits 1; `ok: true` exits 0.

Malformed input fails on stderr with only
`{"ok":false,"error":{"code":"FIXED_CODE"}}`, exit 1. CLI codes inherited from
Phase 1 are `INVALID_ARGS`, `INVALID_ORIGIN`, `INVALID_SESSION`, `INVALID_MODE`,
`MISSING_INPUT`, `UNREADABLE_INPUT`, `INVALID_JSON`, `INVALID_EVIDENCE`. Phase 2 adds
`INSUFFICIENT_SAMPLES`, `RETRY_DETECTED`, `LEGACY_SESSION_REQUEST`. Document probe
codes are `INVALID_PROBE_MODE`, `INVALID_SAMPLE`, `INVALID_APP_STAGE`,
`MISSING_APP_STAGE`, `DUPLICATE_APP_STAGE`, `OUT_OF_ORDER_APP_STAGE`,
`RETRY_DETECTED`, `RESOURCE_COLLECTION_FAILED`. Save only the fixed code, never a
thrown error object, message, stack or serialized unknown input.

## Attribution and privacy procedure

1. Browser artifacts may contain only allowed numeric durations, `retryCount`,
   `kind`/`cache`, and the two fixed redacted resource names above or
   `https://redacted.invalid/v1/sessions`. All nonlegacy paths collapse to
   `/resource`. Exact `/v1/sessions` detection happens before redaction; query
   strings/fragments cannot bypass it and subpaths do not count as that endpoint.
   Fetch/XHR initiation capture includes failures and requests still in flight at
   freeze, without reading bodies or request headers. No collector reads browser
   storage, credentials, tokens, content, commands or attachment URIs.
2. Keep component attribution in a separate sanitized worksheet, never appended
   to evaluator JSON. Whitelist fixed stage names and finite nonnegative
   `duration`/`spanDuration` only. Verify Server RPC received→daemon found, daemon
   request received→child started→webhook received, and worker entry→auth→machine
   →session created→socket ready→processor starting→processor ready against the
   actual producer semantics. Use each producer's own local spans; worker
   `duration` is elapsed from that worker's origin. Verify real consume/ack
   boundaries for C4. If a required component does not produce usable evidence,
   attribution remains blocked even when the browser evaluator returns `ok`.
3. Correlate the single controlled operation in the authorized runtime without
   exporting identifiers. Never save raw logs, full URLs, response bodies, raw
   errors, account/session/device/machine/trace IDs, paths, private prompts,
   commands, tokens, or attachment URIs. Do not paste unfiltered console output
   into the worksheet. Review redaction before saving artifacts or screenshots;
   cover address bars, titles, content, sidebar identities and filesystem labels.
4. Preserve provenance in the case ledger: exact tested commit, cache treatment,
   counts, each fixed failure code, and links to sanitized artifacts. Separate
   ledger metadata from browser evidence JSON. Obtain at least five **fresh**
   observations per cohort; copying a frozen sample does not create an observation.
5. Mark attribution `pass` only when stage completeness/order, component-local
   spans, provenance, zero retries, zero legacy requests and privacy all pass.
   Record latency `pass` or `fail` separately from the evaluator. A printed
   latency report with `ok: false` can accompany PR C attribution pass; a fixed
   validation error cannot. C4–C7 remain independent functional gates.

The full automated PR C verification is:

```sh
pnpm --filter happy-app exec vitest run --maxWorkers=2 sources/sync/sessionStartupTrace.test.ts sources/sync/sessionStartupTraceRuntime.test.ts sources/sync/sessionCriticalPathProbeBridge.test.ts sources/components/appRoot/appRootFonts.test.ts sources/components/appRoot/AuthenticatedRootLayout.test.tsx sources/sync/sessionRouteOwnership.test.ts sources/sync/sessionMessageFrontier.test.ts sources/sync/sync.messageVisibility.test.ts sources/sync/sessionBootstrap.test.ts sources/sync/sync.sessionWriters.test.ts sources/-session/SessionView.hydration.test.tsx sources/-session/SessionView.agentSpace.test.tsx sources/hooks/attachmentSelectionGeneration.test.ts sources/hooks/useImagePicker.test.ts sources/components/ComposeHome.test.tsx sources/components/sessionHistoryScrollIntent.test.ts sources/components/SessionHistoryList.test.tsx sources/hooks/useSpawnSession.test.tsx
pnpm --filter happy-app run typecheck
pnpm --filter happy-server-self-host exec vitest run sources/app/api/socket/rpcHandler.spec.ts
pnpm --filter happy-server-self-host run typecheck
pnpm --dir packages/happy-cli exec vitest run --project unit src/daemon/run.sessionStartupTrace.test.ts src/api/apiSession.test.ts src/claude/runClaude.test.ts src/codex/runCodex.startupTrace.test.ts src/agent/acp/runAcp.test.ts src/ui/auth.startupTrace.test.ts src/api/api.test.ts src/commands/codexCommand.test.ts
pnpm --dir packages/happy-cli run build
node --test packages/happy-app/scripts/check-session-critical-path.test.mjs
git diff --check
```

Run the CLI test command and build sequentially: its test setup can build and
shares the atomic build lock. Automated success does not replace Ego C1–C7.
