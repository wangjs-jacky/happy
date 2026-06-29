---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: App TXT Code Block Horizontal Scroll Fix
created_at: 2026-06-29
branch: fix/txt-horizontal-scroll
---

## Goal Capsule

- **Objective:** Fix App chat/console rendering for fenced `txt` blocks so users can drag the block's internal horizontal scroll area without the surrounding page jumping.
- **Authority:** User report and screenshot are the product source; `CLAUDE.md` branch/PR rules govern repo workflow; existing `MarkdownView`/`HorizontalScrollView` patterns govern implementation.
- **Execution profile:** Lightweight bug fix in `packages/happy-app`; no protocol, daemon, server, or content-generation changes.
- **Stop conditions:** Stop if the issue is caused by native platform gesture infrastructure outside Markdown/code block rendering and cannot be fixed locally without a broader navigation gesture redesign.

## Product Contract

### Summary

The App currently renders agent-returned `txt` content as a fenced code block with an internal horizontal scrollbar, but tapping or dragging inside the block does not reliably move that internal scrollbar and can instead move the outer chat page.

### Problem Frame

The broken behavior appears in the mobile session view when a wide plain-text/code block is embedded in an assistant message. The block visually indicates horizontal overflow, but user interaction is captured by surrounding Markdown long-press handling, parent vertical scrolling, or drawer/page gestures instead of by the code block's own horizontal scroll view.

### Requirements

- R1. Wide fenced `txt`/code blocks in chat messages must allow horizontal drag/scroll inside the block.
- R2. Interacting with the block's horizontal scroll region must not cause the outer session page to jump unexpectedly.
- R3. Existing Markdown behaviors must continue to work: normal text selection/copy behavior, long-press copy routing where enabled, copy button, tables, and links.
- R4. The fix must remain local to App message/code block rendering unless investigation proves the shared horizontal scroll component needs a narrowly scoped enhancement.

### Acceptance Examples

- AE1. Given an assistant message containing a long `txt` fenced code block, when the user drags horizontally inside the block, then the block content moves horizontally and the page stays vertically stable.
- AE2. Given the same message, when the user scrolls vertically outside the block, then the session page still scrolls normally.
- AE3. Given a Markdown table or normal Markdown text, when the user interacts with it, then existing table horizontal scrolling and Markdown copy/link behavior are unchanged.

### Scope Boundaries

- In scope: chat Markdown code blocks, shared horizontal scroll behavior if needed, and focused regression tests/type checks.
- Out of scope: server-side text generation, daemon output formatting, file viewer editor behavior, visual redesign of code blocks, or replacing the Markdown renderer.

## Planning Contract

### Key Technical Decisions

- KTD1. Treat the screenshot's `txt` panel as a Markdown fenced code block path: `MessageView` renders `MarkdownView`, which maps `code-block` to `RenderCodeBlock`, which wraps `SimpleSyntaxHighlighter` in `HorizontalScrollView`.
- KTD2. Preserve the shared `HorizontalScrollView` abstraction instead of adding ad hoc scroll views in Markdown. This component already owns web wheel-axis locking and native drawer gesture contention.
- KTD3. Isolate code block touch handling from the Markdown-level long-press wrapper. The current mobile `GestureDetector` wraps the entire Markdown tree; code blocks need a way to keep their horizontal pan from being treated as parent long-press/page interaction.
- KTD4. Prefer behavior tests for reusable gesture/prop helpers and TypeScript validation over brittle full native gesture automation, unless the repo already has a practical simulator/browser harness for this exact interaction.

### Existing Patterns

- `packages/happy-app/sources/components/markdown/MarkdownView.tsx` renders code blocks and tables through `HorizontalScrollView`.
- `packages/happy-app/sources/components/HorizontalScrollView.tsx` already handles web wheel scroll and native drawer gesture priority when horizontal overflow exists.
- `packages/happy-app/sources/components/SimpleSyntaxHighlighter.tsx` preserves code text shape and should not be responsible for gesture ownership.

### Implementation Sequence

1. Confirm the code block is inside the Markdown long-press wrapper on native and that the child `HorizontalScrollView` lacks any explicit relationship with that wrapper gesture.
2. Add the smallest API needed for nested horizontal scroll regions to opt out of or coordinate with the Markdown long-press wrapper.
3. Apply the API in `RenderCodeBlock` while keeping table behavior unchanged unless the same issue is demonstrably shared.
4. Add focused coverage for any new helper/prop behavior and run App validation commands.

## Implementation Units

### U1. Code block gesture isolation

- **Goal:** Make `RenderCodeBlock`'s horizontal scroll area win horizontal drags and avoid causing the parent Markdown/page scroll to jump.
- **Requirements:** R1, R2, R3.
- **Files:** `packages/happy-app/sources/components/markdown/MarkdownView.tsx`, optionally `packages/happy-app/sources/components/HorizontalScrollView.tsx`.
- **Approach:** Wire code block horizontal scroll through the shared component with gesture coordination that disables or blocks conflicting parent gestures only for overflowing horizontal content. Keep non-code Markdown and table rendering behavior stable.
- **Test Scenarios:** Wide `txt` block drag scrolls internally; tap/long press on regular Markdown still opens existing copy flow; table scroll remains unchanged.
- **Verification:** `cd packages/happy-app && pnpm typecheck`.

### U2. Regression coverage for Markdown/code block rendering contract

- **Goal:** Guard the code block path that renders `txt` content into a horizontal scroll region.
- **Requirements:** R1, R3, R4.
- **Files:** Existing tests under `packages/happy-app/sources/components/markdown/` or a focused new test near any extracted helper.
- **Approach:** Add a narrowly scoped test around any pure helper introduced for gesture/scroll props or parser/render routing, avoiding brittle native gesture simulation.
- **Test Scenarios:** A fenced `txt` block remains a `code-block` with language `txt`; helper/prop behavior preserves default table behavior while enabling code block-specific gesture isolation if a helper is added.
- **Verification:** `cd packages/happy-app && pnpm test -- --run <focused-test-file>`.

## Verification Contract

| Check | Command | Covers |
|---|---|---|
| Focused App tests | `cd packages/happy-app && pnpm test -- --run <focused-test-file>` | U2 |
| App typecheck | `cd packages/happy-app && pnpm typecheck` | U1, U2 |
| Manual behavior check | Open a session with a wide fenced `txt` block and drag inside the block on mobile | R1, R2, AE1, AE2 |

## Definition of Done

- The plan is implemented on `fix/txt-horizontal-scroll`.
- A wide `txt` fenced code block can be horizontally scrolled from inside the block.
- Tapping or dragging inside that block no longer jumps the outer page.
- Existing Markdown text, links, copy behavior, and table horizontal scrolling remain intact.
- Focused tests and App typecheck complete or any inability to run them is documented.
