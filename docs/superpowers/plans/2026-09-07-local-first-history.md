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

- [ ] Add focused failing tests: unchanged cursor yields no body payload; offline deletion is replayable; accounts are isolated; duplicates and pagination do not skip committed changes; missing sessions in ordinary pages are not deletion evidence.
- [ ] Implement the smallest durable protocol compatible with existing old clients; a transactionally updated revision index plus explicit deleted records is acceptable if it has safe cursor semantics.
- [ ] Run focused server tests and Prisma generation/typecheck. Document migration ordering and endpoint wire contract.
- [ ] Commit scoped files; independent review of correctness/spec and test evidence.

## Task 2: Persistent local history and incremental synchronization

**Files:** new Web/native local-history modules under sources/sync; sync.ts integration; reset/logout lifecycle; session protocol client; focused IndexedDB and sync tests.

**Interfaces:** asynchronous account-scoped snapshot/page read/write/delete; persisted coverage and change cursor; current-session-first hydration; use Task 1's actual protocol, retaining compatibility for old server capability absence.

- [ ] Add failing tests for store reopen and cached historical reads with zero network bodies; transactional coverage/cursor; account isolation; deletion during pending writes; quota/corruption fallback; over-150 sessions preservation.
- [ ] Implement per-record IndexedDB storage and a native fallback without new native dependencies. Import legacy warm data without truncating the new archive.
- [ ] Restore requested session/window from disk before network, load older known pages locally, persist fetched/socket records, and preserve confirmed coverage. Revalidation occurs in background; unchanged version suppresses body request. Use explicit server deletion events/reconciliation only.
- [ ] Verify focused persistence/sync regression suites and app typecheck; commit and review.

## Task 3: Attachment persistence and reading continuity

**Files:** attachment download Web persistence integration; ChatList/ConversationTranscript reading state and paging controls; tests for attachment request counts and pagination/restoration.

**Interfaces:** stable bytes key `(server, account, session, ref)` independent of image preview variant or signed URL; bounded memory and persistent byte budget; async persistent reading state `(anchorId, offset, collapsedGroups)` scoped by account/session.

- [ ] Add failing tests for cached download after module restart, preview/original sharing encrypted bytes, deletion/reset preventing repopulation; boundary-only delayed Loading, restore anchor and expanded groups, pagination error/retry and bounded prefetch.
- [ ] Implement persistent encrypted attachment bytes at the shared download boundary; no signature/OSS request on hit; enforce quota and in-flight coalescing. Do not claim large streaming media is fully offline without storing ranges.
- [ ] Persist/restore reading state and pin visible anchor while prepending; separate background prefetch from visible waiting, delayed stable-height indicator only when missing boundary is reached. Keep request budgets and retry affordance.
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
