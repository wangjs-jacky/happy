/**
 * Screenshot RPC handler
 * Handles requests to capture desktop screenshots from remote clients
 * Supports macOS, Linux, and Windows platforms
 */

import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as os from 'os';
import { ScreenshotRequest, ScreenshotResponse } from '@slopus/happy-wire';
import { logger } from '@/lib';

/**
 * Handle screenshot request
 * Captures the desktop screen and returns it as base64-encoded PNG/JPEG
 *
 * @param request - Screenshot request containing target (desktop/browser) info
 * @returns Promise resolving to screenshot response with base64 image data
 * @throws Error if screenshot capture fails or platform is unsupported
 */
export async function handleScreenshot(
  request: ScreenshotRequest
): Promise<ScreenshotResponse> {
  const platform = os.platform();
  const screenshotPath = join(tmpdir(), `happy-screenshot-${Date.now()}.png`);

  try {
    logger.debug('[RPC] Screenshot request received', { target: request.target });

    // Platform-specific screenshot command
    if (platform === 'darwin') {
      // macOS: use screencapture
      execSync(`screencapture -x "${screenshotPath}"`);
    } else if (platform === 'linux') {
      // Linux: use gnome-screenshot
      execSync(`gnome-screenshot -f "${screenshotPath}"`);
    } else if (platform === 'win32') {
      // Windows: use PowerShell with .NET APIs
      const psCmd = `
Add-Type -AssemblyName System.Windows.Forms;
$screen = [System.Windows.Forms.Screen]::PrimaryScreen;
$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height);
$graphics = [System.Drawing.Graphics]::FromImage($bitmap);
$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size);
$bitmap.Save("${screenshotPath}", [System.Drawing.Imaging.ImageFormat]::Png);
$graphics.Dispose();
$bitmap.Dispose();
      `.trim();
      execSync(`powershell -NoProfile -Command "${psCmd}"`);
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    // Verify screenshot was created
    if (!existsSync(screenshotPath)) {
      throw new Error('Failed to capture screenshot: file not created');
    }

    // Read and encode the screenshot
    const imageBuffer = await readFile(screenshotPath);
    const base64Data = imageBuffer.toString('base64');

    logger.debug('[RPC] Screenshot captured successfully', {
      size: imageBuffer.length,
      target: request.target,
    });

    return {
      data: base64Data,
      mimeType: 'image/png',
      size: imageBuffer.length,
      timestamp: Date.now(),
      targetUsed: request.target,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn('[RPC] Screenshot capture failed', { error: errorMessage, platform });
    throw new Error(`Failed to capture screenshot: ${errorMessage}`);
  } finally {
    // Cleanup temporary file
    if (existsSync(screenshotPath)) {
      try {
        unlinkSync(screenshotPath);
        logger.debug('[RPC] Screenshot temp file cleaned up');
      } catch (cleanupError) {
        logger.warn('[RPC] Failed to cleanup temp screenshot file', {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
  }
}
