# Remove Capture Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the composer camera affordance, desktop screenshot RPC, browser screenshot reporting, and browser-step presentation while preserving ordinary attachments, QR scanning, browser automation, and legacy protocol parsing.

**Architecture:** Delete the active capture path at both UI and CLI boundaries. Remove the browser screenshot MCP tool and its prompt injection so agents no longer produce browser-step evidence; keep the existing wire/API `browser_step` shape as a compatibility reader for historical events, but stop projecting those events into the app UI. Keep generic attachment upload and the unrelated camera permission/QR flows intact.

**Tech Stack:** TypeScript, React Native/Expo, pnpm workspaces, Vitest, React Test Renderer.

**Spec:** User request in the current conversation; reference screenshot `/Users/jacky/.happy/attachments/2026-09-09T16-25-39-710Z-0-image.png`.

## Global Constraints

- Work only in sibling worktree `/Users/jacky/jacky-github/happy--remove-capture-tools`.
- Root workspace `/Users/jacky/jacky-github/happy` remains clean `main` aligned with `origin/main`.
- Preserve ordinary image/media/PDF attachments and QR-scanning camera functionality.
- Do not remove generic Ego browser automation; remove only screenshot capture/reporting and its Happy presentation.
- Keep legacy `browser_step` protocol fields parseable for already stored messages; no new events may be produced by Happy CLI code.
- Use pnpm commands only.

### Task 1: Lock the removed UI and MCP surface with failing tests

**Files:**
- Modify: `packages/happy-app/sources/components/MessageComposer.screenshot.test.tsx`
- Modify: `packages/happy-cli/src/codex/happyMcpBridgeTools.test.ts`

**Interfaces:**
- Verifies the public behavior that no camera screenshot button is rendered even if an old caller passes the removed callback.
- Verifies `report_browser_step` is absent from the bridge tool name list.

- [ ] **Step 1: Write the failing tests**

  Change the composer test to render `MessageComposer` with the legacy screenshot callback cast through `as any`, then assert the screenshot accessibility label has zero matches. Add an assertion that `HAPPY_MCP_BRIDGE_TOOL_NAMES` does not contain `report_browser_step`.

- [ ] **Step 2: Run the focused tests and verify they fail for the expected reason**

  Run:

  ```bash
  pnpm --filter happy-app exec vitest run sources/components/MessageComposer.screenshot.test.tsx
  pnpm --filter @wangjs-jacky/paws exec vitest run src/codex/happyMcpBridgeTools.test.ts
  ```

  Expected: the existing camera button is found and the bridge list still contains `report_browser_step`.

### Task 2: Remove the composer and desktop screenshot path

