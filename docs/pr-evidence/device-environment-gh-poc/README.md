# Device Environment — GitHub CLI POC evidence

Visible UI cases: 4

| Case | Problem | Before | After |
|---|---|---|---|
| ENV-1 Fleet overview | Happy only showed daemon online/offline | ![Before Settings](before-settings.png) | ![Fleet overview](after-fleet-overview.png) |
| ENV-2 Mutation preview | No exact fleet plan existed | ![Before Settings](before-settings.png) | ![Alignment preview](after-alignment-preview.png) |
| ENV-3 Partial result | Multi-device failures could not be compared | ![Before Settings](before-settings.png) | ![Partial result](after-partial-result.png) |
| ENV-4 Theme states | New surfaces require semantic dark-theme verification | ![Before Settings](before-settings.png) | ![Dark theme](after-dark-theme.png) |

The Before image is intentionally shared: the prior product had no Device Environment route. Each After is an independent capture of its named state. Screenshots are unmodified Ego Browser captures at 1440×1100, device scale factor 1. The settings list is scrolled to keep all three machine rows readable; summary counts are verified separately and included in the recorded replay.

## Revisions and fixture boundary

- Before: `36452dccd4f5694e00f0b964d7e54379cc72ceac`, rendered from a separate detached worktree.
- Final verified source: `6bc091d779675b07f6b65a985ba61343bb679a21`. ENV-4 was recaptured after its focus-state fix. ENV-1–3 screenshots remain from `66fbab25ff063c377bf79d8d813dc5b16fe1ab68`; their rendered states are unchanged by the focus-only fix and were rechecked in the final replay.
- Both builds used the repository's Expo Web entry point, with the API endpoint set to unused loopback port `19879`. No API server or daemon was started.
- Browser-only runtime fixtures populated the existing Zustand machine registry and replaced the two exported `environmentOps` functions with deterministic responses. The production Settings route, Device Environment view, fleet hook, and confirmation modal were exercised unchanged. No production fixture code was added.
- Fixture machines: Studio Mac (authenticated, upgrade `2.79.0 → 2.80.0`), Build Mac (not installed, authentication missing, installation requires repair), and Travel Mac (offline). These names and versions are illustrative and distinct from the real local adapter check below.
- Environment inspection and application in the browser never reached a real machine. Authentication bootstrap used a synthetic, nonfunctional local credential. Repair commands were displayed only.

## Visible acceptance

| Case | Verified result |
|---|---|
| ENV-1 | All three registered devices remain visible. Online status, installed/target versions, authentication missing, and offline/unknown state are distinct. Only the two online fixture machines are inspected. |
| ENV-2 | Preview lists the exact upgrade, installation, and skipped offline machine. Before approval, apply count is zero. Cancel retains the preview and does not apply. The three-device confirmation body fits: 238×144 px, 13 px font, 18 px line height; no clipping or overflow at the target viewport. |
| ENV-3 | Only the two online machines receive fixture apply calls. Studio Mac retains the successful upgrade; Build Mac retains the attempted installation target and local-terminal repair commands; Travel Mac stays offline. Summary is `1/3` and identifies remaining attention. |
| ENV-4 | `ginghamDark` resting `#1A2330`, hover/pressed `#1F2A38`, and focus `#283544` match the semantic tokens. Actual pointer press → scan/disable → keyboard Tab now clears the old focus highlight. During disabling and after focus moves to Back, Scan returns to `#1A2330`; only the currently focused action gets `#283544`. |

The settings panel has a working internal scroller (842 px visible area; scanned fleet content 996 px). The confirmation dialog itself does not require scrolling for this three-machine fixture. A much larger fleet or unusually long device names is outside this visual sample.

## Fresh cross-package verification

All commands below exited 0:

```sh
pnpm --filter @slopus/happy-wire exec vitest run src/environment.test.ts
pnpm --filter @wangjs-jacky/paws exec vitest run \
  src/environment/processRunner.test.ts \
  src/environment/githubCliAdapter.test.ts \
  src/environment/environmentService.test.ts \
  src/environment/registerEnvironmentHandlers.test.ts \
  src/api/apiMachine.test.ts
pnpm --filter happy-app exec vitest run \
  sources/environment/fleetModel.test.ts \
  sources/hooks/useDeviceEnvironment.test.ts \
  sources/components/environment/DeviceEnvironmentView.test.tsx \
  sources/components/DesktopSettingsModal.test.tsx \
  sources/sync/apiSocket.test.ts
pnpm --filter @slopus/happy-wire run build
pnpm --filter @wangjs-jacky/paws run build
pnpm --filter happy-app run typecheck
git diff --check
```

Results at the final source revision: wire **2/2**, CLI **61/61**, App **50/50**; **113 tests across 11 files, zero failures**. The App suite includes the new missing-blur regression test. `git diff --check` printed nothing.

Non-failing warnings: React test renderer deprecation in component tests; pkgroll bin paths outside `dist` and empty `index` / `codex/happyMcpStdioBridge` chunks; Metro `NO_COLOR`/`FORCE_COLOR` conflict and `@noble/hashes/crypto.js` fallback resolution. CLI test setup also builds the CLI. No test, typecheck, or build error was suppressed.

## Real local adapter comparison — read only

The adapter's `inspect()` was compared with `gh --version`, `brew info --json=v2 gh`, and `gh auth status --hostname github.com` with `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, and `GITHUB_ENTERPRISE_TOKEN` removed. Both auth output streams were discarded at the process boundary.

| Value | Adapter | Direct commands |
|---|---|---|
| Installed version | `2.98.0` | `2.98.0` |
| Homebrew stable version | `2.100.0` | `2.100.0` |
| Authentication enum | `authenticated` | `authenticated` |

All three direct commands exited 0. No install, upgrade, authentication login, or real environment apply was performed.

## Delivery scope

The same four cases passed an Ego-only recorded replay, including Cancel → no apply, two-machine partial results, and the actual pointer/disable/Tab focus regression. The delivered MP4 is 17.5 seconds, 1440×1100, H.264, `yuv420p`, 30 fps, silent, 680,918 bytes, with `moov` before `mdat` (`faststart`). It was recorded from real Ego frames at 8 fps and resampled to 30 fps for playback. Codec inspection, full decode, whole-timeline contact sheet, full-size confirmation/result frames, and redaction checks passed. The MP4 and all five screenshots were sent to chat; the video remains a separate local task artifact and is not part of this evidence commit.

Replay coverage: 0–3 s fleet summary/rows; 3–8.8 s exact plans, confirmation, cancellation, approval; 8.8–11.9 s partial results/attention; 11.9–17.5 s dark surfaces, pointer press, disabling, and keyboard focus transfer.

These files provide local PR evidence; this task does not push, publish, deploy, or create/update a PR. Before embedding this matrix in a PR, use immutable evidence-commit URLs and verify the actual rendered PR images.
