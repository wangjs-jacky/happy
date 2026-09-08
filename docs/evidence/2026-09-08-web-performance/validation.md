# Validation record

Integrated product revision: `e6f24edca079708321f4899f3b5aaf1f30df002a` (main `e54c27b7` merged into reviewed performance branch).

Final product revision: `e448350d` adds genuine non-wheel Web navigation ownership. Independent whole-branch review requested that fix; scoped rereview approved it with no new breakage.

## Automated checks

- 112 relevant test files: **1,117 passed, 1 separately-run traversal excluded**, exit 0, 167.56 s.
- Original heavy traversal with unchanged 60-second timeout: **1 passed / 153 other cases skipped**, exit 0, test 35.463 s / command 41.32 s.
- Integration-specific transcript/adapter/reading/first-submission tests: **98 passed**.
- Typecheck passed after rebuilding the workspace happy-wire generated output. The first attempt found stale generated environment types; no product-source workaround was made.
- Earlier contended history runs timed out. Those failures are retained in the implementation reports; the isolated pass is not a claim that the earlier runs passed.
- Final gesture fix: **67 tests passed** (pagination 45, reading 14, real vendor adapter 5, browser progress 3), then typecheck passed. Actual DOM keyboard/pointer/touch event contracts are covered; real browser PageUp paging and stop-position checks passed. No native device touch or OS scrollbar-drag result is claimed from a DOM test.

Commands from the worktree root:

```sh
pnpm --filter happy-app exec vitest run sources/sync/sync.messageVisibility.test.ts -t 'repeatedly traverses older and newer cached pages' --maxWorkers=1 --reporter=verbose --silent
pnpm --filter happy-app exec vitest run sources/sync sources/hooks/useDraft.test.tsx sources/hooks/useSpawnSession.test.tsx sources/components/ComposeHome.test.tsx sources/components/ActiveSessionsGroupCompact.test.tsx sources/components/ConversationTranscript.pagination.test.tsx sources/components/ConversationTranscript.browserProgress.integration.test.tsx sources/components/transcriptReading.test.tsx sources/components/anchoredWebVirtualizedList.test.tsx sources/components/AttachmentGalleryView.test.tsx sources/components/ImageViewer.performance.test.tsx sources/components/markdown/MermaidRenderer.test.tsx sources/components/markdown/MermaidRenderer.native.test.tsx sources/components/markdown/mermaidRendererModel.test.ts sources/utils/otaRuntimeConfig.test.ts --maxWorkers=2 -t '^(?!.*repeatedly traverses).*' --reporter=dot --silent
pnpm --filter @slopus/happy-wire run build
pnpm --filter happy-app typecheck
```

## Isolated first-message browser checks

- 20-second fake machine delay: starting card appears and composer clears in a 22.5 ms sampled observation; two send clicks invoke submission once. Real keyboard input during startup survives navigation as the newer compose draft.
- Explicit 1.5-second fake RPC failure: Restore returns exact submitted text; refresh retains the durable restored record.
- Refresh during a 12-second fake spawn: record becomes failed/interrupted without a retry or known session ID; no automatic resend is authorized. The fake machine may have created an empty isolated session before the browser could know its result.
- Before/After screenshots use the same prompt, 1440×900/DPR 1, and an eight-second fake delay. They were delivered through Happy image cards.
- Independent review noted light Before / dark After themes for first submission; this pair supports behavior comparison only, not color/style deltas.

These are development fixtures, not production latency percentiles or real model startup tests. Native device behavior was not physically exercised. Final video replays passed and were delivered. [Independent interaction acceptance](interaction-review.md) passed the scoped cases with explicit production/loading limits; PR/CI checks are tracked on the pull request.
