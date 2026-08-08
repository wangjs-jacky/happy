import { describe, expect, it } from 'vitest'
import { analyzeMacProcessSnapshot } from './macProcessSnapshotAnalyzer'
import type { MacProcessAnalysisInput, MacProcessStatRow } from './types'

const capturedAt = 100_000

function stat(pid: number, ppid: number, cpuPercent: number, rssKb: number, elapsedSeconds: number, state = 'S'): MacProcessStatRow {
  return { pid, ppid, cpuPercent, rssKb, elapsedSeconds, state }
}

function fixture(overrides: Partial<MacProcessAnalysisInput> = {}): MacProcessAnalysisInput {
  return {
    capturedAt,
    stats: [],
    commands: [],
    arguments: [],
    trackedRoots: [],
    previousMembership: [],
    ...overrides,
  }
}

describe('analyzeMacProcessSnapshot', () => {
  it('deduplicates nested roots and attributes descendants once', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(100, 1, 1, 100, 90), stat(110, 100, 2, 200, 80), stat(120, 110, 3, 300, 70)],
      commands: [{ pid: 100, value: 'paws' }, { pid: 110, value: 'happy' }, { pid: 120, value: 'agent' }],
      arguments: [
        { pid: 100, value: 'paws codex --started-by daemon' },
        { pid: 110, value: 'happy codex --started-by daemon' },
        { pid: 120, value: 'agent' },
      ],
      trackedRoots: [{ pid: 100, spawnedAt: 10_000, kind: 'daemon' }],
    }))
    expect(result.worker).toEqual({ rootCount: 1, processCount: 3, rssBytes: 600 * 1_024 })
  })

  it('keeps surviving descendants orphaned after their root exits', () => {
    const first = analyzeMacProcessSnapshot(fixture({
      stats: [stat(100, 1, 1, 100, 90), stat(110, 100, 2, 200, 80)],
      commands: [{ pid: 100, value: 'paws' }, { pid: 110, value: 'agent' }],
      arguments: [{ pid: 100, value: 'paws codex --started-by daemon' }, { pid: 110, value: 'agent' }],
    }))
    const second = analyzeMacProcessSnapshot(fixture({
      capturedAt: capturedAt + 10_000,
      stats: [stat(110, 1, 2, 200, 90)],
      commands: [{ pid: 110, value: 'agent' }],
      arguments: [{ pid: 110, value: 'agent' }],
      previousMembership: first.nextMembership,
    }))
    expect(second.orphans).toMatchObject({ rootCount: 1, processCount: 1 })
  })

  it('does not inherit membership when a pid is reused', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(110, 1, 0, 10, 1)],
      commands: [{ pid: 110, value: 'agent' }],
      arguments: [{ pid: 110, value: 'agent' }],
      previousMembership: [{ rootFingerprint: '100:10000', memberFingerprints: ['110:20000'] }],
    }))
    expect(result.orphans.processCount).toBe(0)
  })

  it('attributes a daemon worker below a tracked tmux pane', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(50, 1, 0, 10, 90), stat(60, 50, 1, 20, 80)],
      commands: [{ pid: 50, value: 'tmux' }, { pid: 60, value: 'paws' }],
      arguments: [{ pid: 50, value: 'tmux pane' }, { pid: 60, value: 'paws codex --started-by=daemon' }],
      trackedRoots: [{ pid: 50, spawnedAt: 10_000, kind: 'tmux' }],
    }))
    expect(result.worker).toEqual({ rootCount: 1, processCount: 1, rssBytes: 20 * 1_024 })
    expect(result.orphans.processCount).toBe(0)
  })

  it('does not treat marker-like substrings as daemon sessions', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(70, 1, 1, 10, 5)],
      commands: [{ pid: 70, value: 'paws' }],
      arguments: [{ pid: 70, value: 'paws codex --started-by daemonized' }],
    }))
    expect(result.orphans.processCount).toBe(0)
  })

  it('counts zombie processes and groups them by sanitized source', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(20, 1, 0, 0, 100, 'Z+'), stat(21, 1, 2, 20, 20)],
      commands: [{ pid: 20, value: '/Applications/Sample Helper' }, { pid: 21, value: '/usr/bin/mds' }],
      arguments: [{ pid: 20, value: '--private /tmp/secret' }, { pid: 21, value: 'mds' }],
    }))
    expect(result.zombieProcessCount).toBe(1)
    expect(result.sources).toContainEqual(expect.objectContaining({ name: 'Sample Helper', zombieProcessCount: 1 }))
    expect(JSON.stringify(result)).not.toContain('/tmp/secret')
  })

  it('recognizes daemon marker boundaries and stable known/unknown source ids', () => {
    const base = fixture({
      stats: [stat(30, 1, 1, 10, 5), stat(31, 1, 1, 10, 5)],
      commands: [{ pid: 30, value: 'Google Chrome Helper' }, { pid: 31, value: '/opt/tools/custom-worker' }],
      arguments: [{ pid: 30, value: '' }, { pid: 31, value: '' }],
    })
    const first = analyzeMacProcessSnapshot(base)
    const second = analyzeMacProcessSnapshot(base)
    expect(first.sources.find((source) => source.name === 'Chrome')?.id).toBe('chrome')
    expect(first.sources.find((source) => source.name === 'custom-worker')?.id)
      .toBe(second.sources.find((source) => source.name === 'custom-worker')?.id)
  })
})
