# 我的 Agent acceptance fixture

Run from the repository root:

```sh
MY_AGENTS_FIXTURE_PORT=18785 node packages/happy-app/e2e/fixtures/my-agents/serve.mjs
```

Use **Ego** at the printed localhost URL. The fixture uses the real RN
`MyAgentsScreen`, `MyAgentCard`, launch coordinator, built-in Skill file, CLI
`agent_skills` / `agent_save` handlers, canonical scanner, and persistent
`ProfileService`. It uses the application's `ginghamDark` tokens.

Authentication, encrypted session storage, machine RPC, hydration and model
responses are deterministic boundaries. Only temporary fixture profiles and
synthetic sessions are mutated. The session view is a fixture, not the real
conversation shell. Actual account-server isolation and machine RPC registration
are tested separately by `my-agents.test.ts` and `apiMachine.test.ts`.

1. **AG-01:** Describe a 狗头军师 and click 创建 Agent. The model simulator loads
   the actual built-in Skill, discovers real temporary Skill files and calls the
   real save tool. Open the returned card. Check two bindings and 可开始对话.
2. **AG-02:** Check list/detail navigation, empty/filled input, keyboard focus,
   scrolling and advanced configuration at desktop widths. Use 390×844 to check
   horizontal overflow and visible touch controls; this does not prove native
   Android keyboard/safe-area behavior.
3. **AG-03:** Give it a task. The normal-session boundary receives encrypted-role
   metadata before the message, and the fixture response shows the saved role.
   Return to details and continue the recorded session. This does not prove
   actual daemon launch, LLM method choice or response quality.
4. **AG-04:** Ask to change its working method; open the updated card, clear long
   preferences and inspect the saved profile. Existing Skills/history remain.
   Empty preference supersession and resumed Codex instruction refresh are
   covered by `codexAppPromptLifecycle.test.ts`.
5. **AG-05:** Archive; task creation disables and list hides it. Show archived,
   open and restore. History and Skills remain. Account A/B separation is a
   service test, not a fixture UI assertion.

Stable selectors: `textarea[aria-label="想创建什么 Agent"]`,
`button[aria-label="创建 Agent"]`, `button[aria-label="开始使用 狗头军师"]`,
`[data-testid="my-agent-status"]`, `textarea[aria-label="Agent 任务"]`,
`button[aria-label="开始对话"]`, `textarea[aria-label="修改 Agent 的要求"]`,
`button[aria-label="帮我调整"]`, `button[aria-label="清除长期偏好"]`.

Record the numeric Ego task-space ID and exact targetId once. Resume that space
by ID and verify the expected URL before each round. Capture/report meaningful
steps with Happy's session-bound `captureVerifiedBrowserStep` helper. Do not
use shared screenshot filenames or operate another task's tab. Stop the server
with SIGTERM after verification to remove its temporary account data.
