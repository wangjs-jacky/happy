import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { analyzeMacProcessSnapshot } from './macProcessSnapshotAnalyzer'
import type {
  MacProcessStatRow,
  MacProcessTextRow,
  MacSystemHealthCollection,
  MacSystemHealthValues,
  SystemHealthCommand,
  SystemHealthCommandError,
  TrackedProcessRoot,
  WorkerMembership,
} from './types'

export interface ExecFileResult {
  stdout: string
  stderr: string
}

export type ExecFileAdapter = (
  file: string,
  args: string[],
  options: {
    timeout: number
    killSignal: 'SIGKILL'
    maxBuffer: number
    env: NodeJS.ProcessEnv
  },
) => Promise<ExecFileResult>

const defaultExecFile = promisify(nodeExecFile) as ExecFileAdapter
const EXEC_OPTIONS = {
  timeout: 5_000,
  killSignal: 'SIGKILL' as const,
  maxBuffer: 4 * 1024 * 1024,
}

function finiteNonNegative(value: string): number | undefined {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function bytes(value: string, unit: string): number | undefined {
  const amount = finiteNonNegative(value)
  const multiplier = ({ B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 } as const)[unit.toUpperCase() as 'B']
  if (amount === undefined || multiplier === undefined) return undefined
  const result = amount * multiplier
  return Number.isFinite(result) ? result : undefined
}

export function parseElapsedSeconds(value: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value.trim())
  if (!match) return undefined
  const days = Number(match[1] ?? 0)
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3])
  const seconds = Number(match[4])
  if (![days, hours, minutes, seconds].every(Number.isFinite) || minutes > 59 || seconds > 59) return undefined
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds
}

