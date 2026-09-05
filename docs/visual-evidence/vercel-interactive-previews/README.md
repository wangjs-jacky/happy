# Vercel interactive previews — PC Web evidence contract

Visible UI cases: 3

Evidence is intentionally **pending** until the isolated build is exercised with Ego. The repository may contain an older exploratory screenshot, but it is not accepted as a final Before/After pair. Do not claim visual verification until every filename below exists, uses the stated viewport/theme, and has been inspected.

| Case | Problem | Before filename | After filename | Required states and interactions |
|---|---|---|---|---|
| 1 — Vercel settings | Happy had no account-scoped managed preview connection UI. | `case-1-vercel-settings-before.png` | `case-1-vercel-settings-after.png` | unavailable, disconnected, connect popup callback without page reload, connected team/project, reconnect, one-shot error + retry, disconnect confirmation, cleanup warning |
| 2 — Preview chat card | Typed preview lifecycle results had no dedicated read-only card. | `case-2-preview-cards-before.png` | `case-2-preview-cards-after.png` | publishing, ready, failed, expired; exactly one safe open/copy action pair; external open; clipboard copy; no iframe, input, form, or callback |
| 3 — Ego run progress | Browser steps replaced or monopolized the capability panel. | `case-3-ego-popover-default-before.png` | `case-3-ego-popover-default-after.png` | capability summary remains available; Skill detail exposes two distinct run triggers; pointer and keyboard activation; Escape close and trigger-focus restore; 12-step internal scroll |
| 3 — Ego run progress (`ginghamDark`) | The same progress UI must use semantic dark-theme surfaces. | `case-3-ego-popover-ginghamDark-before.png` | `case-3-ego-popover-ginghamDark-after.png` | same Case 3 behavior in the non-default dark theme; normal, selected, and modal surfaces must not retain caramel colors |

## Capture dimensions

- Primary comparison viewport: **1440×900**, device scale factor 1.
- Boundary check: **1024×768**. The Ego popover must stay at least 12 px from every viewport edge and scroll internally.
- Before and After images for each row must use identical viewport, route, theme, open surface, and crop.
- The default and `ginghamDark` rows are both mandatory for Case 3; they do not increase `Visible UI cases` beyond 3.

## Deterministic local fixture for Ego

The fixture never contacts Vercel, OSS, or a real account. It runs only in a non-production build when all three gates are present: `EXPO_PUBLIC_HAPPY_E2E_FIXTURES=1`, `dev_token`, and `dev_secret`. Production builds ignore the fixture parameter.

From the feature worktree:

```bash
EXPO_PUBLIC_HAPPY_E2E_FIXTURES=1 pnpm env:up:authenticated
pnpm exec tsx packages/happy-app/e2e/fixtures/vercel-interactive-previews/seed.ts
```

The second command prints JSON containing:

- `sessionUrl`: open this exact URL in Ego for the four preview cards and the two Ego runs.
- `settingsUrl`: open this exact URL in Ego for the disconnected Settings state.
- `sessionId`: deterministic fixture session identifier for diagnostics.

Do not copy the printed authenticated URLs into PR text, reports, screenshots, or logs; they contain short-lived local development credentials.

Settings state switches keep the printed origin and auth query intact and change only `happy_preview_fixture`:

| State | Query value |
|---|---|
| unavailable operator | `happy_preview_fixture=unavailable` |
| disconnected + real same-origin popup callback | `happy_preview_fixture=disconnected` |
| connected team/project | `happy_preview_fixture=connected` |
| first request fails, Retry becomes disconnected | `happy_preview_fixture=error-once` |
| connected, then disconnect shows cleanup warning | `happy_preview_fixture=disconnect-warning` |

For Case 3, open `sessionUrl`, verify `[data-testid="capability-hub-summary"]`, enter `[data-testid="capability-block-skills"]`, and use:

- `[data-testid="browser-progress-trigger-ego-fixture-run-1"]` (12 steps, long-scroll fixture)
- `[data-testid="browser-progress-trigger-ego-fixture-run-2"]` (3 steps, independent repeated run)
- `[data-testid="browser-steps-popover"]`
- `[data-testid="browser-steps-timeline-scroll"]`

Switch to **Settings → Appearance → Gingham** with dark color scheme for the `ginghamDark` capture. Stop and remove the isolated environment after evidence capture:

```bash
pnpm env:down
pnpm env:current
# Pass the environment name shown by the seed JSON:
pnpm env:remove <environment-name>
```

## Automated specification

`packages/happy-app/e2e/vercel-preview-evidence.spec.ts` mirrors these three Cases and uses the same fixture data and stable selectors. It must only be executed through the repository's isolated Web E2E runner when browser automation is permitted. In the current task it was edited but deliberately not executed because repository policy requires Ego for every browser operation.
