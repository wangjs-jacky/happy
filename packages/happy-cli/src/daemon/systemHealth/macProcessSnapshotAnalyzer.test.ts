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
  it('deduplicates nested tracked roots and attributes every descendant once', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(100, 1, 1, 100, 90), stat(110, 100, 2, 200, 80), stat(120, 110, 3, 300, 70)],
      commands: [{ pid: 100, value: 'node' }, { pid: 110, value: 'tmux' }, { pid: 120, value: 'node' }],
      arguments: [
        { pid: 100, value: 'node happy daemon' },
        { pid: 110, value: 'tmux new-session' },
        { pid: 120, value: 'node claude' },
      ],
      trackedRoots: [
        { pid: 100, spawnedAt: 10_000, kind: 'daemon' },
        { pid: 110, spawnedAt: 20_000, kind: 'tmux' },
      ],
    }))

    expect(result.worker).toEqual({ rootCount: 1, processCount: 3, rssBytes: 600 * 1_024 })
    expect(result.nextMembership).toHaveLength(1)
    expect(result.nextMembership[0]?.rootFingerprint).toBe('100:10000')
    expect(result.sources).toContainEqual(expect.objectContaining({
      id: 'paws-workers',
      name: 'Paws Workers',
      processCount: 3,
    }))
  })

  it('keeps surviving descendants orphaned and absorbs their new descendants after the tracked root exits', () => {
    const first = analyzeMacProcessSnapshot(fixture({
      stats: [stat(100, 1, 1, 100, 90), stat(110, 100, 2, 200, 80)],
      commands: [{ pid: 100, value: 'node' }, { pid: 110, value: 'agent' }],
      arguments: [{ pid: 100, value: 'node happy daemon' }, { pid: 110, value: 'agent' }],
      trackedRoots: [{ pid: 100, spawnedAt: 10_000, kind: 'daemon' }],
    }))
    const second = analyzeMacProcessSnapshot(fixture({
      capturedAt: capturedAt + 10_000,
      stats: [stat(110, 1, 2, 200, 90), stat(120, 110, 3, 300, 5)],
      commands: [{ pid: 110, value: 'agent' }, { pid: 120, value: 'agent-helper' }],
      arguments: [{ pid: 110, value: 'agent' }, { pid: 120, value: 'agent-helper' }],
      previousMembership: first.nextMembership,
    }))

    expect(second.orphans).toEqual({ rootCount: 1, processCount: 2, rssBytes: 500 * 1_024 })
    expect(second.nextMembership[0]?.memberFingerprints).toHaveLength(2)
  })

  it('keeps promoted orphan membership across snapshots until the last member exits', () => {
    const first = analyzeMacProcessSnapshot(fixture({
      stats: [stat(100, 1, 1, 100, 90), stat(110, 100, 2, 200, 80)],
      commands: [{ pid: 100, value: 'node' }, { pid: 110, value: 'agent' }],
      arguments: [{ pid: 100, value: 'node happy daemon' }, { pid: 110, value: 'agent' }],
      trackedRoots: [{ pid: 100, spawnedAt: 10_000, kind: 'daemon' }],
    }))
    const second = analyzeMacProcessSnapshot(fixture({
      capturedAt: capturedAt + 10_000,
      stats: [stat(110, 1, 2, 200, 90)],
      commands: [{ pid: 110, value: 'agent' }],
      arguments: [{ pid: 110, value: 'agent' }],
      previousMembership: first.nextMembership,
    }))
    const third = analyzeMacProcessSnapshot(fixture({
      capturedAt: capturedAt + 20_000,
      stats: [stat(110, 1, 2, 200, 100)],
      commands: [{ pid: 110, value: 'agent' }],
      arguments: [{ pid: 110, value: 'agent' }],
      previousMembership: second.nextMembership,
    }))
    const final = analyzeMacProcessSnapshot(fixture({
      capturedAt: capturedAt + 30_000,
      previousMembership: third.nextMembership,
    }))

    expect(second.orphans).toEqual({ rootCount: 1, processCount: 1, rssBytes: 200 * 1_024 })
    expect(third.orphans).toEqual({ rootCount: 1, processCount: 1, rssBytes: 200 * 1_024 })
    expect(final.orphans).toEqual({ rootCount: 0, processCount: 0, rssBytes: 0 })
    expect(final.nextMembership).toEqual([])
  })

  it('does not inherit previous membership when a pid is reused with a different birth fingerprint', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(110, 1, 0, 10, 1)],
      commands: [{ pid: 110, value: 'agent' }],
      arguments: [{ pid: 110, value: 'agent' }],
      previousMembership: [{ rootFingerprint: '100:10000', memberFingerprints: ['110:20000'] }],
    }))

    expect(result.orphans.processCount).toBe(0)
  })

  it('fails closed for ownership and membership when elapsed time is missing', () => {
    const rowWithoutElapsed: MacProcessStatRow = {
      pid: 100,
      ppid: 1,
      cpuPercent: 1,
      rssKb: 10,
      state: 'S',
    }
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [rowWithoutElapsed],
      commands: [{ pid: 100, value: 'paws' }],
      arguments: [{ pid: 100, value: 'paws codex --started-by daemon' }],
      trackedRoots: [{ pid: 100, spawnedAt: 10_000, kind: 'daemon' }],
    }))

    expect(result.worker.processCount).toBe(0)
    expect(result.orphans.processCount).toBe(0)
    expect(result.nextMembership).toEqual([])
  })

  it('requires the tracked daemon pid birth fingerprint to match', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(100, 1, 1, 10, 86)],
      commands: [{ pid: 100, value: 'paws' }],
      arguments: [{ pid: 100, value: 'paws codex --started-by daemon' }],
      trackedRoots: [{ pid: 100, spawnedAt: 10_000, kind: 'daemon' }],
    }))

    expect(result.worker.processCount).toBe(0)
    expect(result.orphans.processCount).toBe(1)
  })

  it('attributes only candidates on the verified tracked tmux pane ancestor chain', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [
        stat(50, 1, 0, 10, 90),
        stat(55, 50, 0, 5, 85),
        stat(60, 55, 1, 20, 80),
        stat(70, 1, 2, 30, 70),
      ],
      commands: [
        { pid: 50, value: 'tmux' },
        { pid: 55, value: 'sh' },
        { pid: 60, value: 'node' },
        { pid: 70, value: 'paws' },
      ],
      arguments: [
        { pid: 50, value: 'tmux pane' },
        { pid: 55, value: 'sh' },
        { pid: 60, value: 'node /opt/paws/dist/index.mjs codex --started-by=daemon' },
        { pid: 70, value: 'paws codex --started-by=daemon' },
      ],
      trackedRoots: [{ pid: 50, spawnedAt: 10_000, kind: 'tmux' }],
    }))

    expect(result.worker).toEqual({ rootCount: 1, processCount: 1, rssBytes: 20 * 1_024 })
    expect(result.orphans).toEqual({ rootCount: 1, processCount: 1, rssBytes: 30 * 1_024 })
  })

  it('does not trust a reused tracked tmux pane pid', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(50, 1, 0, 10, 86), stat(60, 50, 1, 20, 80)],
      commands: [{ pid: 50, value: 'tmux' }, { pid: 60, value: 'paws' }],
      arguments: [{ pid: 50, value: 'tmux pane' }, { pid: 60, value: 'paws codex --started-by=daemon' }],
      trackedRoots: [{ pid: 50, spawnedAt: 10_000, kind: 'tmux' }],
    }))

    expect(result.worker.processCount).toBe(0)
    expect(result.orphans.processCount).toBe(1)
  })

  it('accepts only exact daemon marker forms and excludes manual terminal sessions', () => {
    const rows = [
      ['paws codex --started-by daemon', true],
      ['paws codex --started-by=daemon', true],
      ['paws codex --started-by daemonized', false],
      ['paws codex --started-by=daemonized', false],
      ['paws codex x--started-by daemon', false],
      ['paws codex', false],
    ] as const

    for (const [args, expected] of rows) {
      const result = analyzeMacProcessSnapshot(fixture({
        stats: [stat(70, 1, 1, 10, 5)],
        commands: [{ pid: 70, value: 'paws' }],
        arguments: [{ pid: 70, value: args }],
      }))
      expect(result.orphans.processCount, args).toBe(expected ? 1 : 0)
    }
  })

  it('requires an exact cli basename or a known node script and agent subcommand', () => {
    const processes = [
      { pid: 10, comm: 'paws-helper', args: 'paws-helper codex --started-by daemon' },
      { pid: 11, comm: 'node', args: 'node /opt/paws/dist/index.mjs unknown --started-by daemon' },
      { pid: 12, comm: 'node', args: 'node /opt/paws/dist/index.mjs codex --started-by daemon' },
      { pid: 13, comm: 'node', args: 'node dist/index.mjs ask --started-by daemon' },
    ]
    const result = analyzeMacProcessSnapshot(fixture({
      stats: processes.map((process) => stat(process.pid, 1, 1, 10, 5)),
      commands: processes.map((process) => ({ pid: process.pid, value: process.comm })),
      arguments: processes.map((process) => ({ pid: process.pid, value: process.args })),
    }))

    expect(result.orphans).toEqual({ rootCount: 2, processCount: 2, rssBytes: 20 * 1_024 })
  })

  it('aggregates known and unknown sources with cpu, rss, age, and zombie counts', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [
        stat(20, 1, 1.25, 10, 100, 'Z+'),
        stat(21, 1, 2.5, 20, 20),
        stat(22, 1, 3, 30, 30),
        stat(23, 1, 4, 40, 40),
        stat(24, 1, 5, 50, 50),
      ],
      commands: [
        { pid: 20, value: '/Applications/Google Chrome Helper' },
        { pid: 21, value: '/Applications/Google Chrome Helper' },
        { pid: 22, value: '/Applications/Cursor Helper' },
        { pid: 23, value: '/System/Library/mdworker_shared' },
        { pid: 24, value: '/opt/tools/custom-worker' },
      ],
      arguments: [
        { pid: 20, value: '--private /tmp/secret' },
        { pid: 21, value: '' },
        { pid: 22, value: '' },
        { pid: 23, value: '' },
        { pid: 24, value: '' },
      ],
    }))

    expect(result.zombieProcessCount).toBe(1)
    expect(result.sources).toContainEqual({
      id: 'chrome',
      name: 'Chrome',
      cpuPercent: 3.75,
      rssBytes: 30 * 1_024,
      processCount: 2,
      zombieProcessCount: 1,
      oldestProcessAgeSeconds: 100,
    })
    expect(result.sources).toContainEqual(expect.objectContaining({ id: 'cursor', name: 'Cursor' }))
    expect(result.sources).toContainEqual(expect.objectContaining({ id: 'spotlight', name: 'Spotlight' }))
    expect(result.sources).toContainEqual(expect.objectContaining({
      id: 'process:584d155a55a1',
      name: 'custom-worker',
    }))
  })

  it('uses a safe basename capped at 40 characters for unknown source names', () => {
    const basename = 'a'.repeat(45)
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(30, 1, 1, 10, 5)],
      commands: [{ pid: 30, value: `/Users/jacky/private-project/${basename}` }],
      arguments: [{ pid: 30, value: '/Users/jacky/private-project/secret-token' }],
    }))

    expect(result.sources[0]?.name).toBe('a'.repeat(40))
    expect(result.sources[0]?.name).toHaveLength(40)
  })

  it('returns every sanitized source and leaves top-five selection to the monitor', () => {
    const processes = Array.from({ length: 30 }, (_, index) => ({
      pid: index + 100,
      comm: `/usr/bin/process-${index}`,
    }))
    const result = analyzeMacProcessSnapshot(fixture({
      stats: processes.map((process) => stat(process.pid, 1, process.pid, 10, 5)),
      commands: processes.map((process) => ({ pid: process.pid, value: process.comm })),
      arguments: processes.map((process) => ({ pid: process.pid, value: '' })),
    }))

    expect(result.sources).toHaveLength(30)
  })

  it('never serializes raw process fields, command lines, or user paths', () => {
    const result = analyzeMacProcessSnapshot(fixture({
      stats: [stat(100, 1, 1, 10, 90), stat(200, 1, 1, 10, 5)],
      commands: [
        { pid: 100, value: '/usr/local/bin/paws' },
        { pid: 200, value: '/Users/jacky/private-project/private-worker' },
      ],
      arguments: [
        { pid: 100, value: 'paws codex --started-by daemon --config /Users/jacky/private-project/key' },
        { pid: 200, value: 'private-worker --token /Users/jacky/private-project/key' },
      ],
    }))
    const json = JSON.stringify(result)

    expect(json).not.toMatch(/"(?:pid|ppid|comm|args)":/)
    expect(json).not.toContain('/Users/jacky/private-project')
    expect(json).not.toContain('--token')
  })
})
