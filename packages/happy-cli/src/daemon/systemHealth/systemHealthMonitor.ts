import {
  SystemHealthCurrentSchema,
  SystemHealthSnapshotSchema,
  type SystemHealthCurrent,
  type SystemHealthIssue,
  type SystemHealthSnapshot,
  type SystemHealthSource,
} from '@/api/types'
import type { MacSystemHealthCollection } from './types'

const GiB = 1024 ** 3
const MAX_RAW_WINDOW_MS = 11 * 60_000

export const SYSTEM_HEALTH_THRESHOLDS = {
  orphanRoots: { warning: 1, critical: 5 },
  swapRatio: { warning: 0.25, critical: 0.5 },
  swapGrowthBytes: { warning: 1 * GiB, critical: 2 * GiB },
  cpuSustained: {
    warning: { value: 85, durationMs: 2 * 60_000 },
    critical: { value: 95, durationMs: 3 * 60_000 },
  },
  loadPerCore: { warning: 1.5, critical: 2 },
  memoryPressureFreePercent: { warningBelow: 10, criticalBelow: 5 },
  workerRssRatio: { warning: 0.2, critical: 0.35 },
  processCount: { warning: 700, critical: 900 },
  processCapacityRatio: { warning: 0.8, critical: 0.9 },
  zombieProcessCount: { warning: 1, critical: 25 },
  diskFreeBytes: { warningBelow: 15 * GiB, criticalBelow: 5 * GiB },
  sourceCpuSustained: {
    warning: { value: 100, durationMs: 5 * 60_000 },
    critical: { value: 200, durationMs: 5 * 60_000 },
  },
} as const

type DesiredLevel = 'clear' | 'warning' | 'critical'

interface RawSample {
  current: SystemHealthCurrent
  sources: SystemHealthSource[]
}

interface RuleObservation {
  code: SystemHealthIssue['code']
  subject?: string
  desired: DesiredLevel
  observed: number
  warningThreshold: number
  criticalThreshold: number
  unit: SystemHealthIssue['unit']
  sustained?: boolean
}

interface RuleState {
  severity?: 'warning' | 'critical'
  since: number
  warningHits: number
  criticalHits: number
  recoveryHits: number
  observed: number
  threshold: number
  unit: SystemHealthIssue['unit']
  code: SystemHealthIssue['code']
  subject?: string
}

function highObservation(
  code: SystemHealthIssue['code'],
  observed: number,
  thresholds: { warning: number; critical: number },
  unit: SystemHealthIssue['unit'],
  subject?: string,
): RuleObservation {
  return {
    code,
    subject,
    observed,
    warningThreshold: thresholds.warning,
    criticalThreshold: thresholds.critical,
    unit,
    desired: observed >= thresholds.critical ? 'critical' : observed >= thresholds.warning ? 'warning' : 'clear',
  }
}

function lowObservation(
  code: SystemHealthIssue['code'],
  observed: number,
  thresholds: { warningBelow: number; criticalBelow: number },
  unit: SystemHealthIssue['unit'],
): RuleObservation {
  return {
    code,
    observed,
    warningThreshold: thresholds.warningBelow,
    criticalThreshold: thresholds.criticalBelow,
    unit,
    desired: observed < thresholds.criticalBelow ? 'critical' : observed < thresholds.warningBelow ? 'warning' : 'clear',
  }
}

function hasSustainedValue(samples: RawSample[], now: number, durationMs: number, selector: (sample: RawSample) => number, threshold: number): boolean {
  const window = samples.filter((sample) => sample.current.sampledAt >= now - durationMs)
  if (window.length === 0 || now - window[0].current.sampledAt < durationMs) return false
  const expected = Math.floor(durationMs / 15_000) + 1
  if (window.length < Math.ceil(expected * 0.8)) return false
  return window.filter((sample) => selector(sample) >= threshold).length >= Math.ceil(window.length * 0.8)
}

export class SystemHealthMonitor {
  private snapshot: SystemHealthSnapshot = {
    schemaVersion: 1,
    platform: 'darwin',
    updatedAt: null,
    lastAttemptAt: null,
    resourceStatus: 'healthy',
    issues: [],
    current: null,
    history: [],
    collector: {
      intervalSeconds: 15,
      historyStepSeconds: 60,
      durationMs: 0,
      lastSampleKind: 'pending',
      errors: [],
    },
  }
  private readonly rawSamples: RawSample[] = []
  private readonly ruleStates = new Map<string, RuleState>()

