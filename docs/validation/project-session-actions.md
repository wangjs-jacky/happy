# Project conversation actions and lifecycle

## Behavior

- Replace the project conversation ellipsis menu with separate delete and archive icons. Keep the existing delete confirmation and close-panel action.
- After removal, select the newest remaining available conversation. Continue finite Task history pagination when the loaded page is exhausted; close only when no available conversation remains.
- Exclude archived/archive-requested sessions from history lists and continuation. The daemon filters before its page limit, including sessions without a locally hydrated header; archive history still protects once-only Task execution.
- Keep owner validation, read-only previews, and late completion/navigation guards. A blurred page cancels deferred selection.
- Online global continuation uses fresh authoritative history; only newly acknowledged sessions still awaiting their first catalog/header appearance may be reused locally.

## Verification

The regressions were reproduced before the implementation, including absent-header archives, exhausted loaded pages, and a wrong-owner route exposing management actions. Related component/history tests, the complete App test suite, Wire build, App/CLI typechecks, and CLI project service/runtime tests are recorded in the PR.

A broader CLI Goal Board run encountered one `No fs.watch update` timeout in the unchanged watcher test. Its isolated rerun passed. This is separate from the changed service/runtime regressions.

## Delivery boundary

This change includes the CLI Goal service as well as the App. Full filtering of older machine history requires updating that service together with the Web/App change. No running daemon, existing conversation, or production deployment was changed during source validation.

Before/after screenshots were requested as an optional review choice; no response or screenshot acceptance is assumed. Browser and physical-device interaction were not verified.
