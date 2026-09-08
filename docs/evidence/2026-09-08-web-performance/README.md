# Web performance regression evidence

Baseline: `48b4aa5f73212110873bb40f4317fcd84410702f`.
Environment: isolated local encrypted Happy server, synthetic sessions, fake machine RPC; no real model/CLI launches or production account changes. Browser: Ego, 1440×900 CSS pixels, DPR 1.

## Verified cases

| Case | Observation | Evidence |
| --- | --- | --- |
| Long sidebar | Fully loaded synthetic 1,000-session account: baseline mounted 1,000 session rows / 16,296 DOM nodes; candidate initial 38 / 981. Real deep scrolling and exact session click passed; complete traversal reached session 0000. This is not an API/bootstrap loading benchmark. | [Before](sidebar-before.png), [After](sidebar-after.png) |
| Draft editing | 25 real input events resulted in first-nonempty save plus one debounce save; final text survived immediate navigation and did not leak into the next session. Final replay selected exact session 0946 after real sidebar scrolling, with 53 mounted rows, and verified 25 events / 2 writes. CDP IME composition/commit matched persisted text; native OS candidate UI was not exercised. | [Video](sidebar-draft.mp4), [measured result](video-sidebar-draft-result.json) |
| History retention | Explicit paging and live append use max 500 wire records / approximate 8 MiB encrypted payload budget. Frozen 2,000-event burst: 66 samples at 250 ms, max 485 wire records, no sampled missing text, preserved reading offset; latest reached server sequence 6000. | Sync regression tests |
| Image continuity | Valid encrypted fixture: 600 wire records, 150 file events, one reused encrypted PNG. Prepend from 100 to 500 records: 120 samples at 50 ms, same loaded image node/source, zero load events, exact user-wheel displacement; latest navigation and subsequent 5-second stability passed. | [Video](history.mp4) |
| First submission | Baseline composer retains submitted prompt during simulated eight-second machine startup. Candidate releases the composer and shows original text in a starting card. Final isolated test observed release after 22.5 ms, duplicate click invokes submission once, and later draft survives navigation. Failure restore/refresh and interruption recovery passed without automatic resend. | [Before](send-before.png), [After](send-after.png), [Video](first-submission.mp4), [recovery](first-submit-recovery.json) |
| Non-wheel history navigation | Real PageUp input (no wheel) loaded an older window, 548–600 → 249–600. Visible reading offsets stayed stable after paging; final replay browsed by keyboard then returned to the measured tail. | [Video](history-keyboard.mp4), [reading samples](history-keyboard-final.json) |

## Limits

- First-send Before/After use matching viewport, prompt and simulated delay but different themes (light Before, dark After). They demonstrate submission behavior, not a controlled color/style comparison.
- The byte budget bounds encrypted wire payload, not total renderer memory, decrypted/reducer expansions, pending overlays, image decode buffers or transient work.
- The actual Chrome crash code is unknown; these tests do not prove the reported crash was OOM or eliminate every possible memory leak.
- Sampling cannot establish zero bad frames between samples, and these short tests are not an hour-long soak.
- Development reload samples were not a controlled production benchmark: baseline 14.4 s / 9.7 s and candidate 13.1 s to message DOM, with large Metro route-bundle download/compile variation. No initial-load speedup is claimed from those numbers.
- First-submission timings are one isolated development sample with an intentionally delayed fake machine, not production startup percentiles. The short local-save time does not imply the actual CLI/model starts in that time.
- The bounded Web transcript adapter depends on react-native-web 0.21.2 internals. Its real-vendor/Babel-boundary regression and browser continuity cases are dependency-upgrade gates; native remains on its original FlatList.

`history.mp4`: H.264, yuv420p, 1440×900, 30 fps, 13.27 seconds, faststart. Full decode and duration-spanning visual review passed; delivered through Happy's playable media card. Device playback was not independently confirmed by the user.

Final replay media (all H.264/yuv420p, 1440×900, 30 fps, faststart; full decode and duration-spanning frame review passed; all sent through Happy):

| File | Duration | Bytes | Case |
| --- | --- | --- | --- |
| sidebar-draft.mp4 | 9.40 s | 375119 | C1–C2 |
| history-keyboard.mp4 | 6.23 s | 511925 | C3 non-wheel follow-up |
| first-submission.mp4 | 16.83 s | 1224409 | C4 |

See [validation record](validation.md) for exact commands and development-only timing limits. [Independent interaction acceptance](interaction-review.md) passed C1–C4 in scope and approved C5's honest evidence boundary; production speedup remains unproven. PR/CI status is tracked on the pull request.
