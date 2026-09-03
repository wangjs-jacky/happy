# Public share theme and cover evidence

All eight PNGs are 1440×900 browser captures. The four `before` images are the verified pre-feature UI baseline; the four `after` images were produced by `packages/happy-app/e2e/public-session-sharing-evidence.spec.ts` against this branch. No screenshot contains a live credential or secret.

## Case matrix

| Case | Files | Viewport and state | Action | Expected | Actual |
| --- | --- | --- | --- | --- | --- |
| 1 — owner share dialog | `case-1-share-dialog-before.png` / `case-1-share-dialog-after.png` | 1440×900, authenticated owner, dark app theme | Open Manage sharing after selecting Gingham, exercising the unavailable-random fallback, uploading the repository PNG, and publishing | Seven theme controls, usable upload/coverless fallback, decoded preview, share actions | Before has only legacy sharing actions. After shows seven theme swatches, Gingham selected, decoded uploaded cover, copied public link, update/open/revoke actions. The real-server share is revoked after verification. |
| 2 — anonymous covered share | `case-2-public-cover-before.png` / `case-2-public-cover-after.png` | 1440×900, anonymous, light mode, V2 Gingham snapshot | Open the covered public ID after cross-ID/reload mode checks | Compact read-only/noindex page, immutable cover URL, canonical Pexels attribution, no owner chrome | Before is the legacy coverless public page. After shows a cover, `Photo by Ada Lovelace on Pexels`, compact header/mode controls, and transcript. Browser assertions verify no auth/cookies and the immutable attachment URL. |
| 3 — coverless public share | `case-3-no-cover-before.png` / `case-3-no-cover-after.png` | 1440×900 capture plus 390×844 asserted layout, anonymous, V2 Sage dark | Open a real-server V2 snapshot with no cover and resize to phone width | No reserved cover gap, viewport-edge vertical scroll owner, no horizontal overflow | Before is the shared legacy anonymous baseline. After begins at the compact header with no banner gap; DOM geometry proves the scroll owner reaches both viewport edges at desktop and phone widths. A real-server V1 fallback is also asserted. |
| 4 — Gingham dark interaction | `case-4-gingham-dark-before.png` / `case-4-gingham-dark-after.png` | 1440×900, anonymous, V2 Gingham dark, long transcript scrolled to code | Keyboard-focus and activate Copy, then inspect success feedback | Theme-specific dark UI, mounted transcript and scroll position preserved during mode changes, keyboard-visible success feedback | Before is the legacy dark public page with only hover-era Copy UI. After shows Gingham dark, a scrolled long transcript, focused `Copied` feedback, and the covered compact header. Clipboard text, `aria-live`, reset timing, instance marker, and scroll offset are asserted. |

Cases 2 and 3 intentionally share the same pre-feature `anonymous-read-only-share-before.png` source: the legacy renderer had neither an optional cover nor distinct coverless spacing, so that single verified state is the truthful baseline for both comparisons. Case 4 maps from the separately captured legacy copy-feedback state. Case 1 maps from the legacy owner Manage sharing dialog.

## Reproduction

Use the existing deterministic MP4 fixture and do not configure a Pexels key:

```bash
env -u PEXELS_API_KEY \
  HAPPY_E2E_MP4_PATH=/tmp/public-share-e2e-success.mp4 \
  HAPPY_E2E_SKIP_CLI_BUILD=1 \
  HAPPY_PUBLIC_SHARE_EVIDENCE_DIR="$PWD/docs/pr-evidence/public-share-theme-cover" \
  pnpm test:e2e:web -- e2e/public-session-sharing-evidence.spec.ts
```

Focused verification and build commands:

```bash
pnpm --filter @slopus/happy-wire exec vitest run src/publicSessionShare.test.ts
pnpm --filter happy-server-self-host exec vitest run \
  sources/app/sessionSharing/publicSessionCoverProvider.spec.ts \
  sources/app/sessionSharing/publicSessionShareStorage.spec.ts \
  sources/app/api/routes/publicSessionShareRoutes.spec.ts
pnpm --filter happy-app exec vitest run \
  sources/sync/publicSessionSnapshot.test.ts \
  sources/sync/publicSessionShareQueuePersistence.test.ts \
  sources/sync/apiPublicSessionShares.test.ts \
  sources/components/PublicSessionShareAppearanceControls.test.tsx \
  sources/components/PublicSessionShareDialog.test.tsx \
  sources/hooks/usePublicSessionAppearance.test.tsx \
  sources/components/PublicSessionTranscript.test.tsx \
  sources/components/markdown/CodeBlockCopyButton.test.tsx \
  sources/themePacks.test.ts
pnpm --filter @slopus/happy-wire run build
pnpm --filter happy-server-self-host typecheck
pnpm --filter happy-app typecheck
pnpm --filter happy-app export:web
```

## Artifact provenance

- Owner and compatibility flows use the ephemeral local Happy server, its real draft/asset/publish/public/revoke routes, and a real encrypted session transcript. The upload is the tracked 1600×1000 `docs/assets/plugin-host-v2/marketplace-installed.png`; the conversation attachment is `/tmp/public-share-e2e-success.mp4`.
- The Pexels renderer case intercepts only the public snapshot and immutable attachment responses. Its attribution metadata is deterministic, and its cover bytes are the same tracked repository PNG. It never contacts Pexels or any external image host.
- The owner random-cover request is deterministically intercepted with HTTP 503 to prove that upload and coverless publication remain available without live Pexels credentials.
- Before captures came from the verified pre-feature browser run at 1440×900. After captures are deterministic outputs of the command above. The server environment is removed after each run.
- Browser checks also cover anonymous/no-cookie requests, `noindex,nofollow,noarchive`, read-only chrome, V1 fallback, V2 covered/coverless rendering, canonical Pexels attribution, light/dark/system local storage across IDs and reloads, system media changes, real scroll geometry, transcript instance/scroll preservation, phone-width containment, and keyboard copy feedback.
