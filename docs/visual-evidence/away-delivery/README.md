# Away-from-computer delivery acceptance

Base: b1551cf94f582247ece2639d733a5cce7dacb225. Before: no global delivery setting or composer phone control. Existing design overlays are not implementation evidence; no matching before screenshots were retained.

Actual implementation tested through Ego task space 133 against an isolated authenticated local server and Expo build. No production account, daemon or Cloudflare credentials were modified.

| Case | Evidence / result |
| --- | --- |
| Composer icon opens settings without toggling | Actual browser pass; component test |
| Enable, refresh, edit appearance, revisit | Actual browser pass; settings serialization regression test |
| Mobile bottom sheet, desktop centered panel | `mobile-after.png` (430×932), `desktop-after.png` (1280×900), Gingham dark; independent visual review pass |
| Server hosting unavailable | Actual browser: disabled hosted choice with reason; configuration navigation pass |
| Credential check/auth error/network error/generation race | Server route and store tests; no live provider credentials used |
| Failed publish retry / explicit one-time tunnel | Component and CLI tests; no live agent retry executed |
| Per-message enable/disable and explicit mode | Prompt tests; live model compliance not tested |

`mobile-interaction.mp4` records actual Ego/CDP frames during opening the panel, switching off/on, and opening configuration. Sampled capture encoded at 3 fps; elapsed timing is condensed. H.264/yuv420p MP4 fully decoded successfully and sent as a Happy playable card. Playback on the user's device has not been confirmed.

No real Cloudflare publication, native Android device, or two-device synchronization was exercised. Server and CLI changes require their normal deployment/update; frontend OTA alone cannot install those components.
