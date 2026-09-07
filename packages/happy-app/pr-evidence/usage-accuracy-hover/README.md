# Usage accuracy and hover evidence

- Case: `[USAGE-POPUP-01]`
- Visible UI cases: 1
- Viewport: 1280 × 900, DPR 1, `zh-CN`, dark color scheme
- Environment: isolated local Server/Web account; no production connection and no model call
- Fixture: the current session belongs to a PRO machine with 35% used, while a newer unrelated PLUS machine reports 0% used

## Before

`case-1-before.png` was captured from the PR merge base (`7ca7f3278c2f6f667b86938ce28d9f7c1fe4484e`) with the same E2E fixture. It demonstrates the regression: the dialog chooses the unrelated machine and shows `100% / PLUS`, formats the day as `625.51M 个令牌`, and does not react to hovering the previous day.

## After

`case-1-after.png` was captured after hovering `2026-09-05` without clicking. The dialog shows the current session machine's `65% / PRO` quota and switches the day summary to `2.40 亿 token · 12 个会话`. Before hover, the same Case asserts the current day summary is `6.26 亿 token · 86 个会话`.

`usage-accuracy-hover-acceptance.mp4` is the passing After run. It is H.264/yuv420p/faststart, 1280 × 720, 25 fps, 25.80 seconds, with no audio. `ffprobe`, full-file decode, and full-duration contact-sheet inspection passed.

## Reproduce

```bash
HAPPY_E2E_WEB_START_TIMEOUT_MS=900000 \
HAPPY_E2E_SKIP_CLI_BUILD=1 \
HAPPY_USAGE_POPUP_EVIDENCE_PHASE=after \
HAPPY_USAGE_POPUP_EVIDENCE_DIR="$PWD/packages/happy-app/pr-evidence/usage-accuracy-hover" \
pnpm test:e2e:web -- e2e/sidebar-account-usage-evidence.spec.ts --grep '\[USAGE-POPUP-01\]'
```

Add `HAPPY_E2E_RECORD=1` to repeat the same Case with Playwright recording.
