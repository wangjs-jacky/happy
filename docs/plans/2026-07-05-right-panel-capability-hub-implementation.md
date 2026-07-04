# Right Panel Capability Hub Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dense, summary-first capability hub inside the mobile right-swipe panel that surfaces real session resources and opens deeper detail on demand.

**Architecture:** Keep Settings as the machine-level installed-skills inventory and make the right panel session-scoped. Mount a compact capability hub inside the existing `RightSwipePanelHost`, derive its data from existing storage hooks (`useSession`, `useSessionMessages`, `useArtifacts`), and keep the extraction logic in pure model functions with tests. Treat `session.metadata.skills` as available session skills only; do not present it as actual skill-use history until a real per-turn usage signal exists.

**Tech Stack:** React Native, Expo Router, Unistyles, Zustand-backed sync storage, Vitest, self-hosted preview OTA.

---

## Constraints

- The mobile right panel is narrow: `RightSwipePanelHost` clamps width to `280..340px`, so the first screen must be dense and block-first.
- Settings already owns installed-skills browsing: `packages/happy-app/sources/app/(app)/settings/skills.tsx`.
- The panel must prefer real data:
  - session messages: `useSessionMessages(sessionId)`
  - session metadata: `useSession(sessionId)`
  - artifacts: `useArtifacts()`
  - image viewer: `imageViewer.open(...)`
- `session.metadata.skills` is populated from the Claude SDK init payload and powers `/skills` as “Available Skills”, not “Used Skills”:
  - `packages/happy-cli/src/claude/claudeRemote.ts`
  - `packages/happy-cli/src/claude/claudeRemoteLauncher.ts`
  - `packages/happy-cli/src/claude/runClaude.ts`
- The user’s latest design direction is:
  - no explanatory hero copy at the top
  - clickable outer capability blocks first
  - detail shown only after tapping a block
  - the panel should become a reusable hub for future modules, not just skills

## File Map

### Existing files to modify

- `packages/happy-app/sources/components/RightSwipePanelHost.tsx`
  - Add a panel-content slot while preserving the current gesture and scrim behavior.
- `packages/happy-app/sources/-session/SessionView.tsx`
  - Inject the session-scoped capability hub into the right panel.
- `packages/happy-app/sources/components/ComposeHome.tsx`
  - Inject a lightweight empty-state or onboarding variant so the panel is not blank outside a session.
- `packages/happy-app/sources/text/_default.ts`
  - Add new translation keys.
- `packages/happy-app/sources/text/translations/en.ts`
- `packages/happy-app/sources/text/translations/ru.ts`
- `packages/happy-app/sources/text/translations/pl.ts`
- `packages/happy-app/sources/text/translations/es.ts`
- `packages/happy-app/sources/text/translations/ca.ts`
- `packages/happy-app/sources/text/translations/it.ts`
- `packages/happy-app/sources/text/translations/pt.ts`
- `packages/happy-app/sources/text/translations/ja.ts`
- `packages/happy-app/sources/text/translations/zh-Hans.ts`
  - Mirror the same keys across all supported languages.

### New files to create

- `packages/happy-app/sources/components/rightPanel/SessionCapabilityHub.tsx`
  - Main dense panel UI for active sessions.
- `packages/happy-app/sources/components/rightPanel/CapabilityBlockCard.tsx`
  - Reusable compact block card used by the hub.
- `packages/happy-app/sources/components/rightPanel/CapabilityHubDetailView.tsx`
  - In-panel detail surface that replaces or overlays the summary list after a block tap.
- `packages/happy-app/sources/components/rightPanel/sessionCapabilityHubModel.ts`
  - Pure extraction helpers for capability counts, recent resources, and detail lists.
- `packages/happy-app/sources/components/rightPanel/useSessionCapabilityHub.ts`
  - Hook that wires session hooks into the pure model.
- `packages/happy-app/sources/components/rightPanel/sessionCapabilityHubModel.test.ts`
  - Unit tests for the model logic.

## Scope Decisions

- First release should ship these capability blocks:
  - `Skills`
  - `Images`
  - `Artifacts`
  - `Files`
- “Skills” block behavior for v1:
  - block label can remain `Skills`
  - detail view must clearly use `session.metadata.skills` as session-available context, not claim a chronological history
  - if no skills metadata exists, show an empty state instead of fabricating entries
- “Images” should come from real `file` tool-call attachments in the current session.
- “Artifacts” should come from real artifacts filtered by `artifact.sessions?.includes(sessionId)`.
- “Files” should come from real edit/file-touch signals already represented in session messages (`Edit`, `MultiEdit`, `Write`, `CodexPatch` when parseable).
- No top-of-panel explanatory paragraph, no status chips, no large decorative header.
- Detail interaction should stay inside the panel first; do not route the user into Settings just to inspect panel content.

