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
- Existing Claude, ACP, OpenCode, and non-session-protocol behavior remains
  unchanged.

## Non-Goals

- Rendering complete sub-agent transcripts in the main chat.
- Changing Codex's own multi-agent protocol.
- Persisting task lifecycle state on the server.
- Reworking the chat message layout or the connection indicator.

## Design

### 1. Scope raw Codex notifications to the active root thread

`CodexAppServerClient` already owns the active root thread id. Before mapping a
raw notification that carries `params.threadId`, it will compare that id with
the active root id.

Notifications from another thread are ignored by the root event mapper. In
particular they may not:

- update `_turnId`;
- resolve the pending root turn;
- emit root `agent_message`, `task_started`, `task_complete`, or
  `turn_aborted` events;
- mutate root command/file-change bookkeeping.

Notifications without a thread id retain the current compatibility behavior,
because older app-server versions may omit the field. Root notifications whose
thread id matches the active thread continue through the existing mapper.

This is deliberately a filtering fix rather than a new sub-agent rendering
feature. Parent-thread Codex events still provide the root agent's commentary,
tool calls, and final response.

### 2. Carry the root turn result into local App session state

The App will add an optional local-only root-turn result to `Session`, with the
values `completed`, `failed`, and `cancelled`. It is not part of the server API
or encrypted session metadata.

The sync boundary is the single writer:

- root `turn-end` sets the result from the protocol event status;
- legacy root `task_complete` sets `completed`;
- legacy root `turn_aborted` maps to `failed` or `cancelled` using its status;
- the next root `turn-start` or legacy `task_started` clears the result before
  setting `thinking: true`.

Initial message loading also inspects lifecycle events in the fetched page and
restores the newest lifecycle state, so reopening a chat does not immediately
lose the completion label. A newer turn start always wins over an older end.

### 3. Present task state separately from connectivity

`useSessionStatus` keeps presence as the source of connection truth. Its
priority becomes:

1. disconnected;
2. permission required;
3. thinking;
4. most recent root-turn result;
5. connected and waiting.

The composer status text for root-turn results is localized as `已完成`, `失败`,
and `已取消`. These labels remain until the next root turn begins. The existing
green presence dot/header chip continues to communicate that the session is
online; completion is not treated as disconnection.

## Error Handling and Compatibility

- Missing `threadId` remains accepted for backwards compatibility.
- A foreign-thread notification is consumed but produces no root event.
- Unknown completion statuses fall back to `failed`, matching the conservative
  lifecycle treatment already used by the session protocol.
- Optional local state keeps older cached/API session records valid without a
  storage migration.

## Tests

### CLI regression

Simulate one app-server connection with an active root thread and a child
thread. Assert that child `agentMessage(final_answer)`, idle, and
`turn/completed` notifications do not emit root text or completion and do not
resolve the pending root turn. Then emit the matching root final answer and
completion and assert exactly one root completion.

Retain a compatibility test proving that raw notifications without `threadId`
still work.

### App regression

- Lifecycle reduction records completed, failed, and cancelled root results.
- A subsequent turn start clears the result.
- `useSessionStatus` prefers working/permission/disconnected states, then shows
  the retained result, then falls back to online waiting.
- History replay uses the newest lifecycle marker rather than batch arrival
  order.

## Verification

- Focused `happy-cli` Codex app-server tests.
- Focused `happy-app` sync/status tests.
- `happy-cli` typecheck.
- `happy-app` typecheck.
- `git diff --check`.

