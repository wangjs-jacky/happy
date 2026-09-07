import { extractCodexResumeFlag } from '@/codex/cliArgs'
import { extractNoSandboxFlag } from '@/utils/sandboxFlags'
import type { PermissionMode } from '@/api/types'
import type { ReasoningEffort } from '@/codex/codexAppServerTypes'
import type { collectCodexUsageSnapshot } from '@/codex/codexUsage'
import { createWorkerSessionStartupLifecycleFromEnvironment, traceWorkerAuthentication, type WorkerSessionStartupLifecycle } from '@/api/sessionStartupTrace'

type CodexAuthenticationDependencies = {
  authAndSetupMachineIfNeeded: typeof import('@/ui/auth').authAndSetupMachineIfNeeded
}

type CodexRuntimeDependencies = {
  runCodex: typeof import('@/codex/runCodex').runCodex
  ensureDaemonRunning: typeof import('@/daemon/ensureDaemonRunning').ensureDaemonRunning
  promptInstallSlashCommandIfNeeded: typeof import('./pawsInstallPrompt').promptInstallSlashCommandIfNeeded
}

type CodexUsageDependencies = {
  collectCodexUsageSnapshot: typeof collectCodexUsageSnapshot
}

async function loadAuthenticationDependencies(): Promise<CodexAuthenticationDependencies> {
  const auth = await import('@/ui/auth')
  return { authAndSetupMachineIfNeeded: auth.authAndSetupMachineIfNeeded }
}

async function loadRuntimeDependencies(): Promise<CodexRuntimeDependencies> {
  const [codex, daemon, installPrompt] = await Promise.all([
    import('@/codex/runCodex'),
    import('@/daemon/ensureDaemonRunning'),
    import('./pawsInstallPrompt'),
  ])
  return {
    runCodex: codex.runCodex,
    ensureDaemonRunning: daemon.ensureDaemonRunning,
    promptInstallSlashCommandIfNeeded: installPrompt.promptInstallSlashCommandIfNeeded,
  }
}

async function loadUsageDependencies(): Promise<CodexUsageDependencies> {
  const usage = await import('@/codex/codexUsage')
  return { collectCodexUsageSnapshot: usage.collectCodexUsageSnapshot }
}

type CodexWorkerCommandOptions = {
  startupLifecycle?: WorkerSessionStartupLifecycle
  loadAuthenticationDependencies?: typeof loadAuthenticationDependencies
  loadRuntimeDependencies?: typeof loadRuntimeDependencies
  loadUsageDependencies?: typeof loadUsageDependencies
}

function formatTokens(value: number | undefined | null): string {
  return typeof value === 'number' ? value.toLocaleString() : '0'
}

function printUsageDay(label: string, day: Awaited<ReturnType<typeof collectCodexUsageSnapshot>>['today']): void {
  if (!day) {
    console.log(`${label}: no local Codex token events found`)
    return
  }
  console.log(`${label}: ${formatTokens(day.totalTokens)} total tokens`)
  console.log(`  input: ${formatTokens(day.inputTokens)} (${formatTokens(day.cachedInputTokens)} cached)`)
  console.log(`  output: ${formatTokens(day.outputTokens)} (${formatTokens(day.reasoningOutputTokens)} reasoning)`)
  console.log(`  events: ${day.tokenCountEvents.toLocaleString()} across ${day.sessions.toLocaleString()} session(s)`)
}

export async function handleCodexCommand(args: string[]): Promise<void> {
  await runCodexWorkerCommand(args)
}

export async function runCodexWorkerCommand(args: string[], options: CodexWorkerCommandOptions = {}): Promise<void> {
  // The daemon preserves the full CLI arguments when choosing its internal entry.
  if (args[0] === 'codex') args = args.slice(1)
  const startupLifecycle = options.startupLifecycle ?? createWorkerSessionStartupLifecycleFromEnvironment()

  if (args[0] === 'usage') {
    const { collectCodexUsageSnapshot } = await (options.loadUsageDependencies ?? loadUsageDependencies)()
    const snapshot = await collectCodexUsageSnapshot()
    console.log(`Codex usage source: ${snapshot.sessionsDir}`)
    console.log(`Time zone: ${snapshot.timeZone}`)
    printUsageDay('Today', snapshot.today)
    printUsageDay('Yesterday', snapshot.yesterday)
    const primary = snapshot.latestEvent?.rateLimits?.primary
    const secondary = snapshot.latestEvent?.rateLimits?.secondary
    if (primary || secondary) {
      console.log(`Rate limits: 5h ${primary?.usedPercent ?? '?'}% / 7d ${secondary?.usedPercent ?? '?'}%`)
    }
    for (const warning of snapshot.warnings) {
      console.log(`Warning: ${warning}`)
    }
    return
  }

  let startedBy: 'daemon' | 'terminal' | undefined = undefined
  let permissionMode: PermissionMode | undefined = 'yolo'
  let model: string | undefined = undefined
  let effort: ReasoningEffort | undefined = undefined
  const sandboxArgs = extractNoSandboxFlag(args)
  const codexArgs = extractCodexResumeFlag(sandboxArgs.args)

  for (let i = 0; i < codexArgs.args.length; i++) {
    if (codexArgs.args[i] === '--started-by') {
      startedBy = codexArgs.args[++i] as 'daemon' | 'terminal'
    } else if (codexArgs.args[i] === '--permission-mode') {
      permissionMode = codexArgs.args[++i] as PermissionMode
    } else if (codexArgs.args[i] === '--model') {
      model = codexArgs.args[++i]
    } else if (codexArgs.args[i] === '--effort') {
      effort = codexArgs.args[++i] as ReasoningEffort
    } else if (codexArgs.args[i] === '--yolo') {
      permissionMode = 'yolo'
    }
  }

  const authenticationDependencies = (options.loadAuthenticationDependencies ?? loadAuthenticationDependencies)()
  const runtimeDependencies = (options.loadRuntimeDependencies ?? loadRuntimeDependencies)()
  const { authAndSetupMachineIfNeeded } = await authenticationDependencies
  const { credentials } = await traceWorkerAuthentication(authAndSetupMachineIfNeeded, startupLifecycle)
  const { promptInstallSlashCommandIfNeeded, ensureDaemonRunning, runCodex } = await runtimeDependencies

  if (!codexArgs.args.includes('--help') && !codexArgs.args.includes('-h')) {
    await promptInstallSlashCommandIfNeeded({ startedBy });
  }

  await ensureDaemonRunning({ startedBy })

  await runCodex({
    credentials,
    startedBy,
    noSandbox: sandboxArgs.noSandbox,
    resumeThreadId: codexArgs.resumeThreadId ?? undefined,
    permissionMode,
    model,
    effort,
    ...(startupLifecycle ? { startupLifecycle } : {}),
  })
}
