# Android legacy OTA release, 2026-09-06

Maintainer requested latest merged code for installed production runtime 23 and
preview runtime 22, followed by new APKs. This release-only branch is based on
main 3906949b26293701d16d2c159eb6faaac081a1a2. Do not merge its runtime mapping
back to main and do not publish iOS from this branch.

Compatibility evidence against installed APK source 53da4bef8f012da5e8207a43a8ee43510076b076:

- Existing happy-app dependency resolved versions are unchanged. Added packages
  are pragmatic-drag-and-drop, its hitbox package, MCP SDK/ext-apps, panzoom,
  paws-plugins and remend (JavaScript/Web code).
- app.config.js, happy-app/plugins and happy-app/patches have no changes.
- The only added native patch targets expo-camera/ios/CameraViewModule.swift.
  Android scanner code does not use the iOS-only dismissScanner path.
- Before this release-only mapping change, runtime contracts, QR classification,
  scanner lifecycle tests passed (52 tests), as did native patch tests (11).

Export Android separately with APP_ENV=production and APP_ENV=preview, using
this mapping and the normal publisher --variant guard. Publish latest pointers
in both legacy channels; preserve all historical objects. New APKs are built
separately from unchanged main with runtimes preview=23, production=24.

Device installation/OTA application requires user verification. No connected
Android device was available during compatibility analysis.
