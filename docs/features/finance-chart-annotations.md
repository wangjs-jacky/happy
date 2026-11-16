# Finance chart teaching annotations

The existing `<happy-finance-chart>` JSON block accepts optional `numberedBars: true`
and `annotations`. Market fields and OHLC values retain their existing schema.
Use real sourced data; do not reconstruct exact quotes from screenshots.

```json
{
  "numberedBars": true,
  "annotations": [
    { "type": "region", "from": 0, "to": 2, "label": "Top fractal: three candles" },
    { "type": "point", "at": { "index": 1, "price": 1294.77 }, "label": "Second candle high" },
    { "type": "line", "from": { "index": 1, "price": 1294.77 }, "to": { "index": 3, "price": 1291.36 }, "dashed": true, "label": "Candidate connection; not a confirmed stroke" }
  ]
}
```

Merge these optional fields into a complete chart payload. Indices are zero-based
positions in `points`; region endpoints are inclusive. Anchor prices must fall
within the referenced candle's low/high. Chart badges refer to the numbered text
legend. Candle numbers appear for charts with at most 20 candles. Region shading
is behind candles; endpoint circles and lines are above candles. All overlays use
the same coordinate transforms as prices and follow the current theme.

Malformed annotations are ignored independently. At most 40 annotations and 200
characters per label are accepted. If malformed candles were removed, all
annotations are suppressed to prevent index drift. Old payloads remain valid.

Tap/drag price inspection remains unchanged. This change does not add manual
annotation editing, export, live feeds, zoom, or automatic Chan-pattern detection.
