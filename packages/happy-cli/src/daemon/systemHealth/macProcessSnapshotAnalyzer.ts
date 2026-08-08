import { createHash } from 'node:crypto'
import type { SystemHealthSource } from '@/api/types'
import type {
  MacProcessAnalysisInput,
  MacProcessAnalysisResult,
  MacProcessStatRow,
  WorkerMembership,
} from './types'

interface JoinedProcess extends MacProcessStatRow {
  comm: string
  args: string
  fingerprint: string
}

const DAEMON_MARKER = /(?:^|\s)--started-by(?:=daemon|\s+daemon)(?=\s|$)/
const AGENT_SUBCOMMAND = /(?:^|\s)(?:claude|codex|gemini|opencode|openclaw)(?=\s|$)/
const CLI_SCRIPT = /(?:^|\s)(?:\S*\/(?:happy|paws)\.mjs|\S*\/dist\/index\.mjs)(?=\s|$)/
const SOURCE_CATEGORY_LIMIT = 8

function safeBasename(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1).trim()
  return (name || 'Other').slice(0, 40)
}

function sourceIdentity(comm: string): { id: string; name: string } {
  const name = safeBasename(comm)
  if (/^Google Chrome(?: Helper.*)?$/i.test(name)) return { id: 'chrome', name: 'Chrome' }
  if (/^Cursor(?: Helper.*)?$/i.test(name)) return { id: 'cursor', name: 'Cursor' }
  if (/^(?:mds|mds_stores)$/i.test(name)) return { id: 'spotlight', name: 'Spotlight' }
  return {
    id: `process:${createHash('sha256').update(comm).digest('hex').slice(0, 12)}`,
    name,
  }
}

function birthFingerprint(row: MacProcessStatRow, capturedAt: number): string {
  const startedAt = row.elapsedSeconds === undefined
    ? capturedAt
    : Math.round((capturedAt - row.elapsedSeconds * 1_000) / 2_000) * 2_000
  return `${row.pid}:${startedAt}`
}

function isWorkerCandidate(process: JoinedProcess): boolean {
  if (!DAEMON_MARKER.test(process.args)) return false
  const basename = safeBasename(process.comm).toLowerCase()
  if (basename === 'paws' || basename === 'happy') return true
  return basename === 'node' && CLI_SCRIPT.test(process.args) && AGENT_SUBCOMMAND.test(process.args)
}

function hasAncestor(pid: number, ancestorPid: number, byPid: Map<number, JoinedProcess>): boolean {
  const visited = new Set<number>()
  let current = byPid.get(pid)
  while (current && current.ppid > 0 && !visited.has(current.ppid)) {
    if (current.ppid === ancestorPid) return true
    visited.add(current.ppid)
    current = byPid.get(current.ppid)
  }
  return false
}

function descendants(rootPid: number, processes: JoinedProcess[]): JoinedProcess[] {
  const included = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const process of processes) {
      if (!included.has(process.pid) && included.has(process.ppid)) {
        included.add(process.pid)
        changed = true
      }
    }
  }
  return processes.filter((process) => included.has(process.pid))
}

function emptyAggregate() {
  return { rootCount: 0, processCount: 0, rssBytes: 0 }
}

function selectRelevantSources(sources: SystemHealthSource[]): SystemHealthSource[] {
  const selected = new Map<string, SystemHealthSource>()
  const add = (items: SystemHealthSource[]) => {
    for (const source of items.slice(0, SOURCE_CATEGORY_LIMIT)) selected.set(source.id, source)
  }

  add([...sources].sort((a, b) => b.cpuPercent - a.cpuPercent))
  add([...sources].sort((a, b) => b.rssBytes - a.rssBytes))
  add(sources
    .filter((source) => source.zombieProcessCount > 0)
    .sort((a, b) => b.zombieProcessCount - a.zombieProcessCount))

  const pawsWorkers = sources.find((source) => source.id === 'paws-workers')
  if (pawsWorkers) selected.set(pawsWorkers.id, pawsWorkers)
  return [...selected.values()]
}

