import fs from 'fs/promises';
import os from 'os';
import { join } from 'path';

const CODEX_HOME_CONFIG_ENTRIES = new Set([
  'AGENTS.md',
  'AGENTS.override.md',
  'config.toml',
  'hooks.json',
  'plugins',
  'prompts',
  'requirements.toml',
  'rules',
  'skills',
]);

type InheritCodexHomeConfigurationOptions = {
  sourceCodexHome?: string;
  onDebug?: (message: string, error?: unknown) => void;
};

export function shouldInheritCodexHomeEntry(entry: string): boolean {
  return CODEX_HOME_CONFIG_ENTRIES.has(entry) || entry.endsWith('.config.toml');
}

export async function inheritCodexHomeConfiguration(
  targetCodexHome: string,
  options: InheritCodexHomeConfigurationOptions = {},
): Promise<void> {
  const sourceCodexHome = options.sourceCodexHome ?? process.env.CODEX_HOME ?? join(os.homedir(), '.codex');
  if (sourceCodexHome === targetCodexHome) return;

  let entries: string[];
  try {
    entries = await fs.readdir(sourceCodexHome);
  } catch (error) {
    options.onDebug?.(`Could not read Codex home for config inheritance: ${sourceCodexHome}`, error);
    return;
  }

  await Promise.all(entries.filter(shouldInheritCodexHomeEntry).map(async (entry) => {
    const sourcePath = join(sourceCodexHome, entry);
    const targetPath = join(targetCodexHome, entry);

    try {
      await fs.lstat(targetPath);
      return;
    } catch {
      // Expected for a fresh temporary CODEX_HOME.
    }

    try {
      const stats = await fs.lstat(sourcePath);
      const symlinkType = stats.isDirectory()
        ? (process.platform === 'win32' ? 'junction' : 'dir')
        : 'file';
      await fs.symlink(sourcePath, targetPath, symlinkType);
    } catch (error) {
      try {
        const stats = await fs.lstat(sourcePath);
        if (!stats.isDirectory()) {
          await fs.copyFile(sourcePath, targetPath);
          return;
        }
      } catch {
        // Keep the original symlink error for diagnostics below.
      }
      options.onDebug?.(`Failed to inherit Codex home entry ${entry}`, error);
    }
  }));
}
