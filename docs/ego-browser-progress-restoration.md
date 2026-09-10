# Ego key-step evidence restoration

Base: `d6eae4f852c2ab3ab71ad9556c07dfeddcdce61c`.

Restore browser evidence removed by `a88f9b39`, not the manual composer camera
or desktop screenshot RPC. Key browser states appear under the corresponding
Skills row. Repeated captures remain in one task run, including Codex sessions
without an explicit Skill tool event. Transport image messages are hidden from
ordinary chat and excluded from ordinary image galleries.

## Isolation contract

- One unique run ID per browser task; never reuse across sessions, concurrent
  agents, or task spaces. Ambiguous pending Skill invocations are not guessed.
- Capture in the same Ego round after selecting the recorded numeric task
  space and exact tab. Verify expected URL/target and agent ownership before
  and after capture. Missing spaces and user takeover fail closed.
- Direct CDP bytes go to a fresh private directory with a private screenshot
  and receipt. Never use Ego's shared temporary screenshot filenames.
- Receipt binds the session, run, skill, task space, target, URL and SHA-256.
  The session reporter rejects mismatched/tampered files, links, unsafe
  permissions and repeated paths. Upload a private copy of validated bytes.
- Run-scoped fullscreen galleries cannot paginate into other runs or normal
  attachments. Session changes clear the selected Skills progress view.

This protects against accidental capture/reporting mix-ups, not malicious code
with arbitrary filesystem access under the same OS account.

## Verification (2026-09-10)

- Capture helper: 11 Node tests, including interleaved captures, target/URL
  changes, private permissions and ownership loss.
- CLI: related 96-test suite passed; final session-context/tool-description
  changes passed a fresh 19-test suite and CLI build.
- App: 142 related tests across 14 files passed, including transcript grouping,
  missing Skill events, same IDs across sessions, galleries, translations,
  unchanged manual composer camera removal and Android runtime contracts.
- CLI and App typechecks passed.
- Real Ego controlled-component regression passed at desktop and 390 x 844:
  Skills entry, task separation, follow-up grouping, session switching and
  narrow modal bounds. See the fixture README for reproducible cases.
- Final evidence video: H.264 / yuv420p / 390 x 844 / 9 seconds, complete decode
  passed; delivered through Happy media. Device playback is not confirmed.
- Independent review found and drove fixes for ambiguous run association,
  gallery scope, failed-upload reservation cleanup and session-context gaps.

PR before/after screenshots were separately asked about; no response received.
No before/after collection is claimed. Browser regression frames are test
evidence, not a production App or native-device acceptance claim.

## Rollout boundary

No merge, OTA, Web deployment, global CLI replacement or daemon restart is part
of this change. The App and CLI both need rollout after approval. Existing CLI
sessions retain their previously loaded rules and require a fresh session for
the new reporting contract. Production attachment delivery, installed Android
and iOS builds, and end-to-end ACP/Gemini runs were not exercised here.
