# Session Critical Path Phase 2 Design

**Status:** approved in chat on 2026-09-05; implementation has not started  
**Base:** `3906949b26293701d16d2c159eb6faaac081a1a2`  
**Delivery shape:** two pull requests, with the second gated by measurements from the first

## 1. Problem statement

Phase 1 removed the browser's legacy full-session refresh from deep-link and new-session startup, separated initial socket connection from genuine reconnect recovery, added targeted session hydration, and made the first local queue receipt explicit. The functional paths now complete, but the production acceptance still misses both latency targets:

- a fresh deep link was interactive in 6546.9 ms against a 2000 ms limit;
- a new text session invoked navigation in 27448.9 ms against a 7000 ms limit.

Those two totals are insufficient for Phase 2. The deep-link number does not distinguish route boot, network body transfer, decryption, store commit, and paint. The new-session number stops at a navigation call and does not prove that the real Claude, Codex, or ACP processor can consume the first message. Phase 2 must establish attribution before selecting a large optimization.

Four correctness gaps from Phase 1 also contaminate performance evidence and remain user-visible:

1. PC Web wheel and trackpad scrolling cannot authorize the next history page.
2. A deep link owns a message-loading lease before it owns a route-opening identity, so a realtime message can release the cache being opened.
3. Merging cached messages `1..100` with the latest page `151..250` can make `101..150` unreachable.
4. A late media or PDF picker can repopulate a cleared or unmounted compose draft.

## 2. Goals and non-goals

### Goals

- Measure navigation and real processor readiness as separate user-facing service-level indicators.
- Produce fixed, redacted stage evidence across Web, Server, daemon, worker, and processor boundaries.
- Remove retry, cache-release, pagination, and picker races before using timings to choose deeper work.
- Make the smallest evidence-supported changes capable of meeting the agreed latency gates.
- Preserve end-to-end encryption, deletion generations, route ownership, outbox atomicity, reconnect recovery, and draft survival from Phase 1.

### Non-goals

- Do not change model inference time or treat first-token latency as equivalent to processor readiness.
- Do not create a new full-account bootstrap endpoint or restore browser calls to `GET /v1/sessions`.
- Do not persist prompts, message bodies, credentials, paths, commands, tokens, attachment URIs, or private identifiers in performance evidence.
- Do not introduce a Worker, a new cache tier, or daemon-side session preallocation before measurements prove that smaller changes cannot meet the gates.
- Do not combine both delivery waves into one unreviewable pull request.

## 3. User-observable cases and acceptance gates

| Case | User-observable result | Gate |
| --- | --- | --- |
| C1 Fresh deep link | Header and latest complete message are painted without a full-account session request or loading retry | P50 <= 2000 ms; P95 <= 4000 ms |
| C2 New-session navigation | A click creates one session, confirms one local outbox receipt, and paints the target route | P50 <= 7000 ms; P95 <= 10000 ms |
| C3 Real processor ready | The processor has registered the real message-consumption path and the initiating Web client receives its encrypted `ready` event | P50 <= 10000 ms; P95 <= 15000 ms |
| C4 First-message integrity | The real processor consumes exactly the first accepted message once; refresh/retry does not duplicate or lose it | Functional pass; duration recorded but not gated on model inference |
| C5 History continuation | A PC Web wheel/trackpad gesture at the end loads exactly one next page; initial layout does not drain history | Functional pass |
| C6 Message range continuity | Cached and latest ranges remain mergeable, and explicit pagination can reach every missing middle range | Functional pass |
| C7 Picker cancellation | Unmount, clear, or draft reset invalidates an older image/media/PDF selection without discarding a newer valid selection | Functional pass |

Latency acceptance uses at least five fresh observations per relevant cold/warm combination and reports minimum, median, P95, maximum, retry count, and sample count. A passing median cannot hide a retry-heavy tail. The existing exact-path ban on browser `GET /v1/sessions` remains mandatory.

