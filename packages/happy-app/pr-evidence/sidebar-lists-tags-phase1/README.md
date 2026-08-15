# Sidebar Lists and Tags phase 1 visual evidence

Cases SIDEBAR-LISTS-TAGS and SIDEBAR-LISTS-TAGS-MOBILE were captured by the
isolated Web E2E harness in Chromium, English, light theme, and DPR 1.

- Desktop, 1440x900: Projects remains the default sidebar view. The Lists tab
  restores two List types, one-to-many Tags, session organization, and the
  active conversation after a full page reload.
- Mobile, 390x844: the original drawer had only the project hierarchy. The
  updated drawer keeps Projects as the default and adds a visible Lists tab
  without navigating away from the current conversation.

Each Before/After pair uses the same viewport, seeded state, and drawer or
workspace position. The conversation content and desktop capability panel
remain unchanged.
