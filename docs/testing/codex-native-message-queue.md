# Codex native message queue acceptance

The queue keeps the current Codex CLI interaction: Enter steers the active native
turn; Tab queues a later turn. Autocomplete consumes Tab first. The explicit
queue button also queues slash commands. Steering uses `turn/steer` with the
expected native turn ID and never falls back to abort plus a new turn. It uses
the running turn's model, effort and permission settings.

## Real Ego acceptance (2026-10-02)

Environment: isolated account, local full Happy server and Expo Web, built Paws
CLI connected to Codex 0.159.3 with a real gpt-6.1-sol model. The prompts only
waited or returned markers; they did not modify project files. No production
account, server, deployment or daemon was used.

| Case | Acceptance criterion | Result |
| --- | --- | --- |
| Enter while working | Original tool completes and original answer includes guidance; native turn ID unchanged | Pass |
| Tab while working | Message remains queued until original turn completes, then starts its own turn | Pass |
| Queue “Send now” | Queue row becomes same-turn guidance; unrelated queued row stays queued | Pass |
| Delete | Removed row is never delivered | Pass |
| Reload | Remaining queue survives refresh and dispatches after original completion | Pass |
| Queued `/skills` | Command cannot steer; completes locally, then following message dispatches | Pass |
| Recover for editing | Text returns to composer, row leaves queue, edits can be queued again | Pass |

Native trace for the Enter case: turn `01a0fb7b-9f37-7c30-92cc-5aec05a7ac0b`
started, `turn/steer` was acknowledged, and that same turn completed with
`ORIGINAL_DONE` and `STEER_REPLY_DONE`. Only afterward did queued turn
`01a0fb7c-712e-70f3-8cb0-44360d5fa7fb` start and answer `QUEUED_REPLY_DONE`.

Verified key frames were delivered through Happy Skills browser progress using
one Ego task space and run ID. Local fixture under
`packages/happy-app/sources/trash/message-staging-queue` is a UI/state-machine
debugging aid, not evidence for this full integration test.

The Happy media card contains a **sampled key-state video**, assembled from
verified frames (24 seconds, H.264/yuv420p, 1920×1080 at 30 fps), not a continuous
recording. Full decoding and visual coverage checks passed. The attempted CDP
screencast lagged behind the final UI and is not used as acceptance evidence.

## Reproduce

1. Build CLI in an isolated worktree. Create an isolated environment with the
   repository's `environments/environments.ts` helpers; run its full server and
   Expo Web. Authenticate its test account without recording credentials.
2. Start the built CLI in that environment's test project with its isolated
   `HAPPY_HOME_DIR`, server URL and Web URL. Use `--started-by daemon` to avoid
   affecting the normal daemon. Use a real authenticated Codex account/model.
3. Open that session in one Ego task space. Ask Codex to execute a 35-second
   Python sleep and reply `ORIGINAL_DONE`. While working, Tab-queue a request
   for `QUEUED_REPLY_DONE`, then Enter-send guidance to append
   `STEER_REPLY_DONE`. Verify the same native turn remains active and the
   queued message is still present. Wait for both answers in order.
4. Repeat with a longer wait. Queue two texts, a `/skills` command and a final
   marker request using the explicit queue button. Recover and edit a text,
   requeue it, then delete it. Click another row's “Send now”; refresh and
   verify the remaining command/marker queue persists and drains in order.
5. Capture verified key states with `captureVerifiedBrowserStep`, report them
   to Happy, and close the same Ego task space only after the final verified
   state. Stop only the isolated CLI/server/Expo processes.

The reusable Chinese-locale Ego script is
`scripts/verify-codex-native-queue.ego.mjs`. After step 2, pass the already
recorded `EGO_TASK_SPACE_ID`, `EGO_TARGET_ID`, `EGO_SESSION_URL`, `EGO_RUN_ID`,
`HAPPY_CAPTURE_SESSION_ID` and the helper's file URL as
`EGO_CAPTURE_HELPER_PATH`, then run
`ego-browser nodejs < scripts/verify-codex-native-queue.ego.mjs`.
It reads real synchronized turn state, verifies editing, deletion, Enter/Tab,
reload and queued `/skills` progression, and emits the final verified frame.
The caller reports that exact frame to Happy and finishes the same task space.

Older CLIs without the advertised `codexSteer` capability retain queueing;
native steering requires the updated CLI. Native Android rendering, image
steering through the browser, and multi-device queue synchronization were not
part of this Web acceptance. The queue is local to the signed-in client.

## Old CLI send-now regression (2026-10-02)

The queue-row action previously remained enabled without `codexSteer` or an
active turn ID. Clicking it marked a queued message as failed even though no
RPC was attempted, which then blocked automatic queue draining. The view and
dispatcher now share an availability check; unavailable guidance leaves the
message queued. Idle slash-command retries are also enabled.

Real Ego regression used the isolated `fresh-birch` account/server/Expo app,
an actual pre-feature CLI build (advertised version 1.3.16), and a freshly
built native-steering CLI (1.3.17 source). No production worker was restarted.

| Case | Observed result |
| --- | --- |
| Old CLI while running | Send now disabled; upgrade/new-session explanation visible; text remains queued |
| Old CLI after completion | Original and queued marker requests both received actual model replies; queue emptied |
| New CLI queue-row Send now | Guidance accepted in original turn `01a0fc92-fe15-7e30-aea5-3faf6929d2fc`; original tool and guided answer completed |
| Remaining queued text | Received model reply in separate turn `01a0fc93-b1d9-7280-b1b9-8909684eebf2` |
| Take back for edit | Restored exact queued text to the visible session input |

To repeat: start one old and one new real worker against an isolated environment.
For the old worker, request a 35-second sleep, then Enter-submit a second marker
request while busy. Verify the disabled queue-row action and wait for both
answers. For the new worker, Tab-queue a marker request and guidance, click the
guidance row's Send now, and verify the original native turn identity and both
final replies. Capture/report verified states using the existing Ego helper.

Previously failed or interrupted submissions remain manual retries because
acceptance can be ambiguous. This patch does not automatically resend them.
Old CLIs also lack the immediate-command completion lifecycle: queued `/skills`
and similar commands may hold later messages. Use an updated CLI for command
queues and native guidance. Publishing only the Web does not update workers;
existing sessions retain the runner that started them.
