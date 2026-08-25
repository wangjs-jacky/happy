# PC List drag-and-drop visual evidence

Visible UI cases: 2. All screenshots were captured by the isolated Chromium
Web E2E at `1440×900`, DPR `1`, English locale, and the light theme.

- `SIDEBAR-SESSION-DROP-01`: a session moves from one List to another and then
  to Unassigned while preserving its Tags and the active conversation route.
- `SIDEBAR-LIST-REORDER-02`: a List moves before or after another List according
  to the drop half, and the new order remains after reload.

The same `[SIDEBAR-LISTS-TAGS]` Case passed in ordinary and evidence modes. Its
stable 25fps H.264/yuv420p acceptance video passed `ffprobe`, full decode, and
full-duration contact-sheet review.
