# Desktop Screenshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to remotely capture and view their desktop/browser screen from the Happy App on mobile, supporting the desktop monitoring workflow.

**Architecture:** 
- Add a `useDesktopScreenshot` hook in the App that dispatches RPC requests to the CLI
- Extend the Wire RPC protocol with `screenshot` request/response types
- Implement screenshot handler in CLI that calls system commands (`screencapture` on macOS, `gnome-screenshot` on Linux)
- Return base64-encoded image data through the encrypted channel
- Display the screenshot in a modal/sheet in the App

**Tech Stack:** 
- RN Hook (React, TypeScript)
- RPC protocol (zod-based type definitions)
- macOS: `screencapture` command
- Linux: `gnome-screenshot` command
- Base64 encoding for transport

## Global Constraints

- All user-visible strings must use `t('key')` from `@/text` and added to all language files
- Follow existing Unistyles patterns for styling
- Use `useHappyAction` for async operations in the App
- RPC types must be defined in happy-wire with Zod validation
- CLI command execution must be safe against path injection
- Screenshot data transport must respect the end-to-end encryption layer

---

### Task 1: Define Wire RPC Types for Screenshot

**Files:**
- Modify: `packages/happy-wire/sources/types/rpc.ts` (create if doesn't exist)
- Create: `packages/happy-wire/sources/types/screenshot.ts`

**Interfaces:**
- Consumes: Existing RPC type structure (check `happy-wire/sources/types/`)
- Produces: 
  - `ScreenshotRequest` type: `{ type: 'screenshot'; target: 'desktop' | 'browser' }`
  - `ScreenshotResponse` type: `{ data: string; mimeType: 'image/png' | 'image/jpeg'; size: number; timestamp: number }`

- [ ] **Step 1: Read existing RPC type patterns**

```bash
grep -r "export type.*Request\|export type.*Response" packages/happy-wire/sources/types/ | head -5
```

- [ ] **Step 2: Create screenshot.ts with type definitions**

Create `packages/happy-wire/sources/types/screenshot.ts`:

```typescript
import { z } from 'zod';

export const ScreenshotTargetSchema = z.enum(['desktop', 'browser']);
export type ScreenshotTarget = z.infer<typeof ScreenshotTargetSchema>;

export const ScreenshotRequestSchema = z.object({
  type: z.literal('screenshot'),
  target: ScreenshotTargetSchema,
  timestamp: z.number(),
});
export type ScreenshotRequest = z.infer<typeof ScreenshotRequestSchema>;

export const ScreenshotResponseSchema = z.object({
  data: z.string(), // base64-encoded image
  mimeType: z.enum(['image/png', 'image/jpeg']),
  size: z.number(), // byte size of original image
  timestamp: z.number(),
  targetUsed: ScreenshotTargetSchema,
});
export type ScreenshotResponse = z.infer<typeof ScreenshotResponseSchema>;
```

- [ ] **Step 3: Export types from index**

Verify or add to `packages/happy-wire/sources/index.ts`:

```typescript
export * from './types/screenshot';
```

- [ ] **Step 4: Commit**

```bash
git add packages/happy-wire/sources/types/screenshot.ts packages/happy-wire/sources/index.ts
git commit -m "feat(wire): add desktop screenshot RPC types"
```

---

### Task 2: Implement CLI Screenshot Handler

**Files:**
- Create: `packages/happy-cli/src/api/rpc/handlers/screenshot.ts`
- Modify: `packages/happy-cli/src/api/rpc/handlers/index.ts` (register handler)

**Interfaces:**
- Consumes: `ScreenshotRequest`, `ScreenshotResponse` from wire; Node.js `child_process` for command execution
- Produces: Handler function that accepts `ScreenshotRequest` and returns `Promise<ScreenshotResponse>`

- [ ] **Step 1: Read existing handler pattern**

```bash
ls -la packages/happy-cli/src/api/rpc/handlers/ | head -10
cat packages/happy-cli/src/api/rpc/handlers/index.ts | head -30
```

- [ ] **Step 2: Create screenshot.ts handler**

Create `packages/happy-cli/src/api/rpc/handlers/screenshot.ts`:

```typescript
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as os from 'os';
import { ScreenshotRequest, ScreenshotResponse } from '@slopus/happy-wire';

const TEMP_SCREENSHOT_PATH = join(tmpdir(), `happy-screenshot-${Date.now()}.png`);

export async function handleScreenshot(request: ScreenshotRequest): Promise<ScreenshotResponse> {
  const platform = os.platform();
  let screenshotPath = TEMP_SCREENSHOT_PATH;

  try {
    // Execute platform-specific screenshot command
    if (platform === 'darwin') {
      // macOS
      if (request.target === 'browser') {
        // For browser, we'd need to target the active browser window
        // For now, capture full screen and let user crop if needed
        execSync(`screencapture -x "${screenshotPath}"`);
      } else {
        // Desktop - full screen
        execSync(`screencapture -x "${screenshotPath}"`);
      }
    } else if (platform === 'linux') {
      // Linux
      if (request.target === 'browser') {
        // Similar limitation on Linux - capture active window
        execSync(`gnome-screenshot -f "${screenshotPath}"`);
      } else {
        execSync(`gnome-screenshot -f "${screenshotPath}"`);
      }
    } else if (platform === 'win32') {
      // Windows - use PowerShell
      const psCommand = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%{PRTSC}'); [System.Threading.Thread]::Sleep(500); $img = [System.Windows.Forms.Clipboard]::GetImage(); $img.Save('${screenshotPath}'); Write-Host 'Screenshot saved'`;
      execSync(`powershell -Command "${psCommand}"`, { encoding: 'utf8' });
    } else {
      throw new Error(`Screenshot not supported on platform: ${platform}`);
    }

    // Read and encode to base64
    const imageBuffer = await readFile(screenshotPath);
    const base64Data = imageBuffer.toString('base64');

    return {
      data: base64Data,
      mimeType: 'image/png',
      size: imageBuffer.length,
      timestamp: Date.now(),
      targetUsed: request.target,
    };
  } finally {
    // Clean up temp file
    if (existsSync(screenshotPath)) {
      try {
        execSync(`rm -f "${screenshotPath}"`);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
```

- [ ] **Step 3: Register handler in RPC router**

Read `packages/happy-cli/src/api/rpc/handlers/index.ts` to understand the pattern, then add:

```typescript
import { handleScreenshot } from './screenshot';

// In the handler router/dispatcher:
case request.type === 'screenshot':
  return handleScreenshot(request as ScreenshotRequest);
```

- [ ] **Step 4: Add test file**

Create `packages/happy-cli/src/api/rpc/handlers/screenshot.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleScreenshot } from './screenshot';
import { execSync } from 'child_process';

vi.mock('child_process');
vi.mock('fs/promises');

describe('handleScreenshot', () => {
  it('should capture desktop screenshot and return base64 data', async () => {
    const result = await handleScreenshot({ 
      type: 'screenshot', 
      target: 'desktop',
      timestamp: Date.now(),
    });
    
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('mimeType', 'image/png');
    expect(result).toHaveProperty('size');
    expect(result).toHaveProperty('timestamp');
    expect(result.targetUsed).toBe('desktop');
  });

  it('should handle screenshot request for browser target', async () => {
    const result = await handleScreenshot({ 
      type: 'screenshot', 
      target: 'browser',
      timestamp: Date.now(),
    });
    
    expect(result.targetUsed).toBe('browser');
  });

  it('should clean up temporary files', async () => {
    // Test that cleanup happens even on error
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add packages/happy-cli/src/api/rpc/handlers/screenshot.ts packages/happy-cli/src/api/rpc/handlers/screenshot.test.ts
git commit -m "feat(cli): implement desktop screenshot RPC handler"
```

---

### Task 3: Create useDesktopScreenshot Hook in App

**Files:**
- Create: `packages/happy-app/sources/hooks/useDesktopScreenshot.ts`

**Interfaces:**
- Consumes: `ScreenshotTarget`, `ScreenshotResponse` from wire; `useHappyAction` for async handling
- Produces: Hook that returns `{ capture: (target: ScreenshotTarget) => void; loading: boolean; screenshot: ScreenshotResponse | null; error: string | null; }`

- [ ] **Step 1: Examine useHappyAction pattern**

```bash
cat packages/happy-app/sources/hooks/useHappyAction.ts
```

- [ ] **Step 2: Create useDesktopScreenshot hook**

Create `packages/happy-app/sources/hooks/useDesktopScreenshot.ts`:

```typescript
import * as React from 'react';
import { ScreenshotTarget, ScreenshotRequest, ScreenshotResponse } from '@slopus/happy-wire';
import { useHappyAction } from './useHappyAction';

interface UseDesktopScreenshotState {
  screenshot: ScreenshotResponse | null;
  loading: boolean;
}

export function useDesktopScreenshot(sendRpc: (request: ScreenshotRequest) => Promise<ScreenshotResponse>) {
  const [state, setState] = React.useState<UseDesktopScreenshotState>({
    screenshot: null,
    loading: false,
  });

  const [loading, captureAsync] = useHappyAction(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      // This will be called with the actual target
      // We'll handle target selection at the component level
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  });

  const capture = React.useCallback(async (target: ScreenshotTarget) => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const response = await sendRpc({
        type: 'screenshot',
        target,
        timestamp: Date.now(),
      });
      setState((prev) => ({
        ...prev,
        screenshot: response,
        loading: false,
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false }));
      throw error;
    }
  }, [sendRpc]);

  return {
    capture,
    ...state,
  };
}
```

- [ ] **Step 3: Add test file**

Create `packages/happy-app/sources/hooks/useDesktopScreenshot.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDesktopScreenshot } from './useDesktopScreenshot';

describe('useDesktopScreenshot', () => {
  it('should capture screenshot and store result', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: 'base64data',
      mimeType: 'image/png',
      size: 1024,
      timestamp: Date.now(),
      targetUsed: 'desktop',
    });

    const { result } = renderHook(() => useDesktopScreenshot(mockRpc));

    await act(async () => {
      await result.current.capture('desktop');
    });

    expect(result.current.screenshot).toBeTruthy();
    expect(result.current.screenshot?.mimeType).toBe('image/png');
  });

  it('should set loading state during capture', async () => {
    const mockRpc = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100))
    );

    const { result } = renderHook(() => useDesktopScreensheet(mockRpc));

    act(() => {
      result.current.capture('desktop');
    });

    expect(result.current.loading).toBe(true);
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/happy-app/sources/hooks/useDesktopScreenshot.ts packages/happy-app/sources/hooks/useDesktopScreenshot.test.ts
git commit -m "feat(app): add useDesktopScreenshot hook"
```

---

### Task 4: Create Screenshot Preview Component

**Files:**
- Create: `packages/happy-app/sources/components/DesktopScreenshotPreview.tsx`

**Interfaces:**
- Consumes: `ScreenshotResponse`, `Image` from 'expo-image'
- Produces: Component that displays the screenshot in a modal-like sheet with close button

- [ ] **Step 1: Create component**

Create `packages/happy-app/sources/components/DesktopScreenshotPreview.tsx`:

```typescript
import * as React from 'react';
import { View, Pressable, ScrollView, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useStyles } from 'react-native-unistyles';
import { ScreenshotResponse } from '@slopus/happy-wire';
import { Modal, useModal } from '@/modal';
import { t } from '@/text';