export function analyzeMacProcessSnapshot(input: MacProcessAnalysisInput): MacProcessAnalysisResult {
  const commByPid = new Map(input.commands.map((row) => [row.pid, row.value]))
  const argsByPid = new Map(input.arguments.map((row) => [row.pid, row.value]))
  const processes: JoinedProcess[] = input.stats.map((row) => ({
    ...row,
    comm: commByPid.get(row.pid) ?? '',
    args: argsByPid.get(row.pid) ?? '',
    fingerprint: birthFingerprint(row, input.capturedAt),
  }))
  const byPid = new Map(processes.map((process) => [process.pid, process]))
  const fingerprintMap = new Map(processes.map((process) => [process.fingerprint, process]))

  const candidateRoots = processes
    .filter(isWorkerCandidate)
    .filter((candidate) => !processes.some((other) => other.pid !== candidate.pid && isWorkerCandidate(other) && hasAncestor(candidate.pid, other.pid, byPid)))

  const normalRoots: JoinedProcess[] = []
  const orphanRoots: JoinedProcess[] = []
  for (const candidate of candidateRoots) {
    const tracked = input.trackedRoots.some((root) => {
      if (root.kind === 'tmux') return root.pid === candidate.pid || hasAncestor(candidate.pid, root.pid, byPid)
      if (root.pid !== candidate.pid) return false
      const startedAt = Number(candidate.fingerprint.split(':')[1])
      return Number.isFinite(startedAt) && Math.abs(startedAt - root.spawnedAt) <= 5_000
    })
    ;(tracked ? normalRoots : orphanRoots).push(candidate)
  }

  const previousRemainders: Array<{ root: JoinedProcess; members: JoinedProcess[] }> = []
  for (const membership of input.previousMembership) {
    if (fingerprintMap.has(membership.rootFingerprint)) continue
    const surviving = membership.memberFingerprints
      .map((fingerprint) => fingerprintMap.get(fingerprint))
      .filter((process): process is JoinedProcess => process !== undefined)
    if (surviving.length === 0) continue
    const survivingPids = new Set(surviving.map((process) => process.pid))
    const root = surviving.find((process) => !survivingPids.has(process.ppid)) ?? surviving[0]
    previousRemainders.push({ root, members: surviving })
  }

  const normalTrees = normalRoots.map((root) => ({ root, members: descendants(root.pid, processes) }))
  const orphanTrees = [
    ...orphanRoots.map((root) => ({ root, members: descendants(root.pid, processes) })),
    ...previousRemainders,
  ]
  const workerPids = new Set(normalTrees.flatMap((tree) => tree.members.map((process) => process.pid)))
  const orphanPids = new Set(orphanTrees.flatMap((tree) => tree.members.map((process) => process.pid)))

  const aggregate = (trees: Array<{ members: JoinedProcess[] }>) => ({
    rootCount: trees.length,
    processCount: new Set(trees.flatMap((tree) => tree.members.map((process) => process.pid))).size,
    rssBytes: trees.flatMap((tree) => tree.members)
      .filter((process, index, all) => all.findIndex((item) => item.pid === process.pid) === index)
      .reduce((total, process) => total + process.rssKb * 1_024, 0),
  })

  const sourceMap = new Map<string, SystemHealthSource>()
  for (const process of processes) {
    const identity = workerPids.has(process.pid) || orphanPids.has(process.pid)
      ? { id: 'paws-workers', name: 'Paws Workers' }
      : sourceIdentity(process.comm)
    const existing = sourceMap.get(identity.id) ?? {
      ...identity,
      cpuPercent: 0,
      rssBytes: 0,
      processCount: 0,
      zombieProcessCount: 0,
    }
    existing.cpuPercent += process.cpuPercent
    existing.rssBytes += process.rssKb * 1_024
    existing.processCount += 1
    if (process.state.startsWith('Z')) existing.zombieProcessCount += 1
    if (process.elapsedSeconds !== undefined) {
      existing.oldestProcessAgeSeconds = Math.max(existing.oldestProcessAgeSeconds ?? 0, process.elapsedSeconds)
    }
    sourceMap.set(identity.id, existing)
  }

  const nextMembership: WorkerMembership[] = [...normalTrees, ...orphanTrees].map((tree) => ({
    rootFingerprint: tree.root.fingerprint,
    memberFingerprints: tree.members.map((process) => process.fingerprint),
  }))

  return {
    worker: normalTrees.length > 0 ? aggregate(normalTrees) : emptyAggregate(),
    orphans: orphanTrees.length > 0 ? aggregate(orphanTrees) : emptyAggregate(),
    zombieProcessCount: processes.filter((process) => process.state.startsWith('Z')).length,
    sources: selectRelevantSources([...sourceMap.values()]),
    nextMembership,
  }
}
