# Finance Chart Card Design

> Goal: let Happy agents fetch real market data through a first-party tool and render the result as an interactive chart card inside chat messages.

## Context

Happy already supports typed message cards through a stable Markdown block contract. The OTA flow defines `<happy-ota-preview>`, parses it into a typed block, and renders `OtaPreviewCard`. This feature reuses that pattern for finance data instead of adding a dynamic card runtime.

## Scope

The first version includes:

- A first-party Happy MCP tool named `finance_chart`.
- A stable `<happy-finance-chart>` JSON block emitted by the agent.
- App-side parsing into a `finance-chart` markdown block.
- A chat-message `FinanceChartCard` with touch/drag point inspection.
- Tests for parsing, MCP tool registration/forwarding, and finance data normalization.

The first version does not include:

- Session sidebar aggregation.
- Trading advice or portfolio analysis.
- Native rebuild changes.
- User-managed external MCP installation.

## Data Flow

1. The user asks for a stock, index, or crypto price trend.
2. The agent calls `mcp__happy__finance_chart` with a query such as `上证指数`, `000001.SS`, or `AAPL`.
3. Happy CLI resolves aliases and fetches chart data from a finance data source.
4. The tool returns normalized quote data plus a ready-to-embed `<happy-finance-chart>` block.
5. The agent includes the block in its answer.
6. The App parser recognizes the block, validates its JSON payload, and renders `FinanceChartCard`.

## MCP Tool Contract

Tool: `finance_chart`

Input:

```ts
{
    query: string;
    range?: '5d' | '1mo' | '3mo' | '6mo' | '1y';
    interval?: '1d';
}
```

Output:

```ts
{
    symbol: string;
    name: string;
    market: string | null;
    currency: string | null;
    range: string;
    interval: string;
    asOf: string;
    source: string;
    latest: {
        date: string;
        close: number;
        change: number | null;
        changePercent: number | null;
    };
    points: Array<{
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | null;
    }>;
    block: string;
}
```

The `block` value uses:

```xml
<happy-finance-chart>
{ ...same normalized JSON without block... }
</happy-finance-chart>
```

## Data Source

The first implementation uses a simple built-in provider and keeps the provider behind a small function boundary. It should prefer no extra runtime dependency and should normalize Yahoo-style chart output into the contract above. The provider must fail clearly when no usable OHLC points are returned.

Known aliases include:

- `上证指数`, `上证`, `000001`, `000001.SS` -> `000001.SS`
- `沪深300`, `300`, `000300`, `000300.SS` -> `000300.SS`
- `纳指`, `纳斯达克`, `IXIC`, `^IXIC` -> `^IXIC`
- `标普500`, `SPX`, `^GSPC` -> `^GSPC`
- `道指`, `DJI`, `^DJI` -> `^DJI`

## App Rendering

`FinanceChartCard` renders:

- symbol, name, source, range, and latest timestamp
- latest close, absolute change, and percentage change
- a compact candlestick-style SVG chart
- a selected point readout with open/high/low/close/volume

Interaction:

- Default selected point is the latest point.
- Pressing or dragging across the chart selects the nearest data point.
- The selected point readout updates without resizing the chart container.

## Error Handling

- The MCP tool returns an MCP error result if the query cannot be resolved or the source has no data.
- The parser ignores invalid finance chart blocks and continues rendering other Markdown blocks.
- The card renders only already-normalized data; it does not fetch network data from the App.

## Verification

- Unit tests for finance chart parsing and invalid-block fallback.
- Unit tests for symbol resolution and chart normalization.
- Unit tests for Happy MCP bridge registration and forwarding.
- `pnpm --filter happy-app typecheck`.
- `pnpm --filter happy-cli run build`.
- A PR to `jacky-main`, then preview OTA from the branch.