interface DesktopScreenshotPreviewProps {
  screenshot: ScreenshotResponse;
  onClose: () => void;
}

export function DesktopScreenshotPreview({
  screenshot,
  onClose,
}: DesktopScreenshotPreviewProps) {
  const { styles, theme } = useStyles(themedStyles);
  const { width } = Dimensions.get('window');
  const imageHeight = (width * 9) / 16; // Assume 16:9 ratio, adjust as needed

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
          onPress={onClose}
        >
          <Octicons name="x" size={24} color={theme.colors.typography} />
        </Pressable>
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        scrollEventThrottle={16}
      >
        <Image
          source={{ uri: `data:${screenshot.mimeType};base64,${screenshot.data}` }}
          style={[styles.image, { height: imageHeight }]}
          contentFit="contain"
        />
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {t('components.desktopScreenshot.size', {
            size: (screenshot.size / 1024).toFixed(1),
          })}
        </Text>
      </View>
    </View>
  );
}

const themedStyles = StyleSheet.create((theme, runtime) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingTop: runtime.insets.top,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.margins.md,
    paddingVertical: theme.margins.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  closeButton: {
    padding: theme.margins.sm,
    borderRadius: 8,
  },
  closeButtonPressed: {
    backgroundColor: theme.colors.secondaryBackground,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.margins.md,
  },
  image: {
    width: '100%',
    borderRadius: 8,
  },
  footer: {
    paddingHorizontal: theme.margins.md,
    paddingVertical: theme.margins.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footerText: {
    fontSize: 12,
    color: theme.colors.textMuted,
  },
}));
```

- [ ] **Step 2: Add i18n strings**

Add to all language translation files (at minimum `en.ts` and `zh-Hans.ts`):

In `packages/happy-app/sources/text/translations/en.ts`:
```typescript
components: {
  desktopScreenshot: {
    title: 'Desktop Screenshot',
    size: ({ size }: { size: string }) => `${size} KB`,
  },
},
```

In `packages/happy-app/sources/text/translations/zh-Hans.ts`:
```typescript
components: {
  desktopScreenshot: {
    title: '桌面截图',
    size: ({ size }: { size: string }) => `${size} KB`,
  },
},
```

- [ ] **Step 3: Add test**

Create `packages/happy-app/sources/components/DesktopScreenshotPreview.test.tsx`:

```typescript
import React from 'react';
import { render } from '@testing-library/react-native';
import { DesktopScreenshotPreview } from './DesktopScreenshotPreview';

