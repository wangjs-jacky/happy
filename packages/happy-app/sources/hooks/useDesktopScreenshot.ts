import * as React from 'react';
import { ScreenshotTarget, ScreenshotRequest, ScreenshotResponse } from '@slopus/happy-wire';

/**
 * Hook for capturing desktop/browser screenshots through RPC.
 *
 * Manages async screenshot request lifecycle, including loading state
 * and response storage. The caller is responsible for passing the RPC
 * sender function (typically session.rpc.send()).
 *
 * @param sendRpc - Function to send RPC request and get response
 * @returns Object with { capture(), screenshot, loading }
 */
export function useDesktopScreenshot(
  sendRpc: (request: ScreenshotRequest) => Promise<ScreenshotResponse>
) {
  const [screenshot, setScreenshot] = React.useState<ScreenshotResponse | null>(null);
  const [loading, setLoading] = React.useState(false);

  const capture = React.useCallback(
    async (target: ScreenshotTarget) => {
      setLoading(true);
      try {
        const response = await sendRpc({
          type: 'screenshot',
          target,
          timestamp: Date.now(),
        });
        setScreenshot(response);
      } finally {
        setLoading(false);
      }
    },
    [sendRpc]
  );

  return { capture, screenshot, loading };
}
