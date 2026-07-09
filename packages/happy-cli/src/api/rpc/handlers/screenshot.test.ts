/**
 * Tests for screenshot RPC handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleScreenshot } from './screenshot';
import { ScreenshotRequest } from '@slopus/happy-wire';

// Mock all required modules
vi.mock('child_process');
vi.mock('fs');
vi.mock('fs/promises');
vi.mock('os', () => ({
  platform: vi.fn(() => 'darwin'),
  tmpdir: vi.fn(() => '/tmp'),
  homedir: vi.fn(() => '/home/testuser'),
}));
vi.mock('@/lib');

describe('Screenshot Handler', () => {
  let mockExecSync: any;
  let mockExistsSync: any;
  let mockReadFile: any;
  let mockUnlinkSync: any;

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Re-import modules to get fresh mocks
    const { execSync } = await import('child_process');
    const fsModule = await import('fs');
    const fsPromisesModule = await import('fs/promises');
    const osModule = await import('os');

    mockExecSync = execSync as any;
    mockExistsSync = fsModule.existsSync as any;
    mockReadFile = fsPromisesModule.readFile as any;
    mockUnlinkSync = fsModule.unlinkSync as any;

    // Setup default mock implementations
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from('mock-image-data'));

    // Reset os.platform to 'darwin' by default
    vi.mocked(osModule.platform).mockReturnValue('darwin' as any);
  });

  describe('macOS screenshot capture', () => {
    it('should capture screenshot using screencapture command on macOS', async () => {
      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'desktop',
        timestamp: Date.now(),
      };

      const response = await handleScreenshot(request);

      expect(mockExecSync).toHaveBeenCalled();
      const command = mockExecSync.mock.calls[0][0];
      expect(command).toContain('screencapture -x');
      expect(command).toContain('.png');

      expect(response).toMatchObject({
        mimeType: 'image/png',
        targetUsed: 'desktop',
      });
      expect(response.data).toBeDefined();
      expect(response.size).toBeGreaterThan(0);
      expect(response.timestamp).toBeGreaterThan(0);
    });

    it('should properly encode screenshot as base64', async () => {
      const testData = Buffer.from('test-image-content');
      mockReadFile.mockResolvedValue(testData);

      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'desktop',
        timestamp: Date.now(),
      };

      const response = await handleScreenshot(request);

      expect(response.data).toBe(testData.toString('base64'));
      expect(response.size).toBe(testData.length);
    });

    it('should clean up temporary screenshot file after capturing', async () => {
      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'desktop',
        timestamp: Date.now(),
      };

      await handleScreenshot(request);

      // Verify cleanup was attempted
      expect(mockUnlinkSync).toHaveBeenCalled();
      const cleanupPath = mockUnlinkSync.mock.calls[0][0];
      expect(cleanupPath).toContain('happy-screenshot');
    });
  });

  describe('Linux screenshot capture', () => {
    it('should capture screenshot using gnome-screenshot on Linux', async () => {
      // Mock os.platform to return 'linux'
      const osModule = await import('os');
      vi.mocked(osModule.platform).mockReturnValue('linux' as any);

      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'browser',
        timestamp: Date.now(),
      };

      const response = await handleScreenshot(request);

      expect(mockExecSync).toHaveBeenCalled();
      const command = mockExecSync.mock.calls[0][0];
      expect(command).toContain('gnome-screenshot -f');

      expect(response.targetUsed).toBe('browser');
    });
  });

  describe('Windows screenshot capture', () => {
    it('should capture screenshot using PowerShell on Windows', async () => {
      // Mock os.platform to return 'win32'
      const osModule = await import('os');
      vi.mocked(osModule.platform).mockReturnValue('win32' as any);

      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'desktop',
        timestamp: Date.now(),
      };

      const response = await handleScreenshot(request);

      expect(mockExecSync).toHaveBeenCalled();
      const command = mockExecSync.mock.calls[0][0];
      expect(command).toContain('powershell');
      expect(command).toContain('System.Windows.Forms');

      expect(response).toMatchObject({
        mimeType: 'image/png',
        targetUsed: 'desktop',
      });
    });
  });

  describe('Error handling', () => {
    it('should throw error for unsupported platform', async () => {
      // Mock os.platform to return unsupported platform
      const osModule = await import('os');
      vi.mocked(osModule.platform).mockReturnValue('freebsd' as any);

      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'desktop',
        timestamp: Date.now(),
      };

      await expect(handleScreenshot(request)).rejects.toThrow('Unsupported platform');
    });

    it('should throw error if screenshot file is not created', async () => {
      mockExistsSync.mockReturnValue(false);

      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'desktop',
        timestamp: Date.now(),
      };

      await expect(handleScreenshot(request)).rejects.toThrow('file not created');
    });

    it('should handle execSync errors gracefully', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'desktop',
        timestamp: Date.now(),
      };

      await expect(handleScreenshot(request)).rejects.toThrow('Command failed');
    });

    it('should still attempt cleanup on error', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Capture failed');
      });

      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'desktop',
        timestamp: Date.now(),
      };

      try {
        await handleScreenshot(request);
      } catch {
        // Expected to throw
      }

      // Cleanup should still be attempted
      expect(mockUnlinkSync).toHaveBeenCalled();
    });
  });

  describe('Request/Response validation', () => {
    it('should return response with all required fields', async () => {
      // Ensure mockExecSync doesn't throw
      mockExecSync.mockReturnValue(undefined);

      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'desktop',
        timestamp: Date.now(),
      };

      const response = await handleScreenshot(request);

      expect(response).toHaveProperty('data');
      expect(response).toHaveProperty('mimeType');
      expect(response).toHaveProperty('size');
      expect(response).toHaveProperty('timestamp');
      expect(response).toHaveProperty('targetUsed');

      expect(typeof response.data).toBe('string'); // base64
      expect(response.mimeType).toBe('image/png');
      expect(typeof response.size).toBe('number');
      expect(typeof response.timestamp).toBe('number');
      expect(response.targetUsed).toBe('desktop');
    });

    it('should preserve target from request in response', async () => {
      // Ensure mockExecSync doesn't throw
      mockExecSync.mockReturnValue(undefined);

      const request: ScreenshotRequest = {
        type: 'screenshot',
        target: 'browser',
        timestamp: Date.now(),
      };

      const response = await handleScreenshot(request);

      expect(response.targetUsed).toBe('browser');
    });
  });
});
