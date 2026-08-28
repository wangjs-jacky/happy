import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('settles ordinary publications in enqueue order', async () => {
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    const settled: number[] = []
    const first = publisher.publish(state('1')).then(() => { settled.push(1) })
    const second = publisher.publish(state('2')).then(() => { settled.push(2) })

    expect(transport.writes).toHaveLength(1)
    transport.writes[0].resolve()
    await first
    await vi.waitFor(() => expect(transport.writes).toHaveLength(2))
    expect(transport.writes[1].mutation(null).pid).toBe(2)
    expect(settled).toEqual([1])
    transport.writes[1].resolve()
    await second
    expect(settled).toEqual([1, 2])
    expect(transport.maxConcurrent).toBe(1)
  })

  it('retries at most twice and releases the queue after failure', async () => {
    const transport: DaemonStateTransport = { write: vi.fn(async () => { throw new Error('ack') }) }
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    await expect(publisher.publish(state('1'))).rejects.toThrow('ack')
    expect(transport.write).toHaveBeenCalledTimes(2)
    await publisher.flush()
  })

  it('reports a latest-publication failure after two attempts', async () => {
    const error = new Error('health ACK failed')
    const transport: DaemonStateTransport = { write: vi.fn(async () => { throw error }) }
    const reportError = vi.fn()
    const publisher = new DaemonStatePublisher(transport, reportError)
    publisher.onConnected(1)

    publisher.publishLatest('system-health', state('1'))
    await publisher.flush()

    expect(transport.write).toHaveBeenCalledTimes(2)
    expect(reportError).toHaveBeenCalledWith(error)
  })

  it('passes a 5 second ACK timeout to transport without overlapping a hung attempt', async () => {
    vi.useFakeTimers()
    const transport = new DeferredTransport()
    const write = vi.spyOn(transport, 'write')
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)

    void publisher.publish(state('1')).catch(() => undefined)
    expect(write).toHaveBeenCalledWith(expect.any(Function), 1, 5_000)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(transport.writes).toHaveLength(1)
    expect(transport.maxConcurrent).toBe(1)
  })

  it('clears pending work and invalidates late generations on disconnect', async () => {
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    const first = publisher.publish(state('1'))
    const pending = publisher.publish(state('2'))
    let firstOutcome = 'pending'
    void first.then(
      () => { firstOutcome = 'resolved' },
      (error: Error) => { firstOutcome = error.message },
    )
    publisher.onDisconnected(2)
    await expect(pending).rejects.toThrow('disconnected')
    await Promise.resolve()
    expect(firstOutcome).toContain('generation')
    transport.writes[0].resolve()
    await expect(first).rejects.toThrow('generation')
    expect(transport.writes).toHaveLength(1)
  })

  it('settles active then queued ordinary publications in order on disconnect', async () => {
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    const settled: number[] = []
    const publications = [1, 2, 3].map((id) => publisher.publish(state(String(id))).catch(() => {
      settled.push(id)
    }))

    publisher.onDisconnected(2)
    await Promise.all(publications)

    expect(settled).toEqual([1, 2, 3])
    expect(transport.writes).toHaveLength(1)
    expect(transport.maxConcurrent).toBe(1)
    transport.writes[0].resolve()
  })

  it('does not issue a concurrent shutdown write when an in-flight write stalls', async () => {
    vi.useFakeTimers()
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    const ordinary = publisher.publish(state('1'))
    const ordinaryOutcome = ordinary.then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const closing = publisher.close((current) => ({ ...current, status: 'shutting-down' }))
    await vi.advanceTimersByTimeAsync(1_000)
    await closing
    expect(await ordinaryOutcome).toContain('closed')
    expect(transport.writes).toHaveLength(1)
    expect(transport.maxConcurrent).toBe(1)
  })

  it('settles active then queued ordinary publications in order on close', async () => {
    vi.useFakeTimers()
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    const settled: number[] = []
    const publications = [1, 2, 3].map((id) => publisher.publish(state(String(id))).catch(() => {
      settled.push(id)
    }))

    const closing = publisher.close((current) => ({ ...current, status: 'shutting-down' }))
    await Promise.all(publications)

    expect(settled).toEqual([1, 2, 3])
    expect(transport.writes).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await closing
    expect(transport.writes).toHaveLength(1)
    expect(transport.maxConcurrent).toBe(1)
  })

  it('uses one idle best-effort shutdown write and returns within one second', async () => {
    vi.useFakeTimers()
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)

    const closing = publisher.close((current) => ({ ...current, status: 'shutting-down' }))
    expect(transport.writes).toHaveLength(1)
    expect(transport.writes[0].mutation(null).status).toBe('shutting-down')
    expect(transport.writes[0].generation).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await closing
    expect(transport.writes).toHaveLength(1)
    expect(transport.maxConcurrent).toBe(1)
  })

  it('drops queued health before waiting for an in-flight write and then shuts down', async () => {
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    const ordinaryOutcome = publisher.publish(state('1')).then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    publisher.publishLatest('system-health', state('2'))

    const closing = publisher.close((current) => ({ ...current, status: 'shutting-down' }))
    transport.writes[0].resolve()
    await vi.waitFor(() => expect(transport.writes).toHaveLength(2))
    expect(transport.writes[1].mutation(null).status).toBe('shutting-down')
    expect(transport.writes[1].mutation(null).pid).toBeUndefined()
    transport.writes[1].resolve()

    await closing
    expect(await ordinaryOutcome).toContain('closed')
    expect(transport.maxConcurrent).toBe(1)
  })

  it('finishes close within two seconds when both phases consume their budgets', async () => {
    vi.useFakeTimers()
    const transport = new DeferredTransport()
    const publisher = new DaemonStatePublisher(transport)
    publisher.onConnected(1)
    void publisher.publish(state('1')).catch(() => undefined)

    let closed = false
    const closing = publisher.close((current) => ({ ...current, status: 'shutting-down' })).then(() => {
      closed = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(closed).toBe(false)
    transport.writes[0].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.writes).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(closed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await closing
    expect(closed).toBe(true)
    expect(transport.maxConcurrent).toBe(1)
  })
})
