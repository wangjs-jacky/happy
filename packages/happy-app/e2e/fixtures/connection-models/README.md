# Connection-model picker acceptance

Run from the repository root:

```sh
pnpm exec tsx --tsconfig packages/happy-cli/tsconfig.json packages/happy-app/e2e/fixtures/connection-models/serve.mjs
```

This reuses the full-App Codex-settings fixture infrastructure. It creates an isolated PGlite server, synthetic account credentials, a synthetic machine bound to that account, and real encrypted machine/session sockets. The native directory and executor are stubs. It never connects to production, starts a real daemon, or performs model inference.

Ignored `test-results/connection-models/runtime.json` identifies the local origin, source session, controller, and default profile. `auth-url.txt` is private: read it in the authorized Ego runtime, navigate without printing it, and move to a clean URL before evidence capture. Use only Ego for browser execution.

## Cases

1. Open the source account session's composer settings, then model search. Confirm native DeepSeek and the account's models have distinct connection labels and cross-connection entries say they open a new session.
2. Enter a synthetic draft in the original session. Select native `deepseek/DeepSeek-V4.1-Flash`. Confirm a new session ID, exact initial model, and native connection in controller metrics.
3. Select `gpt-6.1-sol` on that same native connection: URL and spawn count stay unchanged.
4. Select account `gpt-6.1-sol`: a second session is created using an explicit one-time grant. Device binding/version stay unchanged.
5. Return to the original session and confirm its draft is still present and no message was forwarded.
6. On the new-session page, choose native DeepSeek while the machine remains account-bound. Reload before sending and confirm that both connection and model are restored. Submit one synthetic message and verify the received model ID and native spawn.
7. At 900×550, search, inspect connection/action labels, close with Escape and verify focus restoration.

## Controller and cleanup

- GET `/metrics`: whitelisted spawn/received model data, native directory reads, abort count; no prompt or credentials.
- GET `/connections`: synthetic public account/binding metadata.
- POST `/shutdown`: stop this fixture's clients/server/web services and remove only its own environment.

The backend grant issuer/redeemer and session registration are real. Synthetic access tokens are never used against OpenAI. Directory-read subprocess isolation and real Magpie directory discovery have separate CLI tests/evidence. This fixture proves UI and transport behavior, not external-model inference, native-device behavior, deployment, or production activation.
