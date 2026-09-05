# Task 7 remediation report — Ego progress popover

## Outcome

Completed the PC Web Ego progress remediation without browser automation.

- Browser progress no longer has a global Capability Hub heading action and never replaces the summary/detail surface.
- `getBrowserStepRuns(messages)` associates explicit stable run IDs with the matching Ego invocation and applies a deterministic same-user-turn fallback for legacy frames.
- Browser events without an associated `ego-browser` or `ego-ops` invocation are excluded.
- Each matching Ego Skill row exposes run-specific, localized **View progress** triggers. Repeated runs keep distinct triggers and open their own step lists.
- The progress surface is rendered through a standalone React Native `Modal`, positioned from the trigger when space permits and clamped to desktop/narrow viewport gutters.
- Backdrop, close button, captured Escape, Tab containment, focus restoration, pointer activation, Enter/Space activation, live updates, and long-list internal scrolling are covered.
- Visible surfaces use Unistyles semantic surface/divider/text/shadow tokens. Tests cover a default-light fixture and the `ginghamDark` surface values.
- Stable Task 8 selectors include `browser-progress-trigger-<runId>`, `browser-steps-popover`, `browser-steps-popover-backdrop`, `browser-steps-popover-close`, and `browser-steps-timeline-scroll`.

## TDD evidence

1. `browserStepRunsModel.test.ts` first failed because the model module did not exist; the implementation then made all four grouping tests pass.
2. The expanded `BrowserStepsPopover.test.tsx` first failed on the missing standalone Modal, backdrop, layout helper, and theme styles; the implementation made those cases pass.
3. `CapabilityHubDetailView.browserProgress.test.tsx` first failed because `SkillItemRow` was not exported and had no progress contract; the run-specific pointer/keyboard/ARIA behavior was then implemented.
4. The focus-containment test first failed because Tab stayed unbounded; boundary cycling was then implemented without initial-focus stealing.
5. The raw normalization test first failed because `runId` and `skillName` were stripped; the App session schema now preserves them.

## Files changed

- `packages/happy-app/sources/components/rightPanel/browserStepRunsModel.ts`
- `packages/happy-app/sources/components/rightPanel/browserStepsModel.ts`
- `packages/happy-app/sources/components/rightPanel/SessionCapabilityHub.tsx`
- `packages/happy-app/sources/components/rightPanel/CapabilityHubDetailView.tsx`
- `packages/happy-app/sources/components/rightPanel/BrowserStepsPopover.tsx`
- `packages/happy-app/sources/components/rightPanel/BrowserStepsPanel.tsx`
- component/model regression tests beside those files
- `packages/happy-app/sources/sync/typesRaw.ts` and its browser-step normalization test
- `_default`, English, Simplified/Traditional Chinese, and required fallback locale entries

## Verification

```text
pnpm --filter happy-app exec vitest run \
  sources/components/rightPanel/browserStepRunsModel.test.ts \
  sources/components/rightPanel/BrowserStepsPanel.test.tsx \
  sources/components/rightPanel/BrowserStepsPopover.test.tsx \
  sources/components/rightPanel/CapabilityHubDetailView.browserProgress.test.tsx \
  sources/components/rightPanel/SessionCapabilityHub.browserProgress.test.tsx \
  sources/components/rightPanel/sessionCapabilityHubModel.test.ts \
  sources/sync/typesRaw.spec.ts

PASS — 7 files, 93 tests.
The five stderr lines are the pre-existing expected malformed-session diagnostics asserted by `typesRaw.spec.ts`.

pnpm --filter happy-app typecheck
PASS

git diff --check
PASS
```

## Review remediation

The follow-up review requirements are now implemented across the complete event path:

- Happy wire and CLI file-event schemas preserve optional `browserStep.runId` and `browserStep.skillName`, while accepting historical label-only events.
- Both the Claude HTTP MCP registration and Codex stdio bridge forward the two fields. The shared agent prompt requires one stable run ID per Ego invocation/task and reuse of that ID for every frame in that run.
- Producer tests verify stable metadata across multiple frames, the CLI envelope and wire tests verify transport preservation, and the App normalization/grouping tests verify consumption.
- Legacy steps remain attached to the latest preceding Ego invocation across interleaved user messages until a newer Ego invocation supersedes it.
- The anchored Skill-row popover is PC Web only. Native platforms retain the existing full `BrowserStepsPanel` behavior.
- Catalan, Spanish, Italian, Japanese, Polish, Portuguese, and Russian now have locale-appropriate browser-progress text, covered by a translation regression test.

Follow-up verification:

```text
@slopus/happy-wire test: PASS — 6 files, 79 tests
Happy CLI focused unit tests: PASS — 4 files, 16 tests
Happy App focused remediation tests: PASS — 6 files, 82 tests
happy-app typecheck: PASS
@wangjs-jacky/paws typecheck: PASS
@slopus/happy-wire typecheck: PASS
git diff --check: PASS
```

## Pending invocation queue remediation

- Each Ego skill now maintains its own deterministic pending-invocation queue. When several real `Skill` calls precede their first frames, first-seen producer IDs bind FIFO by invocation order, one ID per invocation.
- Invocation message IDs and tool call IDs remain authoritative and can bind an exact pending invocation ahead of FIFO discovery; that invocation is then removed from the pending queue.
- Repeated frames keep routing through the bound ID. New IDs are excluded once the matching skill queue is exhausted. Different skill queues, direct input IDs, and legacy routing remain independent.

Queue remediation evidence:

```text
Happy App focused progress suite: PASS — 6 files, 87 tests
Happy CLI producer/bridge suite: PASS — 4 files, 16 tests
Happy wire suite: PASS — 6 files, 79 tests
happy-app, Happy CLI, and Happy wire typechecks: PASS
git diff --check: PASS
```

## Final high-priority binding remediation

- Real Ego `Skill` invocations do not need to contain `input.runId`. The first subsequent explicit browser frame carrying both `skillName` and `runId` binds that ID to the latest preceding, matching, unbound invocation.
- Further frames with the bound ID route to the same invocation. A different new ID cannot reuse an already-bound invocation and remains excluded until another matching Ego invocation appears.
- Declared invocation `input.runId`, invocation message IDs, tool call IDs, and legacy label-only routing remain supported.
- The cross-layer regression builds producer-shaped browser metadata, parses it with the shared wire schema, and feeds the resulting event into the App grouping model using the real `Skill` input shape without a run ID. It covers multiple skills, multiple invocations, distinct IDs, and orphan exclusion.
- Agent instructions now require exactly one newly generated stable ID for each Ego invocation, reused for all meaningful frames from that invocation and never across invocations.

Final focused evidence:

```text
Browser run model + App normalization: PASS — 2 files, 71 tests
Happy CLI producer/bridge tests: PASS — 4 files, 16 tests
Happy wire suite: PASS — 6 files, 79 tests
happy-app, Happy CLI, and Happy wire typechecks: PASS
git diff --check: PASS
```
