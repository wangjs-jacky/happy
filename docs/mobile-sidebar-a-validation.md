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
| A6 | Existing desktop navigation and theme tokens remain intact. | Desktop regression tests pass; Ego 1440px retained 60px rail/three session tabs/nowrap titles; ginghamDark rail rgb(18,24,33) and selected surface rgb(31,42,56) verified |

Independent code review: PASS, including follow-up fixes for native account-menu touch bounds, small-screen bulk-toolbar overflow and direct drawer-navigation close handling.

Independent Mobile Web visual review: PASS, including two-line titles (desktop-only marquee CSS), all three tabs, advisor history and 320px bulk toolbar.

Local verification: `pnpm --filter happy-app typecheck` passed; eight targeted test files / 65 tests passed, including the OTA runtime contract. Existing react-test-renderer deprecation/act warnings remain in the organization suite.

Ego used an isolated `authenticated-empty` environment, 35 synthetic encrypted sessions and a local-only installed advisor fixture. No real-account session mutations or provider requests. Evidence is in `/Users/jacky/Downloads/paws-mobile-sidebar-a-20260907/`.

Native verification: no Android device attached. Preview OTA is the handoff for device testing; verify account-menu actions/cancel/system-back, drawer close and multi-selection. Advisor-history scroll position after leaving that panel is not retained; ordinary view positions are retained. Composer persistence was not rewritten.

Video: [18.5-second acceptance recording](evidence/mobile-sidebar-a/acceptance.mp4), H.264 / 390×844 / 30fps / 555 decoded frames / faststart. Entire stream decoded successfully; overview and case-specific frames inspected for visibility and synthetic-only data. Sent to Happy as a playable media card; actual playback on the user's phone has not been confirmed.

Video timeline: 0–4s Projects / Lists / Timeline; 4–8.6s scroll and restoration; 8.6–11.4s advisor history and return; 11.4–12.8s ordinary history; 12.8–15.7s account menu; 15.7–18.5s close and reopen drawer.

After screenshots: [390px ginghamDark](evidence/mobile-sidebar-a/mobile-390.png), [320px light](evidence/mobile-sidebar-a/mobile-320.png). Screenshots follow the user-approved A design scope, not an expanded full-site matrix.

Additional theme-pack suite: 3 tests passed (68 targeted tests total).

Preview OTA: Android / runtime 23 / stamp `1788754202845` / Update ID `76d11487-a4eb-2a97-8640-42bf535c1aad`, built from commit `6b4e6f91`. [Manifest](https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/23/preview/1788754202845.json) returned HTTP 200; the downloaded 37,046,358-byte launch asset matched its SHA-256 hash. Published using `--skip-latest`, so no production or shared preview-latest pointer changed. Choose the named version explicitly in the preview app's OTA Versions screen.
