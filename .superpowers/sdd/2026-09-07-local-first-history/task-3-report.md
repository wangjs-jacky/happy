# Task 3 — attachment persistence and reading continuity

Review BASE: `62c3e009bb9a4cf3f62bd0592acaec7451f8fe2a` (includes upstream
`b7e06c40` / #473). Implemented only in `happy--local-first-history`; root main,
active production runtime, upstream plan edits and deployment state untouched.

## Implementation

- IndexedDB schema 2 adds separate ciphertext and LRU metadata stores without
  recreating v1 message/account/session stores. Keys are server-origin/account /
  session / stable attachment ref; signed URLs, tokens and preview dimensions
  are not persistent identities. Byte eviction is bounded to 128 MiB and 1,000
  entries per account scope. Oversize files remain network-only. Eviction reads
  metadata, never all cached byte payloads.
- Shared encrypted downloader reads disk before request-download/OSS, coalesces
  concurrent byte downloads across preview/full/motion consumers, captures the
  server/token before awaits, and validates durable account epoch/session
  tombstones. Durable checks and byte mutation share the same transaction.
- Deletion/reconciliation/reset clear ciphertext atomically; browser invalidation
  broadcasts invalidate decoded/in-flight work across handles/tabs. Web Blob
  previews/full/viewer caches dispose on invalidation; decoded keys also carry
  captured account/server/generation identity. Existing memory limits remain
  80 thumbnail / 3 full / 3 viewer, with two decode workers per lane; native
  remains a bounded 50-entry data-URI fallback, without new dependencies.
- Reading adapter captures the history owner and stores wire message identity,
  sequence, signed measured viewport offset, meaningful group expansion keys,
  and explicit follow-latest intent. Actual member/viewport `measureInWindow`
  results drive restore/pinning; estimated index scrolling only mounts an
  offscreen target. Member markers support tall/nested expanded groups. Stable
  membership keys survive random reducer rendered IDs and boundary-group changes.
- Authenticated ChatList wires older/newer loading and error state, a historical
  visual-bottom newer loader, and explicit select-latest-before-scroll. Public
  snapshots remain opt-out/read-only. The #473 partial anchor count and load-more
  sheet behavior is retained. Background prefetch does not add a loading row;
  reached-boundary Loading appears after 250ms in a fixed 36px overlay, with
  explicit error retry. Repeated same-boundary requests are suppressed.
- Historical windows suppress live footer/current-turn/latest-edit/follow-tail
  affordances. Historical sends still commit the encrypted outbox, retain the
  reading slice, avoid inserting optimistic current-turn rows there, and expose
  newer history/jump-latest.

## Cross-task integration correction

The Task 2 latest facade previously returned an in-flight older load without
actually selecting latest. It now waits for that owner and selects latest;
if that awaited operation already reached latest, its result is reused. Cache
reads also recheck the captured owner before initiating an HTTP request. The
paired stale-tail / corrupt-cache regression caught a real extra request when
automatic and explicit latest navigation overlapped; request-budget assertions
were retained, not loosened.

## RED / GREEN evidence

- `localHistory.attachments.test.ts`: RED absent write API; GREEN durable reopen,
  eviction, oversize, separate-handle deletion/reconciliation/reset fencing.
- `apiAttachments.persistence.test.ts`: RED three fetches instead of two, and
  delayed deleted-session result delivered; GREEN one descriptor + one body for
  concurrent consumers, zero fetches after archive reopen, rejected stale result.
- Web hook regressions: RED cross-account decoded reuse and undisposed stale
  decode; GREEN captured identity and dispose-after-reset fencing. Native hook
  compatibility passed unchanged.
- Pagination regressions: RED missing delayed boundary indicator/newer loader,
  historical latest selection and historical gates; GREEN these cases alongside
  all upstream #473 tests. Retry and session-switch timer cancellation covered.
- Reading tests: new module RED; GREEN stable expansion membership, synthetic
  fallback / deterministic one-wire multiple-block row selection, measured
  signed offset, +100px prepend correction, and account-read cancellation.
- Writer integration: RED historical optimistic insertion, native delete without
  decoded invalidation and latest jump returning older load; GREEN 25 tests.
  Further REDs proved duplicate completed-latest selection and HTTP after old
  account cache-read; guarded implementation passed the 27-test writer suite.
- Initial broad run: 18 files / 202 tests, 201 passed; only the paired corrupt
  archive request budget failed. Isolated corrupt test passed; paired reproduction
  showed two identical latest-page GETs. This failure drove the correction above.

## Verification commands

All app commands run from `packages/happy-app`, with bounded workers. Completed
pre-final typechecks (`pnpm exec tsc --noEmit --pretty false`) exited 0, but the
first preceded later UI edits and the second preceded the final coalescing/owner
guard correction; neither alone is claimed as final evidence.

Final stable-source verification (before source commit; no intervening source
edits) completed:

- Command 1: **2 files / 103 tests passed**, exit 0, 117.10s. Includes the paired
  stale-tail/corrupt-cache budget regression, all 76 message-visibility cases,
  and all 27 writer cases.
- Command 2: **20 files / 126 tests passed**, exit 0, 122.05s. Includes all six
  OTA runtime contract cases, attachment/gallery/viewer regressions, public
  snapshots, grouped messages and reading/pagination tests.
- Command 3: **exit 0**, empty diagnostic output, after the final owner/coalescing
  fix. This is the final source typecheck, distinct from the earlier two runs.
- Command 5: **exit 0**, no whitespace errors.
- Total focused coverage: **22 files / 229 tests passed**.
- Web export remains **pending** at the immutable source-review handoff; the
  first cold export started before the last fix and is not final-build evidence.

Exact commands:

1. `pnpm exec vitest run sources/sync/sync.sessionWriters.test.ts sources/sync/sync.messageVisibility.test.ts --maxWorkers=1 --silent`
2. `pnpm exec vitest run sources/sync/apiAttachments.downloadSource.test.ts sources/sync/apiAttachments.persistence.test.ts sources/sync/localHistory.attachments.test.ts sources/sync/localHistory.test.ts sources/sync/sessionHistoryReconciliation.test.ts sources/sync/resolveMediaAttachmentSource.test.ts sources/sync/resolveMotionPhotoAttachmentSource.test.ts sources/hooks/useAttachmentImage.web.test.tsx sources/hooks/useAttachmentImage.test.tsx sources/utils/attachmentImageSource.web.test.ts sources/utils/otaRuntimeConfig.test.ts sources/components/ConversationTranscript.pagination.test.tsx sources/components/transcriptReading.test.tsx sources/components/ToolGroupView.test.tsx sources/components/PublicSessionTranscript.test.tsx sources/hooks/useGroupedMessages.test.ts sources/components/ImageViewer.performance.test.tsx sources/components/ImageViewer.motionPhoto.test.tsx sources/components/AttachmentGalleryView.test.tsx sources/sync/imageViewer.test.ts --maxWorkers=1 --silent`
3. `pnpm exec tsc --noEmit --pretty false`
4. `APP_ENV=production pnpm exec expo export --platform web --max-workers 2 --output-dir .expo/task3-web-export`
5. `git diff --check`

An export was started before the final coalescing correction, so its output is
pre-fix evidence only. Final export must be rerun after the source is frozen.

## Limits and review focus

- No browser run or new screenshots: mocked native-node measurement tests prove
  the offset/owner logic, not pixel-accurate Web/native rendering. Only the
  user-supplied existing dark transcript screenshot was inspected. Independent
  Ego-only interaction review remains the controller's delivery workflow.
- Plain streaming media stays signed-URL/network streaming; no claim of full
  offline playback or stored ranges. Encryption/blob keys remain memory-only.
- Cache failures remain optional network fallbacks. No quota was increased for
  decoded memory, no eager image prefetch, no native dependency or runtime change.
- No publish, OTA/APK, server rollout/migration, PR, push or merge was performed.
  Existing server deployment prerequisite remains separate from this UI work.
