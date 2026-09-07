# Session C1–C3 Remaining Performance Plan

> **Execution:** Use `superpowers:subagent-driven-development`, strict RED → GREEN, and a sibling worktree.

**Goal:** Remove the production cold deep-link request flood and reduce the Codex daemon spawn critical path without changing encryption, route ownership, message integrity, or processor-ready semantics.

**Evidence:** Production Ego showed a cold deep link taking about 54 seconds while `/v1/machines`, `/v3/sessions/changes`, the target snapshot, and the target message page competed on the same constrained origin. A clean local-history run expanded changes into 174 point snapshot lookups. In contrast, a warm h2 `/health` request completed in about 81 ms with a 27 ms maximum event-loop heartbeat gap, so a permanent Chromium main-thread or proxy delay is not the supported root cause. Daemon traces show child spawn in 95 ms but `worker.entry.started → auth start` taking 2.6–4.9 seconds; existing credential I/O itself takes under 100 ms because `codexCommand` waits for the full `runCodex` dependency graph before authentication.

**Spec:** `docs/superpowers/specs/2026-09-05-session-critical-path-phase-2-design.md`

## Global Constraints

- Keep the root checkout clean and make all changes in `/Users/jacky/jacky-github/happy--session-c1-c3-remaining`.
- Preserve end-to-end encryption, deletion fences, local-history account scoping, route ownership, outbox atomicity, and exactly-once first-message behavior.
- Do not restore `GET /v1/sessions`, add daemon preallocation, move `worker.processor.ready`, or persist private trace data.
- Changes are invalidation signals, not permission to rebuild the complete historical session catalog with point GETs.
- The initial active-session page and initial target message page must be bounded independently from explicit user pagination. Older history remains reachable through the existing frontier/pagination path.
- Normal terminal `paws codex`, daemon-started Codex, and the `usage` command retain their current behavior.

## Task 1: Bound cold Web bootstrap and stop changes-to-point-GET amplification

**Files:**

- Modify `packages/happy-app/sources/sync/localHistoryStore.ts`
- Modify `packages/happy-app/sources/sync/sessionHistoryReconciliation.ts`
- Modify `packages/happy-app/sources/sync/sync.ts`
- Test `packages/happy-app/sources/sync/localHistory.test.ts`
- Test `packages/happy-app/sources/sync/sessionHistoryReconciliation.test.ts`
- Test `packages/happy-app/sources/sync/sessionBootstrap.test.ts`
- Test `packages/happy-app/sources/sync/sync.messageVisibility.test.ts`

- [ ] Write RED tests proving that hundreds of unseen non-deleted change identities advance the durable cursor but create zero snapshot point GETs and zero placeholder history records; known stale local snapshots still refresh; tombstones still delete known local state.
- [ ] Write a RED bootstrap test proving the initial active request is limited to 25 summaries and explicit post-interactive pagination remains at 50.
- [ ] Write a RED target-history test proving the initial latest request is limited to 25 wire messages while subsequent explicit older/newer pagination remains at 100 and every older range stays reachable.
- [ ] Verify each new test fails for the expected old `150`, `100`, or unseen-record amplification behavior.
- [ ] Implement the smallest change: do not materialize unseen reconciliation records; refresh only known snapshots whose stored change version is newer; use named initial active/message limits of 25 while leaving explicit pagination at 100.
- [ ] Run the focused Web suites and typecheck.
- [ ] Commit as `perf(web): bound cold session bootstrap traffic`.

## Task 2: Start authentication before heavy Codex runtime dependencies finish loading

**Files:**

- Modify `packages/happy-cli/src/commands/codexCommand.ts`
- Test `packages/happy-cli/src/commands/codexCommand.test.ts`

- [ ] Write a RED orchestration test with separate deferred auth and runtime loaders. While the runtime loader is unresolved, daemon-started Codex must already call authentication and emit `worker.auth.ready`; `ensureDaemonRunning` and `runCodex` must still wait for runtime dependencies.
- [ ] Verify RED fails because the current combined `Promise.all` loader gates authentication on `runCodex`.
- [ ] Split the loader into the authentication dependency and runtime dependencies. Parse arguments first, begin both imports concurrently, await authentication immediately, then await runtime dependencies before prompt/daemon/processor work. Keep `usage` free to load only its usage dependency and preserve help/install-prompt semantics.
- [ ] Run focused CLI startup/readiness/atomic-build suites and build.
- [ ] Compare the same-machine built artifact module timing; record the sanitized entry-to-auth improvement without exposing paths or credentials.
- [ ] Commit as `perf(cli): overlap authentication with Codex runtime loading`.

## Task 3: Cross-package review, production delivery, and Ego regression

- [ ] Run all affected Web suites plus `happy-app` typecheck.
- [ ] Run all affected CLI suites plus the atomic CLI build.
- [ ] Obtain task-scoped reviews after Tasks 1 and 2, then a whole-branch review; fix all Critical/Important findings with reviewed fix rounds.
- [ ] Push, create a PR to `main`, wait for required CI, and squash merge under the user's existing authorization.
- [ ] Verify the Web production workflow publishes the merge SHA to `https://47.115.228.20:8443`; report OTA as triggered, skipped, or not triggered based on the actual path filter result.
- [ ] Build the merged CLI locally and switch only the local dev-link artifact used for new daemon sessions; do not restart the daemon unless required, and never kill existing workers.
- [ ] In Ego task space 105, re-run a populated fresh deep link and one real new Codex session. Report every meaningful verified browser round with a screenshot. Validate lower request count/bytes, faster route paint, one first message, and a real encrypted processor-ready event.
- [ ] Complete Ego task space 105 after the final verified browser state.

