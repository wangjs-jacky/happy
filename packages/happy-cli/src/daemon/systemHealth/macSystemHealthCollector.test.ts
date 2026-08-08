import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MacSystemHealthCollector, parseElapsedSeconds, type ExecFileAdapter } from './macSystemHealthCollector'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8')

const outputs = new Map<string, string>([
  ['/usr/sbin/sysctl -n hw.ncpu hw.memsize vm.loadavg vm.swapusage', fixture('sysctl.txt')],
  ['/bin/launchctl limit maxproc', 'maxproc 4000 unlimited\n'],
  ['/usr/bin/top -l 2 -s 0 -n 0', fixture('top.txt')],
  ['/usr/bin/vm_stat ', fixture('vm_stat.txt')],
  ['/usr/bin/memory_pressure -Q', fixture('memory_pressure.txt')],
  ['/bin/ps -A -ww -o pid= -o ppid= -o pcpu= -o rss= -o state= -o etime=', fixture('ps_stats.txt')],
  ['/bin/ps -A -ww -o pid= -o comm=', fixture('ps_comm.txt')],
  ['/bin/ps -A -ww -o pid= -o args=', fixture('ps_args.txt')],
  ['/bin/df -kP /', fixture('df.txt')],
])

function fakeExec(
  failures = new Map<string, unknown>(),
  commandOutputs: ReadonlyMap<string, string> = outputs,
) {
  const calls: Array<{ file: string; args: string[]; options: Parameters<ExecFileAdapter>[2] }> = []
  const exec: ExecFileAdapter = async (file, args, options) => {
    const key = `${file} ${args.join(' ')}`
    calls.push({ file, args, options })
    const failure = failures.get(key)
    if (failure) throw failure
    const stdout = commandOutputs.get(key)
    if (stdout === undefined) throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' })
    return { stdout, stderr: '' }
  }
  return { exec, calls }
}

