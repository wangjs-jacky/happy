import { describe, expect, it } from 'vitest'
import { SystemHealthSnapshotSchema } from '@/api/types'

describe('system health payload budget', () => {
  it('keeps the maximal encrypted snapshot below 32 KiB without raw process data', () => {
    const source = (index: number) => ({
      id: `process:${index.toString(16).padStart(12, '0')}`,
      name: `Sanitized source ${index}`,
      cpuPercent: 999.9,
      rssBytes: 99_999_999_999,
      processCount: 9_999,
      zombieProcessCount: 999,
      oldestProcessAgeSeconds: 9_999_999,
    })
    const sources = Array.from({ length: 5 }, (_, index) => source(index))
    const current = {
      sampledAt: 1_800_000_000_000,
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
    const issueCodes = [
      'orphan-workers', 'swap-high', 'swap-growing', 'cpu-sustained', 'load-high',
      'memory-pressure-high', 'worker-memory-high', 'process-count-high',
      'process-capacity-high', 'zombie-processes', 'disk-low', 'single-source-cpu-high',
    ] as const
    const snapshot = SystemHealthSnapshotSchema.parse({
      schemaVersion: 1,
      platform: 'darwin',
      updatedAt: current.sampledAt,
      lastAttemptAt: current.sampledAt,
      resourceStatus: 'critical',
      current,
      history: Array.from({ length: 30 }, (_, index) => ({
        sampledAt: current.sampledAt - (29 - index) * 60_000,
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
        subject: `process:${index.toString(16).padStart(12, '0')}`,
        observed: 999_999_999,
        threshold: 999_999_999,
        unit: 'count',
        since: current.sampledAt,
      })),
      collector: {
        intervalSeconds: 15,
        historyStepSeconds: 60,
        durationMs: 5_000,
        lastSampleKind: 'complete',
        errors: Array.from({ length: 16 }, () => ({ command: 'ps', code: 'parse' })),
      },
    })
    const json = JSON.stringify(snapshot)
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThan(32 * 1024)
    expect(json).not.toContain('/Users/example/private-project')
    expect(json).not.toContain('--secret-token')
    const keys = new Set<string>()
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit)
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        keys.add(key)
        visit(child)
      }
    }
    visit(snapshot)
    expect(keys).not.toContain('pid')
    expect(keys).not.toContain('ppid')
    expect(keys).not.toContain('comm')
    expect(keys).not.toContain('args')
  })
})
