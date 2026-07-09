/**
 * RPC handlers index
 * Central export point for all RPC handler functions and registration utilities
 */

import { RpcHandlerManager } from '../RpcHandlerManager';
import { handleScreenshot } from './screenshot';

export { handleScreenshot } from './screenshot';

/**
 * Register the screenshot RPC handler
 * @param rpcHandlerManager - The RPC handler manager instance
 */
export function registerScreenshotHandler(
  rpcHandlerManager: RpcHandlerManager
): void {
  rpcHandlerManager.registerHandler('screenshot', handleScreenshot);
}
