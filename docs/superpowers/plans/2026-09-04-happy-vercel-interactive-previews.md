# Happy Vercel Interactive Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-scoped Vercel static previews staged through private OSS, plus PC Web preview cards and a non-blocking Ego progress popover.

**Architecture:** The CLI owns a session-scoped preview workspace and uploads an immutable manifest directly to OSS using server-issued descriptors. Happy Server owns encrypted Vercel installation credentials, publishes staged objects through the Vercel REST API, records expiry, and performs durable cleanup. Typed session events drive read-only PC Web cards; existing browser-step events remain available without replacing the capability hub.

**Tech Stack:** TypeScript, Zod 4, Fastify 5, Prisma/PostgreSQL/PGlite, MinIO S3 API, React Native Web/Expo, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-happy-vercel-interactive-previews-design.md`

## Global Constraints

- PC Web is the first client target.
- Only Happy-issued static workspaces are publishable; never accept an arbitrary directory or localhost port.
- Maximum 100 files, 10 MiB total, 5 MiB per file, with root `index.html` required.
- Vercel credentials stay encrypted on Happy Server and never enter clients, prompts, logs, or signed OSS URLs.
- OSS objects stay private under `private/interactive-previews/` and are removed after publication or by retrying cleanup.
- Vercel publication is explicitly non-production and becomes due for deletion 24 hours after `publishedAt`.
- Preview pages do not receive Happy authentication or report interactions to the Agent.
- Browser steps must not replace `SessionCapabilityHub`.
- All visible surfaces use current Unistyles semantic tokens and include PC Web visual evidence before merge.

---

### Task 1: Shared Preview Contract

**Files:**
- Create: `packages/happy-wire/src/interactivePreview.ts`
- Modify: `packages/happy-wire/src/index.ts`
- Modify: `packages/happy-wire/src/sessionProtocol.ts`
- Test: `packages/happy-wire/src/interactivePreview.test.ts`
- Test: `packages/happy-wire/src/sessionProtocol.test.ts`

**Interfaces:**
- Produces `InteractivePreviewManifestSchema`, `InteractivePreviewStateSchema`, `InteractivePreviewEventSchema`, `PREVIEW_LIMITS`, and their inferred types.
- Adds `{ t: 'interactive-preview'; preview: InteractivePreviewEvent }` to `SessionEvent`.

- [ ] **Step 1: Write failing schema tests** for a valid root `index.html`, traversal, hidden files, duplicate paths, unsupported MIME, more than 100 files, more than 5 MiB per file, and more than 10 MiB total.
- [ ] **Step 2: Run `pnpm --filter @slopus/happy-wire exec vitest run src/interactivePreview.test.ts src/sessionProtocol.test.ts` and verify failure.**
- [ ] **Step 3: Implement the strict contract.** The public interface is:

```ts
export const PREVIEW_LIMITS = { maxFiles: 100, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 } as const;
export type InteractivePreviewAsset = { id: string; path: string; size: number; sha256: string; mimeType: string };
export type InteractivePreviewManifest = { version: 1; previewId: string; title: string; assets: InteractivePreviewAsset[] };
export type InteractivePreviewEvent = { version: 1; id: string; title: string; state: 'publishing' | 'ready' | 'failed' | 'expired'; url?: string; publishedAt?: number; expiresAt?: number; errorCode?: string };
export function validateInteractivePreviewManifest(value: unknown): InteractivePreviewManifest;
```

- [ ] **Step 4: Re-run focused tests and verify pass.**
- [ ] **Step 5: Commit with `feat(wire): add interactive preview contract`.**

### Task 2: Encrypted Vercel Connection and Client

**Files:**
- Create: `packages/happy-server/sources/app/previews/vercelCredentialStore.ts`
- Create: `packages/happy-server/sources/app/previews/vercelClient.ts`
- Create: `packages/happy-server/sources/app/previews/vercelCredentialStore.spec.ts`
- Create: `packages/happy-server/sources/app/previews/vercelClient.spec.ts`
- Create: `packages/happy-server/sources/app/api/routes/vercelConnectRoutes.ts`
- Create: `packages/happy-server/sources/app/api/routes/vercelConnectRoutes.spec.ts`
- Modify: `packages/happy-server/sources/app/api/api.ts`
- Modify: `packages/happy-server/README.md`

**Interfaces:**
- Produces `vercelCredentialStore.get/set/delete(accountId)` and `createVercelClient({ token, teamId, fetch })`.
- Produces authenticated status/params/disconnect routes and a state-authenticated callback.

- [ ] **Step 1: Write failing store tests** asserting provider path `['user', accountId, 'providers', 'vercel', 'credential']`, encrypted persistence, strict parsing, and deletion.
- [ ] **Step 2: Write failing HTTP-client tests** asserting `Authorization: Bearer`, fixed `https://api.vercel.com` origins, hard timeouts, `target: null`, file SHA manifests, no production promotion, and deletion by deployment ID.
- [ ] **Step 3: Write failing route tests** for missing operator configuration, authenticated params/status, one-time account-bound state, callback exchange, provider errors without token leakage, and disconnect.
- [ ] **Step 4: Run the three specs and verify failure.**
- [ ] **Step 5: Implement minimal encrypted storage, provider client, and routes.** Store this strict encrypted shape:

