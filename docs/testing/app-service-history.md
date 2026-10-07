# Application service history regression

The owner application directory must include both legacy delegation conversations and
`ai-services/1` conversations. Opening either kind decrypts its retained transcript;
switching accounts clears the previous account's list and messages. Reading never starts
an execution. A service conversation uses the device and account pinned in its binding.

## Automated checks

Run the relevant app history, hook, sidebar, menu and machine encryption Vitest tests,
plus server `ownerHistory.spec.ts`, `transport.spec.ts`, `appDelegation.spec.ts` and
`appDelegationRoutes.spec.ts`. The owner history suite uses a real ephemeral PostgreSQL
engine and covers mixed pagination, cross-owner denial, retained revoked/expired history,
and read-only stale status projection.

## Ego browser acceptance

From a sibling worktree, install dependencies and build the Web app:

```sh
CI=1 EXPO_OFFLINE=1 HAPPY_E2E_DISABLE_WATCHMAN=1 pnpm --filter happy-app export:web
HAPPY_APP_HISTORY_BROWSER_FIXTURE=1 pnpm --filter happy-server-self-host test sources/app/aiServices/ownerHistory.egoFixture.spec.ts
```

The fixture listens on `http://127.0.0.1:14318` (override with
`HAPPY_APP_HISTORY_BROWSER_PORT`). It serves the actual exported app and owner API routes,
with a temporary database, synthetic accounts and real encrypted transcripts. It does
not connect to production or execute models; socket and unrelated endpoints are absent.
Normal test runs skip this opt-in fixture. It stops after ten minutes or on
`POST /__e2e/stop`.

In another terminal, run:

```sh
ego-browser nodejs <<'EOF'
const { verifyAppServiceHistory } = await import(process.cwd() + '/scripts/verify-app-service-history.ego.mjs');
const { task } = await verifyAppServiceHistory({ taskSpace });
await task.finish({ keep: [] });
EOF
```

The runner checks mixed directory, legacy question/answer, four shared transcript
messages, real menu switch A→B with empty history, and B→A with the shared transcript
restored. It writes synthetic account storage only on the fixture origin. It returns
the task for the caller to capture/report the verified final state before finishing;
Happy callers must supply their session-bound capture/report callback via `onVerified`.
To resume an existing task instead of creating one, pass its recorded numeric `spaceId`.

This verifies the Web reader and account switch against real route implementations,
not native mobile layout, production deployment or live model execution.
