import type { SystemHealthSnapshot } from '@/api/types'
import type { MacSystemHealthCollector } from './macSystemHealthCollector'
import type { SystemHealthMonitor } from './systemHealthMonitor'
import type { TrackedProcessRoot } from './types'

export interface SystemHealthRuntimeDependencies {
  collector: Pick<MacSystemHealthCollector, 'collect'>
  monitor: Pick<SystemHealthMonitor, 'record' | 'getSnapshot'>
  publish: (snapshot: SystemHealthSnapshot) => void
  isConnected: () => boolean
  trackedRoots: () => TrackedProcessRoot[]
  setTimeout?: typeof setTimeout
  setInterval?: typeof setInterval
  clearTimeout?: typeof clearTimeout
  clearInterval?: typeof clearInterval
}

export class SystemHealthRuntime {
  private initialTimer: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private running = false
  private stopped = false
  private latest: SystemHealthSnapshot | null = null

  constructor(private readonly dependencies: SystemHealthRuntimeDependencies) {}

  start(): void {
    if (this.initialTimer || this.interval || this.stopped) return
    const scheduleTimeout = this.dependencies.setTimeout ?? setTimeout
    this.initialTimer = scheduleTimeout(() => {
      this.initialTimer = null
      void this.sample()
      const scheduleInterval = this.dependencies.setInterval ?? setInterval
      this.interval = scheduleInterval(() => void this.sample(), 15_000)
    }, 5_000)
  }

  publishLatestNow(): void {
    if (this.latest && this.dependencies.isConnected()) this.dependencies.publish(this.latest)
  }

  stop(): void {
    this.stopped = true
    const cancelTimeout = this.dependencies.clearTimeout ?? clearTimeout
    const cancelInterval = this.dependencies.clearInterval ?? clearInterval
    if (this.initialTimer) cancelTimeout(this.initialTimer)
    if (this.interval) cancelInterval(this.interval)
    this.initialTimer = null
    this.interval = null
  }

  private async sample(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      const collection = await this.dependencies.collector.collect({ trackedRoots: this.dependencies.trackedRoots() })
      this.latest = this.dependencies.monitor.record(collection)
      if (this.dependencies.isConnected()) this.dependencies.publish(this.latest)
    } catch {
      // 采集失败不能进入 daemon 主循环，也不能中断下一次采样。
    } finally {
      this.running = false
    }
  }
}

export function getSystemHealthCapability(now = Date.now()) {
  if (process.platform !== 'darwin') return undefined
  return {
    schemaVersion: 1 as const,
    supported: true as const,
    enabled: process.env.HAPPY_SYSTEM_HEALTH_MONITOR === '1',
    reportedAt: now,
  }
}
