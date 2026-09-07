# Session warm-cache and pagination acceptance

All browser evidence was captured with Ego at 1440×900 against an isolated,
authenticated local environment containing only synthetic encrypted sessions.
The environment and Ego task space were removed after verification.

## Verified cases

1. `case-1-cached-revisit-pending.png`: after opening A → B → C and revisiting
   A, its encrypted cached messages remained visible while the `after_seq`
   request was deterministically delayed. `session-loading` and visible
   progress-bar counts both remained zero.
2. `case-2-mru-after-reload.png`: after touching A, opening a fourth session D,
   and reloading the app, A was restored from the three-page MRU cache. Its
   messages again remained visible while the incremental request was delayed.
3. `session-cache-acceptance.mp4`: end-to-end acceptance for cached session
   revisit and eager older-page prefetch. The H.264 recording is 1440×900 at
   15 fps and was fully decoded after encoding (221/221 frames).

The long-history case also verified that the older-page request begins about
1.5 viewports before the visual top, no progress bar replaces visible messages,
and both the oldest and newest synthetic messages are eventually present.

## Automated verification

- 11 focused test files, 168 tests passing
- `pnpm --filter happy-app run typecheck`
- `git diff --check`
- Independent Gate 2 review: PASS, no blocking findings
