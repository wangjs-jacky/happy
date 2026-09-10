# Ego Skills progress regression fixture

Run from `packages/happy-app` after `pnpm install`:

```sh
node sources/trash/ego-browser-progress/build.mjs
```

Open `http://127.0.0.1:4388/` with Ego. The server binds only to loopback, builds
in memory, and reads no Happy authentication or real session data. Stop with
Ctrl-C. This is a local test fixture, not a published preview.

The fixture renders the production `ConversationActivityStrip`, browser-run
projection, `SkillBrowserProgress`, and steps popover/panel with React Native
Web. Authentication-dependent image loading, icons, safe area, Unistyles, and
the fullscreen image viewer are controlled boundaries. It uses synthetic
sessions/images and production ginghamDark colors/Chinese copy.

## Cases

| Case | Action | Expected |
| --- | --- | --- |
| Skills entry | Open run-1 progress from Skills | Two A steps, no standalone chat screenshots |
| Task isolation | Close and open run-2 | Only the other task result |
| Follow-up | Add step, reopen run-1 | Third step in the original run |
| Session isolation | Switch session while progress is open | Old modal closes; reopening shows B steps only |
| Narrow layout | Repeat at 390 x 844 CSS pixels | Dialog stays within viewport; controls remain visible |

Stable test IDs are `browser-progress-trigger-run-1`,
`browser-progress-trigger-run-2`, `browser-steps-popover-close`, `add-step`,
`switch-session`, and `current-session`.

The production fullscreen gallery and transcript integration are covered by
`BrowserStepsPopover.test.tsx`, `BrowserStepsPanel.test.tsx`, and
`ConversationTranscript.browserProgress.integration.test.tsx`. The fixture does
not prove production authentication, encrypted attachment delivery, native
gestures, native safe areas, or an installed phone build.
