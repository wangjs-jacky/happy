import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentBackend, AgentMessage, AgentMessageHandler, SessionId, StartSessionResult } from '@/agent/core/AgentBackend';

const MAX_PROJECT_CODE_LENGTH = 64;
const PROJECT_CODE_HASH_LENGTH = 16;
const TURN_TIMEOUT_MS = 10 * 60 * 1000;
const PYTHON_PTY_SCRIPT = `
import os, pty, select, subprocess, sys

cmd = sys.argv[1:]
if not cmd:
    print("missing command", file=sys.stderr)
    sys.exit(2)

master, slave = pty.openpty()
proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, close_fds=True, env=os.environ.copy())
os.close(slave)
try:
    while True:
        readable, _, _ = select.select([master], [], [], 0.1)
        if master in readable:
            try:
                data = os.read(master, 4096)
            except OSError:
                break
            if data:
                os.write(1, data)
        if proc.poll() is not None:
            while True:
                try:
                    data = os.read(master, 4096)
                except OSError:
                    break
                if not data:
                    break
                os.write(1, data)
            break
finally:
    try:
        os.close(master)
    except OSError:
        pass

sys.exit(proc.returncode or 0)
`;

type DeepCodeSessionIndexEntry = {
  id?: unknown;
  createTime?: unknown;
  updateTime?: unknown;
};

function stripAnsi(input: string): string {
  return input
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function sanitizeProjectCodePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
}

function getLegacyProjectCode(projectRoot: string): string {
  return projectRoot.replace(/[\\/]/g, '-').replace(/:/g, '');
}

async function hashProjectRoot(projectRoot: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const normalized = path.resolve(projectRoot);
  const hashInput = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return createHash('sha256').update(hashInput).digest('hex').slice(0, PROJECT_CODE_HASH_LENGTH);
}

async function getProjectCode(projectRoot: string): Promise<string> {
  const legacyCode = getLegacyProjectCode(projectRoot);
  if (legacyCode.length <= MAX_PROJECT_CODE_LENGTH) {
    return legacyCode;
  }

  const hash = await hashProjectRoot(projectRoot);
  const prefixLimit = MAX_PROJECT_CODE_LENGTH - PROJECT_CODE_HASH_LENGTH - 1;
  const basename = path.basename(path.resolve(projectRoot));
  const prefix = sanitizeProjectCodePart(basename).slice(0, prefixLimit).replace(/[-.]+$/g, '') || 'project';
  return `${prefix}-${hash}`;
}

async function readLatestSessionId(projectRoot: string, since: number): Promise<string | null> {
  try {
    const projectCode = await getProjectCode(projectRoot);
    const indexPath = path.join(os.homedir(), '.deepcode', 'projects', projectCode, 'sessions-index.json');
    if (!existsSync(indexPath)) return null;

    const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const entries: DeepCodeSessionIndexEntry[] = Array.isArray(index?.entries) ? index.entries : [];
    const candidates = entries
      .filter((entry) => typeof entry?.id === 'string')
      .map((entry) => ({
        id: entry.id as string,
        time: Date.parse(String(entry.updateTime ?? entry.createTime ?? '')),
      }))
      .filter((entry) => Number.isFinite(entry.time) && entry.time >= since - 5000)
      .sort((a, b) => b.time - a.time);
    return candidates[0]?.id ?? null;
  } catch {
    return null;
  }
}

function resolveDeepCodeCommand(): { command: string; argsPrefix: string[] } {
  if (process.env.DEEPCODE_CLI_PATH) {
    return {
      command: process.env.DEEPCODE_NODE_PATH ?? process.execPath,
      argsPrefix: [process.env.DEEPCODE_CLI_PATH],
    };
  }

  try {
    const which = spawnSyncText(process.platform === 'win32' ? 'where deepcode' : 'command -v deepcode').trim();
    if (which) {
      const real = realpathSync(which);
      if (real.endsWith(`${path.sep}cli.js`) && real.includes(`${path.sep}@vegamo${path.sep}deepcode-cli${path.sep}`)) {
        return { command: process.execPath, argsPrefix: [real] };
      }
    }
  } catch {
    // Fall back to PATH lookup below.
  }

  return { command: 'deepcode', argsPrefix: [] };
}

function spawnSyncText(command: string): string {
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', command], { encoding: 'utf-8', windowsHide: true })
    : spawnSync('/bin/sh', ['-lc', command], { encoding: 'utf-8', windowsHide: true });
  if (result.error) throw result.error;
  return result.stdout ?? '';
}

export class DeepCodeBackend implements AgentBackend {
  private handlers = new Set<AgentMessageHandler>();
  private sessionId: string | null = null;
  private activeProcess: ChildProcessWithoutNullStreams | null = null;

  constructor(private readonly opts: { cwd: string; log?: (msg: string) => void }) {}

  async startSession(): Promise<StartSessionResult> {
    return { sessionId: 'deepcode' };
  }

  async sendPrompt(_sessionId: SessionId, prompt: string): Promise<void> {
    const startedAt = Date.now();
    const resolved = resolveDeepCodeCommand();
    const deepcodeArgs = [...resolved.argsPrefix];
    if (this.sessionId) {
      deepcodeArgs.push('--resume', this.sessionId);
    }
    deepcodeArgs.push('--prompt', prompt);

    this.opts.log?.(`Running ${resolved.command} ${deepcodeArgs.join(' ')}`);
    this.emit({ type: 'status', status: 'running' });

    const output = await this.runTurn(resolved.command, deepcodeArgs);
    const cleaned = stripAnsi(output).trim();
    if (cleaned) {
      this.emit({ type: 'model-output', textDelta: cleaned });
    }

    if (!this.sessionId) {
      const projectCode = await getProjectCode(this.opts.cwd);
      const sessionId = await readLatestSessionId(this.opts.cwd, startedAt)
        ?? await readLatestSessionId(path.resolve(this.opts.cwd), startedAt);
      if (sessionId) {
        this.sessionId = sessionId;
        this.opts.log?.(`DeepCode session ${sessionId} for project ${projectCode}`);
      }
    }

    this.emit({ type: 'status', status: 'idle' });
  }

  async cancel(_sessionId: SessionId): Promise<void> {
    this.activeProcess?.kill('SIGTERM');
  }

  onMessage(handler: AgentMessageHandler): void {
    this.handlers.add(handler);
  }

  offMessage(handler: AgentMessageHandler): void {
    this.handlers.delete(handler);
  }

  async dispose(): Promise<void> {
    this.activeProcess?.kill();
    this.handlers.clear();
  }

  private runTurn(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('python3', ['-c', PYTHON_PTY_SCRIPT, command, ...args], {
        cwd: this.opts.cwd,
        env: process.env,
        windowsHide: true,
      });
      this.activeProcess = child;

      let output = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('DeepCode turn timed out'));
      }, TURN_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        this.activeProcess = null;
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        this.activeProcess = null;
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(stripAnsi(output).trim() || `DeepCode exited with code ${code}`));
        }
      });
    });
  }

  private emit(msg: AgentMessage): void {
    for (const handler of this.handlers) {
      handler(msg);
    }
  }
}
