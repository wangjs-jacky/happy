import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getSystemHealthCapability,
  getSystemHealthMetadata,
  isSystemHealthMonitorEnabled,
  SystemHealthRuntime,
} from './systemHealthRuntime'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const originalFeatureFlag = process.env.HAPPY_SYSTEM_HEALTH_MONITOR

describe('SystemHealthRuntime', () => {
  afterEach(() => {
    vi.useRealTimers()
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    if (originalFeatureFlag === undefined) delete process.env.HAPPY_SYSTEM_HEALTH_MONITOR
    else process.env.HAPPY_SYSTEM_HEALTH_MONITOR = originalFeatureFlag
  })

  it('samples after 5 seconds, every 15 seconds, and never overlaps', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let concurrent = 0
    let maxConcurrent = 0
    let resolveCollection: (() => void) | undefined
    const snapshots: number[] = []
    const collector = {
      collect: vi.fn(async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise<void>((resolve) => { resolveCollection = resolve })
        concurrent -= 1
        return { kind: 'complete' as const, attemptedAt: Date.now(), durationMs: 1, values: {}, commandErrors: [] }
      }),
    }
    const runtime = new SystemHealthRuntime({
      collector,
      monitor: {
        record: (collection) => ({ updatedAt: collection.attemptedAt } as never),
        getSnapshot: () => ({ updatedAt: 0 } as never),
      },
      publish: (snapshot) => snapshots.push(snapshot.updatedAt ?? -1),
      isConnected: () => true,
      trackedRoots: () => [],
    })
    runtime.start()
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(collector.collect).toHaveBeenCalledTimes(1)
    resolveCollection?.()
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(collector.collect).toHaveBeenCalledTimes(2)
    expect(maxConcurrent).toBe(1)
    expect(snapshots).toEqual([35_000])
    runtime.stop()
    resolveCollection?.()
  })

  it('keeps sampling offline and publishes only the latest snapshot after reconnect', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let connected = false
    const published: number[] = []
    const runtime = new SystemHealthRuntime({
      collector: { collect: vi.fn(async () => ({ kind: 'complete' as const, attemptedAt: Date.now(), durationMs: 1, values: {}, commandErrors: [] })) },
      monitor: {
        record: (collection) => ({ updatedAt: collection.attemptedAt } as never),
        getSnapshot: () => ({ updatedAt: 0 } as never),
      },
      publish: (snapshot) => published.push(snapshot.updatedAt ?? -1),
      isConnected: () => connected,
      trackedRoots: () => [],
    })
    runtime.start()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(published).toEqual([])
    connected = true
    runtime.publishLatestNow()
    expect(published).toEqual([20_000])
    runtime.stop()
  })

  it('isolates collection failures and keeps sampling on later ticks', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const published: number[] = []
    const collector = {
      collect: vi.fn()
        .mockRejectedValueOnce(new Error('temporary collection failure'))
        .mockImplementation(async () => ({
          kind: 'complete' as const,
          attemptedAt: Date.now(),
          durationMs: 1,
          values: {},
          commandErrors: [],
        })),
    }
    const runtime = new SystemHealthRuntime({
      collector,
      monitor: {
        record: (collection) => ({ updatedAt: collection.attemptedAt } as never),
        getSnapshot: () => ({ updatedAt: 0 } as never),
      },
      publish: (snapshot) => published.push(snapshot.updatedAt ?? -1),
      isConnected: () => true,
      trackedRoots: () => [],
    })

    runtime.start()
    await vi.advanceTimersByTimeAsync(20_000)

    expect(collector.collect).toHaveBeenCalledTimes(2)
    expect(published).toEqual([20_000])
    runtime.stop()
  })

  it('does not record or publish an in-flight collection after stop', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let resolveCollection!: () => void
    const record = vi.fn((collection) => ({ updatedAt: collection.attemptedAt } as never))
    const publish = vi.fn()
    const runtime = new SystemHealthRuntime({
      collector: {
        collect: vi.fn(async () => {
          await new Promise<void>((resolve) => { resolveCollection = resolve })
          return {
            kind: 'complete' as const,
            attemptedAt: Date.now(),
            durationMs: 1,
            values: {},
            commandErrors: [],
          }
        }),
      },
      monitor: {
        record,
        getSnapshot: () => ({ updatedAt: 0 } as never),
      },
      publish,
      isConnected: () => true,
      trackedRoots: () => [],
    })

    runtime.start()
    await vi.advanceTimersByTimeAsync(5_000)
    runtime.stop()
    resolveCollection()
    await vi.runAllTicks()

    expect(record).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(record).not.toHaveBeenCalled()
  })
})

describe('system health feature gates', () => {
  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
    if (originalFeatureFlag === undefined) delete process.env.HAPPY_SYSTEM_HEALTH_MONITOR
    else process.env.HAPPY_SYSTEM_HEALTH_MONITOR = originalFeatureFlag
  })

  it('reports the macOS capability even while collection is disabled', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    delete process.env.HAPPY_SYSTEM_HEALTH_MONITOR

    expect(getSystemHealthCapability(123)).toEqual({
      schemaVersion: 1,
      supported: true,
      enabled: false,
      reportedAt: 123,
    })
    expect(getSystemHealthMetadata(456).systemHealthMonitor?.reportedAt).toBe(456)
    expect(isSystemHealthMonitorEnabled()).toBe(false)
  })

  it('enables collection only for an exact feature flag value on macOS', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    process.env.HAPPY_SYSTEM_HEALTH_MONITOR = 'true'
    expect(isSystemHealthMonitorEnabled()).toBe(false)

    process.env.HAPPY_SYSTEM_HEALTH_MONITOR = '1'
    expect(isSystemHealthMonitorEnabled()).toBe(true)
    expect(getSystemHealthCapability(789)?.enabled).toBe(true)
  })

  it('omits the capability and stays disabled off macOS', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    process.env.HAPPY_SYSTEM_HEALTH_MONITOR = '1'

    expect(getSystemHealthCapability()).toBeUndefined()
    expect(getSystemHealthMetadata()).toEqual({})
    expect(isSystemHealthMonitorEnabled()).toBe(false)
  })
})
