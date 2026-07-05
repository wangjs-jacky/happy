# Settings Brand Profile Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the mascot as the settings brand entry while removing membership UI and keeping profile editing separate.

**Architecture:** This is a focused React Native UI cleanup. `SettingsView` owns the settings landing page structure, `SidebarView` owns the drawer user card, and translation files define only the visible strings still used by the product.

**Tech Stack:** React Native, Expo Router, react-native-unistyles, existing Happy/Paws settings components.

---

## Chunk 1: Settings Brand And Membership Cleanup

### Task 1: Restore Settings Brand Header

**Files:**
- Modify: `packages/happy-app/sources/components/SettingsView.tsx`

- [x] Re-import `View` from `react-native`.
- [x] Re-import `layout` and `MascotSwitcher`.
- [x] Add a top standalone brand header before the first `ItemGroup`.
- [x] Keep the header limited to `MascotSwitcher`; do not show profile avatar/name/bio.

### Task 2: Remove Membership UI

**Files:**
- Modify: `packages/happy-app/sources/components/SettingsView.tsx`
- Modify: `packages/happy-app/sources/components/SidebarView.tsx`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/*.ts`

- [x] Remove the `会员计划` / `Membership Plan` row from settings.
- [x] Remove `Andante` badge rendering and styles from the sidebar.
- [x] Remove `settings.membershipPlan` from the default and translated text objects.

### Task 3: Verify

**Files:**
- Check only.

- [x] Run `pnpm --filter happy-app run typecheck`.
- [x] Run `rg -n "Andante|membershipPlan|会员计划|Membership Plan" packages/happy-app/sources`.
- [x] Confirm remaining matches, if any, are not product UI.
- [x] Publish preview OTA with `pnpm ota:selfhost:preview`.
