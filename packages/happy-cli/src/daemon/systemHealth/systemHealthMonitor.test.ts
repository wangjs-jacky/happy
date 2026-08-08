import { describe, expect, it } from 'vitest'
import { SystemHealthMonitor } from './systemHealthMonitor'
import type { MacSystemHealthCollection, MacSystemHealthValues } from './types'

const GiB = 1024 ** 3

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
      sources: [{ id: 'sample', name: 'Sample', cpuPercent: 10, rssBytes: 100, processCount: 1, zombieProcessCount: 0 }],
      ...overrides,
    },
  }
}

describe('SystemHealthMonitor', () => {
  it('warns after two zombie samples and recovers after three clean samples', () => {
    const monitor = new SystemHealthMonitor()
    expect(monitor.record(complete(0, { zombieProcessCount: 1 })).resourceStatus).toBe('healthy')
    expect(monitor.record(complete(15_000, { zombieProcessCount: 1 })).issues).toContainEqual(expect.objectContaining({ code: 'zombie-processes', severity: 'warning' }))
    monitor.record(complete(30_000))
    monitor.record(complete(45_000))
    expect(monitor.record(complete(60_000)).issues).not.toContainEqual(expect.objectContaining({ code: 'zombie-processes' }))
  })

  it('raises a critical process capacity issue independently of absolute count', () => {
    const monitor = new SystemHealthMonitor()
    monitor.record(complete(0, { processCount: 950, processLimit: 1_000 }))
    const snapshot = monitor.record(complete(15_000, { processCount: 950, processLimit: 1_000 }))
    expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'process-capacity-high', severity: 'critical', observed: 0.95 }))
  })

  it('does not advance alert state or overwrite current on partial samples', () => {
    const monitor = new SystemHealthMonitor()
    const first = monitor.record(complete(0, { zombieProcessCount: 1 }))
    const partial = monitor.record({ kind: 'partial', attemptedAt: 15_000, durationMs: 5_000, values: { zombieProcessCount: 100 }, commandErrors: [{ command: 'ps', code: 'timeout' }] })
    expect(partial.current).toEqual(first.current)
    expect(partial.collector.lastSampleKind).toBe('partial')
    expect(monitor.record(complete(30_000, { zombieProcessCount: 1 })).resourceStatus).toBe('warning')
  })

  it('keeps the last sample per minute and caps history at 30 points', () => {
    const monitor = new SystemHealthMonitor()
    monitor.record(complete(1_000))
    monitor.record(complete(50_000, { processCount: 301 }))
    for (let minute = 1; minute <= 35; minute += 1) monitor.record(complete(minute * 60_000))
    const snapshot = monitor.getSnapshot()
    expect(snapshot.history).toHaveLength(30)
    expect(snapshot.history.at(-1)?.sampledAt).toBe(35 * 60_000)
    expect(snapshot.history.every((point, index, all) => index === 0 || point.sampledAt > all[index - 1].sampledAt)).toBe(true)
  })

  it('uses the earliest sample in the 9.5 to 10.5 minute swap baseline window', () => {
    const monitor = new SystemHealthMonitor()
    for (let index = 0; index <= 42; index += 1) {
      monitor.record(complete(index * 15_000, { swapUsedBytes: index === 42 ? 3.5 * GiB : 1 * GiB }))
    }
    const snapshot = monitor.record(complete(42 * 15_000 + 15_000, { swapUsedBytes: 3.5 * GiB }))
    expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'swap-growing', severity: 'critical' }))
  })
})
