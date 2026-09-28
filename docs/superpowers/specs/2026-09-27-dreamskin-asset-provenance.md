# DreamSkin implementation asset provenance

The implementation uses the palette from the reviewed DreamSkin `cecilylove002` ZIP. Run `node packages/happy-app/scripts/inspect-dreamskin-theme.mjs /absolute/path/original.zip` to verify the exact ZIP, its manifest, and the checked-in semantic token mapping; `--write` regenerates that mapping for review. The source CSS is a single `[data-ds-part="root"]` background rule and is never injected into Paws. The source photograph is excluded because the manifest's `CC BY-NC 4.0` label and 「哲风壁纸」 provenance do not establish redistribution rights for the wallpaper.

The original background is an independently generated image made for this implementation. It depicts a quiet interior, an East Asian woman on the right using a laptop, and a white cat toward the center-left, with a broad dark area for interface text. Generated on 2026-09-27 with GPT Image via the imagegen tool. Original PNG SHA-256: `ab20371920996109cf75b015f1c86838338027f0b76b16bfe32bb2ab34c98e95`. The served `background.804fdea2203cbde0.webp` is a quality-92 WebP encoding of that original; its SHA-256 is `804fdea2203cbde0a25db39a0f78cc96b34a442c43a7b6526384c7f17524344b`.

The local skin is opt-in on PC Web and does not alter public-share theme packs. Turning it off restores the saved Paws color pack and light/dark preference.
