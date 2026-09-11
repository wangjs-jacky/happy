import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockAuthAndSetupMachineIfNeeded: vi.fn(),
  mockCollectCodexUsageSnapshot: vi.fn(),
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

vi.mock('@/codex/codexUsage', () => ({
  collectCodexUsageSnapshot: mocks.mockCollectCodexUsageSnapshot,
}))

import { handleCodexCommand, runCodexWorkerCommand } from './codexCommand'
import { createWorkerSessionStartupLifecycleFromEnvironment } from '@/api/sessionStartupTrace'

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
    mocks.mockCollectCodexUsageSnapshot.mockResolvedValue({
      sessionsDir: '/tmp/codex-sessions',
      timeZone: 'UTC',
      today: null,
      yesterday: null,
      latestEvent: null,
      warnings: [],
    })
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

  it('records entry before loading heavy dependencies and retains it through actual command orchestration', async () => {
    const startupLifecycle = createWorkerSessionStartupLifecycleFromEnvironment({
      HAPPY_SESSION_STARTUP_TRACE_ID: '00000000-0000-4000-8000-000000000001',
    })!
    const order: string[] = []
    let launchedOptions: any
    await runCodexWorkerCommand(['codex', '--started-by', 'daemon', '--model', 'test-model'], {
      startupLifecycle,
      loadAuthenticationDependencies: async () => ({
        authAndSetupMachineIfNeeded: async (lifecycle) => {
          expect(lifecycle).toBe(startupLifecycle)
          order.push('auth.started')
          lifecycle!.authReady()
          lifecycle!.machineReady('machine-1')
          return { credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array(32) } }, machineId: 'machine-1' }
        },
      }),
      loadRuntimeDependencies: async () => {
        order.push(...mocks.mockLoggerDebug.mock.calls
          .filter(([label]) => label === '[SESSION STARTUP]')
          .map(([, event]) => event.stage), 'dependencies.loaded')
        return {
          promptInstallSlashCommandIfNeeded: async () => { order.push('install.checked'); return 'skipped' },
          ensureDaemonRunning: async () => { order.push('daemon.checked') },
          runCodex: async (options: any) => { launchedOptions = options; order.push('codex.started') },
        }
      },
    })

    expect(order).toEqual([
      'worker.entry.started', 'dependencies.loaded', 'auth.started',
      'install.checked', 'daemon.checked', 'codex.started',
    ])
    expect(launchedOptions).toMatchObject({ startedBy: 'daemon', model: 'test-model', startupLifecycle })
    expect(mocks.mockLoggerDebug.mock.calls
      .filter(([label]) => label === '[SESSION STARTUP]')
      .map(([, event]) => event.stage)).toEqual([
        'worker.entry.started', 'worker.auth.ready', 'worker.machine.ready',
      ])
  })

  it('authenticates and emits auth ready while runtime dependencies remain deferred', async () => {
    const startupLifecycle = createWorkerSessionStartupLifecycleFromEnvironment({
      HAPPY_SESSION_STARTUP_TRACE_ID: '00000000-0000-4000-8000-000000000001',
    })!
    let resolveRuntimeDependencies: (dependencies: any) => void
    const runtimeDependencies = new Promise<any>((resolve) => {
      resolveRuntimeDependencies = resolve
    })
    const authAndSetupMachineIfNeeded = vi.fn(async (lifecycle) => {
      lifecycle.authReady()
      lifecycle.machineReady('machine-1')
      return { credentials: { token: 'token', encryption: { type: 'legacy' as const, secret: new Uint8Array(32) } }, machineId: 'machine-1' }
    })
    const loadAuthenticationDependencies = vi.fn(async () => ({ authAndSetupMachineIfNeeded }))
    const loadRuntimeDependencies = vi.fn(async () => runtimeDependencies)
    const ensureDaemonRunning = vi.fn(async () => undefined)
    const runCodex = vi.fn(async () => undefined)

    const command = runCodexWorkerCommand(['codex', '--started-by', 'daemon'], {
      startupLifecycle,
      loadAuthenticationDependencies,
      loadRuntimeDependencies,
    })

    await vi.waitFor(() => {
      expect(loadAuthenticationDependencies).toHaveBeenCalledTimes(1)
      expect(loadRuntimeDependencies).toHaveBeenCalledTimes(1)
      expect(authAndSetupMachineIfNeeded).toHaveBeenCalledWith(startupLifecycle)
    })
    expect(mocks.mockLoggerDebug.mock.calls
      .filter(([label]) => label === '[SESSION STARTUP]')
      .map(([, event]) => event.stage)).toEqual([
        'worker.entry.started', 'worker.auth.ready', 'worker.machine.ready',
      ])
    expect(ensureDaemonRunning).not.toHaveBeenCalled()
    expect(runCodex).not.toHaveBeenCalled()

    resolveRuntimeDependencies!({
      promptInstallSlashCommandIfNeeded: async () => 'skipped',
      ensureDaemonRunning,
      runCodex,
    })
    await command

    expect(ensureDaemonRunning).toHaveBeenCalledWith({ startedBy: 'daemon' })
    expect(runCodex).toHaveBeenCalledTimes(1)
  })

  it('observes a runtime loader rejection when authentication fails first', async () => {
    const workerEntry = await readFile(resolve(process.cwd(), 'dist/codexWorkerEntry.mjs'), 'utf8')
    const codexCommandModule = workerEntry.match(/'\.\/(codexCommand-[^']+\.mjs)'/)?.[1]
    expect(codexCommandModule).toBeDefined()
    const moduleUrl = pathToFileURL(resolve(process.cwd(), 'dist', codexCommandModule!)).href
    const script = `
      const { c: codexCommand } = await import(process.argv[1])
      let rejectAuthenticationDependencies
      let rejectRuntimeDependencies
      let authenticationLoads = 0
      let runtimeLoads = 0
      const authenticationDependencies = new Promise((_, reject) => { rejectAuthenticationDependencies = reject })
      const runtimeDependencies = new Promise((_, reject) => { rejectRuntimeDependencies = reject })
      const command = codexCommand.runCodexWorkerCommand(['codex'], {
        loadAuthenticationDependencies: () => { authenticationLoads++; return authenticationDependencies },
        loadRuntimeDependencies: () => { runtimeLoads++; return runtimeDependencies }
      })
      await Promise.resolve()
      if (authenticationLoads !== 1 || runtimeLoads !== 1) throw new Error('both loaders must start before either resolves')
      rejectAuthenticationDependencies(new Error('authentication failed'))
      let observedAuthenticationFailure = false
      try { await command } catch (error) {
        if (error.message !== 'authentication failed') throw error
        observedAuthenticationFailure = true
      }
      if (!observedAuthenticationFailure) throw new Error('authentication failure must reject the command')
      rejectRuntimeDependencies(new Error('runtime loading failed'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      process.stdout.write('runtime rejection observed\\n')
    `
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script, moduleUrl])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const exitCode = await new Promise<number | null>((resolve) => child.once('close', resolve))

    expect(exitCode).toBe(0)
    expect(stdout).toBe('runtime rejection observed\n')
    expect(stderr).toBe('')
  })

  it('loads only usage dependencies for the usage command', async () => {
    const loadUsageDependencies = vi.fn(async () => ({
      collectCodexUsageSnapshot: async () => ({
        source: 'codex-session-jsonl' as const,
        codexHome: '/tmp/codex-home',
        sessionsDir: '/tmp/codex-sessions',
        timeZone: 'UTC',
        scannedAt: 0,
        today: null,
        yesterday: null,
        days: [],
        latestEvent: null,
        warnings: [],
      }),
    }))
    const loadAuthenticationDependencies = vi.fn()
    const loadRuntimeDependencies = vi.fn()
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await runCodexWorkerCommand(['usage'], {
      loadUsageDependencies,
      loadAuthenticationDependencies,
      loadRuntimeDependencies,
    })

    expect(loadUsageDependencies).toHaveBeenCalledTimes(1)
    expect(loadAuthenticationDependencies).not.toHaveBeenCalled()
    expect(loadRuntimeDependencies).not.toHaveBeenCalled()
    consoleLog.mockRestore()
  })

  it('routes the exact account upload command without loading a Codex worker', async () => {
    const uploadCurrentCodexAccount = vi.fn(async () => undefined)
    const loadRuntimeDependencies = vi.fn()
    await runCodexWorkerCommand(['codex', 'account', 'upload'], {
      loadAccountDependencies: async () => ({ uploadCurrentCodexAccount }), loadRuntimeDependencies,
    })
    expect(uploadCurrentCodexAccount).toHaveBeenCalledOnce()
    expect(loadRuntimeDependencies).not.toHaveBeenCalled()
    expect(mocks.mockAuthAndSetupMachineIfNeeded).not.toHaveBeenCalled()
  })

  it.each([['account'], ['account', 'upload', '--yes'], ['account', 'upload', '/tmp/auth.json'], ['account', 'rename']])('rejects unsupported account command arguments %j', async (...args) => {
    await expect(runCodexWorkerCommand(args)).rejects.toThrow('paws codex account upload')
    expect(mocks.mockRunCodex).not.toHaveBeenCalled()
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
