import { describe, expect, it, vi } from 'vitest'
import { DaemonStatePublisher, type DaemonStateMutation, type DaemonStateTransport } from './daemonStatePublisher'

class DeferredTransport implements DaemonStateTransport {
  concurrent = 0
  maxConcurrent = 0
  writes: Array<{ mutation: DaemonStateMutation; generation: number; resolve: () => void; reject: (error: Error) => void }> = []

  write(mutation: DaemonStateMutation, generation: number): Promise<void> {
    this.concurrent += 1
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent)
    return new Promise((resolve, reject) => this.writes.push({
      mutation,
      generation,
      resolve: () => { this.concurrent -= 1; resolve() },
      reject: (error) => { this.concurrent -= 1; reject(error) },
    }))
  }
}

const state = (id: string): DaemonStateMutation => (current) => ({ ...current, status: 'running', pid: Number(id) })

describe('DaemonStatePublisher', () => {
  it('never writes concurrently and keeps only the latest pending health mutation', async () => {
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    const ordinary = publisher.publish(state('1'))
    publisher.publishLatest('system-health', state('2'))
    publisher.publishLatest('system-health', state('3'))
    expect(transport.writes).toHaveLength(1)
    transport.writes[0].resolve()
    await ordinary
    await vi.waitFor(() => expect(transport.writes).toHaveLength(2))
    expect(transport.writes[1].mutation(null).pid).toBe(3)
    expect(transport.maxConcurrent).toBe(1)
    transport.writes[1].resolve()
    await publisher.flush()
  })

  it('retries at most twice and releases the queue after failure', async () => {
    const transport: DaemonStateTransport = { write: vi.fn(async () => { throw new Error('ack') }) }
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    await expect(publisher.publish(state('1'))).rejects.toThrow('ack')
    expect(transport.write).toHaveBeenCalledTimes(2)
    await publisher.flush()
  })

  it('clears pending work and invalidates late generations on disconnect', async () => {
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    const first = publisher.publish(state('1'))
    const pending = publisher.publish(state('2'))
    publisher.onDisconnected(2)
    await expect(pending).rejects.toThrow('disconnected')
    transport.writes[0].resolve()
    await expect(first).rejects.toThrow('generation')
    expect(transport.writes).toHaveLength(1)
  })

  it('does not issue a concurrent shutdown write when an in-flight write stalls', async () => {
    vi.useFakeTimers()
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    void publisher.publish(state('1')).catch(() => undefined)
    const closing = publisher.close((current) => ({ ...current, status: 'shutting-down' }))
    await vi.advanceTimersByTimeAsync(1_000)
    await closing
    expect(transport.writes).toHaveLength(1)
    expect(transport.maxConcurrent).toBe(1)
    vi.useRealTimers()
  })
})
