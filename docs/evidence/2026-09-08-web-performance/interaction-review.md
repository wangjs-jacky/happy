# Independent interaction acceptance

Product revision: `e448350d`. Verdict: scoped pass; no confirmed product regression. An independent PC interaction reviewer used Ego against the isolated synthetic environment after code review and controller E2E passed.

| Case | Independent observation | Evidence boundary |
| --- | --- | --- |
| C1 sidebar | Real pointer selected session 0945; route and heading agreed; no persistent overlapping rows or blank window. | Thousand-row traversal and mounted-row counts are controller evidence, not a second independent full traversal. |
| C2 input | Exact keyboard-inserted draft was visible; later compose draft survived successful first-message navigation. | Per-character save counts and composition checks are controller evidence; no native OS IME candidate panel claim. |
| C3 history | 17 real PageUp keys crossed image history; settled scroll geometry stayed identical over 2.2 seconds. A real pointer latest-button click reached the measured bottom and dismissed the button. | Wire budgets and same-image-node continuity rely on controller samples/tests; no hour-long soak or zero-intermediate-frame claim. |
| C4 first submission | At 1024×768, submitted text appeared in starting card and composer emptied; newer text stayed editable and survived navigation. Reload during a 12-second synthetic spawn showed interrupted recovery; confirmed Restore returned exact text with durable recovery retained. | Fake machine only; not real model/CLI startup percentiles. Duplicate-click and explicit RPC-failure tests are controller evidence. |
| C5 loading | Documentation accurately separates development Metro compilation timings from production performance. | Production initial-load speedup and original Chrome crash causality remain unproven. |

Dark-state checks at 1024×768, 1280×720, 1440×900 and 1920×1080 (DPR 1) found visible card text, progress/recovery action, composer and send control, without measured horizontal document overflow. This was not a full-site or exhaustive accessibility review.

First-send Before is light theme and After dark theme. Matching viewport/prompt supports behavioral comparison only, not a controlled color/style comparison. Media decode and delivery were checked by the controller, not repeated by this reviewer.

Unverified loading, focus and helper-click attempts were not counted as passes. Final browser state was independently verified at the actual history tail and reported through Happy. No production account or daemon changes were made.
