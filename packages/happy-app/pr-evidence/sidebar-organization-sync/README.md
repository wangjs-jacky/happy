# Sidebar organization account-sync evidence

Captured on 2026-08-28 from PR #371 (`fix/sync-sidebar-organization`) against the production account API.

## Reproduction

1. Restore the same production test account in two isolated Ego Light task spaces.
2. In Client A, create the Agent list `SYNC-371 跨端清单` and the tag `SYNC-371 跨端 Tag`.
3. Keep Client B open before the mutation, then open its Lists tab after the account settings update arrives.
4. Verify that Client B displays both records without copying browser storage or re-entering them.

## Evidence

- `client-a-desktop.png`: desktop Client A immediately after creating the list and tag.
- `client-b-mobile.png`: independent Client B at a 390 x 844 mobile viewport, with the drawer open after receiving the same account settings.

Both screenshots show the same list and tag names. The clients used separate browser task spaces; the shared state arrived through encrypted account settings rather than device-local sidebar settings.