## 4. Measurement model

### 4.1 Two clocks, not one fabricated global clock

Each runtime measures its own spans with a local monotonic clock. Wall-clock timestamps may be logged for correlation, but durations from different machines are never subtracted. Browser end-to-end metrics use the initiating browser's monotonic clock and an event that returns to that same browser.

This yields two classes of evidence:

- **End-to-end Web metrics:** click/navigation start to browser-observed paint, navigation, processor-ready event, first agent event, and turn completion.
- **Component-local spans:** Server lookup/RPC, daemon child spawn/webhook, worker authentication/machine/session setup, socket readiness, processor initialization, message consumption, and message acknowledgement.

### 4.2 Fixed stage vocabulary

Existing stages remain compatible. Phase 2 adds only fixed names needed to attribute the path:

```text
web.deep_link.navigation_started
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

web.spawn.clicked
server.rpc.received
server.rpc.daemon_found
daemon.spawn.request_received
daemon.spawn.child_started
worker.entry.started
worker.auth.ready
worker.machine.ready
worker.session.created
daemon.spawn.webhook_received
worker.socket.ready
worker.processor.starting
worker.processor.ready
web.session.hydrated
web.first_message.queued
web.session.navigated
web.session.route_painted
web.processor.ready_received
web.first_agent_event_received
web.turn.completed
```

Every event uses an allowlisted schema:

```ts
type StartupTraceEvent = {
  traceId: string;
  stage: StartupTraceStage;
  duration?: number;
  spanDuration?: number;
  outcome?: 'success' | 'error';
  errorCode?: StartupTraceErrorCode;
};
```

`duration` retains the current meaning of elapsed time from that component's local trace origin. `spanDuration` is the duration of one named operation in the same runtime. Production logs may attach already-approved machine or session correlation fields, but browser acceptance output contains only stage durations, sample classification, retry count, and redacted resource paths. Logging is best effort and cannot delay startup.

### 4.3 Processor-ready definition

The daemon webhook is not processor readiness. Claude, Codex, and ACP report the webhook before their actual processor setup.

`processor ready` means:

1. the real backend/client has started;
2. the session message handler that consumes the first queued user message is registered;
3. the worker emits the existing encrypted session event `{ type: 'ready' }`;
4. the initiating Web client receives that event for the created session.

The browser keeps an in-memory `sessionId -> trace context` only after the spawn RPC returns. Realtime handling marks `web.processor.ready_received` on the matching encrypted `ready` event and then clears the entry after the trace finishes or times out. No trace context is persisted to storage.

Agent-specific readiness adapters must map to the same semantic boundary. Tests must prove that an artificial delay before message-handler registration delays processor-ready, while an artificial model-response delay does not.

## 5. PR C: attribution and correctness foundation

PR C owns the measurement contract and the four known correctness gaps. It may include a low-risk optimization only when the new test or local span proves its root cause.

### 5.1 Route-opening ownership

Add a route-opening owner separate from `currentViewingSessionId`:

```ts
type SessionRouteOwner = {
  sessionId: string;
  ownerEpoch: number;
  phase: 'opening' | 'interactive';
};
```

`SessionViewContent` acquires the owner before `sync.openSession()` and releases it with compare-by-identity cleanup. `SessionViewLoaded` promotes that same owner to interactive and only then applies viewing/read semantics. An old A mount cannot release a newer B owner or a newer same-ID owner.

Realtime message handling treats either opening or interactive ownership as foreground retention. When a realtime gap invalidates an in-flight latest-page operation, `openSession()` must not report ready until one of these is true:

- its own latest page commits; or
- the superseding foreground catch-up commits a page that satisfies the latest target.

The boolean result of latest-page application cannot be ignored. A superseded operation must await the winning operation or restart once under the still-current route owner. Deletion and explicit route abandonment remain terminal.

This design protects loading without marking unread messages read before content is actually visible.

### 5.2 Message range frontier