function parseSysctl(output: string) {
  const lines = output.trim().split(/\r?\n/)
  const cpuCores = finiteNonNegative(lines[0] ?? '')
  const memoryTotalBytes = finiteNonNegative(lines[1] ?? '')
  const loads = [...(lines[2] ?? '').matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
  const swap = /total\s*=\s*([\d.]+)([KMGTP]?)(?:B)?\s+used\s*=\s*([\d.]+)([KMGTP]?)(?:B)?/i.exec(lines.slice(3).join(' '))
  return {
    cpuCores,
    memoryTotalBytes,
    load1: loads[0],
    load5: loads[1],
    load15: loads[2],
    swapTotalBytes: swap ? bytes(swap[1], swap[2] || 'B') : undefined,
    swapUsedBytes: swap ? bytes(swap[3], swap[4] || 'B') : undefined,
  }
}

function parseProcessLimit(output: string): number | undefined {
  const match = /^\s*maxproc\s+(\S+)/m.exec(output)
  return match ? finiteNonNegative(match[1]) : undefined
}

function parseCpu(output: string): number | undefined {
  const lines = output.match(/^CPU usage:.*$/gm)
  const last = lines?.at(-1)
  const idle = last ? /(?:^|\s)([\d.]+)%\s*idle/i.exec(last) : null
  const idlePercent = idle ? finiteNonNegative(idle[1]) : undefined
  return idlePercent === undefined || idlePercent > 100 ? undefined : 100 - idlePercent
}

function parseVmStat(output: string) {
  const pageSizeMatch = /page size of\s+(\d+)\s+bytes/i.exec(output)
  const pageSize = pageSizeMatch ? finiteNonNegative(pageSizeMatch[1]) : undefined
  const page = (name: string) => {
    const match = new RegExp(`^${name}:\\s*(\\d+)\\.`, 'mi').exec(output)
    return match ? finiteNonNegative(match[1]) : undefined
  }
  const free = page('Pages free')
  const inactive = page('Pages inactive')
  const speculative = page('Pages speculative')
  const compressed = page('Pages occupied by compressor')
  return {
    memoryAvailableBytes: pageSize !== undefined && free !== undefined && inactive !== undefined && speculative !== undefined
      ? (free + inactive + speculative) * pageSize
      : undefined,
    memoryCompressedBytes: pageSize !== undefined && compressed !== undefined ? compressed * pageSize : undefined,
  }
}

function parseMemoryPressure(output: string): number | undefined {
  const match = /System-wide memory free percentage:\s*([\d.]+)%/i.exec(output)
  const value = match ? finiteNonNegative(match[1]) : undefined
  return value !== undefined && value <= 100 ? value : undefined
}

function parseProcessStats(output: string): MacProcessStatRow[] {
  const rows: MacProcessStatRow[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/.exec(line)
    if (!match) continue
    const pid = finiteNonNegative(match[1])
    const ppid = finiteNonNegative(match[2])
    const cpuPercent = finiteNonNegative(match[3])
    const rssKb = finiteNonNegative(match[4])
    if (pid === undefined || ppid === undefined || cpuPercent === undefined || rssKb === undefined) continue
    rows.push({ pid, ppid, cpuPercent, rssKb, state: match[5], elapsedSeconds: parseElapsedSeconds(match[6]) })
  }
  return rows
}

function parseProcessText(output: string): MacProcessTextRow[] {
  const rows: MacProcessTextRow[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    const pid = match ? finiteNonNegative(match[1]) : undefined
    if (match && pid !== undefined) rows.push({ pid, value: match[2] })
  }
  return rows
}

function parseDisk(output: string) {
  const line = output.trim().split(/\r?\n/).at(-1)
  const columns = line?.trim().split(/\s+/) ?? []
  const totalKb = finiteNonNegative(columns[1] ?? '')
  const freeKb = finiteNonNegative(columns[3] ?? '')
  return {
    diskTotalBytes: totalKb === undefined ? undefined : totalKb * 1024,
    diskFreeBytes: freeKb === undefined ? undefined : freeKb * 1024,
  }
}

function errorCode(error: unknown): 'timeout' | 'exit' {
  const value = error as { killed?: boolean; code?: string }
  return value?.killed || value?.code === 'ETIMEDOUT' ? 'timeout' : 'exit'
}

export class MacSystemHealthCollector {
  private previousMembership: WorkerMembership[] = []

  constructor(
    private readonly execFile: ExecFileAdapter = defaultExecFile,
    private readonly now: () => number = Date.now,
  ) {}

  async collect(input: { trackedRoots: TrackedProcessRoot[] }): Promise<MacSystemHealthCollection> {
    const attemptedAt = this.now()
    const errors: SystemHealthCommandError[] = []
    const run = async (command: SystemHealthCommand, file: string, args: string[]) => {
      try {
        const result = await this.execFile(file, args, {
          ...EXEC_OPTIONS,
          env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
        })
        return result.stdout
      } catch (error) {
        errors.push({ command, code: errorCode(error) })
        return undefined
      }
    }

    const [sysctl, launchctl, top, vmStat, memoryPressure, psStats, psComm, psArgs, df] = await Promise.all([
      run('sysctl', '/usr/sbin/sysctl', ['-n', 'hw.ncpu', 'hw.memsize', 'vm.loadavg', 'vm.swapusage']),
      run('launchctl', '/bin/launchctl', ['limit', 'maxproc']),
      run('top', '/usr/bin/top', ['-l', '2', '-s', '0', '-n', '0']),
      run('vm_stat', '/usr/bin/vm_stat', []),
      run('memory_pressure', '/usr/bin/memory_pressure', ['-Q']),
      run('ps', '/bin/ps', ['-A', '-ww', '-o', 'pid=', '-o', 'ppid=', '-o', 'pcpu=', '-o', 'rss=', '-o', 'state=', '-o', 'etime=']),
      run('ps', '/bin/ps', ['-A', '-ww', '-o', 'pid=', '-o', 'comm=']),
      run('ps', '/bin/ps', ['-A', '-ww', '-o', 'pid=', '-o', 'args=']),
      run('df', '/bin/df', ['-kP', '/']),
    ])

    const values: MacSystemHealthValues = { sampledAt: attemptedAt }
    const parse = <T>(command: SystemHealthCommand, output: string | undefined, parser: (value: string) => T): T | undefined => {
      if (output === undefined) return undefined
      try {
        return parser(output)
      } catch {
        errors.push({ command, code: 'parse' })
        return undefined
      }
    }

    Object.assign(values, parse('sysctl', sysctl, parseSysctl))
    Object.assign(values, { processLimit: parse('launchctl', launchctl, parseProcessLimit) })
    Object.assign(values, { cpuUsedPercent: parse('top', top, parseCpu) })
    Object.assign(values, parse('vm_stat', vmStat, parseVmStat))
    Object.assign(values, { memoryPressureFreePercent: parse('memory_pressure', memoryPressure, parseMemoryPressure) })
    Object.assign(values, parse('df', df, parseDisk))

    const stats = parse('ps', psStats, parseProcessStats)
    const commands = parse('ps', psComm, parseProcessText)
    const argumentsRows = parse('ps', psArgs, parseProcessText)
    if (stats && commands && argumentsRows) {
      const analysis = analyzeMacProcessSnapshot({
        capturedAt: attemptedAt,
        stats,
        commands,
        arguments: argumentsRows,
        trackedRoots: input.trackedRoots,
        previousMembership: this.previousMembership,
      })
      this.previousMembership = analysis.nextMembership
      Object.assign(values, {
        processCount: stats.length,
        zombieProcessCount: analysis.zombieProcessCount,
        pawsWorkerRoots: analysis.worker.rootCount,
        pawsWorkerProcesses: analysis.worker.processCount,
        pawsWorkerRssBytes: analysis.worker.rssBytes,
        orphanWorkerRoots: analysis.orphans.rootCount,
        orphanWorkerProcesses: analysis.orphans.processCount,
        orphanWorkerRssBytes: analysis.orphans.rssBytes,
        sources: analysis.sources,
      })
    }

    const coreKeys = [
      'sampledAt', 'cpuUsedPercent', 'cpuCores', 'load1', 'load5', 'load15',
      'memoryTotalBytes', 'memoryAvailableBytes', 'memoryCompressedBytes',
      'swapUsedBytes', 'swapTotalBytes', 'processCount', 'zombieProcessCount',
      'pawsWorkerRoots', 'pawsWorkerProcesses', 'pawsWorkerRssBytes',
      'orphanWorkerRoots', 'orphanWorkerProcesses', 'orphanWorkerRssBytes', 'sources',
    ] as const
    const complete = coreKeys.every((key) => values[key] !== undefined)
    const useful = Object.entries(values).some(([key, value]) => key !== 'sampledAt' && value !== undefined)
    return {
      kind: complete ? 'complete' : useful ? 'partial' : 'failed',
      attemptedAt,
      durationMs: Math.max(0, this.now() - attemptedAt),
      values,
      commandErrors: errors,
    }
  }
}
