import { describe, expect, it, vi } from 'vitest'
import { SystemHealthRuntime } from './systemHealthRuntime'

describe('SystemHealthRuntime', () => {
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
    vi.useRealTimers()
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
    vi.useRealTimers()
  })
})
