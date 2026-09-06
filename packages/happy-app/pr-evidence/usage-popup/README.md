# Usage popup visual evidence

Visible UI cases: 1

## Case 1 — account-menu usage opens in a dialog

- Before source: `75e879e4aac6fa6352a00d4f3deb75667ae6af97`
- Before: selecting **使用情况** navigates away to `/settings/usage`.
- After: selecting **使用情况** closes the account menu and opens an in-place dialog while preserving the current URL.
- Shared conditions: 1280 × 900 viewport, DPR 1, `zh-CN`, dark color scheme, `ginghamDark`, deterministic PLUS quota with 63% remaining.
- Interaction checks: menu rest/hover/pressed surfaces, one named modal owner, complete URL preservation, focus loop, non-tabbable backdrop, theme-pack close-control rest/focus/hover/pressed colors, close-button/backdrop/Escape dismissal, and focus return to the account trigger.

## Artifacts

- `case-1-before.png`
- `case-1-after.png`
- `usage-popup-e2e.mp4` — 1280 × 720, 25 fps, H.264/yuv420p/faststart, 20.40 seconds; full decode passed.

## Reproduction

```bash
HAPPY_E2E_WEB_START_TIMEOUT_MS=900000 \
HAPPY_E2E_SKIP_CLI_BUILD=1 \
HAPPY_E2E_RECORD=1 \
HAPPY_USAGE_POPUP_EVIDENCE_PHASE=after \
HAPPY_USAGE_POPUP_EVIDENCE_DIR=<output-dir> \
pnpm test:e2e:web -- \
  e2e/sidebar-account-usage-evidence.spec.ts \
  --grep '\[USAGE-POPUP-01\]'
```

The Case creates a temporary encrypted machine usage snapshot in the isolated E2E environment and deletes it in `finally`; it does not touch production data.
