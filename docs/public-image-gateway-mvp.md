# Public Image Gateway MVP

This document explains how to test the public image gateway MVP from PR #149.

The design goal is narrow: public users can submit image prompts, while the Mac mini only pulls approved jobs as an outbound worker. Public users never reach Happy daemon, Happy sessions, MCP tools, shell, or local file paths.

## Components

- `happy-image-gateway`: HTTP gateway for `/image`, admin review, budget mode, and worker APIs.
- `happy-image-worker`: Mac mini polling worker that claims queued jobs and calls a fixed native image generation command.
- `happy-image-native-codex`: local Mac mini command that asks Codex to use native image generation and returns the new image path.
- Happy App Settings entry: Settings -> Features -> Public Image Gateway opens the public page and review console links.

## Local Smoke Test

Run this from the PR worktree:

```bash
cd /Users/jacky/jacky-github/happy--public-image-gateway
pnpm --filter happy-image-gateway build
```

Start a local gateway:

```bash
rm -f /tmp/happy-image-gateway-smoke.json
IMAGE_GATEWAY_PORT=4312 \
IMAGE_GATEWAY_DATA=/tmp/happy-image-gateway-smoke.json \
IMAGE_GATEWAY_ADMIN_TOKEN=admin-smoke \
IMAGE_GATEWAY_WORKER_TOKEN=worker-smoke \
node packages/image-gateway/dist/server.mjs
```

Open:

```text
http://127.0.0.1:4312/image
http://127.0.0.1:4312/image/admin?token=admin-smoke
```

API smoke:

```bash
curl -sS -X POST http://127.0.0.1:4312/image/jobs \
  -H 'content-type: application/json' \
  -d '{"prompt":"draw a compact public image gateway dashboard"}' \
  > /tmp/image-job.json

JOB=$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/image-job.json','utf8')).id")

curl -sS -X POST http://127.0.0.1:4312/image/worker/claim \
  -H 'authorization: Bearer worker-smoke' \
  > /tmp/image-claim.json

curl -sS -X POST "http://127.0.0.1:4312/image/worker/jobs/$JOB/succeed" \
  -H 'authorization: Bearer worker-smoke' \
  -H 'content-type: application/json' \
  -d '{"resultUrl":"https://example.com/generated.png","actualCostCents":40}' \
  > /tmp/image-success.json

cat /tmp/image-success.json
```

Expected result:

- submitted job starts as `queued`
- worker claim returns the same job as `running`
- success report changes it to `succeeded`
- job page shows the returned `resultUrl`

## Gateway Environment

Required for production-like use:

```bash
IMAGE_GATEWAY_PORT=3010
IMAGE_GATEWAY_DATA=/var/lib/happy-image-gateway/state.json
IMAGE_GATEWAY_ADMIN_TOKEN=<strong random admin token>
IMAGE_GATEWAY_WORKER_TOKEN=<strong random worker token>
IMAGE_GATEWAY_HASH_SECRET=<strong random hash secret>
```

Run:

```bash
node packages/image-gateway/dist/server.mjs
```

Recommended Caddy route on the ECS HTTPS frontend:

```caddyfile
/image* {
    reverse_proxy 127.0.0.1:3010
}
```

Keep the existing Happy routes unchanged:

```caddyfile
/v1* /v3* /v4* /files* {
    reverse_proxy 127.0.0.1:3005
}
```

## Worker Environment

The worker should run on Mac mini. It only makes outbound requests to the gateway.

```bash
IMAGE_GATEWAY_URL=https://47.115.228.20:8443
IMAGE_GATEWAY_WORKER_TOKEN=<same worker token as gateway>
IMAGE_WORKER_NATIVE_COMMAND="node /Users/jacky/jacky-github/happy--public-image-gateway/packages/image-gateway/dist/nativeCodexCommand.mjs"
IMAGE_WORKER_UPLOAD_COMMAND="<required command: job_id image_path -> result url>"
IMAGE_WORKER_POLL_MS=5000
IMAGE_WORKER_TIMEOUT_MS=300000
```

Run:

```bash
node packages/image-gateway/dist/worker.mjs
```

Do not restart Happy daemon for this MVP. The worker is a separate process and should not use `happy daemon start`, `happy daemon restart`, or any direct daemon command.

## Native Codex Command

The included native command is:

```bash
node packages/image-gateway/dist/nativeCodexCommand.mjs
```

The worker calls it through `IMAGE_WORKER_NATIVE_COMMAND`. It reads the worker JSON from stdin, builds a fixed image-only Codex prompt, runs Codex, scans `~/.codex/generated_images` for a newly-created PNG/JPEG, and returns:

