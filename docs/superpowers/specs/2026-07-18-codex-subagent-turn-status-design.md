# Codex Sub-Agent Turn Status Design

## Problem

Codex app-server emits notifications for the active root thread and its spawned
sub-agent threads over the same connection. Paws currently treats every raw
`item/completed`, `thread/status/changed`, and `turn/completed` notification as
belonging to the root thread.

When a review sub-agent finishes with a response such as `Approved.`, Paws
therefore publishes that response as ordinary root-agent text, emits a root
`turn-end`, and clears the session's thinking state while the root agent is
still working. The real root response arrives later, after the UI has already
reported the task as idle.

Separately, the chat composer represents an online idle session as `在线`.
That label describes transport presence, not task lifecycle, so a correctly
completed root turn still has no explicit completion acknowledgement.

## Goals

- A sub-agent completion must not publish a root-agent final answer or end the
  root turn.
- Only lifecycle notifications for the active root Codex thread may control
  root `task_started`, `task_complete`, and `turn-end` events.
- The App must distinguish connectivity from the most recent root-turn result.
- `已完成`, `失败`, or `已取消` remains visible until the next root turn starts.
- Provider message content and non-session-protocol ingestion remain unchanged;
  all flavors using the unified session protocol gain the same explicit root
  turn-result label.

## Non-Goals

- Rendering complete sub-agent transcripts in the main chat.
- Changing Codex's own multi-agent protocol.
- Persisting task lifecycle state on the server.
- Reworking the chat message layout or the connection indicator.

## Design

### 1. Scope raw Codex notifications to the active root thread

`CodexAppServerClient` already owns the active root thread id. The app-server
protocol places thread identity at the top-level `params.threadId` for its
thread-scoped raw notifications. At the start of raw-notification handling,
before any state mutation, the client will compare a string `params.threadId`
with the active root id.

Notifications from another thread are ignored by the root event mapper. In
particular they may not:

- update `_turnId`;
- resolve the pending root turn;
- emit root `agent_message`, `task_started`, `task_complete`, or
  `turn_aborted` events;
- mutate root command/file-change bookkeeping.

Notifications with a non-string or missing thread id retain the current
compatibility behavior, because older app-server versions may omit the field.
The client deliberately does not guess identity from nested objects. Root
notifications whose thread id matches the active thread continue through the
existing mapper. Thus the strict root-only guarantee applies whenever the
provider supplies its canonical thread id; the missing-id path is an explicit
backwards-compatibility exception.

This is deliberately a filtering fix rather than a new sub-agent rendering
feature. Parent-thread Codex events still provide the root agent's commentary,
tool calls, and final response.

### 2. Preserve ordered root lifecycle markers during normalization

Session-protocol `turn-start` and `turn-end` envelopes will normalize to an
invisible lifecycle record instead of dropping start or collapsing end into a
status-less generic `ready` event. The normalized record contains:

- `status`: `running`, `completed`, `failed`, or `cancelled`;
- server message `seq` when available;
- `createdAt` and message id, inherited from the encrypted message record.

This is separate from the existing generic `ready` event used by voice hooks,
but reducing a terminal lifecycle record still sets the reducer's existing
`hasReadyEvent` flag. `voiceHooks.onReady` therefore keeps firing once for root
turn completion without depending on the normalized content shape.

The session-message reducer owns a local `rootTurnLifecycle` value. It applies
each lifecycle record through a small reducer and only accepts a record newer
than its watermark. Server message `seq` is the primary ordering key. The sync
layer passes the API/realtime record sequence into normalization; for direct or
legacy records without a sequence, the fallback is `(createdAt, arrivalOrder)`,
where `arrivalOrder` is a monotonic counter local to that session-message
reducer. A sequenced lifecycle record always outranks an unsequenced record
once the session has observed a sequence. The state lives in `SessionMessages`,
not `Session`, so server session refreshes cannot overwrite it.

Realtime delivery, initial latest-page loading, and older-page replay all pass
through the same reducer. Consequently an older page arriving after a live
completion cannot roll state backwards, while reopening a chat restores the
newest lifecycle marker present in fetched history.

Status mapping is exact at the unified protocol boundary:

- `turn-start` becomes `running`;
- `turn-end: completed` becomes `completed`;
- `turn-end: failed` becomes `failed`;
- `turn-end: cancelled` becomes `cancelled`.

The existing CLI mapper remains responsible for converting legacy Codex MCP
events into these valid session-protocol statuses. An explicit valid status
(`completed`, `failed`, `cancelled`, plus normalized spelling `canceled`) wins.
Otherwise `task_complete` is completed unless it carries an error, while
`turn_aborted` is cancelled unless its reason or error indicates failure.
Unknown provider statuses never reach App lifecycle state directly.

### 3. Present task state separately from connectivity

`useSessionMessages` exposes `rootTurnLifecycle` alongside visible messages.
`useSessionStatus` accepts that lifecycle value while keeping presence as the
source of connection truth. Its priority becomes:

1. disconnected;
2. permission required;
3. thinking;
4. most recent root-turn result;
5. connected and waiting.

When lifecycle is `running`, the existing thinking state remains authoritative.
When a new `turn-start` is reduced, the prior result is replaced immediately,
so its label disappears before the next response begins.

The composer status text for root-turn results is localized in every supported
locale (`已完成`, `失败`, and `已取消` in Chinese). These labels remain until the
next root turn begins. The existing green presence dot/header chip continues to
communicate that the session is online; completion is not treated as
disconnection. Permission continues to outrank thinking, matching current UI
behavior when both states are present.

## Error Handling and Compatibility

- Missing `threadId` remains accepted for backwards compatibility.
- A foreign-thread notification is consumed but produces no root event.
- Session lifecycle state is local message-derived state and requires no server
  schema or persisted-session migration.

## Tests

### CLI regression

Simulate one app-server connection with an active root thread and a child
thread. Send foreign `turn/started`, command execution, file change,
`agentMessage(final_answer)`, idle, and `turn/completed` notifications. Assert
they do not change the root `_turnId`, resolve the pending root turn, emit root
text/lifecycle/tool events, or mutate root file-change bookkeeping. Then emit
the matching root final answer and completion and assert exactly one root
completion.

Retain a compatibility test proving that raw notifications without `threadId`
still work.

### App regression

- Lifecycle normalization retains start and the exact end status.
- Lifecycle reduction records running, completed, failed, and cancelled root
  results; a subsequent turn start replaces the prior result.
- `useSessionStatus` prefers working/permission/disconnected states, then shows
  the retained result, then falls back to online waiting.
- A live completion followed by an older-page load does not roll state back.
- A newer start followed by a late older end remains running.
- Equal-timestamp start/end markers applied in either arrival order resolve by
  server sequence.
- Initial latest-page loading restores lifecycle before visible status renders.
- Server session refresh leaves message-owned lifecycle state intact.
- Terminal lifecycle reduction still raises `hasReadyEvent` and invokes the
  existing voice-ready path.

## Verification

- Focused `happy-cli` Codex app-server tests.
- Focused `happy-app` sync/status tests.
- `happy-cli` typecheck.
- `happy-app` typecheck.
- `git diff --check`.
