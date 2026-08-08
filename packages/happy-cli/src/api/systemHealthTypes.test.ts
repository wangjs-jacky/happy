import { describe, expect, it } from 'vitest'
import {
  DaemonStateSchema,
  MachineMetadataSchema,
  SystemHealthSnapshotSchema,
} from './types'

const current = {
  sampledAt: 1_754_608_000_000,
  cpuUsedPercent: 48.5,
  cpuCores: 10,
  load1: 3.2,
  load5: 2.8,
  load15: 2.2,
  memoryTotalBytes: 16_000_000_000,
  memoryAvailableBytes: 8_000_000_000,
  memoryCompressedBytes: 1_000_000_000,
  memoryPressureFreePercent: 31,
  swapUsedBytes: 500_000_000,
  swapTotalBytes: 4_000_000_000,
  diskFreeBytes: 120_000_000_000,
  diskTotalBytes: 500_000_000_000,
  processCount: 421,
  processLimit: 4_000,
  zombieProcessCount: 2,
  pawsWorkerRoots: 2,
  pawsWorkerProcesses: 9,
  pawsWorkerRssBytes: 900_000_000,
  orphanWorkerRoots: 0,
  orphanWorkerProcesses: 0,
  orphanWorkerRssBytes: 0,
  topCpuSources: [],
  topMemorySources: [],
  topZombieSources: [],
}

const snapshot = {
  schemaVersion: 1 as const,
  platform: 'darwin' as const,
  updatedAt: current.sampledAt,
  lastAttemptAt: current.sampledAt + 20,
  resourceStatus: 'warning' as const,
  current,
  history: [{
    sampledAt: current.sampledAt,
    cpuUsedPercent: current.cpuUsedPercent,
    load1: current.load1,
    memoryAvailableBytes: current.memoryAvailableBytes,
    swapUsedBytes: current.swapUsedBytes,
    processCount: current.processCount,
    zombieProcessCount: current.zombieProcessCount,
    orphanWorkerRoots: current.orphanWorkerRoots,
    pawsWorkerRssBytes: current.pawsWorkerRssBytes,
  }],
  issues: [{
    code: 'swap-growing' as const,
    severity: 'warning' as const,
    observed: -0.5,
    threshold: 1,
    unit: 'bytes' as const,
    since: current.sampledAt,
  }],
  collector: {
    intervalSeconds: 15 as const,
    historyStepSeconds: 60 as const,
    durationMs: 320,
    lastSampleKind: 'complete' as const,
    errors: [],
  },
}

describe('SystemHealthSnapshotSchema', () => {
  it('accepts the encrypted version 1 payload including process capacity and zombies', () => {
    expect(SystemHealthSnapshotSchema.parse(snapshot).resourceStatus).toBe('warning')
  })

  it('rejects negative synchronized metrics except issue observations', () => {
    expect(() => SystemHealthSnapshotSchema.parse({
      ...snapshot,
      current: { ...current, zombieProcessCount: -1 },
    })).toThrow()
    expect(SystemHealthSnapshotSchema.parse(snapshot).issues[0]?.observed).toBe(-0.5)
  })

  it('accepts pending snapshots without a complete sample', () => {
    expect(SystemHealthSnapshotSchema.parse({
      ...snapshot,
      updatedAt: null,
      current: null,
      history: [],
      issues: [],
      collector: { ...snapshot.collector, lastSampleKind: 'pending' },
    }).current).toBeNull()
  })
})

it('embeds health state in daemon state and capability in metadata', () => {
  expect(DaemonStateSchema.parse({ status: 'running', systemHealth: snapshot }).systemHealth).toBeTruthy()
  expect(MachineMetadataSchema.parse({
    host: 'mac-mini',
    platform: 'darwin',
    happyCliVersion: '1.0.0',
    homeDir: '/tmp/home',
    happyHomeDir: '/tmp/happy-home',
    happyLibDir: '/tmp/happy-lib',
    systemHealthMonitor: {
      schemaVersion: 1,
      supported: true,
      enabled: false,
      reportedAt: 1,
    },
  }).systemHealthMonitor?.enabled).toBe(false)
})