```ts
type VercelCredential = { version: 1; accessToken: string; configurationId: string; teamId?: string; teamName?: string; projectId?: string };
```

- [ ] **Step 6: Re-run focused specs and server typecheck.**
- [ ] **Step 7: Commit with `feat(server): connect Vercel preview provider`.**

### Task 3: Preview Draft, OSS, Publication, and Cleanup

**Files:**
- Modify: `packages/happy-server/prisma/schema.prisma`
- Create: `packages/happy-server/prisma/migrations/20260904090000_add_interactive_previews/migration.sql`
- Create: `packages/happy-server/sources/app/previews/previewStorage.ts`
- Create: `packages/happy-server/sources/app/previews/previewPublisher.ts`
- Create: `packages/happy-server/sources/app/previews/previewCleanup.ts`
- Create: `packages/happy-server/sources/app/api/routes/interactivePreviewRoutes.ts`
- Create corresponding `*.spec.ts` files
- Modify: `packages/happy-server/sources/app/api/api.ts`
- Modify: `packages/happy-server/sources/index.ts`
- Modify: `packages/happy-server/sources/main.ts`

**Interfaces:**
- Produces draft, asset-completion, publish, list, and delete APIs from the spec.
- Produces `startInteractivePreviewCleanup()` and `publishInteractivePreview(previewId)`.

- [ ] **Step 1: Write failing storage tests** for opaque keys, private presigned PUT, exact size, bounded reads, and prefix-only cleanup.
- [ ] **Step 2: Write failing publisher tests** for sequential Vercel file uploads, idempotent manifest publication, `target: null`, ready state, and OSS deletion only after Vercel success.
- [ ] **Step 3: Write failing lifecycle tests** for one-hour draft cleanup, 24-hour deployment deadline, retry tombstones, and duplicate cleanup claims.
- [ ] **Step 4: Write failing route tests** for account/session ownership, immutable draft IDs, manifest mismatch, missing objects, limit enforcement, duplicate publish, list filtering, and delete.
- [ ] **Step 5: Run focused server tests and verify failure.**
- [ ] **Step 6: Add Prisma models and migration, then generate the client.** Status values remain strings to preserve forward compatibility.
- [ ] **Step 7: Implement storage, publisher, routes, and recovery cleanup with at most two active publication jobs and sequential per-file streams.**
- [ ] **Step 8: Run focused tests, `pnpm --filter happy-server typecheck`, and migration smoke against PGlite.**
- [ ] **Step 9: Commit with `feat(server): publish expiring previews through OSS`.**

### Task 4: CLI Workspace and Preview MCP Tools

**Files:**
- Create: `packages/happy-cli/src/previews/previewWorkspace.ts`
- Create: `packages/happy-cli/src/previews/previewApi.ts`
- Create tests beside both files
- Modify: `packages/happy-cli/src/configuration.ts`
- Modify: `packages/happy-cli/src/claude/utils/startHappyServer.ts`
- Modify: `packages/happy-cli/src/codex/happyMcpBridgeTools.ts`
- Modify: `packages/happy-cli/src/codex/utils/permissionHandler.ts`
- Modify corresponding existing tests
- Modify: `packages/happy-cli/src/api/apiSession.ts`

**Interfaces:**
- Produces `PreviewWorkspaceRegistry.create(sessionId, title)` and `.resolveForPublish(sessionId, previewId)`.
- Registers `create_preview` and `publish_preview` across HTTP and stdio Happy MCP servers.

- [ ] **Step 1: Write failing workspace tests** for root allocation, session scoping, `realpath`, symlinks, hidden/denied files, MIME/signature checks, root index, hashes, and all size limits.
- [ ] **Step 2: Write failing API tests** for draft creation, direct presigned uploads, object completion, publish, retry, signed-URL redaction, and local cleanup only after success.
- [ ] **Step 3: Extend MCP and permission tests first** so exact first-party preview tool names are forwarded and auto-approved while substring attacks remain blocked.
- [ ] **Step 4: Run focused CLI tests and verify failure.**
- [ ] **Step 5: Implement the workspace registry, preview API uploader, MCP handlers, and typed session event emission.**
- [ ] **Step 6: Re-run focused tests and `pnpm --filter happy typecheck`.**
- [ ] **Step 7: Commit with `feat(cli): add managed preview MCP tools`.**

### Task 5: Built-in Agent Instruction

**Files:**
- Modify: `packages/happy-app/sources/sync/prompt/systemPrompt.ts`
- Modify: `packages/happy-app/sources/sync/prompt/systemPrompt.test.ts`
- Modify: `packages/happy-cli/src/claude/utils/systemPrompt.ts`
- Modify: `packages/happy-cli/src/claude/utils/systemPrompt.test.ts`

