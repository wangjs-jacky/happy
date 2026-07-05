# Session Skills List Right Panel

Date: 2026-07-04
Branch: `skills-timeline-panel`
Scope: design draft only

## Goal

Fill the currently empty mobile right-swipe panel with the simplest useful view:

- one vertical list
- current session skills only
- names only

No installed-skills inventory, no timeline metadata, no status badges, no reasons, no fallback tabs.

## Design Decisions

- Keep the existing right-swipe shell and left-side conversation context.
- Make the panel read like a plain ordered stack, not a diagnostic trace.
- Use one title and one list.
- Each row shows only the skill name.
- The visual weight should come from spacing, type, and row grouping rather than extra chips or labels.

## Display Order For This Draft

Top to bottom:

1. `using-superpowers`
2. `codex-harness`
3. `using-git-worktrees`
4. `web-design-engineer`

## Why This Simpler Direction

- It matches the user's latest requirement exactly.
- It reduces implementation ambiguity for the first app version.
- It avoids inventing session-trace semantics before the UI proves useful.

## Prototype Deliverable

HTML prototype:

- `docs/prototypes/session-skills-timeline-right-panel.html`

The prototype still shows the current mobile filmstrip on the left and uses the right panel for the new skills list, so the gesture context remains visible.
