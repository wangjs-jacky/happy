import { createHash } from 'node:crypto'
import type { SystemHealthSource } from '@/api/types'
import type {
  MacProcessAnalysisInput,
  MacProcessAnalysisResult,
  MacProcessStatRow,
  PreviousRootMembership,
  TrackedProcessRoot,
} from './types'

interface JoinedProcess extends MacProcessStatRow {
  comm: string
  args: string
  fingerprint?: string
}

interface FingerprintedProcess extends JoinedProcess {
  fingerprint: string
}

interface ProcessTree {
  root: FingerprintedProcess
  members: FingerprintedProcess[]
}

const DAEMON_MARKER = /(?:^|\s)--started-by(?:=daemon|\s+daemon)(?=\s|$)/
const AGENT_SUBCOMMAND = /(?:^|\s)(?:ask|claude|codex|gemini|opencode|openclaw)(?=\s|$)/
const CLI_SCRIPT = /(?:^|\s)(?:\S*\/(?:happy|paws)\.mjs|(?:\S*\/)?dist\/index\.mjs)(?=\s|$)/

function roundTo2Seconds(value: number): number {
  return Math.round(value / 2_000) * 2_000
}

function safeBasename(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/')
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  const name = basename.replace(/[\u0000-\u001F\u007F]/g, ' ').trim()
  return (name || 'Other').slice(0, 40)
}

function sourceIdentity(comm: string): { id: string; name: string } {
  const name = safeBasename(comm)
  if (/^Google Chrome(?: Helper.*)?$/i.test(name)) return { id: 'chrome', name: 'Chrome' }
  if (/^Cursor(?: Helper.*)?$/i.test(name)) return { id: 'cursor', name: 'Cursor' }
  if (/^(?:mds|mds_stores|mdworker|mdworker_shared)$/i.test(name)) return { id: 'spotlight', name: 'Spotlight' }
  if (name === 'Other') return { id: 'other', name }
  return {
    id: `process:${createHash('sha256').update(comm).digest('hex').slice(0, 12)}`,
    name,
  }
}

function birthFingerprint(row: MacProcessStatRow, capturedAt: number): string | undefined {
  if (row.elapsedSeconds === undefined || !Number.isFinite(row.elapsedSeconds) || row.elapsedSeconds < 0) return undefined
  if (!Number.isFinite(capturedAt)) return undefined
  return `${row.pid}:${roundTo2Seconds(capturedAt - row.elapsedSeconds * 1_000)}`
}

function trackedFingerprint(root: TrackedProcessRoot): string {
  return `${root.pid}:${roundTo2Seconds(root.spawnedAt)}`
}

function hasFingerprint(process: JoinedProcess): process is FingerprintedProcess {
  return process.fingerprint !== undefined
}

function isWorkerCandidate(process: JoinedProcess): boolean {
  const basename = safeBasename(process.comm).toLowerCase()
  if (basename === 'paws' || basename === 'happy') return true
  return basename === 'node' && CLI_SCRIPT.test(process.args) && AGENT_SUBCOMMAND.test(process.args)
}

function isDaemonCandidate(process: JoinedProcess): boolean {
  return isWorkerCandidate(process) && DAEMON_MARKER.test(process.args)
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

function isSelfOrDescendant(pid: number, rootPid: number, byPid: Map<number, JoinedProcess>): boolean {
  return pid === rootPid || hasAncestor(pid, rootPid, byPid)
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

function deduplicateRoots(roots: FingerprintedProcess[], byPid: Map<number, JoinedProcess>): FingerprintedProcess[] {
  const unique = [...new Map(roots.map((root) => [root.fingerprint, root])).values()]
  return unique.filter((root) => !unique.some((other) => (
    other.pid !== root.pid && hasAncestor(root.pid, other.pid, byPid)
  )))
}

function treesFromRoots(
  roots: FingerprintedProcess[],
  processes: JoinedProcess[],
  excludedPids: ReadonlySet<number> = new Set(),
): ProcessTree[] {
  return roots.map((root) => ({
    root,
    members: descendants(root.pid, processes)
      .filter(hasFingerprint)
      .filter((process) => !excludedPids.has(process.pid)),
  })).filter((tree) => tree.members.some((process) => process.pid === tree.root.pid))
}

function emptyAggregate() {
  return { rootCount: 0, processCount: 0, rssBytes: 0 }
}

function aggregate(trees: ProcessTree[]) {
  const members = [...new Map(
    trees.flatMap((tree) => tree.members).map((process) => [process.fingerprint, process]),
  ).values()]
  return {
    rootCount: trees.length,
    processCount: members.length,
    rssBytes: members.reduce((total, process) => total + process.rssKb * 1_024, 0),
  }
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
  const byFingerprint = new Map(
    processes.filter(hasFingerprint).map((process) => [process.fingerprint, process]),
  )

  const trackedRoots: FingerprintedProcess[] = []
  for (const tracked of input.trackedRoots) {
    const pane = byPid.get(tracked.pid)
    if (!pane || !hasFingerprint(pane) || pane.fingerprint !== trackedFingerprint(tracked)) continue
    if (tracked.kind === 'daemon') {
      trackedRoots.push(pane)
      continue
    }
    trackedRoots.push(...processes.filter(hasFingerprint).filter((process) => (
      isWorkerCandidate(process) && isSelfOrDescendant(process.pid, pane.pid, byPid)
    )))
  }
  const normalRoots = deduplicateRoots(trackedRoots, byPid)
  const normalTrees = treesFromRoots(normalRoots, processes)
  const workerPids = new Set(normalTrees.flatMap((tree) => tree.members.map((process) => process.pid)))

  const daemonRoots = deduplicateRoots(
    processes.filter(hasFingerprint)
      .filter((process) => isDaemonCandidate(process) && !workerPids.has(process.pid)),
    byPid,
  )
  const previousRoots: FingerprintedProcess[] = []
  for (const membership of input.previousMembership) {
    const membershipFingerprints = new Set([
      membership.rootFingerprint,
      ...membership.memberFingerprints,
    ])
    const surviving = [...membershipFingerprints]
      .map((fingerprint) => byFingerprint.get(fingerprint))
      .filter((process): process is FingerprintedProcess => process !== undefined && !workerPids.has(process.pid))
    const survivingPids = new Set(surviving.map((process) => process.pid))
    previousRoots.push(...surviving.filter((process) => !survivingPids.has(process.ppid)))
  }

  const orphanRoots = deduplicateRoots([...daemonRoots, ...previousRoots], byPid)
  const orphanTrees = treesFromRoots(orphanRoots, processes, workerPids)
  const orphanPids = new Set(orphanTrees.flatMap((tree) => tree.members.map((process) => process.pid)))

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

  const nextMembership: PreviousRootMembership[] = [...normalTrees, ...orphanTrees].map((tree) => ({
    rootFingerprint: tree.root.fingerprint,
    memberFingerprints: tree.members.map((process) => process.fingerprint),
  }))

  return {
    worker: normalTrees.length > 0 ? aggregate(normalTrees) : emptyAggregate(),
    orphans: orphanTrees.length > 0 ? aggregate(orphanTrees) : emptyAggregate(),
    zombieProcessCount: processes.filter((process) => process.state.startsWith('Z')).length,
    sources: [...sourceMap.values()],
    nextMembership,
  }
}