Replace the overloaded `oldestLoadedMessageSeq` interpretation with explicit contiguous frontier state. The cache may retain arbitrary deduplicated messages, but pagination follows the latest contiguous page backward:

```ts
type MessageRangeFrontier = {
  latestSeq: number | null;
  olderBeforeSeq: number | null;
  hasMoreOlder: boolean;
};
```

After a latest page `151..250`, `olderBeforeSeq` is `151` even if cache `1..100` exists. An older request uses `before_seq=151`, merges `51..150`, deduplicates by message identity, and advances the frontier to `51`. When the fetched range overlaps existing `1..100`, the merge may close the gap and advance to the cache's continuous lower boundary. It must never jump across an unobserved interval merely because a smaller cached sequence exists.

Out-of-order, superseded, evicted, or deleted operations retain the Phase 1 ownership rules.

### 5.3 Attachment picker generation

Introduce an attachment-selection generation independent of text revision. Each picker captures:

- hook instance identity;
- target compose-draft identity;
- attachment generation at start.

Unmount, `clearImages`, external draft reset, or accepted-submit cleanup increments the generation. A result may append only when all captured identities remain current. Starting a second picker does not invalidate the first by itself; both may append within the attachment limit if neither crosses an invalidating boundary.

The rule applies at every await boundary: permission, system picker, image normalization, thumbhash generation, PDF stat, and final state update. Media and PDF paths receive the same guard already partially present for images.

### 5.4 PC Web history intent

Keep the existing protection against automatic `onEndReached` drains. Represent a user pagination intent as a consumable epoch:

- native touch drag creates an intent through `onScrollBeginDrag`;
- Web wheel/trackpad or a real scroll delta creates an intent through the React Native Web event surface;
- `onEndReached` consumes at most one current intent;
- repeated layout/end callbacks without a new user gesture do nothing.

Component tests verify behavior, not handler presence. Ego verifies that a real wheel gesture loads new rows.

## 6. PR D: evidence-selected latency changes

PR D begins only after PR C can produce a complete attribution table from a production-like run. It applies candidates in ascending architectural risk and keeps a candidate only when its covering span and end-to-end metric improve.

### 6.1 Deep-link candidates

1. **Boot concurrency:** load critical fonts, sodium, and credentials concurrently where dependency rules allow it.
2. **Critical font split:** block PC Web only on fonts required by the first session skeleton; load decorative, monospace, and unused icon families in the background with fallback rendering.
3. **Route priority:** once credentials and crypto are ready, start target snapshot/latest-message hydration before non-target account work.
4. **Background scheduling:** defer session-history pagination and non-target active-session decrypt/store commits until the latest target message is painted.
5. **Payload/query/render work:** optimize only the measured dominant stage. Possible actions include a first-turn-complete byte-bounded response or reduced store commit churn; neither is permitted without evidence and reducer-completeness tests.

### 6.2 New-session candidates

1. Pass `startedBy: 'daemon'` through every daemon-spawned agent entry so workers skip redundant daemon discovery.
2. Make existing valid machine/auth state a read-only fast path; acquire the settings write lock only for initialization or an actual change.
3. Move nonessential machine metadata refresh outside the serial session-registration path when identity already exists.
4. Delay static-import or agent-discovery restructuring until profiling shows module loading is material.
5. Consider daemon-side session preallocation only if worker startup remains the dominant gate after steps 1-3.

### 6.3 Conditional daemon preallocation

If required, the daemon allocates the encrypted server session before spawning the worker and returns the session identity to Web. The worker adopts that identity instead of creating another session. This protocol requires:

- a client-generated idempotency key;
- repeated RPC calls returning the same allocation;
- authenticated worker adoption;
- an explicit `starting | ready | failed` lifecycle;
- first-message queuing before worker adoption;
- late success after caller timeout;
- retry without duplicate session or duplicate first message;
- cleanup for permanently unadopted allocations.

