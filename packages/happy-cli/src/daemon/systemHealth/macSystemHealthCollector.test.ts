import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MacSystemHealthCollector, type ExecFileAdapter } from './macSystemHealthCollector'

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

function fakeExec(failures = new Map<string, unknown>()) {
  const calls: Array<{ file: string; args: string[]; options: Parameters<ExecFileAdapter>[2] }> = []
  const exec: ExecFileAdapter = async (file, args, options) => {
    const key = `${file} ${args.join(' ')}`
    calls.push({ file, args, options })
    const failure = failures.get(key)
    if (failure) throw failure
    const stdout = outputs.get(key)
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
      memoryTotalBytes: 17_179_869_184,
      memoryAvailableBytes: (1_000 + 2_000 + 50) * 16_384,
      memoryCompressedBytes: 500 * 16_384,
      swapUsedBytes: 512 * 1024 ** 2,
      processCount: 3,
      processLimit: 4_000,
      zombieProcessCount: 1,
      pawsWorkerRoots: 1,
    })
    expect(fake.calls).toHaveLength(9)
    expect(fake.calls.every((call) => call.file.startsWith('/'))).toBe(true)
    expect(fake.calls.every((call) => call.options.timeout === 5_000 && call.options.killSignal === 'SIGKILL')).toBe(true)
    expect(fake.calls.every((call) => call.options.maxBuffer === 4 * 1024 * 1024 && call.options.env.LC_ALL === 'C')).toBe(true)
  })

  it('keeps optional command failures out of core values without faking zero', async () => {
    const key = '/usr/bin/memory_pressure -Q'
    const fake = fakeExec(new Map([[key, Object.assign(new Error('timeout'), { killed: true })]]))
    const result = await new MacSystemHealthCollector(fake.exec, () => 100_000).collect({ trackedRoots: [] })
    expect(result.kind).toBe('complete')
    expect(result.values.memoryPressureFreePercent).toBeUndefined()
    expect(result.commandErrors).toContainEqual({ command: 'memory_pressure', code: 'timeout' })
    expect(JSON.stringify(result.commandErrors)).not.toContain('stderr')
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
})
