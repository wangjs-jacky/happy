# Generated Image Gallery Evidence

- Case ID: `PC-GENERATED-IMAGE-GALLERY-001`.
- Viewport: 1440 x 900, DPR 1, Chrome via the repository Web E2E harness.
- Before: `main` at `1c80c54e7bc014feb92255bd1e285dfa36e3cdd5`; generated images use fixed-height cards and crop their previews.
- After: this branch; generated images use their reported dimensions to determine preview height and are arranged by FlashList masonry layout.
- Fixture: five encrypted generated-image events with wide, portrait, square, editorial, and landscape dimensions. The E2E suite waits for their real attachment downloads, checks the four-column layout, source-proportional preview heights, and absence of horizontal overflow.
