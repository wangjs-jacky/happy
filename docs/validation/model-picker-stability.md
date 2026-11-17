# Model picker stability — 2026-11-17

Base: 0446739b10ec7a0685ab8540dca012633253dc70 (main). Worktree: happy--model-picker-stability.

## Confirmed code paths

- getSuggestedModelModes added current hardcoded GPT releases to a session's provider catalog. Those suggestions were not evidence that the selected connection supported the model.
- A running Codex session without model metadata exposed the full hardcoded GPT fallback, changing to its actual catalog after metadata arrived.
- SessionConfigPanel held its model as an array index. Catalog replacement/reordering could change the identity behind that index. It now holds a key and preserves it within the same machine/agent/account/selection scope.
- getAvailableModels injected a selectable default reset into Codex catalogs. Codex catalogs and the unified new-session menu now offer concrete models only. The internal default sentinel remains necessary when starting before catalog hydration; outbound reset behavior is preserved.
- A native default selection displays the CLI-reported current model when available, instead of the raw default key.

## Validation

115 tests passed across modelModeOptions, runningSessionTurnModes, messageMeta, SessionConfigPanel, SessionComposerModeSelector, SessionInfoDropdown, newSessionModeSelection, newSessionModelMetadata and newSessionSpawnSettings.

The new component regression selects Terra, reverses the same connection's catalog, and checks that getSelection still returns Terra. Additional checks cover no fabricated GPT choices before metadata, connection-specific catalogs, no default menu item, and native reset semantics before/after hydration.

happy-app typecheck passed. git diff --check passed.

## Limits

No production browser interaction, native-device run, upstream inference request, PR, merge or deployment was performed. These are code-confirmed causes, not proof that all reported server/model errors share one cause. Provider/account/catalog differences may legitimately produce different model lists; catalog membership does not establish upstream inference health. New-session metadata is still borrowed only from matching existing sessions; this change does not implement live catalog discovery for a machine with no prior catalog.
