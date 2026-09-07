# Web navigation and foreground refresh

Base: `31ef2b9dc44e94998aad25ae6cfc056552cb0c0a`.

## Symptoms and findings

- Session navigation dispatched a home dismissal followed by a separate navigation.
- The history sidebar's intermediate container did not constrain the FlatList height.
  A real account mounted 624–989 history rows during observation; each refresh could
  therefore update hundreds of rows and avatars.
- Unchanged incremental session snapshots still published an empty update to the
  store, rebuilding and sorting the sidebar lists. Foreground refresh processes up
  to 150 snapshots individually.
- Bounded message replay intentionally creates new reducer IDs. Using those IDs as
  React keys also remounted the transcript's top-level rows.

## Changes

- Web session navigation compacts the stack atomically, retaining its home anchor.
  Clicking the selected session is a no-op. Native navigation and desktop modal
  isolation retain their existing behavior.
- Constrain the sidebar list height and use a five-viewport virtualization window.
- Skip empty incremental session updates; retain empty replacement deletion semantics.
- Use wire/block identity for transcript row keys when the reading adapter supplies
  it. Preserve transient-ID fallback for local/unbacked rows and other transcripts.

## Verification

- 68 tests across session writers, desktop routing/presentation, sidebar history,
  transcript pagination and reading anchors passed.
- `pnpm --filter happy-app typecheck` passed.
- Ego, real account, local development build: sidebar mounted 63–64 history rows;
  session navigation produced only the destination path; tab return retained the
  document, root, composer and transcript DOM nodes.
- Independent Ego interaction regression: 3/3 passed (switch/reselect, tab return,
  sidebar scroll/return). The sidebar mounted 63–82 rows across those scroll positions.
- Production observation likewise retained the document/root/composer on tab return,
  but showed repeated 70–158 ms main-thread tasks. This is evidence of rendering
  pressure, not proof of a browser reload. Development timing is not a controlled
  production benchmark, so no latency percentage is claimed.

## Limits

- Expanded tool groups still use transient keys for some nested children. This
  change stabilizes top-level transcript rows, not every descendant.
- Browser memory eviction/discard is outside these fixes and was not reproduced.
- Production deployment requires the normal main-branch merge and deployment workflow.