## Chunk 1: Panel Host And Data Foundation

### Task 1: Open the existing right panel to real content

**Files:**
- Modify: `packages/happy-app/sources/components/RightSwipePanelHost.tsx`
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Modify: `packages/happy-app/sources/components/ComposeHome.tsx`

- [ ] **Step 1: Add a render slot for panel content**

Update `RightSwipePanelHost` so callers can pass a right-panel node, while the host keeps ownership of width, gesture progress, safe-area padding, drag handle, and close behavior.

- [ ] **Step 2: Keep the shell narrow and scrollable**

Inside the right panel area, render:
- the drag handle
- a scrollable content container below it
- no new top copy

- [ ] **Step 3: Mount session content only where it exists**

Wire `SessionView` to pass a session-scoped panel component and `ComposeHome` to pass a minimal empty-state variant instead of leaving the panel blank.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter happy-app typecheck`

Expected: success with no new TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/components/RightSwipePanelHost.tsx \
        packages/happy-app/sources/-session/SessionView.tsx \
        packages/happy-app/sources/components/ComposeHome.tsx
git commit -m "feat(happy-app): open right swipe panel to injected content"
```

### Task 2: Build the capability-hub model with tests first

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/sessionCapabilityHubModel.ts`
- Create: `packages/happy-app/sources/components/rightPanel/sessionCapabilityHubModel.test.ts`
- Create: `packages/happy-app/sources/components/rightPanel/useSessionCapabilityHub.ts`

- [ ] **Step 1: Write failing tests for session resource extraction**

Cover these cases:
- filters artifacts by `sessions`
- extracts recent image attachments from `file` tool calls
- extracts touched files from edit-like tools
- treats `metadata.skills` as available skills context, not usage history
- preserves newest-first ordering and output limits

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run: `pnpm --filter happy-app test --run sources/components/rightPanel/sessionCapabilityHubModel.test.ts`

Expected: failing assertions because the model does not exist yet.

- [ ] **Step 3: Implement the smallest pure model that makes the tests pass**

Design the model output around panel needs:
- summary block list with counts
- detail lists per capability
- recent-resource rows that can be opened by the UI
- stable empty states

- [ ] **Step 4: Add a hook that binds storage hooks to the pure model**

`useSessionCapabilityHub(sessionId)` should pull:
- `useSession(sessionId)`
- `useSessionMessages(sessionId)`
- `useArtifacts()`

and return one normalized object for the UI.

- [ ] **Step 5: Re-run the targeted tests**

Run: `pnpm --filter happy-app test --run sources/components/rightPanel/sessionCapabilityHubModel.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/happy-app/sources/components/rightPanel/sessionCapabilityHubModel.ts \
        packages/happy-app/sources/components/rightPanel/sessionCapabilityHubModel.test.ts \
        packages/happy-app/sources/components/rightPanel/useSessionCapabilityHub.ts
git commit -m "feat(happy-app): add capability hub session model"
```

## Chunk 2: Dense Capability Hub UI

### Task 3: Render compact capability blocks first, detail second

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/CapabilityBlockCard.tsx`
- Create: `packages/happy-app/sources/components/rightPanel/CapabilityHubDetailView.tsx`
- Create: `packages/happy-app/sources/components/rightPanel/SessionCapabilityHub.tsx`
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Modify: `packages/happy-app/sources/components/ComposeHome.tsx`

- [ ] **Step 1: Build the summary-first block UI**

Render a compact single-column stack where the first screen immediately shows tappable capability blocks. Each block should show:
- icon
- name
- one short summary line or count

- [ ] **Step 2: Implement in-panel detail transitions**

Tapping a block should switch the panel into a detail view with a clear back affordance. Do not push to Settings for core inspection.

- [ ] **Step 3: Wire resource actions to existing surfaces**

Use current app behaviors where possible:
- image rows open `imageViewer`
- artifact rows route to `/artifacts/[id]`
- file rows route to existing session file/diff surfaces

- [ ] **Step 4: Add a compact empty state**

If a session has no current data for a block, show a short empty state instead of removing the block entirely. The panel should stay structurally stable.

- [ ] **Step 5: Manually verify the narrow layout**

Check on a phone-width viewport that:
- blocks start near the top
- there is no dead hero paragraph
- at least one actionable block is visible without scrolling

- [ ] **Step 6: Commit**

