import type { SystemHealthSource } from '@/api/types'

export type SystemHealthCommand = 'sysctl' | 'launchctl' | 'top' | 'vm_stat' | 'memory_pressure' | 'ps' | 'df'
export type SystemHealthCommandErrorCode = 'timeout' | 'exit' | 'parse'

export interface SystemHealthCommandError {
  command: SystemHealthCommand
  code: SystemHealthCommandErrorCode
}

export interface MacProcessStatRow {
  pid: number
  ppid: number
  cpuPercent: number
  rssKb: number
  state: string
  elapsedSeconds?: number
}

export interface MacProcessTextRow {
  pid: number
  value: string
}

export interface TrackedProcessRoot {
  pid: number
  spawnedAt: number
  kind: 'daemon' | 'tmux'
}

export interface WorkerMembership {
  rootFingerprint: string
  memberFingerprints: string[]
}

export interface ProcessAggregate {
  rootCount: number
  processCount: number
  rssBytes: number
}

export interface MacProcessAnalysisInput {
  capturedAt: number
  stats: MacProcessStatRow[]
  commands: MacProcessTextRow[]
  arguments: MacProcessTextRow[]
  trackedRoots: TrackedProcessRoot[]
  previousMembership: WorkerMembership[]
}

export interface MacProcessAnalysisResult {
  worker: ProcessAggregate
  orphans: ProcessAggregate
  zombieProcessCount: number
  sources: SystemHealthSource[]
  nextMembership: WorkerMembership[]
}

export interface MacSystemHealthValues {
  sampledAt?: number
  cpuUsedPercent?: number
  cpuCores?: number
  load1?: number
  load5?: number
  load15?: number
  memoryTotalBytes?: number
  memoryAvailableBytes?: number
  memoryCompressedBytes?: number
  memoryPressureFreePercent?: number
  swapUsedBytes?: number
  swapTotalBytes?: number
  diskFreeBytes?: number
  diskTotalBytes?: number
  processCount?: number
  processLimit?: number
  zombieProcessCount?: number
  pawsWorkerRoots?: number
  pawsWorkerProcesses?: number
  pawsWorkerRssBytes?: number
  orphanWorkerRoots?: number
  orphanWorkerProcesses?: number
  orphanWorkerRssBytes?: number
  sources?: SystemHealthSource[]
}

export interface MacSystemHealthCollection {
  kind: 'complete' | 'partial' | 'failed'
  attemptedAt: number
  durationMs: number
  values: MacSystemHealthValues
  commandErrors: SystemHealthCommandError[]
}
