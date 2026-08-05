# New-session icon tooltip acceptance evidence

## Case ledger

Visible UI cases: 1

| Case ID | Page / state | Before problem | Severity | Reproduction | Acceptance | Result |
| --- | --- | --- | --- | --- | --- | --- |
| UI-NEW-SESSION-001 | Active-session header, desktop and phone widths | The header permanently renders a generic plus icon and the “New session” label, consuming scarce header width instead of using the requested chat-plus icon with on-demand copy. | P2 | Open an active session at the recorded viewports and inspect the right-side header action. | Default state is a square chat-plus icon with no visible label; pointer hover and keyboard focus reveal the localized tooltip; phone/native stays icon-only; activation navigates to `/new`. | Passed |

## Comparable visual evidence

All captures use the real active-session page, Chrome, DPR 1, browser zoom 100%, and the viewport named in the filename. The seeded account/avatar may differ between isolated runs; the session metadata and UI state are equivalent.

| Viewport / state | Before (`main` at `f9610820`) | After |
| --- | --- | --- |
| 1280 × 720, default | `20260806-ui-new-session-001-before-1280x720.png` | `20260806-ui-new-session-001-after-default-1280x720.png` |
| 1280 × 720, hover | The label is already permanently visible in the Before capture. | `20260806-ui-new-session-001-after-hover-1280x720.png` |
| 1440 × 900, hover | `20260806-ui-new-session-001-before-1440x900.png` | `20260806-ui-new-session-001-after-hover-1440x900.png` |
| 1920 × 1080, hover | `20260806-ui-new-session-001-before-1920x1080.png` | `20260806-ui-new-session-001-after-hover-1920x1080.png` |
| 390 × 844, default | `20260806-ui-new-session-001-before-390x844.png` | `20260806-ui-new-session-001-after-390x844.png` |

## Automated acceptance

- E2E: `pnpm test:e2e:web -- --grep '活跃会话新建入口'` — passed, 1 test in 9.2 seconds.
- Component regression: `pnpm --filter happy-app exec vitest run sources/-session/SessionView.agentSpace.test.tsx` — passed, 15 tests.
- Static: `pnpm --filter happy-app typecheck` and `git diff --check` — passed.

The Playwright Harness created an `authenticated-empty` local environment and one temporary local session, then stopped its Server/Web/daemon processes and removed the environment. It did not connect to production. Native Android rendering is covered by the component test; no simulator or real-device validation was run.

## Independent baseline review

An independent screenshot-review Agent, isolated from the implementation, confirmed three P2 aspects in the old UI: the permanent text label consumed header width, the generic plus was not specific enough once compacted, and the 390 px header prioritized the repeated action over session context. These are treated as one visible product Case because they share the same control, implementation, and screenshot group. A P3 observation about the existing wide-screen header anchor was left outside this user-requested scope because the intended grouping could not be established from static evidence and the change does not alter that anchor.
