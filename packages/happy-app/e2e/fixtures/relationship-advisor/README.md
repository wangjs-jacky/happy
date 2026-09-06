# Advisor image interaction regression

Run `node packages/happy-app/e2e/fixtures/relationship-advisor/serve.mjs` from the repository root.
Use Ego at the printed `/before/` and `/after/` URLs. Baseline defaults to `9c1539a1`;
set `ADVISOR_BASELINE` to replay another revision. This localhost fixture is not a deployed App.

The fixture renders the real advisor screen, MessageComposer, MultiTextInput.web,
useImagePicker, Expo web picker, AgentInputAttachmentStrip, expo-image, image viewer,
local image cache, request client, server handler and provider adapter. Theme tokens
come from the application's `ginghamDark` theme. It does **not** replace the composer
with a visible file input. The system picker creates its own hidden input normally.

External model responses and uploads are deterministic/in-memory. Navigation,
settings, authentication, Markdown styling and unrelated composer controls are isolated.
Image download, encrypted-session fetching and media playback are not exercised here.
No provider key or production account is used. Native permission/picker/gesture behavior
and real-model OCR require separate acceptance; browser screenshots do not prove them.

## Cases

1. Select a supplied image using **添加附件**. Verify a thumbnail and its remove control
   appear in the real composer, without a visible filename input. Send image + text.
   After: the message contains an image; before: only an image-count label.
2. Reload, then ask a follow-up. Inspect `window.lastFixtureRequest`: after retains
   original bytes on the first user message; before has zero images on the follow-up.
3. Paste an image from the clipboard into the textarea. Verify the same thumbnail
   strip appears, send without text, reload, and confirm the image remains visible.
4. Click a sent image and verify the shared fullscreen viewer, then close it.
5. Set `window.fixtureMode = 'empty'`, send text. Before: no error/retry. After:
   explicit empty-response message and retry. Set mode to `normal` and retry;
   verify one user and one assistant message, without duplicated turns.

Stable selectors: `textarea`, `[data-testid="message-composer-send-button"]`,
`[data-testid="relationship-advisor-image"]`,
`[data-testid="relationship-advisor-retry-button"]`.

Fixture-only diagnostics: `window.fixtureHistory()`, `window.lastFixtureRequest`,
`window.advisorFixtureCache`, `window.advisorFixtureViewer`.