```json
{
  "imagePath": "/Users/jacky/.codex/generated_images/.../ig_....png",
  "actualCostCents": 40
}
```

Configurable environment:

```bash
# Optional. By default the command resolves the Codex vendor binary behind the
# npm wrapper when available, then runs:
IMAGE_NATIVE_CODEX_COMMAND="<codex-vendor-binary> exec --skip-git-repo-check --sandbox read-only"

# Optional. Default:
IMAGE_NATIVE_CODEX_GENERATED_DIR="$HOME/.codex/generated_images"

# Optional. Default:
IMAGE_NATIVE_CODEX_TIMEOUT_MS=300000

# Optional. Default:
IMAGE_NATIVE_CODEX_COST_CENTS=40
```

The Codex command is fixed by the operator. Public users cannot pass Codex args, shell commands, tool names, model backend, or file paths.

Smoke test the native command without real Codex by using a fake command that writes a PNG into a temp generated-images directory:

```bash
rm -rf /tmp/native-codex-images /tmp/native-codex-fake.js
mkdir -p /tmp/native-codex-images
printf '%s\n' "const fs=require('fs'); const path=require('path'); const root=process.env.IMAGE_NATIVE_CODEX_GENERATED_DIR; const dir=path.join(root, 'fake-session'); fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir, 'generated.png'), 'png');" > /tmp/native-codex-fake.js

printf '%s' '{"jobId":"job_smoke","prompt":"draw a smoke test image","options":{"size":"1024x1024","output":"png","count":1}}' \
  | IMAGE_NATIVE_CODEX_GENERATED_DIR=/tmp/native-codex-images \
    IMAGE_NATIVE_CODEX_COMMAND='node /tmp/native-codex-fake.js' \
    IMAGE_NATIVE_CODEX_COST_CENTS=12 \
    node packages/image-gateway/dist/nativeCodexCommand.mjs
```

Expected output:

```json
{
  "imagePath": "/tmp/native-codex-images/fake-session/generated.png",
  "actualCostCents": 12
}
```

## Native Image Command Contract

The worker sends this JSON to `IMAGE_WORKER_NATIVE_COMMAND` through stdin:

```json
{
  "jobId": "job_...",
  "prompt": "public user prompt",
  "options": {
    "size": "1024x1024",
    "output": "png",
    "count": 1
  }
}
```

The native command must write one of these JSON responses to stdout:

```json
{
  "resultUrl": "https://example.com/generated.png",
  "actualCostCents": 40
}
```

or:

```json
{
  "imagePath": "/absolute/path/to/generated.png",
  "actualCostCents": 40
}
```

If `imagePath` is returned, `IMAGE_WORKER_UPLOAD_COMMAND` is required. The upload command receives:

```text
<job_id> <image_path>
```

and must print the final public or signed result URL to stdout.

## Budget Modes

The gateway has three modes:

- `open`: public submissions go straight to `queued` while the daily budget has room.
- `review`: public submissions go to `pending_review`; admin must approve them.
- `closed`: public submissions are rejected.

The gateway automatically switches from `open` to `review` once reported daily spend reaches the daily budget.

## Admin Testing

Open:

```text
https://47.115.228.20:8443/image/admin?token=<admin token>
```

Use the mode buttons:

- Open
- Review
- Closed

When in `review`, submit a public prompt from `/image`; it should appear as `pending_review`. Click Approve, then the worker can claim it.

## App Preview Test

Preview OTA:

```text
Update ID: 784f2c20-6d51-e724-356f-5ebe84cd2af4
Channel: preview
Runtime version: 21
```

On a preview APK:

1. Kill and cold-start the app.
2. Apply the available preview update.
3. Go to Settings -> Features -> Public Image Gateway.
4. Tap the public page and admin page rows.

The App entry only opens gateway URLs. It does not expose Happy daemon or session tools to public users.

## Verification Commands

```bash
pnpm --filter happy-image-gateway test
pnpm --filter happy-image-gateway build
pnpm --filter happy-app typecheck
```

## Safety Checklist

- Public users only reach `/image`.
- Worker uses `IMAGE_GATEWAY_WORKER_TOKEN`.
- Admin uses `IMAGE_GATEWAY_ADMIN_TOKEN`.
- Prompt max length is 1200 characters.
- Image size is fixed at `1024x1024`.
- Worker accepts only the fixed native image command contract.
- No public request can pass a shell command, MCP tool name, file path, model backend, or Happy session id.
- Mac mini exposes no public port for this MVP.
