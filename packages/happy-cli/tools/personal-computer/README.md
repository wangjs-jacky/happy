# Personal isolated browser runtime

This is a single-user Linux browser computer, not ChromiumOS, a full desktop,
or a multi-tenant VM product. The trusted Paws controller stays outside Docker.

- An explicit `Start` builds a recipe-addressed image and creates only this
  Personal home's labelled resources. `Stop` removes its browser/egress
  containers and two private networks, releasing Docker address-pool slots;
  workspace/profile volumes remain intact for the next explicit `Start`.
  Status is a single read and never starts Docker resources.
- The browser runs as UID 1000 with a read-only image, dropped capabilities,
  no-new-privileges, CPU/memory/PID limits and a private Docker network.
- Browser profile and workspace use distinct named volumes. Each shell/file
  task runs in a fresh container with only the workspace volume, on a different
  internal network. It cannot reach the browser's CDP listener or profile.
- Only a trusted proxy joins the external network. HTTP and CONNECT destinations
  are resolved, checked as public unicast and pinned to the checked address;
  private/metadata destinations and non-web ports are refused. The proxy does
  not decrypt HTTPS or implement a domain allowlist.
- Docker and CDP are not mounted/exposed to the model. A random host-loopback
  stdio tunnel exists only for the trusted controller's live view/input; no
  Docker network port is published.
- Agent browser actions use the pinned **chrome-use v1.5.291** Linux binary,
  downloaded from `leeguooooo/chrome-use`'s GitHub Release. The Dockerfile verifies
  the release's published SHA-256 for ARM64 and x64 and keeps its licence files.
  The bridge permits a narrow list of semantic actions and snapshots. It does
  not expose eval, cookies, arbitrary CLI arguments or the extension installer.
  Connection is explicit CDP followed by `tab adopt` of the displayed target;
  each operation checks that active target before and after acting. Automatic
  popup/tab switching is refused in this MVP instead of showing an old frame
  while the agent acts on a different page.
- Frame delivery uses CDP screencast events while a viewer is subscribed; it
  does not poll, write screenshots to chat history or persist frames in state.
- An explicit takeover increments a durable epoch, cancels agent operations
  and kills each one-shot task container (including detached children). Return
  control needs the current viewer and epoch. Closing a view or disconnecting
  never returns control automatically. A refreshed authenticated owner may
  explicitly reclaim control; stale viewers remain fenced out.
- A controller lock prevents independent Personal processes from using the
  same computer concurrently. A hard-crash recovery or corrupt control record
  starts paused for human review, rather than replaying unknown effects.

Chromium currently uses `--no-sandbox` inside the restricted container. This
weakens Chromium's own process sandbox; Docker Desktop's Linux VM and the
container restrictions are the remaining boundary. Do not use this image as a
hostile multi-tenant service or expose its Docker/CDP ports publicly. Browser
cookies are sensitive local volume data; no user's host profile, Home, Docker
socket, model keys or OAuth tokens are copied into this image.

Ordinary browsing/research and Paws UI verification continue to use Ego. The
chrome-use exception is only for the explicitly authorized Personal computer.
