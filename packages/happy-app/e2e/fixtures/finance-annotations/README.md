# Finance annotation browser acceptance

Start from the worktree root:

```sh
node packages/happy-app/e2e/fixtures/finance-annotations/serve.mjs
```

Open `http://127.0.0.1:49819/?theme=light` through Ego only. This isolated fixture
imports the real FinanceChartCard, parser, React Native Web, SVG, Gesture Handler
and Reanimated. Only Unistyles is adapted to a static theme using the actual
`caramelLight`/`ginghamDark` tokens. Data is explicitly synthetic. It does not test
chat transport, authentication, native Android or server data acquisition.

Create one Ego task space, record its numeric ID and p1 targetId. Prepend
`globalThis.financeAcceptanceConfig = {...};` to `verify.ego.mjs` and pipe that
combined source to `ego-browser nodejs`. Config keys:

- `spaceId`, `targetId`, `sessionId`, `runId`: explicit current ownership/evidence identifiers
- `url`: exact local fixture URL
- `width`, `height`: viewport (1280×900, 390×844 and 320×844)
- `output`: new absolute directory for sampled interaction frames/results
- `case`: descriptive case name

Cases: light/dark annotation display, five candle selections, horizontal drag,
no page overflow or JS errors, and `?theme=dark&case=legacy` without annotations.
`result.json` references the private verified screenshot, which must be reported
once via Happy report_browser_step. Frames are CDP samples taken after actual
browser actions, not a continuous screencast; label any compiled video accordingly.
The capture helper path is environment-specific and must use the current session's
provided helper, not an inferred path.

In this run, Ego CDP touch events also verified tap (candle 2) and horizontal swipe
(candle 4) at 390px. This is browser touch emulation, not a native device test.

Regression discovered: SVG uses default xMidYMid meet at fixed 170px height.
Wide cards have centered horizontal gutters, so selection must subtract the gutter
and divide by SVG scale. `financeChartInteraction.test.ts` now protects this case.
