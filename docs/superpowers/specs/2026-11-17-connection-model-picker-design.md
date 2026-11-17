# Connection-aware model picker

## Intent and approved behavior
The user approved “按推荐直接改：跨连接新开，保留旧会话”. A composer can show models from the selected machine's native Codex/Magpie connection and owned ChatGPT accounts. Selecting a model on the current connection keeps the existing model-change behavior. Selecting a different connection starts a fresh Paws session, navigates only after success, and leaves the original session, its messages, running work, draft, and connection untouched. Device default bindings are never mutated.

## Approaches
- Temporarily change the machine binding: existing workaround, rejected for this feature because it affects concurrent starts.
- Keep one thread while changing providers: requires context migration and changes existing conversation semantics; user chose the alternative.
- **Chosen:** connection-qualified menu entries and an explicit per-launch connection. Same-connection switches stay local; cross-connection selection starts an empty session in the same directory. No history or drafts are automatically forwarded.

## Scope and boundaries
- Reuse existing composer/picker styling and theme tokens on Web and native.
- Each option has a stable connection + model identity, display label, and optional description. Duplicate model IDs on different connections must remain distinct.
- Native models are discovered by one user-triggered, read-only machine RPC; no inference, polling, default writes, or busy-worker restart.
- Owned account profiles use their matching session catalog when available. A profile without a catalog remains available as an explicit automatic-model launch entry, never supplemented with hardcoded models from another connection.
- A per-launch native choice skips managed-account grant creation. A per-launch ChatGPT choice requests a grant for the selected owned profile without changing the device binding. Existing implicit launches retain binding/version checks.
- Server enforces user/machine/profile ownership, credential validity, one-time grants, and existing audited resume/service authority. The new explicit profile path applies only to fresh launches.
- Older CLI/RPC absence yields current-connection models plus an honest refresh error; never silently launches on the default connection when an explicit route was selected.
- No deployment, machine activation, account changes, or Tauri work is included. Shared JS changes are OTA-eligible; no native/runtime change.

## Acceptance cases
C1: A bound ChatGPT session shows native DeepSeek-V4.1-Flash alongside its own account models, with connection labels.
C2: Selecting native DeepSeek launches a fresh session with exact model and native connection; old session and machine binding remain unchanged.
C3: Selecting a model on the same account only updates the existing session.
C4: Switching from native to a chosen ChatGPT account issues an owned per-launch grant independently of the device default.
C5: Duplicate clicks, failed launch, stale auth/machine/catalog responses and unsupported RPC do not create incorrect sessions or navigate away.
C6: New-session selection can explicitly choose the native connection without changing the default account.
