# Paws Documentation Calibration Implementation Plan

> **For agentic workers:** Execute this plan in the current isolated worktree. Subagent review is intentionally skipped because the active repository instructions do not authorize delegation for this task.

**Goal:** Make the repository's current, user-facing documentation describe Paws as an independently maintained product with accurate install, distribution, contribution, runtime, and roadmap information.

**Architecture:** Preserve internal `happy-*` package names, compatibility aliases, protocol identifiers, and historical design/research records. Update only active maintenance guidance and public-facing documents; explicitly label inherited or historical documents instead of mechanically renaming technical identifiers.

**Tech Stack:** Markdown, pnpm workspace metadata, Expo app configuration, GitHub Actions.

---

## Chunk 1: Maintenance model and documentation map

### Task 1: Record the independent-project model

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/README.md`

- [x] State that Paws is independently maintained and does not routinely sync from `upstream`.
- [x] Preserve `upstream` only as historical attribution/reference.
- [x] Explain which inherited documents may legitimately retain Happy/internal names.

### Task 2: Replace the stale roadmap

**Files:**
- Modify: `docs/roadmap.md`

- [x] Separate shipped foundations, current stabilization priorities, and later product bets.
- [x] Reflect the current Paws distribution and Agent/App capabilities.
- [x] Avoid dates or promises that are not backed by an active milestone.

## Chunk 2: User and contributor onboarding

### Task 3: Calibrate bilingual getting-started guides

**Files:**
- Modify: `docs/getting-started.md`
- Modify: `docs/getting-started.zh-CN.md`

- [x] Make `npm install -g @wangjs-jacky/paws` the default install path.
- [x] Keep source linking as a contributor/developer path.
- [x] Correct Paws terminology, supported agents, and runtime/channel matrix.
- [x] Remove instructions that route normal users to the upstream product.

### Task 4: Rewrite contribution guidance for this repository

**Files:**
- Modify: `docs/CONTRIBUTING.md`

- [x] Use the Paws repository, sibling-worktree model, actual package names, and current bundle IDs.
- [x] Document static checks and the preview OTA boundary without requiring a dev server.

## Chunk 3: Public product surfaces

### Task 5: Rebrand active legal, distribution, and marketing docs

**Files:**
- Modify: `PRIVACY.md`
- Modify: `packages/happy-app/TERMS.md`
- Modify: `packages/happy-app/Stores.md`
- Modify: `packages/happy-app/docs/marketing/README-creators.md`
- Modify: `packages/happy-server/README.md`

- [x] Replace upstream product names and links with Paws equivalents.
- [x] Remove obsolete App Store/Play Store and upstream-hosted-server claims.
- [x] Keep technical privacy claims conservative and aligned with the current codebase.

### Task 6: Correct active deployment/self-host commands

**Files:**
- Modify: `docs/deployment.md`
- Modify: `docs/selfhost-intranet-deploy.md`

- [x] Prefer the `paws` command for users while preserving internal package paths.
- [x] Use current workspace package names in pnpm commands.

## Chunk 4: Verification and delivery

### Task 7: Verify the documentation set

- [x] Search active docs for obsolete repository URLs, package IDs, unpublished-package claims, and user-facing `happy` install commands.
- [x] Validate local relative Markdown links.
- [x] Run `pnpm -r --if-present typecheck`.
- [x] Run the full workspace test suite.
- [x] Review `git diff --check` and the final diff.

### Task 8: Integrate directly

- [ ] Commit the focused documentation change.
- [ ] Push `docs-paws-calibration`.
- [ ] Create a PR to `main` and merge it after checks are green.
- [ ] Update the root checkout to `origin/main` and remove the worktree/branch.
