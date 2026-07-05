# Finance Chart Card Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-party finance data tool and render its structured output as an interactive chart card in Happy chat.

**Architecture:** Happy CLI exposes `finance_chart` through the existing first-party MCP bridge. The App extends the existing Markdown typed-block pipeline with `<happy-finance-chart>` and renders normalized data through a focused React Native card.

**Tech Stack:** TypeScript, MCP SDK, React Native, react-native-svg, Unistyles, Vitest.

---

## File Structure

- Create `packages/happy-cli/src/finance/financeChart.ts`: symbol aliasing, provider fetch, normalization, block serialization.
- Create `packages/happy-cli/src/finance/financeChart.test.ts`: TDD coverage for aliases, normalization, and block output.
- Modify `packages/happy-cli/src/claude/utils/startHappyServer.ts`: add HTTP MCP handler for `finance_chart`.
- Modify `packages/happy-cli/src/codex/happyMcpBridgeTools.ts`: add stdio bridge registration for `finance_chart`.
- Modify `packages/happy-cli/src/codex/happyMcpBridgeTools.test.ts`: verify the new bridge tool.
- Modify `packages/happy-app/sources/sync/prompt/systemPrompt.ts`: document the finance chart block contract.
- Create `packages/happy-app/sources/utils/sessionFinanceCharts.ts`: parse and validate finance chart payloads.
- Create `packages/happy-app/sources/utils/sessionFinanceCharts.test.ts`: parse valid and invalid blocks.
- Modify `packages/happy-app/sources/components/markdown/parseMarkdown.ts`: add `finance-chart` block type.
- Modify `packages/happy-app/sources/components/markdown/parseMarkdownBlock.ts`: parse `<happy-finance-chart>`.
- Modify `packages/happy-app/sources/components/markdown/parseMarkdownBlock.test.ts`: verify typed block parsing.
- Create `packages/happy-app/sources/components/FinanceChartCard.tsx`: interactive message card.
- Modify `packages/happy-app/sources/components/markdown/MarkdownView.tsx`: render `FinanceChartCard`.

## Chunk 1: CLI Finance Tool

### Task 1: Add finance normalization tests

- [ ] Write failing tests in `packages/happy-cli/src/finance/financeChart.test.ts` for alias resolution, Yahoo-style normalization, and generated `<happy-finance-chart>` block.
- [ ] Run `pnpm --filter happy-cli exec vitest run src/finance/financeChart.test.ts` and confirm the tests fail because the module does not exist.
- [ ] Implement `packages/happy-cli/src/finance/financeChart.ts` with typed inputs/outputs, alias resolution, provider fetch, normalization, and block serialization.
- [ ] Run the finance tests again and confirm they pass.

### Task 2: Register MCP tool

- [ ] Update `packages/happy-cli/src/codex/happyMcpBridgeTools.test.ts` with failing expectations for `finance_chart` registration and forwarding.
- [ ] Run `pnpm --filter happy-cli exec vitest run src/codex/happyMcpBridgeTools.test.ts` and confirm the new expectations fail.
- [ ] Register `finance_chart` in `happyMcpBridgeTools.ts` and `startHappyServer.ts`.
- [ ] Run bridge tests and finance tests again.

## Chunk 2: App Parser And Card

### Task 3: Add finance chart parser

- [ ] Write failing tests in `packages/happy-app/sources/utils/sessionFinanceCharts.test.ts` for valid JSON blocks, invalid JSON fallback, and minimum point validation.
- [ ] Run `pnpm --filter happy-app exec vitest run sources/utils/sessionFinanceCharts.test.ts` and confirm they fail.
- [ ] Implement `sessionFinanceCharts.ts`.
- [ ] Run the parser tests and confirm they pass.

### Task 4: Add typed Markdown block

- [ ] Add failing coverage in `parseMarkdownBlock.test.ts` for `<happy-finance-chart>`.
- [ ] Run `pnpm --filter happy-app exec vitest run sources/components/markdown/parseMarkdownBlock.test.ts`.
- [ ] Extend `parseMarkdown.ts` and `parseMarkdownBlock.ts`.
- [ ] Run markdown parser tests.

### Task 5: Render interactive card

- [ ] Create `FinanceChartCard.tsx` with stable chart dimensions, SVG rendering, and press/drag nearest-point selection.
- [ ] Wire `MarkdownView.tsx` to render the new block.
- [ ] Keep all visible labels concise and local to the card for now; avoid adding broad i18n churn unless typecheck requires it.

## Chunk 3: Verification And Delivery

### Task 6: Verify locally

- [ ] Run `pnpm --filter happy-cli exec vitest run src/finance/financeChart.test.ts src/codex/happyMcpBridgeTools.test.ts`.
- [ ] Run `pnpm --filter happy-app exec vitest run sources/utils/sessionFinanceCharts.test.ts sources/components/markdown/parseMarkdownBlock.test.ts`.
- [ ] Run `pnpm --filter happy-app typecheck`.
- [ ] Run `pnpm --filter happy-cli run build`.

### Task 7: Commit, PR, preview OTA

- [ ] Review `git diff`.
- [ ] Commit with repository-standard trailer.
- [ ] Push branch `finance-chart-card` to origin.
- [ ] Create PR against `jacky-main`.
- [ ] Publish preview OTA from `packages/happy-app` or confirm the PR workflow produced one.
- [ ] Report PR URL, OTA metadata, and validation status.
