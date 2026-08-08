import { describe, expect, it } from 'vitest'
import type { SystemHealthIssue, SystemHealthSnapshot, SystemHealthSource } from '@/api/types'
import { SystemHealthMonitor } from './systemHealthMonitor'
import type { MacSystemHealthCollection, MacSystemHealthValues } from './types'

const GiB = 1024 ** 3
const INTERVAL_MS = 15_000

function source(id: string, cpuPercent: number, rssBytes = 100, zombieProcessCount = 0): SystemHealthSource {
  return { id, name: id, cpuPercent, rssBytes, processCount: 1, zombieProcessCount }
}

function complete(sampledAt: number, overrides: Partial<MacSystemHealthValues> = {}): MacSystemHealthCollection {
  return {
    kind: 'complete',
    attemptedAt: sampledAt,
    durationMs: 10,
    commandErrors: [],
    values: {
      sampledAt,
      cpuUsedPercent: 20,
      cpuCores: 10,
      load1: 1,
      load5: 1,
      load15: 1,
      memoryTotalBytes: 16 * GiB,
      memoryAvailableBytes: 8 * GiB,
      memoryCompressedBytes: 1 * GiB,
      swapUsedBytes: 1 * GiB,
      swapTotalBytes: 8 * GiB,
      processCount: 300,
      processLimit: 4_000,
      zombieProcessCount: 0,
      pawsWorkerRoots: 1,
      pawsWorkerProcesses: 2,
      pawsWorkerRssBytes: 1 * GiB,
      orphanWorkerRoots: 0,
      orphanWorkerProcesses: 0,
      orphanWorkerRssBytes: 0,
      sources: [source('sample', 10)],
      ...overrides,
    },
  }
}

function issue(snapshot: SystemHealthSnapshot, code: SystemHealthIssue['code'], subject?: string): SystemHealthIssue | undefined {
  return snapshot.issues.find((item) => item.code === code && item.subject === subject)
}

function recordTwice(monitor: SystemHealthMonitor, overrides: Partial<MacSystemHealthValues>): SystemHealthSnapshot {
  monitor.record(complete(0, overrides))
  return monitor.record(complete(INTERVAL_MS, overrides))
}