  record(collection: MacSystemHealthCollection): SystemHealthSnapshot {
    this.snapshot = {
      ...this.snapshot,
      lastAttemptAt: collection.attemptedAt,
      collector: {
        intervalSeconds: 15,
        historyStepSeconds: 60,
        durationMs: collection.durationMs,
        lastSampleKind: collection.kind,
        errors: collection.commandErrors,
      },
    }
    if (collection.kind !== 'complete') return SystemHealthSnapshotSchema.parse(this.snapshot)

    const values = collection.values
    const sources = values.sources ?? []
    const current = SystemHealthCurrentSchema.parse({
      sampledAt: values.sampledAt,
      cpuUsedPercent: values.cpuUsedPercent,
      cpuCores: values.cpuCores,
      load1: values.load1,
      load5: values.load5,
      load15: values.load15,
      memoryTotalBytes: values.memoryTotalBytes,
      memoryAvailableBytes: values.memoryAvailableBytes,
      memoryCompressedBytes: values.memoryCompressedBytes,
      memoryPressureFreePercent: values.memoryPressureFreePercent,
      swapUsedBytes: values.swapUsedBytes,
      swapTotalBytes: values.swapTotalBytes,
      diskFreeBytes: values.diskFreeBytes,
      diskTotalBytes: values.diskTotalBytes,
      processCount: values.processCount,
      processLimit: values.processLimit,
      zombieProcessCount: values.zombieProcessCount,
      pawsWorkerRoots: values.pawsWorkerRoots,
      pawsWorkerProcesses: values.pawsWorkerProcesses,
      pawsWorkerRssBytes: values.pawsWorkerRssBytes,
      orphanWorkerRoots: values.orphanWorkerRoots,
      orphanWorkerProcesses: values.orphanWorkerProcesses,
      orphanWorkerRssBytes: values.orphanWorkerRssBytes,
      topCpuSources: [...sources].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 5),
      topMemorySources: [...sources].sort((a, b) => b.rssBytes - a.rssBytes).slice(0, 5),
      topZombieSources: [...sources].filter((source) => source.zombieProcessCount > 0)
        .sort((a, b) => b.zombieProcessCount - a.zombieProcessCount).slice(0, 5),
    })
    this.rawSamples.push({ current, sources })
    while (this.rawSamples[0] && this.rawSamples[0].current.sampledAt < current.sampledAt - MAX_RAW_WINDOW_MS) this.rawSamples.shift()

    const point = {
      sampledAt: current.sampledAt,
      cpuUsedPercent: current.cpuUsedPercent,
      load1: current.load1,
      memoryAvailableBytes: current.memoryAvailableBytes,
      swapUsedBytes: current.swapUsedBytes,
      processCount: current.processCount,
      zombieProcessCount: current.zombieProcessCount,
      orphanWorkerRoots: current.orphanWorkerRoots,
      pawsWorkerRssBytes: current.pawsWorkerRssBytes,
    }
    const minute = Math.floor(current.sampledAt / 60_000)
    const history = [...this.snapshot.history]
    const bucketIndex = history.findIndex((item) => Math.floor(item.sampledAt / 60_000) === minute)
    if (bucketIndex === -1) {
      history.push(point)
    } else if (history[bucketIndex]!.sampledAt <= point.sampledAt) {
      history[bucketIndex] = point
    }
    history.sort((a, b) => a.sampledAt - b.sampledAt)

    const observations = this.buildObservations(current, sources)
    const evaluatedKeys = new Set(observations.map((observation) => this.ruleKey(observation.code, observation.subject)))
    for (const [key, state] of this.ruleStates) {
      if (state.code === 'single-source-cpu-high' && !evaluatedKeys.has(key)) {
        observations.push({
          code: state.code,
          subject: state.subject,
          desired: 'clear',
          observed: 0,
          warningThreshold: SYSTEM_HEALTH_THRESHOLDS.sourceCpuSustained.warning.value,
          criticalThreshold: SYSTEM_HEALTH_THRESHOLDS.sourceCpuSustained.critical.value,
          unit: 'percent',
        })
      }
    }
    for (const observation of observations) this.applyObservation(observation, current.sampledAt)

