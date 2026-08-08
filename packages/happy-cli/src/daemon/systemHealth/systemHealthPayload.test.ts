import { describe, expect, it } from 'vitest'
import { SystemHealthSnapshotSchema, type SystemHealthSource } from '@/api/types'
import { analyzeMacProcessSnapshot } from './macProcessSnapshotAnalyzer'

const maxFinite = Number.MAX_VALUE
const sampledAt = maxFinite

function source(index: number): SystemHealthSource {
  return {
    id: `${index}`.padEnd(64, 'i'),
    name: `${index}`.padEnd(40, 'n'),
    cpuPercent: maxFinite,
    rssBytes: maxFinite,
    processCount: maxFinite,
    zombieProcessCount: maxFinite,
    oldestProcessAgeSeconds: maxFinite,
  }
}

function current(sources: SystemHealthSource[]) {
  return {
    sampledAt,
    cpuUsedPercent: maxFinite,
    cpuCores: maxFinite,
    load1: maxFinite,
    load5: maxFinite,
    load15: maxFinite,
    memoryTotalBytes: maxFinite,
    memoryAvailableBytes: maxFinite,
    memoryCompressedBytes: maxFinite,
    memoryPressureFreePercent: maxFinite,
    swapUsedBytes: maxFinite,
    swapTotalBytes: maxFinite,
    diskFreeBytes: maxFinite,
    diskTotalBytes: maxFinite,
    processCount: maxFinite,
    processLimit: maxFinite,
    zombieProcessCount: maxFinite,
    pawsWorkerRoots: maxFinite,
    pawsWorkerProcesses: maxFinite,
    pawsWorkerRssBytes: maxFinite,
    orphanWorkerRoots: maxFinite,
    orphanWorkerProcesses: maxFinite,
    orphanWorkerRssBytes: maxFinite,
    topCpuSources: sources,
    topMemorySources: sources,
    topZombieSources: sources,
  }
}

function snapshotWithSources(sources: SystemHealthSource[]) {
  return SystemHealthSnapshotSchema.parse({
    schemaVersion: 1,
    platform: 'darwin',
    updatedAt: sampledAt,
    lastAttemptAt: sampledAt,
    resourceStatus: 'critical',
    current: current(sources),
    history: Array.from({ length: 30 }, () => ({
      sampledAt: maxFinite,
      cpuUsedPercent: maxFinite,
      load1: maxFinite,
      memoryAvailableBytes: maxFinite,
      swapUsedBytes: maxFinite,
      processCount: maxFinite,
      zombieProcessCount: maxFinite,
      orphanWorkerRoots: maxFinite,
      pawsWorkerRssBytes: maxFinite,
    })),
    issues: Array.from({ length: 16 }, (_, index) => ({
      code: 'single-source-cpu-high',
      severity: 'critical',
      subject: `${index}`.padEnd(64, 's'),
      observed: -maxFinite,
      threshold: maxFinite,
      unit: 'percent',
      since: maxFinite,
    })),
    collector: {
      intervalSeconds: 15,
      historyStepSeconds: 60,
      durationMs: maxFinite,
      lastSampleKind: 'complete',
      errors: Array.from({ length: 16 }, () => ({ command: 'memory_pressure', code: 'timeout' })),
    },
  })
}

describe('system health payload budget', () => {
  it('keeps the schema-boundary worst-case snapshot below the 32 KiB wire budget', () => {
    const snapshot = snapshotWithSources(Array.from({ length: 5 }, (_, index) => source(index)))
    const json = JSON.stringify(snapshot)

    expect(snapshot.history).toHaveLength(30)
    expect(snapshot.current?.topCpuSources).toHaveLength(5)
    expect(snapshot.current?.topMemorySources).toHaveLength(5)
    expect(snapshot.current?.topZombieSources).toHaveLength(5)
    expect(snapshot.issues).toHaveLength(16)
    expect(snapshot.current?.cpuUsedPercent).toBe(Number.MAX_VALUE)
    expect(snapshot.issues[0]).toEqual(expect.objectContaining({
      code: 'single-source-cpu-high',
      severity: 'critical',
      observed: -Number.MAX_VALUE,
      threshold: Number.MAX_VALUE,
      unit: 'percent',
    }))
    expect(snapshot.collector).toEqual(expect.objectContaining({
      durationMs: Number.MAX_VALUE,
      lastSampleKind: 'complete',
      errors: expect.arrayContaining([
        { command: 'memory_pressure', code: 'timeout' },
      ]),
    }))
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

    expect(analysis.sources).toEqual([expect.objectContaining({
      name: 'secret-worker',
      processCount: 1,
      zombieProcessCount: 1,
    })])
    expect(json).not.toContain(rawUser)
    expect(json).not.toContain(rawPath)
    expect(json).not.toContain(String(rawPid))
    expect(json).not.toContain(rawArgs)
    expect(json).not.toContain('payload-fixture-secret')
    expect(json).not.toMatch(/"(?:pid|ppid|comm|args)":/)
  })
})