```bash
git add packages/happy-app/sources/components/rightPanel/CapabilityBlockCard.tsx \
        packages/happy-app/sources/components/rightPanel/CapabilityHubDetailView.tsx \
        packages/happy-app/sources/components/rightPanel/SessionCapabilityHub.tsx \
        packages/happy-app/sources/-session/SessionView.tsx \
        packages/happy-app/sources/components/ComposeHome.tsx
git commit -m "feat(happy-app): add dense session capability hub UI"
```

### Task 4: Add translations for the new panel

**Files:**
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/ru.ts`
- Modify: `packages/happy-app/sources/text/translations/pl.ts`
- Modify: `packages/happy-app/sources/text/translations/es.ts`
- Modify: `packages/happy-app/sources/text/translations/ca.ts`
- Modify: `packages/happy-app/sources/text/translations/it.ts`
- Modify: `packages/happy-app/sources/text/translations/pt.ts`
- Modify: `packages/happy-app/sources/text/translations/ja.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`

- [ ] **Step 1: Add the default translation structure**

Create a new translation section for the panel, for example `rightPanelCapabilityHub.*`, covering:
- block titles
- empty states
- detail titles
- back/close affordances

- [ ] **Step 2: Mirror the keys across all languages**

Do not ship with missing translations or hardcoded JSX strings.

- [ ] **Step 3: Re-read the changed translation files and sanity-check key consistency**

Make sure every language exports the same shape.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter happy-app typecheck`

Expected: success with no missing translation key errors.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/text/_default.ts \
        packages/happy-app/sources/text/translations/en.ts \
        packages/happy-app/sources/text/translations/ru.ts \
        packages/happy-app/sources/text/translations/pl.ts \
        packages/happy-app/sources/text/translations/es.ts \
        packages/happy-app/sources/text/translations/ca.ts \
        packages/happy-app/sources/text/translations/it.ts \
        packages/happy-app/sources/text/translations/pt.ts \
        packages/happy-app/sources/text/translations/ja.ts \
        packages/happy-app/sources/text/translations/zh-Hans.ts
git commit -m "feat(happy-app): localize capability hub strings"
```

## Chunk 3: Verification, PR, And Preview OTA

### Task 5: Verify the hub against real session data

**Files:**
- Test: `packages/happy-app/sources/components/rightPanel/sessionCapabilityHubModel.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `pnpm --filter happy-app test --run sources/components/rightPanel/sessionCapabilityHubModel.test.ts`

Expected: PASS.

- [ ] **Step 2: Run existing related tests that could regress**

Run: `pnpm --filter happy-app test --run sources/sync/imageViewer.test.ts sources/hooks/useGroupedMessages.test.ts`

Expected: PASS.

- [ ] **Step 3: Run full typecheck**

Run: `pnpm --filter happy-app typecheck`

Expected: PASS.

- [ ] **Step 4: Verify manually on a preview build**

Use a real session containing at least:
- one user image attachment
- one artifact linked to the session
- one edit/file tool call

Confirm:
- blocks render immediately near the top
- detail transitions work
- image tap opens the viewer
- artifact tap opens artifact detail
- file tap opens the existing session file surface

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app
git commit -m "test(happy-app): verify capability hub integration"
```

### Task 6: Open PR and trigger preview OTA

**Files:**
- Modify: `docs/plans/2026-07-05-right-panel-capability-hub-implementation.md`

- [ ] **Step 1: Push the feature branch**

Run: `git push -u origin skills-timeline-panel`

Expected: remote branch updated successfully.

- [ ] **Step 2: Open the PR against `jacky-main`**

Run:

```bash
gh pr create --repo wangjs-jacky/happy --base jacky-main --head skills-timeline-panel
```

Expected: PR URL returned.

- [ ] **Step 3: Wait for the preview OTA workflow**

Monitor `.github/workflows/ota-preview.yml` on the PR and collect:
- PR URL
- preview OTA comment
- published update ID

- [ ] **Step 4: Verify on the preview app build**

Use the preview build on device, open the target session, swipe in the right panel, and validate the capability hub against the OTA update.

- [ ] **Step 5: Update this plan with the verification result**

Append:
- PR URL
- OTA update ID
- device verification note

---

## Risks And Follow-Ups

- Real “used skills history” still has no stable source in the current app protocol. Do not fake chronology from `metadata.skills`.
- If `CodexPatch` or other edit tools do not expose parseable file lists consistently, ship `Files` with the edit tools that already route cleanly first, then extend coverage.
- If detail-in-panel transitions feel too heavy, the fallback is a summary list in-panel plus route-out detail for individual resources. Do not move the whole feature into Settings.
- After the first release, the next module to add is a generalized “recent generated resources” block that can aggregate HTML previews, images, artifacts, and touched files under one surface.
