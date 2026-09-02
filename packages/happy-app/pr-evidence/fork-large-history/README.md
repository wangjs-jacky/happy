# Fork large-history replay evidence

Case: `FORK-HISTORY-01`

The field report showed a forked Codex session taking a long time to appear and
opening with a large blank/truncated history region. The Before image is that
report, center-cropped from 1304x768 to 1280x720 so it can be compared at the
same evidence size as the automated After capture.

The After image and MP4 come from the isolated Web E2E fixture with 334 turns
(668 encrypted session envelopes). The acceptance run verifies:

- click-to-route stays below the 15-second regression ceiling;
- the latest agent turn is visible after navigation;
- the REST transcript contains exactly 668 messages with contiguous seq values
  from 1 through 668;
- backward UI pagination reaches the earliest history page (`before_seq <= 101`).

Observed click-to-route timings:

- ordinary E2E run: 3143 ms;
- recording E2E run: 4391 ms.

Artifacts:

- `case-1-before.png`: reported broken state, 1280x720;
- `case-1-after.png`: repaired large-history state, 1280x720;
- `fork-large-history-acceptance.mp4`: H.264/yuv420p, 1280x720,
  66.92 seconds.

The test environment used isolated local Server/Web/session data and was fully
stopped and removed after each run. Mobile playback was not requested.
