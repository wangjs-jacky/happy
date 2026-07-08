# AGENTS.md - Codex Entry Point

This file is the Codex-facing entry point for this repository. Keep project rules centralized in `CLAUDE.md` to avoid drift between Claude and Codex instructions.

## Critical Root Workspace Rule

Before doing any repo work, assume this invariant unless the user explicitly says otherwise:

- The root workspace `~/jacky-github/happy` is reserved for a **clean `main` only**.
- It must stay **exactly aligned with `origin/main`**.
- Do **not** develop, experiment, or leave tracked/untracked changes in the root workspace.
- All implementation work must happen in a sibling git worktree such as `../happy--<topic>`.
- If the root workspace is dirty, **first migrate or stash that work into a sibling worktree and restore the root workspace to clean `main`**, then continue.

Quick check:

```bash
cd ~/jacky-github/happy
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

If `git status --short` is non-empty, or `HEAD` differs from `origin/main`, fix that first.

## Required Project Instructions

Before making project changes, read and follow the root `CLAUDE.md`.

`CLAUDE.md` is the source of truth for:

- remotes and branch model
- worktree location, naming, and dependency setup
- build, test, and local development commands
- commit, PR, Android APK, OTA, and upstream sync rules
- the "root workspace stays clean main" invariant

If this file conflicts with `CLAUDE.md`, prefer `CLAUDE.md` unless the section below explicitly matches the user's wording.

## Sync To Main

This section is preserved from the original `AGENTS.md` for compatibility with existing Codex workflows. In normal fork development, `CLAUDE.md` defines `main` as the integration branch. Only use this legacy workflow when the user explicitly says `sync to main` or `synt to main`.

When the user says `sync to main` or `synt to main`, they mean:

1. Fetch `origin/main`.
2. Rebase the current branch on `origin/main`.
3. Push the current HEAD directly to `main` with a normal push, for example:
   `git push origin HEAD:main`

Do not force push for this workflow.
