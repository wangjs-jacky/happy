import type { DaemonState } from './types'

export type DaemonStateMutation = (state: DaemonState | null) => DaemonState

export interface DaemonStateTransport {
  write(mutation: DaemonStateMutation, generation: number, timeoutMs: number): Promise<void>
}

interface PublishTask {
  mutation: DaemonStateMutation
  resolve?: () => void
  reject?: (error: Error) => void
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Daemon state ACK timed out')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export class DaemonStatePublisher {
  private generation = 0
  private connected = false
  private closing = false
  private inFlight = false
  private ordinaryQueue: PublishTask[] = []
  private latestQueue = new Map<string, PublishTask>()
  private flushWaiters: Array<() => void> = []

  constructor(private readonly transport: DaemonStateTransport) {}

  onConnected(generation: number): void {
    if (this.closing) return
    this.generation = generation
    this.connected = true
    this.pump()
  }

  onDisconnected(generation: number): void {
    this.generation = generation
    this.connected = false
    const error = new Error('Daemon state publisher disconnected')
    for (const task of this.ordinaryQueue) task.reject?.(error)
    this.ordinaryQueue = []
    this.latestQueue.clear()
    this.resolveFlushIfIdle()
  }

  publish(mutation: DaemonStateMutation): Promise<void> {
    if (this.closing) return Promise.reject(new Error('Daemon state publisher is closing'))
    if (!this.connected) return Promise.reject(new Error('Daemon state publisher is disconnected'))
    return new Promise<void>((resolve, reject) => {
      this.ordinaryQueue.push({ mutation, resolve, reject })
      this.pump()
    })
  }

  publishLatest(coalesceKey: string, mutation: DaemonStateMutation): void {
    if (this.closing || !this.connected) return
    this.latestQueue.set(coalesceKey, { mutation })
    this.pump()
  }

  flush(): Promise<void> {
    if (!this.inFlight && this.ordinaryQueue.length === 0 && this.latestQueue.size === 0) return Promise.resolve()
    return new Promise((resolve) => this.flushWaiters.push(resolve))
  }

  async close(shutdownMutation?: DaemonStateMutation): Promise<void> {
    if (this.closing) return
    this.closing = true
    this.latestQueue.clear()
    const pendingError = new Error('Daemon state publisher closed')
    for (const task of this.ordinaryQueue) task.reject?.(pendingError)
    this.ordinaryQueue = []

    if (this.inFlight) {
      await Promise.race([this.flush(), new Promise((resolve) => setTimeout(resolve, 1_000))])
      if (this.inFlight) {
        this.generation += 1
        this.connected = false
        return
      }
    }
    if (shutdownMutation && this.connected) {
      try {
        await withTimeout(this.transport.write(shutdownMutation, this.generation, 1_000), 1_000)
      } catch {
        // 关闭写入仅为 best effort，不能阻塞 daemon 清理。
      }
    }
    this.connected = false
  }

  private pump(): void {
    if (this.inFlight || !this.connected || this.closing) return
    const task = this.ordinaryQueue.shift() ?? this.takeLatest()
    if (!task) {
      this.resolveFlushIfIdle()
      return
    }
    this.inFlight = true
    const generation = this.generation
    void this.runTask(task, generation).finally(() => {
      this.inFlight = false
      this.pump()
      this.resolveFlushIfIdle()
    })
  }

  private takeLatest(): PublishTask | undefined {
    const entry = this.latestQueue.entries().next()
    if (entry.done) return undefined
    const [key, task] = entry.value
    this.latestQueue.delete(key)
    return task
  }

  private async runTask(task: PublishTask, generation: number): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.connected || this.generation !== generation || this.closing) break
      try {
        await withTimeout(this.transport.write(task.mutation, generation, 5_000), 5_000)
        if (this.connected && this.generation === generation) task.resolve?.()
        else task.reject?.(new Error('Daemon state generation changed'))
        return
      } catch (error) {
        lastError = error
      }
    }
    task.reject?.(lastError instanceof Error ? lastError : new Error('Daemon state publication failed'))
  }

  private resolveFlushIfIdle(): void {
    if (this.inFlight || this.ordinaryQueue.length > 0 || this.latestQueue.size > 0) return
    for (const resolve of this.flushWaiters.splice(0)) resolve()
  }
}