**Files:**
- Modify: `packages/happy-app/sources/components/MessageComposer.tsx`
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Modify: `packages/happy-app/sources/-session/SessionView.agentSpace.test.tsx`
- Modify: `packages/happy-app/sources/-session/SessionView.hydration.test.tsx`
- Modify: `packages/happy-app/sources/sync/sessionViewPlatform.testSupport.tsx`
- Modify: `packages/happy-app/sources/components/MessageComposer.screenshot.test.tsx` (retain as the removal regression test)
- Delete: `packages/happy-app/sources/sync/ops.screenshot.ts`
- Delete: `packages/happy-app/sources/sync/ops.screenshot.test.ts`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/ca.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/es.ts`
- Modify: `packages/happy-app/sources/text/translations/it.ts`
- Modify: `packages/happy-app/sources/text/translations/ja.ts`
- Modify: `packages/happy-app/sources/text/translations/pl.ts`
- Modify: `packages/happy-app/sources/text/translations/pt.ts`
- Modify: `packages/happy-app/sources/text/translations/ru.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hant.ts`

**Interfaces:**
- `MessageComposer` no longer accepts or renders screenshot props.
- `SessionViewLoaded` no longer imports or calls `requestScreenshot`, owns capture state, or passes screenshot props.
- The remaining `components.messageComposer` translation object contains no screenshot-only labels.

- [ ] **Step 1: Remove the screenshot-only props, state, handler, button, and mocks**

  Delete the `onCaptureScreenshot`/`screenshotCapturing` prop declarations and camera button block from `MessageComposer`; remove screenshot state/handler/request import and props from `SessionView`; remove now-unused test mocks and old positive screenshot assertions; delete the two screenshot operation test files. Keep the paperclip attachment action and all non-screenshot `ActivityIndicator` uses. Retain `MessageComposer.screenshot.test.tsx` with its new absence assertion from Task 1.

- [ ] **Step 2: Remove only screenshot-specific translation entries**

  Remove `screenshot`, `screenshotFailedTitle`, `screenshotFailedBody`, and `screenshotUnsupportedPlatform` entries plus their direct-button comments from every locale listed above. Do not remove unrelated text containing the word “screenshot” in advisor prompts or activity prompts.

- [ ] **Step 3: Run the UI type/test checks**

  Run:

  ```bash
  pnpm --filter happy-app exec vitest run sources/components/MessageComposer.screenshot.test.tsx sources/components/MessageComposer.paste.test.tsx sources/components/AgentInputAttachmentStrip.test.tsx
  pnpm --filter happy-app exec vitest run sources/-session/SessionView.agentSpace.test.tsx sources/-session/SessionView.hydration.test.tsx
  ```

  Expected: exit code 0 and no screenshot button/import/type errors.

### Task 3: Remove CLI desktop screenshot registration and implementation

**Files:**
- Modify: `packages/happy-cli/src/modules/common/registerCommonHandlers.ts`
- Modify: `packages/happy-cli/src/api/apiSession.ts`
- Delete: `packages/happy-cli/src/modules/common/registerScreenshotHandler.ts`
- Delete: `packages/happy-cli/src/modules/common/registerScreenshotHandler.test.ts`
- Delete: `packages/happy-cli/src/utils/screenshot.ts`
- Delete: `packages/happy-cli/src/utils/screenshot.test.ts`

**Interfaces:**
- `registerCommonHandlers` keeps its existing common handlers but has no `registerScreenshot` option.
- `ApiSession` no longer registers a `screenshot` session RPC.

- [ ] **Step 1: Remove the handler import, option, call, and session registration**

  Delete the screenshot handler import and conditional registration in `registerCommonHandlers`; change the session constructor call to `registerCommonHandlers(this.rpcHandlerManager, this.metadata.path)`; delete the handler and its tests.

- [ ] **Step 2: Remove the now-unreferenced screenshot utility and tests**

  Delete `src/utils/screenshot.ts` and `src/utils/screenshot.test.ts` after confirming no remaining production import uses them.

- [ ] **Step 3: Run CLI focused checks**

  Run:

  ```bash
  pnpm --filter @wangjs-jacky/paws exec vitest run src/api/apiSession.test.ts
  pnpm --filter @wangjs-jacky/paws run typecheck
  ```

  Expected: exit code 0; no `screenshot` RPC or utility import remains in CLI production code.

### Task 4: Remove browser screenshot reporting and app presentation

**Files:**
- Modify: `packages/happy-cli/src/codex/happyMcpBridgeTools.ts`
- Modify: `packages/happy-cli/src/codex/utils/permissionHandler.ts`
- Modify: `packages/happy-cli/src/codex/codexPrompt.ts`
- Modify: `packages/happy-cli/src/codex/runCodex.ts`
- Modify: `packages/happy-cli/src/claude/utils/systemPrompt.ts`
- Modify: `packages/happy-cli/src/claude/utils/startHappyServer.ts`
- Modify: `packages/happy-cli/src/codex/happyMcpBridgeTools.test.ts`
- Modify: `packages/happy-cli/src/codex/__tests__/permissionHandler.test.ts`
- Modify: `packages/happy-cli/src/codex/__tests__/sessionProtocolMapper.test.ts`
- Modify: `packages/happy-cli/src/codex/codexPrompt.test.ts`
- Modify: `packages/happy-cli/src/claude/utils/systemPrompt.test.ts`
- Modify: `packages/happy-cli/src/api/sendFileEvent.test.ts`
- Delete: `packages/happy-cli/src/claude/utils/browserStepTool.test.ts`
- Delete: `packages/happy-cli/src/browser/browserStepReportingPrompt.ts`
- Delete: `packages/happy-cli/scripts/capture-browser-step.mjs`
- Delete: `packages/happy-cli/scripts/capture-browser-step.test.mjs`
- Modify: `packages/happy-app/sources/components/ConversationActivityStrip.tsx`
- Modify: `packages/happy-app/sources/components/ConversationTranscript.tsx`
- Delete: `packages/happy-app/sources/components/BrowserProgressContext.tsx`
- Delete: `packages/happy-app/sources/components/SkillBrowserProgress.tsx`
- Delete: `packages/happy-app/sources/components/rightPanel/BrowserStepsPanel.tsx`
- Delete: `packages/happy-app/sources/components/rightPanel/BrowserStepsPopover.tsx`
- Delete: `packages/happy-app/sources/components/rightPanel/browserStepRunsModel.ts`
- Delete: `packages/happy-app/sources/components/rightPanel/browserStepsModel.ts`
- Delete: related browser-progress test files and test-only mocks
- Modify: `packages/happy-app/sources/components/SessionImageViewer.tsx`
- Modify: `packages/happy-app/sources/utils/taskResourceEvents.ts`
- Modify: `packages/happy-app/sources/components/rightPanel/sessionCapabilityHubModel.test.ts`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/ca.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/es.ts`
- Modify: `packages/happy-app/sources/text/translations/it.ts`
- Modify: `packages/happy-app/sources/text/translations/ja.ts`
- Modify: `packages/happy-app/sources/text/translations/pl.ts`
- Modify: `packages/happy-app/sources/text/translations/pt.ts`
- Modify: `packages/happy-app/sources/text/translations/ru.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hant.ts`
- Delete: `packages/happy-app/sources/text/browserProgressTranslations.test.ts`

