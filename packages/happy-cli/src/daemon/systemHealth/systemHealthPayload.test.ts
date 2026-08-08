import { describe, expect, it } from 'vitest'
import { SystemHealthSnapshotSchema, type SystemHealthSource } from '@/api/types'
import { analyzeMacProcessSnapshot } from './macProcessSnapshotAnalyzer'

const sampledAt = 1_800_000_000_000

function source(index: number): SystemHealthSource {
  return {
    id: `process:${index.toString(16).padStart(56, '0')}`,
    name: `${index}`.padEnd(40, 'x'),
    cpuPercent: 999.9,
    rssBytes: 99_999_999_999,
    processCount: 9_999,
    zombieProcessCount: 999,
    oldestProcessAgeSeconds: 9_999_999,
  }
}

function current(sources: SystemHealthSource[]) {
  return {
    sampledAt,
    cpuUsedPercent: 100,
    cpuCores: 128,
    load1: 999,
    load5: 999,
    load15: 999,
    memoryTotalBytes: 999_999_999_999,
    memoryAvailableBytes: 999_999_999_999,
    memoryCompressedBytes: 999_999_999_999,
    memoryPressureFreePercent: 100,
    swapUsedBytes: 999_999_999_999,
    swapTotalBytes: 999_999_999_999,
    diskFreeBytes: 999_999_999_999,
    diskTotalBytes: 999_999_999_999,
    processCount: 9_999,
    processLimit: 10_000,
    zombieProcessCount: 9_999,
    pawsWorkerRoots: 999,
    pawsWorkerProcesses: 9_999,
    pawsWorkerRssBytes: 999_999_999_999,
    orphanWorkerRoots: 999,
    orphanWorkerProcesses: 9_999,
    orphanWorkerRssBytes: 999_999_999_999,
    topCpuSources: sources,
    topMemorySources: sources,
    topZombieSources: sources,
  }
}

function snapshotWithSources(sources: SystemHealthSource[]) {
  const issueCodes = [
    'orphan-workers', 'swap-high', 'swap-growing', 'cpu-sustained', 'load-high',
    'memory-pressure-high', 'worker-memory-high', 'process-count-high',
    'process-capacity-high', 'zombie-processes', 'disk-low', 'single-source-cpu-high',
  ] as const
  return SystemHealthSnapshotSchema.parse({
    schemaVersion: 1,
    platform: 'darwin',
    updatedAt: sampledAt,
    lastAttemptAt: sampledAt,
    resourceStatus: 'critical',
    current: current(sources),
    history: Array.from({ length: 30 }, (_, index) => ({
      sampledAt: sampledAt - (29 - index) * 60_000,
      cpuUsedPercent: 100,
      load1: 999,
      memoryAvailableBytes: 999_999_999_999,
      swapUsedBytes: 999_999_999_999,
      processCount: 9_999,
      zombieProcessCount: 9_999,
      orphanWorkerRoots: 999,
      pawsWorkerRssBytes: 999_999_999_999,
    })),
    issues: Array.from({ length: 16 }, (_, index) => ({
      code: issueCodes[index % issueCodes.length],
      severity: index % 2 ? 'warning' : 'critical',
      subject: `${index}`.padEnd(64, 's'),
      observed: 999_999_999,
      threshold: 999_999_999,
      unit: 'count',
      since: sampledAt,
    })),
    collector: {
      intervalSeconds: 15,
      historyStepSeconds: 60,
      durationMs: 5_000,
      lastSampleKind: 'complete',
      errors: Array.from({ length: 16 }, () => ({ command: 'ps', code: 'parse' })),
    },
  })
}

describe('system health payload budget', () => {
  it('keeps the maximal snapshot below the 32 KiB wire budget', () => {
    const snapshot = snapshotWithSources(Array.from({ length: 5 }, (_, index) => source(index)))
    const json = JSON.stringify(snapshot)

    expect(snapshot.history).toHaveLength(30)
    expect(snapshot.current?.topCpuSources).toHaveLength(5)
    expect(snapshot.current?.topMemorySources).toHaveLength(5)
    expect(snapshot.current?.topZombieSources).toHaveLength(5)
    expect(snapshot.issues).toHaveLength(16)
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThan(32 * 1024)
  })

  it('does not copy raw process identity or command data into the snapshot', () => {
    const rawPid = 8_675_309
    const rawUser = 'payload-fixture-user'
    const rawPath = `/Users/${rawUser}/private-project/secret-worker`
    const rawArgs = `secret-worker --token payload-fixture-secret --config ${rawPath}`
    const analysis = analyzeMacProcessSnapshot({
      capturedAt: sampledAt,
      stats: [{
        pid: rawPid,
        ppid: 1,
        cpuPercent: 99,
        rssKb: 1_024,
        elapsedSeconds: 30,
        state: 'Z',
      }],
      commands: [{ pid: rawPid, value: rawPath }],
      arguments: [{ pid: rawPid, value: rawArgs }],
      trackedRoots: [],
      previousMembership: [],
    })
    const snapshot = snapshotWithSources(analysis.sources)
    const json = JSON.stringify(snapshot)

    expect(json).not.toContain(rawUser)
    expect(json).not.toContain(rawPath)
    expect(json).not.toContain(String(rawPid))
    expect(json).not.toContain(rawArgs)
    expect(json).not.toContain('payload-fixture-secret')
    expect(json).not.toMatch(/"(?:pid|ppid|comm|args)":/)
  })
})
