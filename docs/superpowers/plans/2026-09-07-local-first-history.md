# Local-first conversation history implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review each task. The approved design below is the specification; execute continuously.

**Goal:** Previously read conversations survive refresh locally; synchronize additions/deletions without repeated old-body or OSS downloads, and show Loading only for unavailable requested content.

**Architecture:** IndexedDB stores encrypted wire messages, confirmed page coverage, snapshots and reading state on Web. Small in-memory windows serve rendering. A durable server change protocol reconciles additions/deletions on reconnect; socket events handle live changes. Attachments use stable account/session/ref keys for persistent byte reuse.

**Tech Stack:** Existing TypeScript, Expo/React Native Web, Zustand, Fastify, Prisma/Postgres, native IndexedDB API.

**Spec:** This document records the user's approved design and independent review from 2026-09-07.

## Global Constraints

- Root happy workspace stays clean main. All edits are in sibling happy--local-first-history.
- History is append/delete; no general body-edit protocol. New tool events can update the rendered projection.
- No blanket cache-size increase or all-history/all-attachment background download.
- Store wire ciphertext for private messages and encrypted attachments; isolate by server origin/account/session. Deletion/logout/local reset fence pending writes.
- A missing entry in a paginated list is never a deletion. Sparse message sequences are legitimate; persist confirmed coverage, not inferred numerical continuity.
- Healthy unchanged connection: zero history polling and zero attachment downloads. Refresh/reconnect may perform lightweight metadata/change reconciliation. Never advance a durable cursor before associated local writes complete.
- Cached content stays usable during background sync and network failure. First uncached content and genuinely missing history boundaries show Loading/error/retry without moving current content.
- Stable attachment ref identifies bytes; signed URLs do not. No background original/audio/video prefetch. Web persistent failures degrade safely to current network behavior.
- Browser automation, if used, is Ego only; screenshot collection requires user choice per CLAUDE.md. Automated unit/integration checks proceed independently.
- Implement full approved scope and record actual verification and remaining runtime limits honestly. No claim of measured speed/OSS savings without measurement.

## Task 1: Reliable server change reconciliation

**Files:** server Prisma schema/migration; session creation/message writing/deletion paths; new authenticated session-change route and registration; focused route/storage tests.

**Interfaces:** An authenticated `/v3/sessions/changes` cursor API reports changed session IDs (including latest message sequence or snapshot version) and explicit deletions, with a stable resume cursor. Initial/reset reconciliation supplies authoritative lightweight existing-session identities, not message bodies. Document exact response and overflow behavior for Task 2. Database writes and change record must commit atomically. Cover every supported writer (REST/socket), including pre-existing sessions at deployment.

- [x] Add focused failing tests: unchanged cursor yields no body payload; offline deletion is replayable; accounts are isolated; duplicates and pagination do not skip committed changes; missing sessions in ordinary pages are not deletion evidence.
- [x] Implement the smallest durable protocol compatible with existing old clients; a transactionally updated revision index plus explicit deleted records is acceptable if it has safe cursor semantics.
- [x] Run focused server tests and Prisma generation/typecheck. Document migration ordering and endpoint wire contract.
- [x] Commit scoped files; independent review of correctness/spec and test evidence.

## Task 2: Persistent local history and incremental synchronization

**Files:** new Web/native local-history modules under sources/sync; sync.ts integration; reset/logout lifecycle; session protocol client; focused IndexedDB and sync tests.

**Interfaces:** asynchronous account-scoped snapshot/page read/write/delete; persisted coverage and change cursor; current-session-first hydration; use Task 1's actual protocol, retaining compatibility for old server capability absence.

Web reading windows must support both directions: `readWindow({anchorSeq?,limit})`, `loadNewerMessages`, `jumpToLatestMessages`, and `isAtLatest`. Track the known server latest separately from visible window bounds; do not flatten disconnected cached islands. Task 3 consumes these APIs and gates latest-only actions. Native fallback may preserve existing window behavior without new native dependencies.

- [x] Add failing tests for store reopen and cached historical reads with zero network bodies; transactional coverage/cursor; account isolation; deletion during pending writes; quota/corruption fallback; over-150 sessions preservation.
- [x] Implement per-record IndexedDB storage and a native fallback without new native dependencies. Import legacy warm data without truncating the new archive.
- [x] Restore requested session/window from disk before network, load older known pages locally, persist fetched/socket records, and preserve confirmed coverage. Revalidation occurs in background; unchanged version suppresses body request. Use explicit server deletion events/reconciliation only.
- [x] Verify focused persistence/sync regression suites and app typecheck; commit and review.

## Task 3: Attachment persistence and reading continuity

**Files:** attachment download Web persistence integration; ChatList/ConversationTranscript reading state and paging controls; tests for attachment request counts and pagination/restoration.