describe('SystemHealthMonitor', () => {
  it('enters an instant warning after two complete samples and recovers after three', () => {
    const monitor = new SystemHealthMonitor()
    expect(monitor.record(complete(0, { orphanWorkerRoots: 1 })).resourceStatus).toBe('healthy')
    expect(monitor.record(complete(INTERVAL_MS, { orphanWorkerRoots: 1 })).resourceStatus).toBe('warning')
    monitor.record(complete(2 * INTERVAL_MS, { orphanWorkerRoots: 0 }))
    monitor.record(complete(3 * INTERVAL_MS, { orphanWorkerRoots: 0 }))
    expect(monitor.record(complete(4 * INTERVAL_MS, { orphanWorkerRoots: 0 })).resourceStatus).toBe('healthy')
  })

  it('supports clear to critical, warning to critical, and critical to warning transitions', () => {
    const direct = new SystemHealthMonitor()
    direct.record(complete(0, { orphanWorkerRoots: 5 }))
    expect(issue(direct.record(complete(INTERVAL_MS, { orphanWorkerRoots: 5 })), 'orphan-workers')?.severity).toBe('critical')

    const escalation = new SystemHealthMonitor()
    escalation.record(complete(0, { orphanWorkerRoots: 1 }))
    escalation.record(complete(INTERVAL_MS, { orphanWorkerRoots: 1 }))
    expect(issue(escalation.record(complete(2 * INTERVAL_MS, { orphanWorkerRoots: 5 })), 'orphan-workers')?.severity).toBe('warning')
    expect(issue(escalation.record(complete(3 * INTERVAL_MS, { orphanWorkerRoots: 5 })), 'orphan-workers')?.severity).toBe('critical')

    expect(issue(escalation.record(complete(4 * INTERVAL_MS, { orphanWorkerRoots: 1 })), 'orphan-workers')?.severity).toBe('critical')
    expect(issue(escalation.record(complete(5 * INTERVAL_MS, { orphanWorkerRoots: 1 })), 'orphan-workers')?.severity).toBe('critical')
    expect(issue(escalation.record(complete(6 * INTERVAL_MS, { orphanWorkerRoots: 1 })), 'orphan-workers')?.severity).toBe('warning')
  })

  it('does not advance state or replace complete data on partial and failed attempts', () => {
    const monitor = new SystemHealthMonitor()
    const first = monitor.record(complete(0, { orphanWorkerRoots: 1 }))
    const partial = monitor.record({
      kind: 'partial',
      attemptedAt: INTERVAL_MS,
      durationMs: 5_000,
      values: { sampledAt: INTERVAL_MS, orphanWorkerRoots: 100 },
      commandErrors: [{ command: 'ps', code: 'timeout' }],
    })
    expect(partial).toMatchObject({
      updatedAt: first.updatedAt,
      lastAttemptAt: INTERVAL_MS,
      resourceStatus: first.resourceStatus,
      issues: first.issues,
      current: first.current,
      history: first.history,
      collector: { durationMs: 5_000, lastSampleKind: 'partial', errors: [{ command: 'ps', code: 'timeout' }] },
    })

    const failed = monitor.record({
      kind: 'failed',
      attemptedAt: 2 * INTERVAL_MS,
      durationMs: 5_001,
      values: { sampledAt: 2 * INTERVAL_MS },
      commandErrors: [{ command: 'top', code: 'exit' }],
    })
    expect(failed.current).toEqual(first.current)
    expect(failed.history).toEqual(first.history)
    expect(failed.collector.lastSampleKind).toBe('failed')
    expect(monitor.record(complete(3 * INTERVAL_MS, { orphanWorkerRoots: 1 })).resourceStatus).toBe('warning')
  })

  it.each([
    ['memory-pressure-high', { memoryPressureFreePercent: 9 }, { memoryPressureFreePercent: undefined }],
    ['process-capacity-high', { processCount: 800, processLimit: 1_000 }, { processLimit: undefined }],
    ['disk-low', { diskFreeBytes: 14 * GiB }, { diskFreeBytes: undefined }],
  ] as const)('does not recover %s while its optional field is missing', (code, active, missing) => {
    const monitor = new SystemHealthMonitor()
    recordTwice(monitor, active)
    for (let index = 2; index < 7; index += 1) {
      expect(issue(monitor.record(complete(index * INTERVAL_MS, missing)), code)?.severity).toBe('warning')
    }
  })

  it('keeps the newest complete point per natural minute in ascending order and caps history at 30', () => {
    const monitor = new SystemHealthMonitor()
    monitor.record(complete(50_000, { processCount: 301 }))
    monitor.record(complete(10_000, { processCount: 302 }))
    for (let minute = 1; minute <= 35; minute += 1) monitor.record(complete(minute * 60_000))
    const snapshot = monitor.getSnapshot()
    expect(snapshot.history).toHaveLength(30)
    expect(snapshot.history.at(-1)?.sampledAt).toBe(35 * 60_000)
    expect(snapshot.history.every((point, index, all) => index === 0 || point.sampledAt > all[index - 1].sampledAt)).toBe(true)

    const sameMinute = new SystemHealthMonitor()
    sameMinute.record(complete(50_000, { processCount: 301 }))
    expect(sameMinute.record(complete(10_000, { processCount: 302 })).history).toEqual([
      expect.objectContaining({ sampledAt: 50_000, processCount: 301 }),
    ])
  })

  it('retains only complete raw samples from the latest 11 minutes', () => {
    const monitor = new SystemHealthMonitor()
    for (let index = 0; index <= 46; index += 1) {
      monitor.record(complete(index * INTERVAL_MS))
      if (index === 20) {
        monitor.record({
          kind: 'partial',
          attemptedAt: index * INTERVAL_MS + 1,
          durationMs: 1,
          values: { sampledAt: index * INTERVAL_MS + 1 },
          commandErrors: [{ command: 'top', code: 'timeout' }],
        })
      }
    }
    const rawSamples = (monitor as unknown as { rawSamples: Array<{ current: { sampledAt: number } }> }).rawSamples
    expect(rawSamples).toHaveLength(45)
    expect(rawSamples[0]?.current.sampledAt).toBe(2 * INTERVAL_MS)
    expect(rawSamples.at(-1)?.current.sampledAt).toBe(46 * INTERVAL_MS)
  })

  describe('instant rule boundaries', () => {
    it.each([
      ['orphan-workers', { orphanWorkerRoots: 1 }, { orphanWorkerRoots: 5 }, 1, 5, 'count'],
      ['swap-high', { swapUsedBytes: 4 * GiB }, { swapUsedBytes: 8 * GiB }, 0.25, 0.5, 'ratio'],
      ['load-high', { load1: 15 }, { load1: 20 }, 1.5, 2, 'ratio'],
      ['worker-memory-high', { pawsWorkerRssBytes: 3.2 * GiB }, { pawsWorkerRssBytes: 5.6 * GiB }, 0.2, 0.35, 'ratio'],
      ['process-count-high', { processCount: 700 }, { processCount: 900 }, 700, 900, 'count'],
      ['process-capacity-high', { processCount: 800, processLimit: 1_000 }, { processCount: 900, processLimit: 1_000 }, 0.8, 0.9, 'ratio'],
      ['zombie-processes', { zombieProcessCount: 1 }, { zombieProcessCount: 25 }, 1, 25, 'count'],
    ] as const)('applies inclusive warning and critical thresholds for %s', (code, warning, critical, warningThreshold, criticalThreshold, unit) => {
      const warningIssue = issue(recordTwice(new SystemHealthMonitor(), warning), code)
      expect(warningIssue).toMatchObject({ severity: 'warning', threshold: warningThreshold, unit })
      const criticalIssue = issue(recordTwice(new SystemHealthMonitor(), critical), code)
      expect(criticalIssue).toMatchObject({ severity: 'critical', threshold: criticalThreshold, unit })
    })

    it('uses strict low-water boundaries for memory pressure and disk space', () => {
      expect(issue(recordTwice(new SystemHealthMonitor(), { memoryPressureFreePercent: 10 }), 'memory-pressure-high')).toBeUndefined()
      expect(issue(recordTwice(new SystemHealthMonitor(), { memoryPressureFreePercent: 5 }), 'memory-pressure-high')).toMatchObject({ severity: 'warning', threshold: 10 })
      expect(issue(recordTwice(new SystemHealthMonitor(), { memoryPressureFreePercent: 4 }), 'memory-pressure-high')).toMatchObject({ severity: 'critical', threshold: 5 })
      expect(issue(recordTwice(new SystemHealthMonitor(), { diskFreeBytes: 15 * GiB }), 'disk-low')).toBeUndefined()
      expect(issue(recordTwice(new SystemHealthMonitor(), { diskFreeBytes: 5 * GiB }), 'disk-low')).toMatchObject({ severity: 'warning', threshold: 15 * GiB })
      expect(issue(recordTwice(new SystemHealthMonitor(), { diskFreeBytes: 4 * GiB }), 'disk-low')).toMatchObject({ severity: 'critical', threshold: 5 * GiB })
    })

    it('does not create ratio observations when a required denominator is zero', () => {
      const monitor = new SystemHealthMonitor()
      expect(() => recordTwice(monitor, { memoryTotalBytes: 0, cpuCores: 0 })).not.toThrow()
      expect(monitor.getSnapshot().issues).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'swap-high' }),
        expect.objectContaining({ code: 'load-high' }),
        expect.objectContaining({ code: 'worker-memory-high' }),
      ]))
    })
  })

  it('uses the oldest sample in the 9.5 to 10.5 minute swap window and preserves negative growth observations', () => {
    const monitor = new SystemHealthMonitor()
    for (let index = 0; index <= 39; index += 1) monitor.record(complete(index * INTERVAL_MS, { swapUsedBytes: 1 * GiB }))
    monitor.record(complete(40 * INTERVAL_MS, { swapUsedBytes: 3.5 * GiB }))
    const critical = monitor.record(complete(41 * INTERVAL_MS, { swapUsedBytes: 3.5 * GiB }))
    expect(issue(critical, 'swap-growing')).toMatchObject({ severity: 'critical', observed: 2.5 * GiB, threshold: 2 * GiB })
    const falling = monitor.record(complete(42 * INTERVAL_MS, { swapUsedBytes: 0 }))
    expect(issue(falling, 'swap-growing')?.observed).toBe(-GiB)
  })

  describe('sustained rules', () => {
    it('raises CPU warning at two minutes and critical at three minutes without an extra entry delay', () => {
      const monitor = new SystemHealthMonitor()
      for (let index = 0; index <= 8; index += 1) monitor.record(complete(index * INTERVAL_MS, { cpuUsedPercent: 95 }))
      expect(issue(monitor.getSnapshot(), 'cpu-sustained')).toMatchObject({ severity: 'warning', threshold: 85 })
      for (let index = 9; index <= 12; index += 1) monitor.record(complete(index * INTERVAL_MS, { cpuUsedPercent: 95 }))
      expect(issue(monitor.getSnapshot(), 'cpu-sustained')).toMatchObject({ severity: 'critical', threshold: 95 })
    })

    it('requires both 80 percent sample coverage and 80 percent qualifying complete samples', () => {
      const insufficientCoverage = new SystemHealthMonitor()
      for (const index of [0, 30_000, 60_000, 90_000, 105_000, 120_000]) {
        insufficientCoverage.record(complete(index, { cpuUsedPercent: 90 }))
      }
      expect(issue(insufficientCoverage.getSnapshot(), 'cpu-sustained')).toBeUndefined()

      const insufficientHigh = new SystemHealthMonitor()
      for (const [index, cpuUsedPercent] of [90, 20, 20, 90, 90, 90, 90, 90].entries()) {
        const sampledAt = [0, 30_000, 45_000, 60_000, 75_000, 90_000, 105_000, 120_000][index]!
        insufficientHigh.record(complete(sampledAt, { cpuUsedPercent }))
      }
      expect(issue(insufficientHigh.getSnapshot(), 'cpu-sustained')).toBeUndefined()

      const sufficient = new SystemHealthMonitor()
      for (const [index, cpuUsedPercent] of [20, 90, 90, 90, 90, 90, 90, 90].entries()) {
        const sampledAt = [0, 30_000, 45_000, 60_000, 75_000, 90_000, 105_000, 120_000][index]!
        sufficient.record(complete(sampledAt, { cpuUsedPercent }))
      }
      expect(issue(sufficient.getSnapshot(), 'cpu-sustained')).toMatchObject({ severity: 'warning' })
    })

    it('uses every analyzer source for five-minute CPU rules while synchronizing only top five', () => {
      const monitor = new SystemHealthMonitor()
      const sources = [
        source('one', 300), source('two', 290), source('three', 280),
        source('four', 270), source('five', 260), source('six', 110),
      ]
      for (let index = 0; index <= 20; index += 1) monitor.record(complete(index * INTERVAL_MS, { sources }))
      const snapshot = monitor.getSnapshot()
      expect(snapshot.current?.topCpuSources).toHaveLength(5)
      expect(snapshot.current?.topCpuSources.map((item) => item.id)).not.toContain('six')
      expect(issue(snapshot, 'single-source-cpu-high', 'six')).toMatchObject({ severity: 'warning', threshold: 100 })
    })

    it('applies both 80 percent gates to source CPU and uses exact warning and critical boundaries', () => {
      const timestamps = Array.from({ length: 21 }, (_, index) => index * INTERVAL_MS)
        .filter((_, index) => ![2, 6, 10, 14].includes(index))
      const warning = new SystemHealthMonitor()
      for (const [index, sampledAt] of timestamps.entries()) {
        warning.record(complete(sampledAt, { sources: [source('boundary', index < 3 ? 0 : 100)] }))
      }
      expect(issue(warning.getSnapshot(), 'single-source-cpu-high', 'boundary')).toMatchObject({ severity: 'warning', threshold: 100 })

      const critical = new SystemHealthMonitor()
      for (const sampledAt of timestamps) critical.record(complete(sampledAt, { sources: [source('boundary', 200)] }))
      expect(issue(critical.getSnapshot(), 'single-source-cpu-high', 'boundary')).toMatchObject({ severity: 'critical', threshold: 200 })

      const insufficient = new SystemHealthMonitor()
      for (const [index, sampledAt] of timestamps.entries()) {
        if (index !== 1) insufficient.record(complete(sampledAt, { sources: [source('boundary', 200)] }))
      }
      expect(issue(insufficient.getSnapshot(), 'single-source-cpu-high', 'boundary')).toBeUndefined()
    })

    it('records a disappeared source as zero and recovers its issue after three complete samples', () => {
      const monitor = new SystemHealthMonitor()
      const hot = source('hot', 210)
      for (let index = 0; index <= 20; index += 1) monitor.record(complete(index * INTERVAL_MS, { sources: [hot] }))
      expect(issue(monitor.getSnapshot(), 'single-source-cpu-high', 'hot')?.severity).toBe('critical')
      expect(issue(monitor.record(complete(21 * INTERVAL_MS, { sources: [] })), 'single-source-cpu-high', 'hot')?.observed).toBe(0)
      monitor.record(complete(22 * INTERVAL_MS, { sources: [] }))
      expect(issue(monitor.record(complete(23 * INTERVAL_MS, { sources: [] })), 'single-source-cpu-high', 'hot')).toBeUndefined()
    })
  })

  it('caps and independently ranks CPU, memory, and zombie source views', () => {
    const sources = Array.from({ length: 8 }, (_, index) => source(
      `source-${index}`,
      index,
      (7 - index) * 1_000,
      index + 1,
    ))
    const current = new SystemHealthMonitor().record(complete(0, { sources })).current
    expect(current?.topCpuSources.map((item) => item.id)).toEqual(['source-7', 'source-6', 'source-5', 'source-4', 'source-3'])
    expect(current?.topMemorySources.map((item) => item.id)).toEqual(['source-0', 'source-1', 'source-2', 'source-3', 'source-4'])
    expect(current?.topZombieSources.map((item) => item.id)).toEqual(['source-7', 'source-6', 'source-5', 'source-4', 'source-3'])
  })

  it('uses code and subject as the issue key and caps synchronized issues at 16', () => {
    const monitor = new SystemHealthMonitor()
    const sources = Array.from({ length: 20 }, (_, index) => source(`hot-${index}`, 110))
    for (let index = 0; index <= 20; index += 1) monitor.record(complete(index * INTERVAL_MS, { sources }))
    const snapshot = monitor.getSnapshot()
    expect(snapshot.issues).toHaveLength(16)
    expect(new Set(snapshot.issues.map((item) => `${item.code}:${item.subject ?? 'global'}`)).size).toBe(16)
  })

  it('rejects an invalid complete sample through the synchronized snapshot schema', () => {
    const monitor = new SystemHealthMonitor()
    expect(() => monitor.record(complete(0, { cpuUsedPercent: -1 }))).toThrow()
    expect(() => monitor.record(complete(INTERVAL_MS, { cpuUsedPercent: Number.NaN }))).toThrow()
  })
})
