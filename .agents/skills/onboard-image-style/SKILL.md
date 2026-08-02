---
name: onboard-image-style
description: Turn user-provided example images into a reusable built-in Paws image-gallery style. Use when a user asks to add, register, or onboard a new image style from screenshots, before/after examples, reference photos, or generated examples, including optional Web deployment or Preview OTA delivery.
---

# Onboard Image Style

Convert the exact reference images attached in the current request into one deterministic gallery preset: analyze and deduplicate inputs, extract transferable visual rules, generate an original cover, register the preset, verify it, and deliver only to explicitly authorized channels.

## Input contract

- Use only attachment paths explicitly supplied in the current turn. Never scan, sort, or infer files from `~/.happy/attachments`.
- Treat the images as style evidence, not as assets to publish. Never commit a user attachment or a crop of it.
- Separate the requested style from screenshot chrome, `Before`/`After` labels, phone UI, watermarks, people, brands, and the original scene content.
- If the user gives no style name, category label, or accent color, derive concise values from the examples. Ask only when a choice would materially change the result.
- Before external actions, resolve one delivery envelope: code only, Web, Preview OTA, or both. Production OTA always requires explicit authorization.

## Workflow

### 1. Prepare safely

Read the repository `AGENTS.md`, root `CLAUDE.md`, and the nearest package instructions. Keep the root workspace clean and work in a sibling worktree following the repository rules.

Record the exact attachment paths, then inspect them without directory discovery:

```bash
pnpm style:onboard:inspect -- /absolute/reference-1.jpg /absolute/reference-2.jpg
```

Use `duplicateGroups` to collapse byte-identical images and `nearDuplicateGroups` to identify visually equivalent encodings. Visually confirm near-duplicate groups before keeping one representative, then review the remaining images for complementary evidence.

### 2. Extract the reusable style

Describe only transferable attributes:

- subject preservation and focal hierarchy;
- composition and crop;
- motion, depth of field, texture, and edge treatment;
- lighting, palette, contrast, grain, and atmosphere;
- elements to remove or avoid.

Write a direct generation instruction longer than 200 characters. Preserve a future user's subject identity and composition unless the style requires a controlled change. Explicitly exclude screenshot UI, comparison layouts, labels, logos, watermarks, duplicate anatomy, and unrelated source-scene details.

### 3. Generate an original cover

Use the image-generation tool to create one clean gallery preview demonstrating the extracted style on a new generic subject or scene. Do not edit or reuse a reference photo as the cover. Do not add `Before`, `After`, `PRE`, `AI`, phone chrome, logos, or explanatory text.

Inspect the generated file and record its real pixel dimensions. Prefer a portrait cover around 3:4 when the style supports it.

### 4. Create and validate the spec

Read [references/spec.md](references/spec.md), copy [references/example-spec.json](references/example-spec.json) to a temporary path outside the repository, and replace every example value. Populate `referenceSha256` from the inspection output. Never add the temporary spec to git.

Run a no-write pass first:

```bash
pnpm style:onboard -- --spec /absolute/style-spec.json --dry-run
```

Then apply the same validated spec:

```bash
pnpm style:onboard -- --spec /absolute/style-spec.json
```

The script prepares the category or count update, preset, manifest entry, static React Native asset mapping, normalized preview asset, and test counts as one batch, then writes them with rollback on a normal command failure. It rejects duplicate IDs or provenance, invalid dimensions, unsupported or oversized images, attachment paths (including symlinks), and preview content that matches an inspected reference hash.

### 5. Verify

Run at minimum:

```bash
pnpm style:onboard:test
pnpm --filter happy-app exec vitest run sources/components/agents/imageStylePreviewManifest.test.ts sources/components/agents/imageAgentPrompt.test.ts
pnpm --filter happy-app typecheck
git diff --check
```

Confirm that the new ID appears exactly once in each registry, the asset exists in `reference-examples`, the category/style counts match, and no attachment path or user image is tracked.

### 6. Commit and deliver

Review the complete diff, use the repository commit format, and report the commit hash and fresh test evidence. Push, deploy Web, or publish Preview OTA only when the delivery envelope authorizes it. For Preview OTA, follow the repository release instructions and return the required Happy OTA metadata.

## Failure handling

- If references disagree, state the ambiguity and ask for the intended variant instead of blending unrelated styles.
- If cover generation fails, stop before registration; never substitute a user attachment.
- If `--dry-run` fails, fix the spec and repeat it. Do not hand-edit around validation.
- If verification fails, keep the failure visible and do not deploy or publish.
