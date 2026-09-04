# Task 6 remediation report: PC Web Vercel settings and preview cards

## Delivered behavior

- The App API now validates status, callback URLs, and disconnect responses; it returns typed, safe errors for unavailable capability, expired sign-in, network, and server failures. Provider response text and credentials never enter UI errors.
- **Settings → Temporary previews** has deterministic loading, unavailable, disconnected, connected team/project, reconnect, disconnect, warning, and safe-error states. PC Web opens the OAuth provider only in a named popup; a blocked popup produces a recoverable instruction instead of navigating the app. Native continues to use the external browser path.
- OAuth state refresh is deterministic after the callback query, browser focus, same-origin completion message, and bounded polling. All listeners and polling timers are cleaned up.
- The server callback now lands on the same-origin temporary-preview settings route. A callback popup posts a completion message to its opener and closes; the opener retains and closes its popup reference on completion, cancellation, and unmount. A monotonic refresh generation prevents late status results or errors from overwriting the newest state.
- Preview tool cards are display-only. They project publishing, ready, failed, expired, and deleting-as-expired events; validate `http:`/`https:` before exposing open/copy actions; never embed an iframe/WebView or accept input/callbacks. Ready previews open externally and copy via the existing app abstractions.
- Interactive-preview lifecycle snapshots replace prior input for the same tool id, so transitions clear stale public URLs and error fields. The ToolView header and provider identity are localized; primary pressed styling preserves the semantic primary background in caramel-light and gingham-dark themes.
- Typed events flow through the existing ToolView message path. Legacy plain-text messages remain text. The settings entry, settings status/actions, and card actions expose stable `testID` hooks for Task 8 fixtures.
- Added English and zh-Hans copy (with the base English fallback required by the typed locale registry), semantic theme surfaces, accessible labels/roles, and 44px minimum preview-card actions.

## TDD evidence

| Behavior | Red result | Green result |
| --- | --- | --- |
| API disconnect warning, safe error taxonomy, provider URL validation | 3 failing assertions: missing warning/type and unsafe `javascript:` URL resolved | `apiInteractivePreviews.spec.ts`: 5/5 |
| Card state projection, labelled controls, and safe URL actions | 5 failing assertions: fixed Chinese copy/no fixture hooks | `InteractivePreviewCard.test.tsx`: 6/6 |
| Deleting projection and legacy text compatibility | `deleting` envelope rejected by raw event schema | `typesRaw.spec.ts`: 64/64 |
| Settings lifecycle and OAuth refresh | 6 failing assertions: no fixtures, popup handling, refresh listeners, or safe error state | `temporary-previews.test.tsx`: 6/6 |
| Lifecycle reducer replacement | ready event retained the prior `publishing` state under the same tool id | `reducer.spec.ts`: 70/70, including publishing → ready → failed → expired |
| Refresh race and callback popup cleanup | stale response/error could win; callback was not an opener bridge and popup was orphaned | `temporary-previews.test.tsx`: 10/10, including out-of-order response/error, callback bridge, cancellation, and retry id |
| Server callback route | callback redirected to root rather than the settings completion bridge | `vercelConnectRoutes.spec.ts`: 9/9 |
| Localized ToolView/provider and pressed contrast | known tool used fixed Chinese title; pressed state used a surface color | `ToolView.interactivePreview.test.tsx`: 2/2; `InteractivePreviewCard.test.tsx`: 7/7; `interactivePreviewTranslations.test.ts`: 1/1 |

## Verification

Follow-up review fix: corrected the ToolView fixture's self-referential mock callback type (`TS2502`) without changing runtime behavior.

```text
pnpm exec vitest run \
  sources/sync/apiInteractivePreviews.spec.ts \
  sources/sync/typesRaw.spec.ts \
  sources/components/tools/views/InteractivePreviewCard.test.tsx \
  sources/app/(app)/settings/temporary-previews.test.tsx \
  sources/components/MessageView.forkActions.test.tsx \
  sources/components/tools/views/_all.test.ts

Test Files  9 passed (9)
Tests       164 passed (164)

pnpm --filter happy-app typecheck
> tsc --noEmit
exit 0

(cd packages/happy-server && pnpm run typecheck)
> tsc --noEmit
exit 0

(cd packages/happy-server && pnpm exec vitest run sources/app/api/routes/vercelConnectRoutes.spec.ts)
Test Files  1 passed (1)
Tests       9 passed (9)

git diff --check
exit 0
```
