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
const DECIMAL_PATTERN = '(?:\\d+\\.?\\d*|\\.\\d+)'

interface Parsed<T> {
  value: T
  valid: boolean
}

function finiteNonNegative(value: string): number | undefined {
  if (!new RegExp(`^${DECIMAL_PATTERN}$`).test(value.trim())) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function finiteNonNegativeInteger(value: string): number | undefined {
  const parsed = finiteNonNegative(value)
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : undefined
}

function finiteProduct(...values: number[]): number | undefined {
  const result = values.reduce((product, value) => product * value, 1)
  return Number.isFinite(result) && result >= 0 ? result : undefined
}

function finiteSum(...values: number[]): number | undefined {
  const result = values.reduce((sum, value) => sum + value, 0)
  return Number.isFinite(result) && result >= 0 ? result : undefined
}

function bytes(value: string, unit: string): number | undefined {
  const amount = finiteNonNegative(value)
  const multiplier = ({ B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 } as const)[unit.toUpperCase() as 'B']
  if (amount === undefined || multiplier === undefined) return undefined
  return finiteProduct(amount, multiplier)
}

export function parseElapsedSeconds(value: string): number | undefined {
  const match = /^(?:(\d+)-(\d+):(\d+):(\d+)|(\d+):(\d+):(\d+)|(\d+):(\d+))$/.exec(value.trim())
  if (!match) return undefined
  const days = finiteNonNegativeInteger(match[1] ?? '0')
  const hours = finiteNonNegativeInteger(match[2] ?? match[5] ?? '0')
  const minutes = finiteNonNegativeInteger(match[3] ?? match[6] ?? match[8])
  const seconds = finiteNonNegativeInteger(match[4] ?? match[7] ?? match[9])
  if (days === undefined || hours === undefined || minutes === undefined || seconds === undefined) return undefined
  if (minutes > 59 || seconds > 59) return undefined
  return finiteSum(
    finiteProduct(days, 86_400) ?? Number.POSITIVE_INFINITY,
    finiteProduct(hours, 3_600) ?? Number.POSITIVE_INFINITY,
    finiteProduct(minutes, 60) ?? Number.POSITIVE_INFINITY,
    seconds,
  )
}

function parseSysctl(output: string): Parsed<Omit<MacSystemHealthValues, 'sampledAt'>> {
  const lines = output.trim().split(/\r?\n/)
  if (lines.length !== 4) return { value: {}, valid: false }
  const cpuCores = finiteNonNegativeInteger(lines[0] ?? '')
  const memoryTotalBytes = finiteNonNegativeInteger(lines[1] ?? '')
  const load = new RegExp(`^\\s*\\{\\s*(${DECIMAL_PATTERN})\\s+(${DECIMAL_PATTERN})\\s+(${DECIMAL_PATTERN})\\s*\\}\\s*$`)
    .exec(lines[2] ?? '')
  const load1 = load ? finiteNonNegative(load[1]) : undefined
  const load5 = load ? finiteNonNegative(load[2]) : undefined
  const load15 = load ? finiteNonNegative(load[3]) : undefined
  const swap = /total\s*=\s*([\d.]+)([KMGTP]?)(?:B)?\s+used\s*=\s*([\d.]+)([KMGTP]?)(?:B)?/i.exec(lines.slice(3).join(' '))
  const swapTotalBytes = swap ? bytes(swap[1], swap[2] || 'B') : undefined
  const swapUsedBytes = swap ? bytes(swap[3], swap[4] || 'B') : undefined
  const value = {
    cpuCores,
    memoryTotalBytes,
    load1,
    load5,
    load15,
    swapTotalBytes,
    swapUsedBytes,
  }
  return { value, valid: Object.values(value).every((item) => item !== undefined) }
}

function parseProcessLimit(output: string): Parsed<number | undefined> {
  const match = /^\s*maxproc\s+(\S+)/m.exec(output)
  if (!match) return { value: undefined, valid: false }
  if (match[1].toLowerCase() === 'unlimited') return { value: undefined, valid: true }
  const value = finiteNonNegativeInteger(match[1])
  return { value, valid: value !== undefined }
}

function parseCpu(output: string): Parsed<number | undefined> {
  const lines = output.match(/^CPU usage:.*$/gm)
  const second = lines?.[1]
  const idle = second ? /(?:^|\s)([\d.]+)%\s*idle/i.exec(second) : null
  const idlePercent = idle ? finiteNonNegative(idle[1]) : undefined
  const value = idlePercent === undefined || idlePercent > 100 ? undefined : 100 - idlePercent
  return { value, valid: value !== undefined }
}

function parseVmStat(output: string): Parsed<Pick<MacSystemHealthValues, 'memoryAvailableBytes' | 'memoryCompressedBytes'>> {
  const pageSizeMatch = /page size of\s+(\d+)\s+bytes/i.exec(output)
  const reportedPageSize = pageSizeMatch ? finiteNonNegativeInteger(pageSizeMatch[1]) : undefined
  const pageSize = reportedPageSize !== undefined && reportedPageSize > 0 ? reportedPageSize : undefined
  const page = (name: string) => {
    const match = new RegExp(`^${name}:\\s*(\\d+)\\.`, 'mi').exec(output)
    return match ? finiteNonNegativeInteger(match[1]) : undefined
  }
  const free = page('Pages free')
  const inactive = page('Pages inactive')
  const speculative = page('Pages speculative')
  const compressed = page('Pages occupied by compressor')
  const availablePages = free !== undefined && inactive !== undefined && speculative !== undefined
    ? finiteSum(free, inactive, speculative)
    : undefined
  const value = {
    memoryAvailableBytes: pageSize !== undefined && free !== undefined && inactive !== undefined && speculative !== undefined
      ? finiteProduct(availablePages ?? Number.POSITIVE_INFINITY, pageSize)
      : undefined,
    memoryCompressedBytes: pageSize !== undefined && compressed !== undefined
      ? finiteProduct(compressed, pageSize)
      : undefined,
  }
  return { value, valid: Object.values(value).every((item) => item !== undefined) }
}

function parseMemoryPressure(output: string): Parsed<number | undefined> {
  const match = /System-wide memory free percentage:\s*([\d.]+)%/i.exec(output)
  const value = match ? finiteNonNegative(match[1]) : undefined
  const percentage = value !== undefined && value <= 100 ? value : undefined
  return { value: percentage, valid: percentage !== undefined }
}

function parseProcessStats(output: string): Parsed<MacProcessStatRow[]> {
  const rows: MacProcessStatRow[] = []
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '')
  let valid = lines.length > 0
  for (const line of lines) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/.exec(line)
    if (!match) {
      valid = false
      continue
    }
    const pid = finiteNonNegativeInteger(match[1])
    const ppid = finiteNonNegativeInteger(match[2])
    const cpuPercent = finiteNonNegative(match[3])
    const rssKb = finiteNonNegativeInteger(match[4])
    const elapsedSeconds = parseElapsedSeconds(match[6])
    if (pid === undefined || ppid === undefined || cpuPercent === undefined || rssKb === undefined) {
      valid = false
      continue
    }
    if (elapsedSeconds === undefined) valid = false
    rows.push({ pid, ppid, cpuPercent, rssKb, state: match[5], elapsedSeconds })
  }
  return { value: rows, valid }
}

