# Task 3 review fix round 1/5

FIX_BASE: `1463035bc970cfa7564bf14b12644a0865a99920`.
Scope: the two P2 findings in `task-3-review-findings.md`, the reproduced
controller test failure, and the requested historical-send/ACK/latest lifecycle.

## Changes and RED / GREEN evidence

1. Same-wire block anchors now store optional `anchorBlock` alongside wire ID
   and measured offset. The sync facade derives a stable source-content ordinal
   from reducer insertion order (tool call IDs have their own namespace), not
   random rendered IDs or viewport node registration. Capture, restore and
   offscreen mounting all match it. Old version-1 reading states remain valid.
   - RED: the second cross-screen block's offset was applied to the first block,
     scrolling to 800 instead of 2100. GREEN: second block restored after rendered
     IDs change, with the same signed viewport offset. Actual reducer replay also
     proves distinct block keys stable across regenerated IDs (RED absent facade).
   - IndexedDB regression verifies old states without a block and persisted
     `text:1` / -200 offset after close and reopen.
2. Expanded groups use one bounded alias set of stable member IDs. Surviving
   members carry expansion through trimming; manual collapse removes the whole
   matching set, including aliases that left the window. Top-level and nested
   observation merges newly visible members. Legacy one-member keys still read.
   - RED: expanded A/B/C became collapsed after trimming A. GREEN: B/C stays
     expanded, then manual collapse stays collapsed on reopening A/B/C; covered
     both in the helper and mounted ConversationTranscript integration.
   - Bounds are 300 aliases per set and 256 group sets. Added boundary regression
     caught rotating aliases on repeated observation of a >300-member group;
     current-member-last merge ordering fixed it. Stable repeated observation
     returns the original array reference, avoiding repeated state updates.
3. Real storage/encryption module imports now finish in `beforeAll` (30s suite
   setup budget), before any test may switch the singleton owner. Test bodies
   retain their existing timeout and sequence assertions.
   - Original paired command reproduced permission timeout at 5094ms and socket
     newestSeq 300 instead of 302. Single-variable diagnostic with 30s test-body
     timeout passed (permission 5889ms, socket 4679ms), showing that a timed-out
     import resumed and changed the next test's storage/encryption owner.
   - After setup correction the default-timeout pair passes; assertions were
     not loosened. The timeout override was diagnostic only, never final evidence.
4. Historical send integration uses real sync/outbox/IndexedDB/reducer, stubbing
   only crypto and network: seed historical seq1, send, ACK seq2, verify drained
   outbox and persisted accepted ciphertext while retaining the same old row
   array and seq1 window, then explicitly jump latest and see the accepted text.
   The combined lifecycle passes. A first test fixture incorrectly omitted the
   accepted server record from its latest-page response; correcting that fixture
   required no production ACK change.
5. A final standard rerun found the existing partial-forward-failure test racing
   random retry backoff: polling for exactly 2 calls observed 4. Forced zero
   backoff reproduced RED with the same 4-vs-2 failure. The affected test now
   awaits named `firstFailedPageRefresh`, then asserts exactly 2 API requests and
   one git refresh before releasing its owner. Zero-backoff GREEN: 1 passed /
   76 skipped, 5.35s. No production retry behavior or assertion was changed.

## Verification commands

All commands run from `packages/happy-app`, with bounded workers and no global
test-timeout override. The paired import diagnostic was:

`pnpm exec vitest run sources/sync/sync.messageVisibility.test.ts --maxWorkers=1 --silent -t 'live permission updates outside|new socket records in a full'`

Only for diagnosis, that same command was repeated with `--testTimeout=30000`.
Zero-backoff RED/GREEN command:

`pnpm exec vitest run sources/sync/sync.messageVisibility.test.ts --maxWorkers=1 --silent -t 'later forward page fails'`

Final standard controller command:

`pnpm exec vitest run sources/sync/sync.messageVisibility.test.ts sources/sync/apiAttachments.persistence.test.ts sources/components/transcriptReading.test.tsx sources/utils/otaRuntimeConfig.test.ts --maxWorkers=1 --silent`

Remaining amended sync / component / storage command:

`pnpm exec vitest run sources/sync/sync.sessionWriters.test.ts sources/sync/apiAttachments.downloadSource.test.ts sources/sync/localHistory.attachments.test.ts sources/sync/localHistory.test.ts sources/sync/sessionHistoryReconciliation.test.ts sources/sync/resolveMediaAttachmentSource.test.ts sources/sync/resolveMotionPhotoAttachmentSource.test.ts sources/hooks/useAttachmentImage.web.test.tsx sources/hooks/useAttachmentImage.test.tsx sources/utils/attachmentImageSource.web.test.ts sources/components/ConversationTranscript.pagination.test.tsx sources/components/transcriptReading.test.tsx sources/components/ToolGroupView.test.tsx sources/components/PublicSessionTranscript.test.tsx sources/hooks/useGroupedMessages.test.ts sources/components/ImageViewer.performance.test.tsx sources/components/ImageViewer.motionPhoto.test.tsx sources/components/AttachmentGalleryView.test.tsx sources/sync/imageViewer.test.ts --maxWorkers=1 --silent`

The latter passed **19 files / 150 tests**, exit 0, 37.40s, after the final
production-source edit. The only subsequent source edit was the scoped test
synchronization correction in `sync.messageVisibility.test.ts` (not in that run).
The earlier boundary run had 149 passed / 1 failed and is not final evidence.

Final controller command passed **4 files / 91 tests**, exit 0, 26.19s, after
the first-failure synchronization correction, with no subsequent source edits.
Combined coverage is **22 distinct files / 235 distinct tests** (the 6 reading
tests run in both commands). Final `pnpm exec tsc --noEmit --pretty false`
exited 0 with no diagnostics. `git diff --check` exited 0. Both requested P2
regressions and historical send/ACK/explicit-latest lifecycle are GREEN;
no remaining failure was observed in these final commands.

## Controller-owned remaining work / limits

- Independent scoped re-review is required; this report does not declare Task 3
  or the overall implementation accepted.
- Web export was stopped with SIGINT at controller authorization. Its exit 0
  reflects Expo's interrupt handling, not a completed export. Do not treat it as
  build evidence. No restart until controller integrates current main and asks
  for the exact-integration build.
- No browser or pixel-accurate layout claim: measurements are mocked-node
  regressions, not a new Ego interaction run. No push, merge, deployment,
  migration, package installation, OTA/APK or root-workspace changes performed.
- Parent-owned plan edits were not modified or staged by this fix round.