    const issues = [...this.ruleStates.values()]
      .filter((state): state is RuleState & { severity: 'warning' | 'critical' } => state.severity !== undefined)
      .map((state) => ({
        code: state.code,
        severity: state.severity,
        subject: state.subject,
        observed: state.observed,
        threshold: state.threshold,
        unit: state.unit,
        since: state.since,
      }))
      .sort((a, b) => (a.severity === b.severity ? a.since - b.since : a.severity === 'critical' ? -1 : 1))
      .slice(0, 16)

    this.snapshot = {
      ...this.snapshot,
      updatedAt: current.sampledAt,
      resourceStatus: issues.some((issue) => issue.severity === 'critical') ? 'critical' : issues.length > 0 ? 'warning' : 'healthy',
      issues,
      current,
      history: history.slice(-30),
    }
    return SystemHealthSnapshotSchema.parse(this.snapshot)
  }

  getSnapshot(): SystemHealthSnapshot {
    return SystemHealthSnapshotSchema.parse(this.snapshot)
  }

  private buildObservations(current: SystemHealthCurrent, sources: SystemHealthSource[]): RuleObservation[] {
    const observations: RuleObservation[] = [
      highObservation('orphan-workers', current.orphanWorkerRoots, SYSTEM_HEALTH_THRESHOLDS.orphanRoots, 'count'),
      highObservation('process-count-high', current.processCount, SYSTEM_HEALTH_THRESHOLDS.processCount, 'count'),
      highObservation('zombie-processes', current.zombieProcessCount, SYSTEM_HEALTH_THRESHOLDS.zombieProcessCount, 'count'),
    ]
    if (current.memoryTotalBytes > 0) {
      observations.push(
        highObservation('swap-high', current.swapUsedBytes / current.memoryTotalBytes, SYSTEM_HEALTH_THRESHOLDS.swapRatio, 'ratio'),
        highObservation('worker-memory-high', current.pawsWorkerRssBytes / current.memoryTotalBytes, SYSTEM_HEALTH_THRESHOLDS.workerRssRatio, 'ratio'),
      )
    }
    if (current.cpuCores > 0) {
      observations.push(highObservation('load-high', current.load1 / current.cpuCores, SYSTEM_HEALTH_THRESHOLDS.loadPerCore, 'ratio'))
    }
    if (current.processLimit !== undefined && current.processLimit > 0) {
      observations.push(highObservation('process-capacity-high', current.processCount / current.processLimit, SYSTEM_HEALTH_THRESHOLDS.processCapacityRatio, 'ratio'))
    }
    if (current.memoryPressureFreePercent !== undefined) {
      observations.push(lowObservation('memory-pressure-high', current.memoryPressureFreePercent, SYSTEM_HEALTH_THRESHOLDS.memoryPressureFreePercent, 'percent'))
    }
    if (current.diskFreeBytes !== undefined) {
      observations.push(lowObservation('disk-low', current.diskFreeBytes, SYSTEM_HEALTH_THRESHOLDS.diskFreeBytes, 'bytes'))
    }

    const swapBaseline = this.rawSamples
      .filter((sample) => sample.current.sampledAt >= current.sampledAt - 10.5 * 60_000 && sample.current.sampledAt <= current.sampledAt - 9.5 * 60_000)
      .sort((a, b) => a.current.sampledAt - b.current.sampledAt)[0]
    if (swapBaseline) {
      observations.push(highObservation('swap-growing', current.swapUsedBytes - swapBaseline.current.swapUsedBytes, SYSTEM_HEALTH_THRESHOLDS.swapGrowthBytes, 'bytes'))
    }

    const cpuCritical = hasSustainedValue(this.rawSamples, current.sampledAt, SYSTEM_HEALTH_THRESHOLDS.cpuSustained.critical.durationMs, (sample) => sample.current.cpuUsedPercent, SYSTEM_HEALTH_THRESHOLDS.cpuSustained.critical.value)
    const cpuWarning = hasSustainedValue(this.rawSamples, current.sampledAt, SYSTEM_HEALTH_THRESHOLDS.cpuSustained.warning.durationMs, (sample) => sample.current.cpuUsedPercent, SYSTEM_HEALTH_THRESHOLDS.cpuSustained.warning.value)
    observations.push({
      code: 'cpu-sustained',
      desired: cpuCritical ? 'critical' : cpuWarning ? 'warning' : current.cpuUsedPercent < SYSTEM_HEALTH_THRESHOLDS.cpuSustained.warning.value ? 'clear' : 'clear',
      observed: current.cpuUsedPercent,
      warningThreshold: SYSTEM_HEALTH_THRESHOLDS.cpuSustained.warning.value,
      criticalThreshold: SYSTEM_HEALTH_THRESHOLDS.cpuSustained.critical.value,
      unit: 'percent',
      sustained: true,
    })

    for (const source of sources) {
      const critical = hasSustainedValue(this.rawSamples, current.sampledAt, SYSTEM_HEALTH_THRESHOLDS.sourceCpuSustained.critical.durationMs, (sample) => sample.sources.find((item) => item.id === source.id)?.cpuPercent ?? 0, SYSTEM_HEALTH_THRESHOLDS.sourceCpuSustained.critical.value)
      const warning = hasSustainedValue(this.rawSamples, current.sampledAt, SYSTEM_HEALTH_THRESHOLDS.sourceCpuSustained.warning.durationMs, (sample) => sample.sources.find((item) => item.id === source.id)?.cpuPercent ?? 0, SYSTEM_HEALTH_THRESHOLDS.sourceCpuSustained.warning.value)
      observations.push({
        code: 'single-source-cpu-high',
        subject: source.id,
        desired: critical ? 'critical' : warning ? 'warning' : 'clear',
        observed: source.cpuPercent,
        warningThreshold: SYSTEM_HEALTH_THRESHOLDS.sourceCpuSustained.warning.value,
        criticalThreshold: SYSTEM_HEALTH_THRESHOLDS.sourceCpuSustained.critical.value,
        unit: 'percent',
        sustained: true,
      })
    }
    return observations
  }

  private ruleKey(code: SystemHealthIssue['code'], subject?: string): string {
    return `${code}:${subject ?? 'global'}`
  }

  private applyObservation(observation: RuleObservation, sampledAt: number): void {
    const key = this.ruleKey(observation.code, observation.subject)
    const state = this.ruleStates.get(key) ?? {
      since: sampledAt,
      warningHits: 0,
      criticalHits: 0,
      recoveryHits: 0,
      observed: observation.observed,
      threshold: observation.warningThreshold,
      unit: observation.unit,
      code: observation.code,
      subject: observation.subject,
    }
    state.observed = observation.observed
    state.unit = observation.unit

    if (observation.desired === 'critical') {
      state.warningHits = 0
      state.recoveryHits = 0
      state.criticalHits += 1
      if (observation.sustained || state.criticalHits >= 2) {
        if (state.severity !== 'critical') state.since = sampledAt
        state.severity = 'critical'
        state.threshold = observation.criticalThreshold
      }
    } else if (observation.desired === 'warning') {
      state.criticalHits = 0
      if (state.severity === 'critical') {
        state.recoveryHits += 1
        if (state.recoveryHits >= 3) {
          state.severity = 'warning'
          state.since = sampledAt
          state.threshold = observation.warningThreshold
          state.recoveryHits = 0
        }
      } else {
        state.recoveryHits = 0
        state.warningHits += 1
        if (observation.sustained || state.warningHits >= 2) {
          if (state.severity !== 'warning') state.since = sampledAt
          state.severity = 'warning'
          state.threshold = observation.warningThreshold
        }
      }
    } else {
      state.warningHits = 0
      state.criticalHits = 0
      if (state.severity) {
        state.recoveryHits += 1
        if (state.recoveryHits >= 3) this.ruleStates.delete(key)
      } else {
        this.ruleStates.delete(key)
      }
    }
    if (this.ruleStates.get(key) !== undefined || observation.desired !== 'clear') this.ruleStates.set(key, state)
  }
}
