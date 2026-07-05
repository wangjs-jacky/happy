# Settings Brand And Profile Interaction Design

Date: 2026-07-04
Status: Draft, approved direction pending implementation plan

## Context

The settings screen recently changed to follow a reference layout for profile editing. That change correctly separated user avatar editing from the old settings header, but it also removed the visible `MascotSwitcher` brand entry from the settings page. The mascot component still exists, and the Appearance screen still has a mascot selector, but the settings page lost the lightweight brand presentation that users can swipe through.

The product has no membership plan. Any copied `Membership Plan` or `Andante` UI from the reference product should be removed from Happy/Paws.

The current `jacky-main` mascot behavior intentionally links each mascot to a theme pack: choosing a mascot also writes the bound `themePack` and applies it with the current light/dark/adaptive preference. This design must preserve that coupling instead of replacing `MascotSwitcher` with a mascot-only image switcher.

## Goals

- Restore the groundhog mascot as a brand display entry in settings.
- Preserve the existing mascot-to-theme-pack coupling from `jacky-main`.
- Keep mascot, profile avatar, and account/security concepts visually and behaviorally separate.
- Preserve the new profile editing flow: avatar and display name are edited from the Personal Profile page.
- Remove membership-plan UI from the settings page and sidebar.
- Keep the design consistent with the existing `ItemGroup`, `ItemList`, `ProfileAvatarControl`, and `MascotSwitcher` patterns.

## Non-Goals

- Do not add a membership plan, subscription badge, or `Andante` label.
- Do not move avatar editing back onto the settings landing page.
- Do not change the avatar upload endpoint or display-name save endpoint.
- Do not decouple mascot switching from theme-pack switching.
- Do not redesign the full Appearance screen.

## Settings Page Structure

The settings landing page should start with a standalone brand header:

- Top: `MascotSwitcher`, centered in a restrained surface area.
- Purpose: brand presentation and quick mascot switching, including the same mascot-bound theme-pack transition used on `jacky-main`.
- It must not show the user's avatar, name, bio, account status, or edit controls.

Immediately below the brand header, the first settings group should contain:

- `个人资料` / `Profile`: opens `/settings/profile`.
- `账号` / `Account`: opens the existing account settings route.

There should be no `会员计划`, `Membership Plan`, `Andante`, or equivalent plan row.

The remaining groups stay in their current order unless implementation finds a small spacing issue:

- General: theme and language.
- Connected Accounts.
- Machines.
- Features.
- Developer, when enabled.
- About.

## Profile Page Structure

The profile page remains the only place for user profile editing:

- Header title: `编辑资料` / `Edit Profile`.
- Top avatar: uses `ProfileAvatarControl`.
- Avatar tap: opens image viewer when an avatar exists.
- Avatar camera/change action: opens image picker.
- Name field: editable and saved through the existing profile API.
- Save button: enabled only when the name changes and is non-empty.

The profile page should not expose mascot switching.

## Sidebar Structure

The sidebar user card should show:

- User avatar via `ProfileAvatarControl`.
- Display name.
- Settings icon or affordance to open settings.

The sidebar must not show `Andante` or any membership badge.

The avatar interaction remains unchanged:

- Avatar tap opens the photo viewer or upload flow.
- Camera/change affordance changes the avatar.
- Tapping the non-avatar part of the card opens settings.

## Mascot Behavior

`MascotSwitcher` remains the canonical swipe interaction:

- Swipe left/right cycles through mascot variants.
- The selected mascot is stored in the existing `mascot` local setting.
- The bound theme pack is stored in the existing `themePack` local setting via `getMascotTheme`.
- `applyTheme` is called with the selected mascot's theme pack and the current `themePreference`.
- The empty home screen continues to read the same setting and display the selected mascot.

The Appearance screen may continue to provide the full mascot picker grid. That is acceptable because it is a settings-oriented selector, while the settings landing page header is a brand display entry.

## Data Flow

Mascot:

- `MascotSwitcher` reads and writes `useLocalSettingMutable('mascot')`, `useLocalSettingMutable('themePack')`, and the current `themePreference`.
- `MascotSwitcher` uses the existing `getMascotTheme` mapping so the settings header and Appearance mascot picker stay consistent.
- `EmptyMainScreen` reads the same setting through existing code.
- No server calls are required; mascot and theme-pack changes are local settings only.

Profile:

- `/settings/profile` reads `useProfile()`.
- Avatar upload uses the existing avatar upload API.
- Display-name save uses the existing profile update API.
- Profile refresh and realtime account updates keep the local profile current.

Account:

- The `账号` row routes to the existing `/settings/account` page.
- No account-page behavior changes are required.

## Error Handling

- Mascot switching should not need network error handling because it is local-only.
- Avatar upload and profile save should keep their existing modal-based error handling.
- The settings landing page should remain usable even if the profile display name is missing; the profile row can omit detail text in that case.

## Accessibility And Layout

- The mascot header should be large enough to feel intentional but not so tall that it crowds the first settings group.
- Text should not overlap or truncate awkwardly on narrow Android screens.
- The brand header should not be implemented as a nested card inside another card.
- Touch targets should remain at least comparable to existing `Item` and avatar controls.

## Verification

Manual checks:

- Settings top shows the mascot switcher.
- Swiping the mascot changes the selected mascot.
- Swiping the mascot applies the bound theme pack, and Appearance shows the matching selected mascot/theme pack.
- Home empty state reflects the selected mascot.
- First settings group contains exactly `个人资料` and `账号`.
- There is no `会员计划`, `Membership Plan`, or `Andante` in settings or the sidebar.
- Personal profile still opens the avatar/name edit page.
- Avatar viewing and changing remain separate from mascot switching.

Automated checks:

- `pnpm --filter happy-app run typecheck`
- If server code remains untouched by the implementation, server typecheck is not required for this change.

## Implementation Notes

Expected focused changes:

- Re-import and render `MascotSwitcher` in `SettingsView`.
- Reuse `MascotSwitcher` as-is from `jacky-main`; do not fork it or remove its theme-pack side effect.
- Restore only the brand header part of the old settings header, not the previous avatar/name/bio header.
- Remove membership-plan row from `SettingsView`.
- Remove membership badge styles and render output from `SidebarView`.
- Keep `/settings/profile` intact.

No database, OTA server, or native rebuild changes are expected for this design.