This is not part of PR C and is not automatically part of PR D. Crossing this boundary requires a measurement-backed design amendment because it changes interfaces shared by App, Server, daemon, and worker.

## 7. Error handling and privacy

- Observability failure returns a fixed code and cannot block session startup.
- Performance acceptance fails closed when mandatory stages are missing, duplicated, out of order, or collected after document start.
- A processor timeout changes the trace to error but does not delete the created session or accepted local outbox message.
- Route retries are bounded and counted. Passing evidence with an unreported retry is invalid.
- Trace schemas reject unknown fields and malformed IDs. Logs use fixed error codes, not raw exceptions.
- No checked-in artifact contains a real origin, session ID, machine ID, directory, command, prompt, message, token, cookie, encryption material, or screenshot of private content.

## 8. Test strategy

All behavior changes use strict RED -> GREEN. A RED must fail on the production boundary for the expected reason before implementation.

### Unit and integration tests

- `SessionView.hydration.test.tsx`: opening ownership, A-to-B switch, same-ID remount, retry winner, unmount, delete.
- `sync.messageVisibility.test.ts` and `sessionBootstrap.test.ts`: realtime-before-latest, latest-before-realtime-catch-up, superseded foreground operation, no false ready.
- `sync.sessionWriters.test.ts`: contiguous frontier across disjoint, adjacent, overlapping, out-of-order, deleted, and evicted ranges.
- `SessionHistoryList.test.tsx`: Web wheel without drag, native drag, one intent per page, no initial auto-drain.
- `useImagePicker.test.ts` plus a real compose-draft integration: image/media/PDF late return after unmount, clear, external reset, PDF stat wait, valid concurrent selection.
- Web trace tests: stage allowlist, in-memory trace cleanup, route paint, ready event, first event, missing-stage fail closed.
- Server/daemon/worker tests: component-local spans, fixed redaction, `startedBy` propagation, processor-ready semantic adapters.
- Delay-injection tests: hydration delay affects navigation; model-response delay does not affect processor-ready; handler-registration delay does.

### Real Ego acceptance

The global browser policy applies: all browser work uses Ego Browser. Each meaningful completed round is captured and reported before the next round, and the final task space is closed.

Run these independent paths without publishing private evidence:

1. fresh deep link with cold and warm resources;
2. new text session to navigation paint;
3. the same session to real encrypted processor-ready event;
4. first-message consumed exactly once through first agent event and turn completion;
5. PC Web history wheel to one additional page;
6. refresh/reconnect retention after startup.

Evidence contains only sanitized metrics and resource paths. Private screenshots or video may be reviewed locally but are not attached to a public PR.

## 9. Delivery gates

### PR C

- All seven Cases have fresh automated evidence or an explicit reason for Ego deferral.
- App, Server, and CLI affected suites pass; typechecks and CLI build pass.
- Independent task reviews and whole-branch review are clean.
- Production-like Ego establishes an attribution table even if latency thresholds still fail.
- PR states that measurement/correctness does not claim final latency success.

### PR D

- Every retained optimization names the dominant span it reduces and carries a regression test.
- C1-C4 pass the agreed double metrics and integrity gates.
- C5-C7 remain green.
- PR Before/After evidence uses matching cases and sanitized measurements.
- Merge, Web production verification, and Android OTA are separate authorization gates unless the user explicitly requests them.

## 10. Implementation order

1. Extend measurement vocabulary and browser-side double-metric lifecycle.
2. Fix route-opening ownership and foreground latest-page coordination.
3. Fix contiguous message-range frontier.
4. Fix picker generations.
5. Fix Web history intent.
6. Run production-like attribution and select PR D candidates.
7. Implement measured low-risk Web/CLI improvements.
8. Re-measure; amend the design before daemon preallocation if still required.

Tasks 2 and 3 both touch the sync hot path and must be sequential. Tasks 4 and 5 are independent but are still implemented one at a time under the Subagent-Driven Development review loop to avoid worktree conflicts.
