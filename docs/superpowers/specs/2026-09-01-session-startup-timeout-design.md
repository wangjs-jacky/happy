# Session Startup Timeout and CLI Release Design

## Problem

Starting or resuming a remote session can legitimately take longer than 60 seconds when the target machine is under heavy load. The mobile client currently needs a bounded RPC acknowledgement timeout so failed operations do not wait forever, but applying one 60-second timeout to every RPC causes a healthy session startup to be reported as failed just before the daemon returns success.

The daemon ownership fix is already present in the repository: a live daemon PID remains authoritative when its two-second HTTP health probe temporarily times out. However, the published `@wangjs-jacky/paws` package is still version `1.2.4`, which predates that fix. The existing publish workflow skips a package version that already exists, so merging source changes without a version bump cannot update installed CLIs.

## Goals

- Bound RPC acknowledgement waits so disconnected or unresponsive operations settle.
- Give session creation and session resume enough time for a slow but healthy CLI startup.
- Preserve the existing daemon owner during transient local HTTP health failures.
- Publish a new CLI package through the repository's existing GitHub Actions workflow.
- Cover the timeout selection and daemon ownership behavior with executable tests.

## Non-goals

- Redesign the RPC protocol into an asynchronous job API.
- Restart or replace the currently running daemon during development.
- Change the relay, server, encryption, or session persistence protocols.
- Add new user-facing copy or translations.

## Design

### RPC timeout policy

`ApiSocket.sessionRPC` and `ApiSocket.machineRPC` will accept an optional call-options object containing `timeoutMs`. Both methods will route through one encrypted RPC helper that:

1. rejects before encryption when the socket is disconnected;
2. encrypts the request;
3. rechecks that the same socket is still connected;
4. uses Socket.IO's acknowledgement timeout;
5. validates and decrypts a successful result.

The timeout is layered across the request path:

- App ordinary RPC calls use a 60-second acknowledgement timeout.
- App session startup calls use a 120-second acknowledgement timeout.
- Server ordinary RPC forwarding uses a 30-second target timeout; startup methods use a 100-second target timeout.
- The daemon's internal startup webhook budget is 90 seconds.

This keeps ordinary operations bounded while leaving the server and daemon enough room for a slow but healthy startup: the App budget is 120 seconds, the server downstream budget is 100 seconds, and the daemon budget is 90 seconds.

Session startup operations use a dedicated 120-second App timeout:

- `spawn-happy-session`
- `resume-happy-session`

The observed incident completed its first CLI startup and session webhook in about 63 seconds. A 120-second bound covers that measured path with substantial margin without making a genuinely stuck request indefinite.

### CLI release

The CLI package version will change from `1.2.4` to `1.2.5`. On merge to `main`, `.github/workflows/cli-npm-publish.yml` watches `packages/happy-cli/**`, builds and packs the package, publishes only when the exact version is absent, and verifies that npm reports the new version.

This release carries the already-merged daemon ownership behavior. No additional daemon ownership logic is necessary for this incident.

### Failure behavior

- A disconnected socket fails immediately and emits no RPC.
- Ordinary RPC calls fail after 60 seconds if no acknowledgement arrives.
- Session spawn/resume calls fail after 120 seconds if no acknowledgement arrives.
- Server-declared RPC errors are returned without attempting response decryption.
- A live daemon whose HTTP health probe times out keeps its state file and ownership lock.
- The server forwards ordinary methods with a 30-second target timeout and startup methods with a 100-second target timeout.

## Verification

- Unit-test the shared encrypted RPC path, immediate disconnected failure, ordinary timeout, startup timeout override, successful decryption, and server error handling.
- Test server RPC forwarding timeout selection, including a fake-timer 90-second startup ACK that is not cut off by the 100-second startup budget.
- Keep the existing daemon ownership regression tests green.
- Run targeted App and CLI tests, App typecheck, CLI typecheck/build, and the relevant package tests.
- Open a pull request and verify the PR checks.
- After merge, verify the npm publish workflow and registry version before updating Macmini2. Installing the new CLI and restarting its daemon are separate deployment actions because a restart can affect active sessions.

## Rollback

- App behavior can be rolled back through the existing OTA rollback workflow if the longer startup window causes a regression.
- CLI installs can be pinned back to `@wangjs-jacky/paws@1.2.4`; the old package remains immutable in npm.
