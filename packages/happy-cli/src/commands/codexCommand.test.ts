import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockAuthAndSetupMachineIfNeeded: vi.fn(),
  mockRunCodex: vi.fn(),
  mockExtractCodexResumeFlag: vi.fn(),
  mockExtractNoSandboxFlag: vi.fn(),
  mockEnsureDaemonRunning: vi.fn(),
  mockLoggerDebug: vi.fn(),
}))

vi.mock('@/ui/logger', () => ({
  logger: { debug: mocks.mockLoggerDebug },
}))

vi.mock('@/ui/auth', () => ({
  authAndSetupMachineIfNeeded: mocks.mockAuthAndSetupMachineIfNeeded,
}))

vi.mock('@/codex/runCodex', () => ({
  runCodex: mocks.mockRunCodex,
}))

vi.mock('@/codex/cliArgs', () => ({
  extractCodexResumeFlag: mocks.mockExtractCodexResumeFlag,
}))

vi.mock('@/utils/sandboxFlags', () => ({
  extractNoSandboxFlag: mocks.mockExtractNoSandboxFlag,
}))

vi.mock('@/daemon/ensureDaemonRunning', () => ({
  ensureDaemonRunning: mocks.mockEnsureDaemonRunning,
}))

import { handleCodexCommand } from './codexCommand'

describe('handleCodexCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockAuthAndSetupMachineIfNeeded.mockResolvedValue({
      credentials: { token: 'token' },
      machineId: 'machine-1',
    })
    mocks.mockExtractNoSandboxFlag.mockImplementation((args: string[]) => ({
      noSandbox: false,
      args,
    }))
    mocks.mockExtractCodexResumeFlag.mockImplementation((args: string[]) => ({
      resumeThreadId: null,
      args,
    }))
    mocks.mockEnsureDaemonRunning.mockResolvedValue(undefined)
    mocks.mockRunCodex.mockResolvedValue(undefined)
    delete process.env.HAPPY_SESSION_STARTUP_TRACE_ID
  })

  afterEach(() => {
    delete process.env.HAPPY_SESSION_STARTUP_TRACE_ID
    vi.restoreAllMocks()
  })

  it('creates worker timing before auth and passes the same lifecycle through to Codex', async () => {
    process.env.HAPPY_SESSION_STARTUP_TRACE_ID = '00000000-0000-4000-8000-000000000001'
    let authLifecycle: any
    mocks.mockAuthAndSetupMachineIfNeeded.mockImplementation(async (startupLifecycle) => {
      authLifecycle = startupLifecycle
      startupLifecycle.authReady()
      startupLifecycle.machineReady('machine-1')
      return { credentials: { token: 'token' }, machineId: 'machine-1' }
    })

    await handleCodexCommand(['--started-by', 'daemon'])

    const events = mocks.mockLoggerDebug.mock.calls
      .filter(([label]) => label === '[SESSION STARTUP]')
      .map(([, event]) => event)
    expect(events.map((event) => event.stage)).toEqual([
      'worker.entry.started',
      'worker.auth.ready',
      'worker.machine.ready',
    ])
    expect(authLifecycle).toBeDefined()
    expect(mocks.mockRunCodex.mock.calls[0][0].startupLifecycle).toBe(authLifecycle)
  })

  it('ensures the daemon is running before starting a codex session in YOLO mode by default', async () => {
    await handleCodexCommand(['--started-by', 'terminal'])

    expect(mocks.mockEnsureDaemonRunning).toHaveBeenCalledTimes(1)
    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: 'terminal',
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: 'yolo',
      model: undefined,
      effort: undefined,
    })
    expect(
      mocks.mockEnsureDaemonRunning.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.mockRunCodex.mock.invocationCallOrder[0])
  })

  it('passes parsed no-sandbox and resume flags through to runCodex', async () => {
    mocks.mockExtractNoSandboxFlag.mockReturnValue({
      noSandbox: true,
      args: ['--resume', 'thread-123', '--started-by', 'daemon'],
    })
    mocks.mockExtractCodexResumeFlag.mockReturnValue({
      resumeThreadId: 'thread-123',
      args: ['--started-by', 'daemon'],
    })

    await handleCodexCommand(['--no-sandbox', '--resume', 'thread-123', '--started-by', 'daemon'])

    expect(mocks.mockEnsureDaemonRunning).toHaveBeenCalledWith({ startedBy: 'daemon' })
    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: 'daemon',
      noSandbox: true,
      resumeThreadId: 'thread-123',
      permissionMode: 'yolo',
      model: undefined,
      effort: undefined,
    })
  })

  it('passes permission-mode through to runCodex', async () => {
    await handleCodexCommand(['--permission-mode', 'yolo'])

    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: undefined,
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: 'yolo',
      model: undefined,
      effort: undefined,
    })
  })

  it('passes model through to runCodex', async () => {
    await handleCodexCommand(['--model', 'gpt-5.4'])

    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: undefined,
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: 'yolo',
      model: 'gpt-5.4',
      effort: undefined,
    })
  })

  it('passes effort through to runCodex', async () => {
    await handleCodexCommand(['--effort', 'xhigh'])

    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: undefined,
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: 'yolo',
      model: undefined,
      effort: 'xhigh',
    })
  })

  it('maps --yolo to codex yolo permission mode', async () => {
    await handleCodexCommand(['--yolo'])

    expect(mocks.mockRunCodex).toHaveBeenCalledWith({
      credentials: { token: 'token' },
      startedBy: undefined,
      noSandbox: false,
      resumeThreadId: undefined,
      permissionMode: 'yolo',
      model: undefined,
      effort: undefined,
    })
  })
})
