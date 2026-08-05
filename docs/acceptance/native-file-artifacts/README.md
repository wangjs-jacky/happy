# Generated media card acceptance

This evidence covers the browser-visible half of the Paws flow for a generated MP4:

1. the page receives the plaintext `video/mp4` file event produced by `send_file`;
2. the message remains an individual file card instead of entering the image gallery;
3. selecting the card requests a short-lived download source and expands an inline player.

CLI upload/event emission and server upload/download behavior are covered separately by their package tests; this recording intentionally focuses on the interaction the user accepts on a phone or browser.

## Evidence

- [Recorded E2E flow](paws-native-mp4-card-acceptance.mp4)
- [Expanded player screenshot](paws-native-mp4-card-after.png)

The recording uses an isolated, synthetic session and a 0.3-second generated MP4 fixture. It contains no production account, session, or service data.

## Re-run

```bash
HAPPY_E2E_RECORD=1 pnpm test:e2e:web -- --grep "Agent 生成的 MP4 在会话内直接展开播放器"
```

Expected result: one Playwright case passes, the media card changes from “点击播放” to “点击收起”, and an HTML video element with controls is visible.

The checked-in MP4 was trimmed to the observable interaction and transcoded to H.264, `yuv420p`, 1280×720, 25 fps, with `faststart` enabled.
