# Task 6 remediation report: PC Web Vercel settings and preview cards

## Delivered behavior

- The App API now validates status, callback URLs, and disconnect responses; it returns typed, safe errors for unavailable capability, expired sign-in, network, and server failures. Provider response text and credentials never enter UI errors.
- **Settings → Temporary previews** has deterministic loading, unavailable, disconnected, connected team/project, reconnect, disconnect, warning, and safe-error states. PC Web opens the OAuth provider only in a named popup; a blocked popup produces a recoverable instruction instead of navigating the app. Native continues to use the external browser path.
- OAuth state refresh is deterministic after the callback query, browser focus, same-origin completion message, and bounded polling. All listeners and polling timers are cleaned up.
- Preview tool cards are display-only. They project publishing, ready, failed, expired, and deleting-as-expired events; validate `http:`/`https:` before exposing open/copy actions; never embed an iframe/WebView or accept input/callbacks. Ready previews open externally and copy via the existing app abstractions.
- Typed events flow through the existing ToolView message path. Legacy plain-text messages remain text. The settings entry, settings status/actions, and card actions expose stable `testID` hooks for Task 8 fixtures.
- Added English and zh-Hans copy (with the base English fallback required by the typed locale registry), semantic theme surfaces, accessible labels/roles, and 44px minimum preview-card actions.

## TDD evidence

| Behavior | Red result | Green result |
| --- | --- | --- |
| API disconnect warning, safe error taxonomy, provider URL validation | 3 failing assertions: missing warning/type and unsafe `javascript:` URL resolved | `apiInteractivePreviews.spec.ts`: 5/5 |
| Card state projection, labelled controls, and safe URL actions | 5 failing assertions: fixed Chinese copy/no fixture hooks | `InteractivePreviewCard.test.tsx`: 6/6 |
| Deleting projection and legacy text compatibility | `deleting` envelope rejected by raw event schema | `typesRaw.spec.ts`: 64/64 |
| Settings lifecycle and OAuth refresh | 6 failing assertions: no fixtures, popup handling, refresh listeners, or safe error state | `temporary-previews.test.tsx`: 6/6 |

## Verification

```text
pnpm exec vitest run \
  sources/sync/apiInteractivePreviews.spec.ts \
  sources/sync/typesRaw.spec.ts \
  sources/components/tools/views/InteractivePreviewCard.test.tsx \
  sources/app/(app)/settings/temporary-previews.test.tsx \
  sources/components/MessageView.forkActions.test.tsx \
  sources/components/tools/views/_all.test.ts

Test Files  6 passed (6)
Tests       86 passed (86)

pnpm --filter happy-app typecheck
> tsc --noEmit
exit 0

git diff --check
exit 0
```