**Interfaces:**
- Instructs every backend to use `create_preview` then `publish_preview` for requested static interaction drafts in remote Happy sessions.

- [ ] **Step 1: Add failing prompt assertions** for remote localhost limitations, Happy-managed preview tools, public-data warning, no arbitrary directory, no Vercel CLI/Cloudflare fallback, and automatic publish after completion.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Add one canonical prompt fragment and reuse it across applicable backends without duplicate injection.**
- [ ] **Step 4: Re-run focused tests.**
- [ ] **Step 5: Commit with `feat(prompts): route drafts through managed previews`.**

### Task 6: PC Web Vercel Settings and Preview Card

**Files:**
- Create: `packages/happy-app/sources/sync/apiInteractivePreviews.ts`
- Create: `packages/happy-app/sources/app/(app)/settings/temporary-previews.tsx`
- Create: `packages/happy-app/sources/components/tools/InteractivePreviewCard.tsx`
- Create tests beside each module
- Modify: `packages/happy-app/sources/components/SettingsView.tsx`
- Modify: `packages/happy-app/sources/sync/typesMessage.ts`
- Modify: `packages/happy-app/sources/sync/typesRaw.ts`
- Modify: `packages/happy-app/sources/components/MessageView.tsx`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`

**Interfaces:**
- Produces connection status/connect/disconnect API functions and a typed preview-card projection.

- [ ] **Step 1: Write failing API and Settings tests** for unavailable, disconnected, popup connection, connected team/project, reconnect, and disconnect.
- [ ] **Step 2: Write failing message tests** for publishing, ready, failed, expired, copy URL, and external open without embedding or callbacks.
- [ ] **Step 3: Run focused App tests and verify failure.**
- [ ] **Step 4: Implement the API, PC-first Settings screen, message projection, and semantic-token card.**
- [ ] **Step 5: Re-run focused tests and `pnpm --filter happy-app typecheck`.**
- [ ] **Step 6: Commit with `feat(app): manage and open temporary previews`.**

### Task 7: Ego Progress Popover

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/BrowserStepsPopover.tsx`
- Create: `packages/happy-app/sources/components/rightPanel/browserStepRunsModel.ts`
- Create corresponding tests
- Modify: `packages/happy-app/sources/components/rightPanel/SessionCapabilityHub.tsx`
- Modify: `packages/happy-app/sources/components/rightPanel/CapabilityHubDetailView.tsx`
- Modify: `packages/happy-app/sources/components/rightPanel/browserStepsModel.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`

**Interfaces:**
- Produces `getBrowserStepRuns(messages)` and an anchored `BrowserStepsPopover` using the existing timeline presentation.

- [ ] **Step 1: Add a failing regression test** proving browser steps no longer replace the capability summary.
- [ ] **Step 2: Add failing grouping tests** for explicit run IDs and the legacy most-recent-Ego fallback.
- [ ] **Step 3: Add failing interaction tests** for Skill-row View progress, pointer/keyboard open, Escape close, focus restore, and viewport-bounded scrolling.
- [ ] **Step 4: Run focused tests and verify failure.**
- [ ] **Step 5: Remove the unconditional `BrowserStepsPanel` return, extract the popover, and attach the trigger only to the associated Ego Skill row.**
- [ ] **Step 6: Re-run tests and App typecheck.**
- [ ] **Step 7: Commit with `fix(app): keep Ego progress out of capability panel`.**

### Task 8: Cross-Package Verification and Visual Evidence

**Files:**
- Create: `packages/happy-server/sources/app/previews/interactivePreview.integration.spec.ts`
- Modify: `packages/happy-app/e2e/web-compose-home.spec.ts`
- Create: `docs/visual-evidence/vercel-interactive-previews/*`
- Modify: `packages/happy-server/README.md`

**Interfaces:**
- Verifies the complete contract and produces immutable PR evidence for every visible PC Web case.

- [ ] **Step 1: Add the local MinIO + fake Vercel integration test** covering create, upload, publish, event data, OSS cleanup, expiry, provider deletion, and restart-safe retry.
- [ ] **Step 2: Add Playwright cases** for Vercel Settings, preview cards, preserved capability hub, and Ego popover in default and `ginghamDark` themes.
- [ ] **Step 3: Run wire, server, CLI, and App focused suites; fix only failures caused by this branch.**
- [ ] **Step 4: Run all four package typechecks and `git diff --check`.**
- [ ] **Step 5: If real operator credentials exist, run the deterministic live Vercel/OSS smoke and explicitly remove its deployment; otherwise record the missing external prerequisite without claiming live verification.**
- [ ] **Step 6: Capture required before/after images with identical PC viewport and add the visual case matrix assets.**
- [ ] **Step 7: Review the complete diff for token/URL leakage, production-target regressions, path traversal, and cleanup durability.**
- [ ] **Step 8: Commit with `test(previews): verify managed preview workflow`.**