function parseProcessText(output: string): Parsed<MacProcessTextRow[]> {
  const rows: MacProcessTextRow[] = []
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '')
  let valid = lines.length > 0
  for (const line of lines) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    const pid = match ? finiteNonNegativeInteger(match[1]) : undefined
    if (match && pid !== undefined) {
      rows.push({ pid, value: match[2] })
    } else {
      valid = false
    }
  }
  return { value: rows, valid }
}

function parseDisk(output: string): Parsed<Pick<MacSystemHealthValues, 'diskTotalBytes' | 'diskFreeBytes'>> {
  const line = output.trim().split(/\r?\n/).at(-1)
  const columns = line?.trim().split(/\s+/) ?? []
  const totalKb = finiteNonNegativeInteger(columns[1] ?? '')
  const freeKb = finiteNonNegativeInteger(columns[3] ?? '')
  const value = {
    diskTotalBytes: totalKb === undefined ? undefined : finiteProduct(totalKb, 1_024),
    diskFreeBytes: freeKb === undefined ? undefined : finiteProduct(freeKb, 1_024),
  }
  return { value, valid: columns.length >= 6 && Object.values(value).every((item) => item !== undefined) }
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

    const outputs = await Promise.all([
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
    const parse = <T>(
      command: SystemHealthCommand,
      output: string | undefined,
      parser: (value: string) => Parsed<T>,
    ): Parsed<T | undefined> => {
      if (output === undefined) return { value: undefined, valid: false }
      try {
        const parsed = parser(output)
        if (!parsed.valid) errors.push({ command, code: 'parse' })
        return parsed
      } catch {
        errors.push({ command, code: 'parse' })
        return { value: undefined, valid: false }
      }
    }

    Object.assign(values, parse('sysctl', outputs[0], parseSysctl).value)
    Object.assign(values, { processLimit: parse('launchctl', outputs[1], parseProcessLimit).value })
    Object.assign(values, { cpuUsedPercent: parse('top', outputs[2], parseCpu).value })
    Object.assign(values, parse('vm_stat', outputs[3], parseVmStat).value)
    Object.assign(values, {
      memoryPressureFreePercent: parse('memory_pressure', outputs[4], parseMemoryPressure).value,
    })
    Object.assign(values, parse('df', outputs[8], parseDisk).value)

    let statsResult = parse('ps', outputs[5], parseProcessStats)
    let commandsResult = parse('ps', outputs[6], parseProcessText)
    let argumentsResult = parse('ps', outputs[7], parseProcessText)
    const statsComplete = statsResult.valid
    const classificationComplete = commandsResult.valid && argumentsResult.valid
    let stats = statsResult.value
    try {
      if (stats && stats.length > 0) {
        Object.assign(values, {
          processCount: stats.length,
          zombieProcessCount: stats.filter((process) => process.state.startsWith('Z')).length,
        })
        if (classificationComplete) {
          const analysis = analyzeMacProcessSnapshot({
            capturedAt: attemptedAt,
            stats,
            commands: commandsResult.value ?? [],
            arguments: argumentsResult.value ?? [],
            trackedRoots: input.trackedRoots,
            previousMembership: this.previousMembership,
          })
          if (statsComplete) this.previousMembership = analysis.nextMembership
          Object.assign(values, {
            pawsWorkerRoots: analysis.worker.rootCount,
            pawsWorkerProcesses: analysis.worker.processCount,
            pawsWorkerRssBytes: analysis.worker.rssBytes,
            orphanWorkerRoots: analysis.orphans.rootCount,
            orphanWorkerProcesses: analysis.orphans.processCount,
            orphanWorkerRssBytes: analysis.orphans.rssBytes,
            sources: analysis.sources,
          })
        }
      }
    } catch {
      errors.push({ command: 'ps', code: 'parse' })
    } finally {
      outputs[5] = undefined
      outputs[6] = undefined
      outputs[7] = undefined
      stats = undefined
      statsResult = { value: undefined, valid: false }
      commandsResult = { value: undefined, valid: false }
      argumentsResult = { value: undefined, valid: false }
    }

    const coreKeys = [
      'sampledAt', 'cpuUsedPercent', 'cpuCores', 'load1', 'load5', 'load15',
      'memoryTotalBytes', 'memoryAvailableBytes', 'memoryCompressedBytes',
      'swapUsedBytes', 'swapTotalBytes', 'processCount', 'zombieProcessCount',
      'pawsWorkerRoots', 'pawsWorkerProcesses', 'pawsWorkerRssBytes',
      'orphanWorkerRoots', 'orphanWorkerProcesses', 'orphanWorkerRssBytes', 'sources',
    ] as const
    const complete = statsComplete && classificationComplete && coreKeys.every((key) => values[key] !== undefined)
    const useful = Object.entries(values).some(([key, value]) => key !== 'sampledAt' && value !== undefined)
    const finishedAt = this.now()
    const elapsed = finishedAt - attemptedAt
    return {
      kind: complete ? 'complete' : useful ? 'partial' : 'failed',
      attemptedAt,
      durationMs: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0,
      values,
      commandErrors: errors,
    }
  }
}