**Interfaces:**
- The CLI MCP bridge and Claude HTTP MCP server expose no `report_browser_step` tool.
- Codex/Claude prompts no longer inject browser screenshot/reporting instructions.
- The activity strip retains ordinary Skill/subagent status rows but has no browser-progress action.
- Transcript rendering no longer creates a browser-progress context or hides new browser-step events through the removed projection; legacy protocol parsing remains in Task 5.

- [ ] **Step 1: Remove the CLI tool, prompt injection, capture script, and permission entries**

  Remove the tool registration and tool-name entries from both MCP server paths, remove browser prompt imports/injection and the Codex first-turn state/options, remove auto-approval entries, and delete the capture helper/script/tests. Preserve the other Happy tools (`send_image`, `send_file`, previews, finance, title, archive).

- [ ] **Step 2: Remove the app browser-progress projection and presentation**

  Remove `SkillBrowserProgress` from `ConversationActivityStrip` while preserving status rendering; remove the context/provider, browser-run memoization, and linked-message filtering from `ConversationTranscript`; delete the dedicated browser progress components/models and update tests to cover ordinary activity/transcript behavior only.

- [ ] **Step 3: Remove screenshot-only comments/resource behavior**

  Remove the browser-step-specific comment from `SessionImageViewer` and the browser-step suppression branch from `taskResourceEvents` only if no remaining code needs that branch; otherwise retain it as an explicit legacy compatibility filter with a comment explaining that no new events are emitted.

- [ ] **Step 4: Run focused CLI/app checks**

  Run:

  ```bash
  pnpm --filter @wangjs-jacky/paws exec vitest run src/codex/happyMcpBridgeTools.test.ts src/codex/codexPrompt.test.ts src/claude/utils/systemPrompt.test.ts
  pnpm --filter happy-app exec vitest run sources/components/ConversationActivityStrip.test.tsx
  ```

  Expected: tests that describe the removed feature are deleted or rewritten, remaining tests pass, and no runtime import points to the deleted modules.

### Task 5: Preserve legacy wire/API parsing and remove dead active references

**Files:**
- Keep unchanged unless typecheck proves otherwise: `packages/happy-wire/src/sessionProtocol.ts`, `packages/happy-wire/src/publicSessionShare.ts`, `packages/happy-cli/src/api/types.ts`, `packages/happy-app/sources/sync/typesRaw.ts`, `packages/happy-app/sources/sync/publicSessionSnapshot.ts`, `packages/happy-app/sources/components/tools/views/FileView.tsx`.
- Modify only if required to remove active producers or broken imports; update tests that assert active browser presentation, not historical parsing.

**Interfaces:**
- Historical `source: 'browser_step'` and `browserStep` metadata remain accepted and serializable.
- No CLI or app code creates a new browser screenshot event or exposes a browser screenshot control.

- [ ] **Step 1: Search for active references**

  Run:

  ```bash
  rg -n --glob '!**/imageStyleCatalog.ts' "requestScreenshot|registerScreenshot|captureScreenshot|report_browser_step|captureVerifiedBrowserStep|BrowserProgressContext|SkillBrowserProgress|BrowserStepsPopover|BrowserStepsPanel|getBrowserStepRuns|hideLinkedBrowserSteps" packages/happy-app packages/happy-cli
  ```

  Expected: only intentionally retained legacy parsing/type references remain; there are no imports, registrations, prompt instructions, or UI render paths.

- [ ] **Step 2: Run package typechecks and targeted regression tests**

  Run:

  ```bash
  pnpm --filter @slopus/happy-wire run typecheck
  pnpm --filter @wangjs-jacky/paws run typecheck
  pnpm --filter happy-app exec vitest run sources/sync/typesRaw.spec.ts sources/sync/publicSessionSnapshot.test.ts sources/components/AttachmentGalleryView.test.tsx sources/components/FileView.test.tsx
  ```

  Expected: exit code 0, including historical browser-step parsing coverage where applicable.

### Task 6: Final verification

**Files:** None beyond the changes above.

- [ ] **Step 1: Inspect the diff and root isolation**

  Run:

  ```bash
  git -C /Users/jacky/jacky-github/happy--remove-capture-tools diff --check
  git -C /Users/jacky/jacky-github/happy--remove-capture-tools status --short
  git -C /Users/jacky/jacky-github/happy status --short
  git -C /Users/jacky/jacky-github/happy rev-parse HEAD
  git -C /Users/jacky/jacky-github/happy rev-parse origin/main
  ```

  Expected: no whitespace errors; root remains clean and aligned with `origin/main`.

- [ ] **Step 2: Run final package verification**

  Run:

  ```bash
  pnpm --filter @slopus/happy-wire run typecheck
  pnpm --filter @wangjs-jacky/paws run typecheck
  pnpm --filter happy-app run typecheck
  pnpm --filter happy-app exec vitest run sources/components/MessageComposer.screenshot.test.tsx sources/components/ConversationActivityStrip.test.tsx sources/sync/typesRaw.spec.ts
  ```

  Expected: all commands exit 0; final report distinguishes code/test verification from any unrun visual/manual check.
