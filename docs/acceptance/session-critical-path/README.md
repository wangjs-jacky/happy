# Session critical-path acceptance gate

Task 10 runs this acceptance procedure with the existing authenticated Ego workflow, an online selectable machine, and a known deep-link session. Do not use Playwright or another browser runner.

Before collecting or storing evidence, redact it. Never include login or account data, browser storage, credentials, cookies, tokens, device identifiers, private prompts, internal addresses, server addresses, or screenshots that reveal any of them. Evidence is limited to resource URLs and the two durations below. Use a safe HTTPS origin and known session ID only as command parameters; do not put them into this document or a checked-in evidence file.

## Gate commands

Print the read-only browser-side collection contract after the workflow has navigated and measured both paths:

```sh
pnpm --filter happy-app perf:session-critical-path -- \
  --origin <https-origin> \
  --session-id <known-session-id> \
  --mode print-ego-probe
```

The printed expression only reads `performance` resource entries and the two timing values that the existing Ego workflow sets. It does not read storage, use credentials, send a message, or create data. Copy its result into a minimal JSON file with this shape and no additional fields:

```json
{
  "resources": [{ "name": "https://redacted.invalid/path" }],
  "deepLinkInteractiveMs": 2000,
  "spawnNavigateMs": 7000
}
```

Evaluate it:

```sh
pnpm --filter happy-app perf:session-critical-path -- \
  --origin <https-origin> \
  --session-id <known-session-id> \
  --mode evaluate-json \
  --input <measurement-json-path>
```

The command prints `{ ok, legacySessionCalls, deepLinkInteractiveMs, spawnNavigateMs }`. It exits non-zero if either duration exceeds its limit or a resource URL has the exact pathname `/v1/sessions`. Query strings and fragments do not bypass that check. The boundary values 2000 ms and 7000 ms pass.

## Required two runs

1. **Fresh-context deep link.** In a fresh authenticated context, open the known session deep link. Measure navigation start to both visible header and latest-message completion; record the resulting deep-link interactive duration as `deepLinkInteractiveMs`.
2. **New text session.** Send a safe test message in a new text session. Measure send click to the new-session event, message queue, route navigation, first agent event, and turn completion; record the resulting new-session navigation duration as `spawnNavigateMs`.

For both critical paths, perform the final resource assertion: exact-path `/v1/sessions` calls must be **0**. The evaluator accepts only the minimum evidence fields shown above and rejects malformed JSON, malformed shapes, and malformed resource URLs.

Task 10 is responsible for executing Ego, collecting screenshots or MP4 evidence when needed, and cleaning up any test-created side effects. This Task 9 gate neither runs a browser nor performs those actions.