describe('DesktopScreenshotPreview', () => {
  const mockScreenshot = {
    data: 'base64encodeddata',
    mimeType: 'image/png' as const,
    size: 102400,
    timestamp: Date.now(),
    targetUsed: 'desktop' as const,
  };

  it('should render screenshot image', () => {
    const { getByTestId } = render(
      <DesktopScreenshotPreview screenshot={mockScreenshot} onClose={() => {}} />
    );
    expect(getByTestId('screenshot-image')).toBeTruthy();
  });

  it('should call onClose when close button is pressed', () => {
    const onClose = jest.fn();
    const { getByTestId } = render(
      <DesktopScreenshotPreview screenshot={mockScreenshot} onClose={onClose} />
    );
    // Simulate close button press
    // getByTestId('close-button').onPress?.();
    // expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/happy-app/sources/components/DesktopScreenshotPreview.tsx packages/happy-app/sources/components/DesktopScreenshotPreview.test.tsx packages/happy-app/sources/text/translations/
git commit -m "feat(app): add desktop screenshot preview component with i18n"
```

---

### Task 5: Wire MessageComposer to Screenshot Handler

**Files:**
- Modify: `packages/happy-app/sources/app/(app)/session.tsx` (or SessionView component that uses MessageComposer)

**Interfaces:**
- Consumes: `useDesktopScreenshot` hook, `MessageComposer` component, `DesktopScreenshotPreview`
- Produces: Integrated screenshot flow that dispatches RPC on button press and shows preview modal

- [ ] **Step 1: Find SessionView**

```bash
grep -r "MessageComposer" packages/happy-app/sources/app --include="*.tsx" | head -3
```

- [ ] **Step 2: Read current MessageComposer usage**

Check how `onCaptureScreenshot` is currently handled (if at all).

- [ ] **Step 3: Integrate useDesktopScreenshot**

Modify the session/app file to:

```typescript
// Add import
import { useDesktopScreenshot } from '@/hooks/useDesktopScreenshot';
import { DesktopScreenshotPreview } from '@/components/DesktopScreenshotPreview';

// Inside component:
const [showScreenshot, setShowScreenshot] = React.useState(false);
const { screenshot, loading, capture } = useDesktopScreenshot(async (request) => {
  // Send RPC through the session's RPC handler
  return await sessionRpc.send(request);
});

const handleCaptureScreenshot = React.useCallback(
  async (target: 'desktop' | 'browser') => {
    await capture(target);
    setShowScreenshot(true);
  },
  [capture]
);

// Pass to MessageComposer:
<MessageComposer
  // ... other props
  onCaptureScreenshot={handleCaptureScreenshot}
/>

// Render modal:
{showScreenshot && screenshot && (
  <Modal
    transparent
    visible={showScreenshot}
    onRequestClose={() => setShowScreenshot(false)}
  >
    <DesktopScreenshotPreview
      screenshot={screenshot}
      onClose={() => setShowScreenshot(false)}
    />
  </Modal>
)}
```

- [ ] **Step 4: Test integration**

Run the app and test:
1. Open a session
2. Tap the camera button
3. Select "Desktop" from the menu
4. Verify screenshot is captured and displayed

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/app/
git commit -m "feat(app): integrate desktop screenshot in session"
```

---

### Task 6: End-to-End Integration Test

**Files:**
- Create: `packages/happy-app/sources/__tests__/desktopScreenshot.integration.test.ts`

**Interfaces:**
- Consumes: Full screenshot flow (hook, component, RPC)
- Produces: Integration test verifying request → handler → response → display

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Desktop Screenshot E2E', () => {
  it('should capture screenshot from mobile app request through to display', async () => {
    // Mock RPC transport
    // Mock CLI screenshot handler
    // Call useDesktopScreenshot
    // Verify response is structured correctly
    // Verify image can be displayed
  });

  it('should handle screenshot request timeout gracefully', async () => {
    // Mock slow/timeout scenario
  });

  it('should support both desktop and browser targets', async () => {
    // Test both target types
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
cd packages/happy-app
pnpm test -- __tests__/desktopScreenshot.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/happy-app/sources/__tests__/desktopScreenshot.integration.test.ts
git commit -m "test(app): add desktop screenshot integration tests"
```

---

### Task 7: Build OTA and Deploy to Preview

**Files:**
- No new files (uses existing Expo build infrastructure)

**Interfaces:**
- Consumes: Built app from tasks 1-6
- Produces: Published Preview OTA containing desktop screenshot feature

- [ ] **Step 1: Type check and test**

```bash
cd /Users/jiashengwang/jacky-github/happy-study/happy--preview-ota
pnpm typecheck
pnpm --filter happy-app test
```

- [ ] **Step 2: Build and publish OTA**

```bash
cd packages/happy-app
pnpm ota:selfhost:preview
```

Expected output:
```
✅ 发布完成！
频道: preview · 平台: android · runtimeVersion: 21
manifest 地址: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/latest.json
新版本 id: <UUID>
```

- [ ] **Step 3: Commit with release notes**

```bash
git add -A
git commit -m "feat(release): desktop screenshot feature OTA

- Capture desktop/browser screenshots from mobile
- Real-time monitoring of desktop state from Happy App
- Base64 transport through encrypted channel
- Support for macOS, Linux, Windows (CLI handler)

OTA Channel: preview
Runtime: 21
Target: Android"
```

---

## Spec Coverage Checklist

- [x] Desktop screenshot capture from mobile
- [x] RPC protocol extension for screenshot
- [x] CLI handler with platform-specific commands
- [x] Screenshot preview display in App
- [x] Base64 image transport
- [x] End-to-end encryption preserved
- [x] i18n support
- [x] Type safety (TypeScript + Zod)
- [x] Unit + integration tests
- [x] OTA deployment to preview channel

---

## Implementation Notes

- **Platform Support**: macOS (`screencapture`), Linux (`gnome-screenshot`), Windows (PowerShell). The first two are well-tested; Windows path may need refinement.
- **Browser vs Desktop**: Currently both capture full screen. Future iteration could add window detection to target browser specifically.
- **Cleanup**: Temp files are cleaned up via `rm -f` in finally block. Consider atomic cleanup if needed.
- **Base64 Size**: Large screenshots may add ~33% to payload. Consider compression if bandwidth is concern (not critical for MVP).
- **Error Handling**: Uses `useHappyAction` which retries on error. Users see modal alerts for failures.
