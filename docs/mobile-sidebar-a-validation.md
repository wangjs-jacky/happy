# Mobile sidebar A

Base: `3cb7d9f09306d8391f86cceb50eb97f53df3ae1e`

Implementation branch: `feat/mobile-sidebar-a`. No production deployment or merge.

| Case | Acceptance | Evidence/status |
| --- | --- | --- |
| A1 | Phone drawer fits 320–480px widths; labeled 56px rail scrolls independently, account remains available. | Unit tests pass; Ego 320×640 and 390×844 pass; 320px bulk toolbar buttons are ~58.7×44 within a 216px toolbar |
| A2 | Projects, Lists, Timeline remain separate first-class views; history is available without replacing a tab. | 12 organization tests pass; Ego tab switching pass |
| A3 | Installed advisor has its own history; Back returns to ordinary sessions without leaving current chat. | Unit + Ego pass: opening history leaves route unchanged; selecting a conversation navigates |
| A4 | New, activity, search, marketplace, My Agents and account retain their existing actions; Agent workspace retains exit. | Unit tests pass; Ego new-session, Agents, account/settings paths pass; native touch verification pending |
| A5 | Each ordinary list restores scroll position; selected session is highlighted on phone; composer draft storage is unchanged. | Hook tests pass; Ego timeline 600px → Lists → timeline restored 600px; title measured 40px with two-line clamp at 320px |
| A6 | Existing desktop navigation and theme tokens remain intact. | Desktop regression tests pass; no hardcoded interaction colors added |

Independent code review: PASS, including follow-up fixes for native account-menu touch bounds, small-screen bulk-toolbar overflow and direct drawer-navigation close handling.

Independent Mobile Web visual review: PASS, including two-line titles (desktop-only marquee CSS), all three tabs, advisor history and 320px bulk toolbar.

Local verification: `pnpm --filter happy-app typecheck` passed; eight targeted test files / 65 tests passed, including the OTA runtime contract. Existing react-test-renderer deprecation/act warnings remain in the organization suite.

Ego used an isolated `authenticated-empty` environment, 35 synthetic encrypted sessions and a local-only installed advisor fixture. No real-account session mutations or provider requests. Evidence is in `/Users/jacky/Downloads/paws-mobile-sidebar-a-20260907/`.

Native verification: no Android device attached. Preview OTA is the handoff for device testing; verify account-menu actions/cancel/system-back, drawer close and multi-selection. Advisor-history scroll position after leaving that panel is not retained; ordinary view positions are retained. Composer persistence was not rewritten.

Video and preview OTA delivery pending. Screenshots follow the user-approved A design scope, not an expanded full-site matrix.
