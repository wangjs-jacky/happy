# Codex Slash Skills Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface installed Codex skills in Happy's slash autocomplete and make exact `/skills` requests return the scanned skill list for Codex sessions.

**Architecture:** Add a Codex-side skill scanner that walks the same local roots the Codex harness uses (`~/.codex/skills`, `~/.agents/skills`, repo-local ancestor `.agents/skills`, and cached plugin skills under `~/.codex/plugins`). Inject the discovered skill names into session metadata at creation time, then extend app-side slash autocomplete to merge `metadata.skills` with built-in slash commands. Keep `/skills` local to Happy for Codex by intercepting the exact command before it reaches the provider and replying from session metadata.

**Tech Stack:** TypeScript, Vitest, Happy CLI session metadata, Zustand-backed app storage.

---

## Chunk 1: Codex Skill Discovery + Metadata

### Task 1: Add a Codex skill scanner with deterministic naming

**Files:**
- Create: `packages/happy-cli/src/codex/codexSkills.ts`
- Create: `packages/happy-cli/src/codex/codexSkills.test.ts`

- [ ] **Step 1: Write the failing test**

Cover these cases:
- global skill roots: `~/.codex/skills/<name>/SKILL.md`
- repo-local ancestor roots: `<cwd>/.agents/skills/<name>/SKILL.md`
- plugin cache roots: `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md`
- nested `.system` skills under `~/.codex/skills/.system/<name>/SKILL.md`
- dedupe by final command name

Expected names:
- plain skills use the frontmatter `name` when present
- plugin skills use `<plugin>:<skill>`

Run: `pnpm vitest run src/codex/codexSkills.test.ts`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 2: Implement the scanner**

Implement `listCodexSkillNames(opts)` in `codexSkills.ts` with small helpers:
- gather candidate roots from `homeDir` and `cwd`
- recursively walk roots, following symlinked directories/files safely
- parse frontmatter `name:` when present, otherwise fall back to the skill directory name
- derive plugin-prefixed names for cached plugin skills
- return a sorted unique `string[]`

- [ ] **Step 3: Run the scanner tests**

Run: `pnpm vitest run src/codex/codexSkills.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/happy-cli/src/codex/codexSkills.ts packages/happy-cli/src/codex/codexSkills.test.ts
git commit -m "feat(codex): discover local skill names"
```

### Task 2: Inject discovered skills into Codex session metadata and `/skills`

**Files:**
- Modify: `packages/happy-cli/src/utils/createSessionMetadata.ts`
- Modify: `packages/happy-cli/src/utils/createSessionMetadata.test.ts`
- Modify: `packages/happy-cli/src/codex/runCodex.ts`
- Modify: `packages/happy-cli/src/codex/codexClearCommand.ts`
- Modify: `packages/happy-cli/src/codex/codexClearCommand.test.ts`
- Modify: `packages/happy-cli/src/parsers/specialCommands.test.ts`

- [ ] **Step 1: Extend metadata tests first**

Add a failing assertion to `createSessionMetadata.test.ts` that `skills` is preserved when passed in the options.

Add slash-queue tests to `codexClearCommand.test.ts` so exact `/skills` is isolated instead of batched like normal text.

Add parser coverage in `specialCommands.test.ts` for exact `/skills`.

Run:
- `pnpm vitest run src/utils/createSessionMetadata.test.ts`
- `pnpm vitest run src/codex/codexClearCommand.test.ts src/parsers/specialCommands.test.ts`

Expected: FAIL on the new assertions.

- [ ] **Step 2: Implement metadata wiring**

In `createSessionMetadata.ts`:
- add an optional `skills?: string[]` input
- write it into `metadata.skills` only when non-empty

In `runCodex.ts`:
- call `listCodexSkillNames({ cwd: process.cwd() })` before `createSessionMetadata`
- pass the resulting array into `createSessionMetadata`
- intercept exact `/skills` inside the queued-message loop
- send a synthetic assistant/system response that mirrors the Claude remote `/skills` formatting

In `codexClearCommand.ts`:
- isolate exact `/skills` in the queue helper so it cannot be merged with surrounding user text

- [ ] **Step 3: Run CLI verification**

Run:
- `pnpm vitest run src/utils/createSessionMetadata.test.ts src/codex/codexSkills.test.ts src/codex/codexClearCommand.test.ts src/parsers/specialCommands.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/happy-cli/src/utils/createSessionMetadata.ts packages/happy-cli/src/utils/createSessionMetadata.test.ts packages/happy-cli/src/codex/runCodex.ts packages/happy-cli/src/codex/codexClearCommand.ts packages/happy-cli/src/codex/codexClearCommand.test.ts packages/happy-cli/src/parsers/specialCommands.test.ts
git commit -m "feat(codex): expose skills in session metadata"
```

## Chunk 2: App Slash Autocomplete

### Task 3: Merge `metadata.skills` into slash autocomplete

**Files:**
- Modify: `packages/happy-app/sources/sync/suggestionCommands.ts`
- Create: `packages/happy-app/sources/sync/suggestionCommands.spec.ts`

- [ ] **Step 1: Write the failing app tests**

Add tests that seed `storage` with a session containing:
- default slash commands only
- `metadata.slashCommands`
- `metadata.skills`

Assert:
- `getAllCommands(sessionId)` contains default commands plus discovered skills
- duplicate names are deduped
- `searchCommands(sessionId, 'super')` finds a skill like `using-superpowers`

Run: `pnpm vitest run sources/sync/suggestionCommands.spec.ts`
Expected: FAIL because skill merging is not implemented yet.

- [ ] **Step 2: Implement app-side command merging**

Update `suggestionCommands.ts` so:
- default commands remain first
- `metadata.slashCommands` still merge in as before
- `metadata.skills` also merge in as slash commands
- skill suggestions get a short description such as `Run installed skill`

- [ ] **Step 3: Run app verification**

Run:
- `pnpm vitest run sources/sync/suggestionCommands.spec.ts sources/sync/skills.spec.ts sources/sync/storageTypes.spec.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/happy-app/sources/sync/suggestionCommands.ts packages/happy-app/sources/sync/suggestionCommands.spec.ts
git commit -m "feat(app): show codex skills in slash autocomplete"
```

## Chunk 3: End-to-End Verification

### Task 4: Run final targeted verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run CLI verification**

Run:
`pnpm vitest run src/codex/codexSkills.test.ts src/codex/codexClearCommand.test.ts src/parsers/specialCommands.test.ts src/utils/createSessionMetadata.test.ts`

Working directory: `packages/happy-cli`
Expected: PASS

- [ ] **Step 2: Run app verification**

Run:
`pnpm vitest run sources/sync/suggestionCommands.spec.ts sources/sync/skills.spec.ts sources/sync/storageTypes.spec.ts`

Working directory: `packages/happy-app`
Expected: PASS

- [ ] **Step 3: Run targeted typechecks**

Run:
- `pnpm exec tsc --noEmit -p tsconfig.json`

Working directory: `packages/happy-cli`
Expected: exit 0

Run:
- `pnpm exec tsc --noEmit -p tsconfig.json`

Working directory: `packages/happy-app`
Expected: exit 0