describe('MacSystemHealthCollector', () => {
  it('runs only absolute command contracts and parses a complete sample', async () => {
    const fake = fakeExec()
    const collector = new MacSystemHealthCollector(fake.exec, () => 100_000)
    const result = await collector.collect({ trackedRoots: [{ pid: 100, spawnedAt: 10_000, kind: 'daemon' }] })

    expect(result.kind).toBe('complete')
    expect(result.values).toMatchObject({
      cpuUsedPercent: 27.5,
      cpuCores: 10,
      load1: 3.2,
      load5: 2.8,
      load15: 2.2,
      memoryTotalBytes: 17_179_869_184,
      memoryAvailableBytes: (1_000 + 2_000 + 50) * 16_384,
      memoryCompressedBytes: 500 * 16_384,
      swapUsedBytes: 512 * 1024 ** 2,
      swapTotalBytes: 4_096 * 1024 ** 2,
      memoryPressureFreePercent: 31,
      diskTotalBytes: 488_245_288 * 1024,
      diskFreeBytes: 300_000_000 * 1024,
      processCount: 4,
      processLimit: 4_000,
      zombieProcessCount: 2,
      pawsWorkerRoots: 1,
    })
    expect(JSON.stringify(result)).not.toContain('/tmp/secret')
    expect(JSON.stringify(result)).not.toContain('/Applications/Sample Helper')
    expect(fake.calls.map(({ file, args }) => ({ file, args }))).toEqual([
      { file: '/usr/sbin/sysctl', args: ['-n', 'hw.ncpu', 'hw.memsize', 'vm.loadavg', 'vm.swapusage'] },
      { file: '/bin/launchctl', args: ['limit', 'maxproc'] },
      { file: '/usr/bin/top', args: ['-l', '2', '-s', '0', '-n', '0'] },
      { file: '/usr/bin/vm_stat', args: [] },
      { file: '/usr/bin/memory_pressure', args: ['-Q'] },
      { file: '/bin/ps', args: ['-A', '-ww', '-o', 'pid=', '-o', 'ppid=', '-o', 'pcpu=', '-o', 'rss=', '-o', 'state=', '-o', 'etime='] },
      { file: '/bin/ps', args: ['-A', '-ww', '-o', 'pid=', '-o', 'comm='] },
      { file: '/bin/ps', args: ['-A', '-ww', '-o', 'pid=', '-o', 'args='] },
      { file: '/bin/df', args: ['-kP', '/'] },
    ])
    expect(fake.calls.every(({ file }) => file.startsWith('/'))).toBe(true)
    expect(fake.calls.every(({ options }) => (
      options.timeout === 5_000
      && options.killSignal === 'SIGKILL'
      && options.maxBuffer === 4 * 1024 * 1024
      && options.env.LC_ALL === 'C'
      && options.env.LANG === 'C'
    ))).toBe(true)
  })

  it('parses all supported elapsed-time layouts and rejects invalid values', () => {
    expect(parseElapsedSeconds('01:30')).toBe(90)
    expect(parseElapsedSeconds('01:01:30')).toBe(3_690)
    expect(parseElapsedSeconds('02-03:04:05')).toBe(183_845)
    expect(parseElapsedSeconds('01:60')).toBeUndefined()
    expect(parseElapsedSeconds('not-a-time')).toBeUndefined()
  })

  it('keeps optional command failures out of core values without faking zero', async () => {
    const fake = fakeExec(new Map<string, unknown>([
      ['/usr/bin/memory_pressure -Q', Object.assign(new Error('timeout'), { killed: true, stderr: 'private' })],
      ['/bin/df -kP /', Object.assign(new Error('exit'), { code: 'EFAIL', stderr: 'private' })],
    ]))
    const result = await new MacSystemHealthCollector(fake.exec, () => 100_000).collect({ trackedRoots: [] })
    expect(result.kind).toBe('complete')
    expect(result.values.memoryPressureFreePercent).toBeUndefined()
    expect(result.values.diskFreeBytes).toBeUndefined()
    expect(result.values.diskTotalBytes).toBeUndefined()
    expect(result.commandErrors).toContainEqual({ command: 'memory_pressure', code: 'timeout' })
    expect(result.commandErrors).toContainEqual({ command: 'df', code: 'exit' })
    expect(JSON.stringify(result.commandErrors)).not.toContain('stderr')
  })

  it('keeps process metrics when a text table fails and joins remaining rows by PID', async () => {
    const custom = new Map(outputs)
    custom.set('/bin/ps -A -ww -o pid= -o comm=', [
      ' 120 /usr/bin/mds',
      ' 100 /opt/tools/paws',
      ' 999 /Applications/Already Exited',
    ].join('\n'))
    custom.set('/bin/ps -A -ww -o pid= -o args=', [
      ' 100 paws codex --started-by daemon',
      ' 120 /usr/bin/mds',
    ].join('\n'))
    const result = await new MacSystemHealthCollector(
      fakeExec(new Map(), custom).exec,
      () => 100_000,
    ).collect({ trackedRoots: [{ pid: 100, spawnedAt: 10_000, kind: 'daemon' }] })

    expect(result.kind).toBe('complete')
    expect(result.values.processCount).toBe(4)
    expect(result.values.zombieProcessCount).toBe(2)
    expect(result.values.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'paws-workers', processCount: 3 }),
    ]))

    const failedComm = await new MacSystemHealthCollector(
      fakeExec(new Map([['/bin/ps -A -ww -o pid= -o comm=', Object.assign(new Error('exit'), { code: 'EFAIL' })]])).exec,
      () => 100_000,
    ).collect({ trackedRoots: [{ pid: 100, spawnedAt: 10_000, kind: 'daemon' }] })
    expect(failedComm.kind).toBe('complete')
    expect(failedComm.values.processCount).toBe(4)
    expect(failedComm.commandErrors).toContainEqual({ command: 'ps', code: 'exit' })
  })

  it('uses only the second top sample and records malformed successful output', async () => {
    const custom = new Map(outputs)
    custom.set('/usr/bin/top -l 2 -s 0 -n 0', 'CPU usage: 10.0% user, 5.0% sys, 85.0% idle\n')
    const result = await new MacSystemHealthCollector(fakeExec(new Map(), custom).exec, () => 100_000)
      .collect({ trackedRoots: [] })
    expect(result.kind).toBe('partial')
    expect(result.values.cpuUsedPercent).toBeUndefined()
    expect(result.commandErrors).toContainEqual({ command: 'top', code: 'parse' })
  })

  it('uses the reported vm page size and rejects malformed locale-dependent numbers', async () => {
    const custom = new Map(outputs)
    custom.set('/usr/bin/vm_stat ', fixture('vm_stat.txt').replaceAll('16384', '4096'))
    custom.set('/usr/sbin/sysctl -n hw.ncpu hw.memsize vm.loadavg vm.swapusage', [
      '10',
      '17179869184',
      '{ 3,20 2,80 2,20 }',
      'total = 4096.00M used = 512.00M free = 3584.00M',
    ].join('\n'))
    const result = await new MacSystemHealthCollector(fakeExec(new Map(), custom).exec, () => 100_000)
      .collect({ trackedRoots: [] })
    expect(result.values.memoryAvailableBytes).toBe((1_000 + 2_000 + 50) * 4_096)
    expect(result.values.load1).toBeUndefined()
    expect(result.values.load5).toBeUndefined()
    expect(result.values.load15).toBeUndefined()
    expect(result.commandErrors).toContainEqual({ command: 'sysctl', code: 'parse' })
  })

  it('marks a missing core command partial and total failure failed', async () => {
    const sysctlKey = '/usr/sbin/sysctl -n hw.ncpu hw.memsize vm.loadavg vm.swapusage'
    const partial = await new MacSystemHealthCollector(
      fakeExec(new Map([[sysctlKey, Object.assign(new Error('exit'), { code: 'EFAIL' })]])).exec,
      () => 100_000,
    ).collect({ trackedRoots: [] })
    expect(partial.kind).toBe('partial')

    const failures = new Map([...outputs.keys()].map((key) => [key, Object.assign(new Error('exit'), { code: 'EFAIL' })]))
    const failed = await new MacSystemHealthCollector(fakeExec(failures).exec, () => 100_000).collect({ trackedRoots: [] })
    expect(failed.kind).toBe('failed')
    expect(failed.commandErrors).toHaveLength(9)
    expect(failed.commandErrors.filter(({ command }) => command === 'ps')).toHaveLength(3)
  })

  it('rejects unlimited process limits and comma decimal CPU values', async () => {
    const custom = new Map(outputs)
    custom.set('/bin/launchctl limit maxproc', 'maxproc unlimited unlimited\n')
    custom.set('/usr/bin/top -l 2 -s 0 -n 0', 'CPU usage: 10,5% user, 5% sys, 84,5% idle\n')
    const exec: ExecFileAdapter = async (file, args) => ({ stdout: custom.get(`${file} ${args.join(' ')}`) ?? '', stderr: '' })
    const result = await new MacSystemHealthCollector(exec, () => 100_000).collect({ trackedRoots: [] })
    expect(result.values.processLimit).toBeUndefined()
    expect(result.values.cpuUsedPercent).toBeUndefined()
    expect(result.kind).toBe('partial')
  })

  it('converts swap units without assuming megabytes', async () => {
    const custom = new Map(outputs)
    custom.set('/usr/sbin/sysctl -n hw.ncpu hw.memsize vm.loadavg vm.swapusage', [
      '10',
      '17179869184',
      '{ 3.20 2.80 2.20 }',
      'total = 4.00G used = 512.00K free = 3.50G',
    ].join('\n'))
    const result = await new MacSystemHealthCollector(fakeExec(new Map(), custom).exec, () => 100_000)
      .collect({ trackedRoots: [] })
    expect(result.values.swapTotalBytes).toBe(4 * 1024 ** 3)
    expect(result.values.swapUsedBytes).toBe(512 * 1024)
  })

  it('does not turn empty successful command output into fabricated zero metrics', async () => {
    const emptyOutputs = new Map([...outputs.keys()].map((key) => [key, '']))
    const result = await new MacSystemHealthCollector(
      fakeExec(new Map(), emptyOutputs).exec,
      () => 100_000,
    ).collect({ trackedRoots: [] })

    expect(result.kind).toBe('failed')
    expect(result.values.processCount).toBeUndefined()
    expect(result.values.zombieProcessCount).toBeUndefined()
    expect(result.commandErrors).toEqual(expect.arrayContaining([
      { command: 'sysctl', code: 'parse' },
      { command: 'top', code: 'parse' },
      { command: 'vm_stat', code: 'parse' },
      { command: 'ps', code: 'parse' },
    ]))
  })
})