**Interfaces:** stable bytes key `(server, account, session, ref)` independent of image preview variant or signed URL; bounded memory and persistent byte budget; async persistent reading state `{version: 1, anchorId, anchorSeq, offset, expandedGroupIds}` scoped by account/session. `anchorId` is the underlying stable wire message identity, resolved to its current rendered message/group; `anchorSeq` supports stable wire lookup. Expansion identities must also survive reducer reprojection and changing boundary-group membership.

Use Task 2's newer-page and jump-latest APIs when restoring a historical Web window. The visual bottom loads newer history; scroll-to-bottom fetches/selects latest when needed. Gate ChatFooter/current-turn grouping/latest-edit affordances and automatic follow-tail behavior by actual `isAtLatest`.

- [x] Add failing tests for cached download after module restart, preview/original sharing encrypted bytes, deletion/reset preventing repopulation; boundary-only delayed Loading, restore anchor and expanded groups, pagination error/retry and bounded prefetch.
- [x] Implement persistent encrypted attachment bytes at the shared download boundary; no signature/OSS request on hit; enforce quota and in-flight coalescing. Do not claim large streaming media is fully offline without storing ranges.
- [x] Persist/restore reading state and pin visible anchor while prepending; separate background prefetch from visible waiting, delayed stable-height indicator only when missing boundary is reached. Keep request budgets and retry affordance.
- [ ] Run focused component/attachment tests, required runtime contract test and typecheck/build; commit and review.

## Task 4: Delivery and Obsidian

**Files:** `wiki/projects/happy/如何让会话刷新后仍像本地应用一样可读.md`, project index and one related backlink in default Obsidian vault; worktree CLAUDE.md index; implementation evidence in this document.

- [ ] Record approved alternatives, invariants, review findings, actual implementation and source references. Mark unmeasured targets as targets.
- [ ] Whole-branch independent review; fix material findings, run proportional integration checks.
- [ ] Commit/push PR under repository policy, verify applicable CI/preview and any authorized merge/release. Coordinate server migration before relying on new endpoint; keep compatible fallback.
- [ ] Verify Obsidian frontmatter/links/index, trigger configured synchronization and report exact completed artifacts and runtime limitations.

## Acceptance cases

1. Same cached history opened/reloaded ten times: no old body re-download; persisted attachment hit has no signature or OSS GET.
2. No changes while connected: no periodic message polling. Reconnect check is small and does not contain old bodies.
3. Read, switch, refresh: restore reading window/anchor and expansion state without clearing visible cached content.
4. More than 150 sessions, sparse historical ranges: no implicit deletion or skipped gaps.
5. Offline append/delete, duplicate or delayed event and interruption during local commit: converge without resurrection or lost records.
6. Missing content/slow network/quota failure: visible Loading/retry only where content unavailable; no unhandled rejection or lost existing content.

## Implementation evidence and release boundary

- Server protocol: independent review approved; full server suite **53 files / 559 tests passed**, plus Prisma generation, typecheck, runtime bundle and bundle syntax check. Migration-backed tests use PGlite, not independent live PostgreSQL connections.
- Client archive: independent fix review approved. Covers durable unseen-session snapshot work, quota failure retaining newly received memory messages, and delayed account/reset/logout/delete responses.
- Attachments and reading state: independent fix review approved at `9086cbb4`. **22 files / 235 distinct tests** and final typecheck passed. Controller reran the previously failing standard command: **4 files / 91 tests passed**. Review fixes retain concrete source-block identity inside a wire message and bounded group aliases across trimming/manual collapse. Historical send, ACK and explicit latest navigation are tested together.
- Two harness races were reproduced and corrected without relaxing behavior assertions: timed-out real-module initialization contaminating the next fixture, and request-count polling missing a zero-delay retry. The final standard command uses no global test-timeout override.
- Main `9e47ee61` was integrated without conflicts as `bfd7693f`; exact integrated app checks and Web export are in progress. An earlier interrupted export is **not** build evidence. Whole-branch review, PR/CI and release are pending.
- Web stores encrypted history in IndexedDB and retains bounded rendering windows. Attachment ciphertext is capped at **128 MiB / 1,000 entries per account**; decoded-memory limits were not enlarged. No blanket attachment prefetch or offline streaming promise. Native retains existing MMKV/network persistence behavior.
- Screenshot choice remains asked/unanswered. No new browser/screenshot/device run was performed; unit measurement tests are not pixel-accurate interaction evidence. No production latency or OSS billing reduction has been measured.
- Production backend migration/restart approval is pending. Main Web/OTA workflows do not deploy the backend. Keep old-server fallback until the documented additive migration and old-writer drain are completed; the read-only live probe returned endpoint 404. No production database or process mutation was performed.
- Test-only `fake-indexeddb` changes the lockfile and matches the conservative native-sensitive OTA gate. Do not bypass the gate or claim an OTA release from a skipped workflow.
- Obsidian decisions and evidence: `wiki/projects/happy/如何让会话刷新后仍像本地应用一样可读.md` (OBA-d9e14af9), default vault. Final delivery will update published references and actual deployment status.
