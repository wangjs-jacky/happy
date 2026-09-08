# Changelog

## 0.1.0-beta.2 - 2026-09-09

- Prepare the first public npm release, distributed on the `next` tag.
- Emit `syncing` and a reusable initial `snapshot` before the connection becomes ready.
- Fetch individual sessions through `/v2/sessions/:id`, including realtime updates, instead of repeatedly downloading the entire session list.
- Validate point-response identity and check fresh session activity before sending.
- Port the startup and session-lookup regression tests from paws-agent-chrome v0.0.5.

This is a beta SDK. Publication status must be checked against the npm registry; this changelog is not proof that a release has been published.
