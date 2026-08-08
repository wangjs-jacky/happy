# macOS 远端系统监控 POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不增加服务端表或明文遥测的前提下，让 macOS Happy daemon 每 15 秒采集一次只读系统健康数据，经现有端到端加密 `daemonState` 同步，并在 Paws 机器详情页展示当前状态、最近 30 分钟趋势、主要资源来源和可解释告警。

**Architecture:** CLI 侧分成纯进程归因、macOS 命令采集、历史/告警状态机、监控运行时四层；所有 `daemonState` 写入统一进入单航班发布器，监控更新使用 `system-health` 合并键实现 latest-wins。App 侧用严格 Zod 边界把解密后的可选字段转换为本地视图模型，再用现有 `ItemList` / `ItemGroup`、主题和 800px 内容宽度渲染；服务端保持透明密文中继，不改数据库和 wire schema。

**Tech Stack:** TypeScript、Node.js `execFile`、Zod、Socket.IO、React Native + Expo、react-native-svg、react-native-unistyles、Vitest、react-test-renderer、macOS `sysctl` / `top` / `vm_stat` / `memory_pressure` / `ps` / `df`。

## Global Constraints

- **设计基线:** 必须逐项满足 `docs/superpowers/specs/2026-08-07-macos-system-monitor-design.md`；若实现中发现冲突，先更新规格并重新审查，不在代码里暗改语义。
- **工作区:** 只在 sibling worktree `/Users/jiashengwang/jacky-github/happy-study/happy--mac-system-monitor`、分支 `feat/mac-system-monitor` 修改；根仓库继续保持干净 `main`。
- **POC 范围:** 只支持 macOS，只监控，不提供清理、结束进程、重启、修复或远程命令入口。
- **开关:** 只有 `HAPPY_SYSTEM_HEALTH_MONITOR=1` 时启用采集；未开启时仍通过机器 metadata 报告 capability，App 必须区分“旧 CLI”“功能关闭”“等待首样本”。
- **隐私:** 不同步 PID、完整命令行、路径、用户名、窗口标题或任意原始 `comm` / `args`；未知来源只发送稳定哈希 ID 和截断后的 basename。
- **采集安全:** 仅使用绝对命令路径和 `execFile`；固定 `LC_ALL=C`、5 秒超时、`SIGKILL`、4 MB `maxBuffer`，禁止 shell 拼接。
- **数值约束:** 除 `issues[].observed` 可为有符号数外，所有同步数值必须有限且非负；不可得数据使用 `null`，不能伪造为 0。
- **同步约束:** 任意时刻最多一个 `machine-update-state` 请求在途；监控更新不得阻塞采样循环；断线代际和关闭时限严格遵循规格。
- **App 规范:** 4 空格缩进，组件用 `React.memo`，样式位于文件末尾并用 `react-native-unistyles`；用户可见文案全部走 `t(...)`。
- **i18n:** 新 key 同步加入 `sources/text/_default.ts` 与 `ca/en/es/it/ja/pl/pt/ru/zh-Hans/zh-Hant.ts`，保持键结构完全一致。
- **测试原则:** 测可观察行为、状态转换和协议约束，不写只锁定 Markdown、Prompt 或普通文案的正则测试。
- **评审证据:** `artifacts/interaction-review/` 必须被 Git 忽略；截图、录屏、登录态和本机路径不得提交。
- **提交格式:** 每个任务独立提交，提交正文统一追加：

```text
Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

### Task 1: 定义加密同步契约与 capability

**Files:**
- Modify: `packages/happy-cli/src/api/types.ts`
- Create: `packages/happy-cli/src/api/systemHealthTypes.test.ts`
- Modify: `packages/happy-app/sources/sync/storageTypes.ts`

**Interfaces:**
- Produces: `SystemHealthCurrentSchema`、`SystemHealthHistoryPointSchema`、`SystemHealthIssueSchema`、`SystemHealthSnapshotSchema` 和对应类型。
- Extends: `DaemonStateSchema.systemHealth?`。
- Extends: 两端 `MachineMetadataSchema.systemHealthMonitor?`。

- [ ] **Step 1: 写 CLI 契约失败测试**

创建 `systemHealthTypes.test.ts`，覆盖完整快照、负数拒绝、`issues.observed` 允许负数、可空采集字段，以及 capability 的前向兼容：

```ts
import { describe, expect, it } from 'vitest';
import { DaemonStateSchema, MachineMetadataSchema, SystemHealthSnapshotSchema } from './types';

const current = {
  sampledAt: 1_754_608_000_000,
  cpuUsedPercent: 48.5,
  cpuCores: 10,
  load1: 3.2,
  load5: 2.8,
  load15: 2.2,
  memoryTotalBytes: 16_000_000_000,
  memoryAvailableBytes: 8_000_000_000,
  memoryCompressedBytes: 1_000_000_000,
  memoryPressureFreePercent: 31,
  swapUsedBytes: 500_000_000,
  swapTotalBytes: 4_000_000_000,
  diskFreeBytes: 120_000_000_000,
  diskTotalBytes: 500_000_000_000,
  processCount: 421,
  pawsWorkerRoots: 2,
  pawsWorkerProcesses: 9,
  pawsWorkerRssBytes: 900_000_000,
  orphanWorkerRoots: 0,
  orphanWorkerProcesses: 0,
  orphanWorkerRssBytes: 0,
  topCpuSources: [],
  topMemorySources: [],
};

describe('SystemHealthSnapshotSchema', () => {
  it('accepts the version 1 encrypted payload', () => {
    expect(SystemHealthSnapshotSchema.parse({
      schemaVersion: 1,
      platform: 'darwin',
      updatedAt: current.sampledAt,
      lastAttemptAt: current.sampledAt + 20,
      resourceStatus: 'warning',
      current,
      history: [{
        sampledAt: current.sampledAt,
        cpuUsedPercent: current.cpuUsedPercent,
        load1: current.load1,
        memoryAvailableBytes: current.memoryAvailableBytes,
        swapUsedBytes: current.swapUsedBytes,
        processCount: current.processCount,
        orphanWorkerRoots: current.orphanWorkerRoots,
        pawsWorkerRssBytes: current.pawsWorkerRssBytes,
      }],
      issues: [{ code: 'swap-growing', severity: 'warning', observed: -0.5, threshold: 1, unit: 'bytes', since: current.sampledAt }],
      collector: { intervalSeconds: 15, historyStepSeconds: 60, durationMs: 320, lastSampleKind: 'complete', errors: [] },
    }).resourceStatus).toBe('warning');
  });

  it('rejects negative synchronized metrics except issue observations', () => {
    expect(() => SystemHealthSnapshotSchema.parse({
      schemaVersion: 1, platform: 'darwin', updatedAt: 1, lastAttemptAt: 1,
      resourceStatus: 'healthy',
      current: { ...current, swapUsedBytes: -1 }, history: [], issues: [],
      collector: { intervalSeconds: 15, historyStepSeconds: 60, durationMs: 1, lastSampleKind: 'complete', errors: [] },
    })).toThrow();
  });
});

it('embeds health state in daemonState and capability in metadata', () => {
  expect(DaemonStateSchema.parse({ status: 'running', systemHealth: undefined })).toBeTruthy();
  expect(MachineMetadataSchema.parse({
    host: 'mac-mini', platform: 'darwin', happyCliVersion: '1.0.0',
    homeDir: '/Users/jacky', happyHomeDir: '/Users/jacky/.happy', happyLibDir: '/tmp/happy',
    systemHealthMonitor: { schemaVersion: 1, supported: true, enabled: false, reportedAt: 1 },
  }).systemHealthMonitor?.enabled).toBe(false);
});
```

- [ ] **Step 2: 确认测试先失败**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/api/systemHealthTypes.test.ts`

Expected: FAIL，提示 `SystemHealthSnapshotSchema` 尚未导出。

- [ ] **Step 3: 在 CLI 定义唯一的同步形状**

在 `types.ts` 中用辅助 schema 强制有限、非负，并把 `history` 限制为最多 30 点、`topCpuSources` / `topMemorySources` 各最多 5 项、`issues` 最多 16 项：

```ts
const NonNegativeFinite = z.number().finite().nonnegative();

export const SystemHealthSourceSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(40),
  cpuPercent: NonNegativeFinite,
  rssBytes: NonNegativeFinite,
  processCount: NonNegativeFinite,
  oldestProcessAgeSeconds: NonNegativeFinite.optional(),
});

export const SystemHealthCurrentSchema = z.object({
  sampledAt: NonNegativeFinite,
  cpuUsedPercent: NonNegativeFinite,
  cpuCores: NonNegativeFinite,
  load1: NonNegativeFinite,
  load5: NonNegativeFinite,
  load15: NonNegativeFinite,
  memoryTotalBytes: NonNegativeFinite,
  memoryAvailableBytes: NonNegativeFinite,
  memoryCompressedBytes: NonNegativeFinite,
  memoryPressureFreePercent: NonNegativeFinite.optional(),
  swapUsedBytes: NonNegativeFinite,
  swapTotalBytes: NonNegativeFinite,
  diskFreeBytes: NonNegativeFinite.optional(),
  diskTotalBytes: NonNegativeFinite.optional(),
  processCount: NonNegativeFinite,
  pawsWorkerRoots: NonNegativeFinite,
  pawsWorkerProcesses: NonNegativeFinite,
  pawsWorkerRssBytes: NonNegativeFinite,
  orphanWorkerRoots: NonNegativeFinite,
  orphanWorkerProcesses: NonNegativeFinite,
  orphanWorkerRssBytes: NonNegativeFinite,
  topCpuSources: z.array(SystemHealthSourceSchema).max(5),
  topMemorySources: z.array(SystemHealthSourceSchema).max(5),
});

export const SystemHealthIssueSchema = z.object({
  code: z.enum(['orphan-workers', 'swap-high', 'swap-growing', 'cpu-sustained', 'load-high', 'memory-pressure-high', 'worker-memory-high', 'process-count-high', 'disk-low', 'single-source-cpu-high']),
  severity: z.enum(['warning', 'critical']),
  subject: z.string().max(64).optional(),
  observed: z.number().finite(),
  threshold: NonNegativeFinite,
  unit: z.enum(['percent', 'ratio', 'bytes', 'count']),
  since: NonNegativeFinite,
});
```

随后按规格组合 `SystemHealthHistoryPointSchema` 和 `SystemHealthSnapshotSchema`：限定 `schemaVersion: 1`、`platform: 'darwin'`；`updatedAt/lastAttemptAt/current` 可空；`resourceStatus` 为三态；`history` 最多 30 点；collector 固定 15/60 秒并携带 duration、sample kind 和脱敏 errors。扩展 `DaemonStateSchema` 与 `MachineMetadataSchema`，导出所有 `z.infer` 类型。可空核心指标只存在于 Collector 内部类型，不进入 complete current 契约。

- [ ] **Step 4: 在 App 镜像 capability schema**

在 `storageTypes.ts` 的 `MachineMetadataSchema` 加入完全同形的可选字段：

```ts
systemHealthMonitor: z.object({
    schemaVersion: z.literal(1),
    supported: z.literal(true),
    enabled: z.boolean(),
    reportedAt: z.number().finite().nonnegative(),
}).optional(),
```

此时仍保留 `Machine.daemonState: any | null`，严格 daemonState 解析放到 Task 7 的功能边界，避免影响历史客户端状态。

- [ ] **Step 5: 运行契约测试和两端类型检查**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/api/systemHealthTypes.test.ts`

Expected: PASS。

Run: `pnpm --filter happy-cli run build && pnpm --filter happy-app run typecheck`

Expected: 两条命令均退出 0。

- [ ] **Step 6: 提交**

```bash
git add packages/happy-cli/src/api/types.ts packages/happy-cli/src/api/systemHealthTypes.test.ts packages/happy-app/sources/sync/storageTypes.ts
git commit -m "feat(monitor): define encrypted macOS health contract

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 以纯函数完成 worker、tmux、孤儿进程与来源归因

**Files:**
- Create: `packages/happy-cli/src/daemon/systemHealth/types.ts`
- Create: `packages/happy-cli/src/daemon/systemHealth/macProcessSnapshotAnalyzer.ts`
- Create: `packages/happy-cli/src/daemon/systemHealth/macProcessSnapshotAnalyzer.test.ts`

**Interfaces:**
- Produces: `analyzeMacProcessSnapshot(input: MacProcessAnalysisInput): MacProcessAnalysisResult`。
- Input: 三张已解析 `ps` 表、当前 tracked roots、上一轮 root membership、采样时间。
- Output: 去敏后的聚合统计、下一轮 membership；绝不返回 `pid`、`ppid`、`comm`、`args`。

- [ ] **Step 1: 定义内部原始类型并写失败测试**

在 `types.ts` 定义 `MacProcessStatRow`、`MacProcessCommandRow`、`TrackedProcessRoot`、`PreviousRootMembership` 和 sanitized result。测试至少覆盖：

```ts
it('deduplicates nested tracked roots and attributes all descendants once', () => {
  const result = analyzeMacProcessSnapshot(fixture({
    trackedRoots: [
      { pid: 100, spawnedAt: 10_000, kind: 'daemon' },
      { pid: 110, spawnedAt: 11_000, kind: 'tmux' },
    ],
    processes: [
      row(100, 1, 1, 100, 100, 'node', 'happy daemon'),
      row(110, 100, 2, 200, 90, 'tmux', 'tmux new-session'),
      row(120, 110, 3, 300, 80, 'node', 'claude'),
    ],
  }));
  expect(result.worker).toEqual({ processCount: 3, rssBytes: 600 * 1024 });
});

it('keeps surviving descendants as orphaned after their tracked root exits', () => {
  const previous = analyzeMacProcessSnapshot(firstSnapshotWithRootAndChild()).nextMembership;
  const result = analyzeMacProcessSnapshot(secondSnapshotWithOnlyChild(previous));
  expect(result.orphans).toMatchObject({ rootCount: 1, processCount: 1 });
});

it('does not inherit membership when a pid is reused with a different birth fingerprint', () => {
  const result = analyzeMacProcessSnapshot(pidReuseFixture());
  expect(result.orphans.processCount).toBe(0);
});

it('never exposes raw command lines in its serialized result', () => {
  const json = JSON.stringify(analyzeMacProcessSnapshot(secretPathFixture()));
  expect(json).not.toContain('/Users/jacky/private-project');
});
```

再覆盖 daemon flag 边界、已知来源 `chrome/cursor/spotlight/paws-workers`、未知来源 SHA-256 ID 稳定性、basename 最长 40 字符和 CPU/RSS 聚合。

- [ ] **Step 2: 确认测试先失败**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/daemon/systemHealth/macProcessSnapshotAnalyzer.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现三表 join、进程树和出生指纹**

实现时使用 `(pid, derivedStartedAt)`，其中 `derivedStartedAt = roundTo2Seconds(capturedAt - elapsedSeconds * 1000)`。只在分析期保留原始字段：

```ts
const fingerprint = (pid: number, elapsedSeconds: number, capturedAt: number) =>
  `${pid}:${Math.round((capturedAt - elapsedSeconds * 1000) / 2000) * 2000}`;

const unknownSourceId = (fullComm: string) =>
  `process:${createHash('sha256').update(fullComm).digest('hex').slice(0, 12)}`;
```

候选 root 只接受两类已知模式：`comm` basename 精确为 `paws` / `happy`；或 basename 为 `node` 且 `args` 以边界命中 `/(happy|paws).mjs` 或 `dist/index.mjs`，同时命中已知 agent 子命令。daemon 标记只用 `(?:^|\s)--started-by(?:=daemon|\s+daemon)(?=\s|$)`。未 tracked、带 daemon 标记的候选才可成为孤儿；终端手动启动且无该标记的相似进程必须排除。

对 nested roots 先按祖先关系消重；tmux root 只认 daemon 已跟踪 pane 的后代。root 消失后，以上一轮 membership 中仍存在且出生指纹相同的最上层存活进程作为 orphan root，继续收拢其后代。

- [ ] **Step 4: 实现严格去敏输出**

返回类型只包含：worker/orphan root、进程数量与 RSS、全部脱敏来源的 `{id,name,cpuPercent,rssBytes,processCount,oldestProcessAgeSeconds?}`、`nextMembership`。已知来源 ID 固定；未知来源用完整 comm 的 SHA-256 前 12 位作为 ID，展示名取安全 basename、限制 40 字符，无法稳定命名时归为 `Other`。`nextMembership` 仅在 daemon 内存中使用，可包含 fingerprint，但不得进入同步 schema；top 5 CPU / top 5 memory 的裁剪由 Monitor 构造公开快照时完成。

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/daemon/systemHealth/macProcessSnapshotAnalyzer.test.ts`

Expected: PASS，覆盖 worker、tmux、孤儿、PID reuse 和隐私断言。

- [ ] **Step 6: 提交**

```bash
git add packages/happy-cli/src/daemon/systemHealth
git commit -m "feat(monitor): analyze macOS process ownership safely

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 采集 macOS 指标并容忍部分命令失败

**Files:**
- Create: `packages/happy-cli/src/daemon/systemHealth/macSystemHealthCollector.ts`
- Create: `packages/happy-cli/src/daemon/systemHealth/macSystemHealthCollector.test.ts`
- Create: `packages/happy-cli/src/daemon/systemHealth/__fixtures__/sysctl.txt`
- Create: `packages/happy-cli/src/daemon/systemHealth/__fixtures__/top.txt`
- Create: `packages/happy-cli/src/daemon/systemHealth/__fixtures__/vm_stat.txt`
- Create: `packages/happy-cli/src/daemon/systemHealth/__fixtures__/memory_pressure.txt`
- Create: `packages/happy-cli/src/daemon/systemHealth/__fixtures__/ps_stats.txt`
- Create: `packages/happy-cli/src/daemon/systemHealth/__fixtures__/ps_comm.txt`
- Create: `packages/happy-cli/src/daemon/systemHealth/__fixtures__/ps_args.txt`
- Create: `packages/happy-cli/src/daemon/systemHealth/__fixtures__/df.txt`

**Interfaces:**
- Produces: `MacSystemHealthCollector.collect(input): Promise<MacSystemHealthCollection>`。
- Constructor dependency: injectable `execFile` adapter，生产环境默认 Node `execFile` promisified 版本。

- [ ] **Step 1: 写命令契约与解析失败测试**

断言每个调用都使用绝对路径、参数数组和统一 options：

```ts
expect(exec.calls).toContainEqual({
  file: '/usr/sbin/sysctl',
  args: ['-n', 'hw.ncpu', 'hw.memsize', 'vm.loadavg', 'vm.swapusage'],
  options: expect.objectContaining({
    timeout: 5_000,
    killSignal: 'SIGKILL',
    maxBuffer: 4 * 1024 * 1024,
    env: expect.objectContaining({ LC_ALL: 'C' }),
  }),
});
```

为 `/usr/bin/top -l 2 -s 0 -n 0`、`vm_stat`、`memory_pressure -Q`、三条 `/bin/ps` 和 `/bin/df -kP /` 写同类断言。fixture 测试覆盖 Intel/Apple Silicon 常见空格差异、swap 单位、`vm_stat` 首行不同 page size、`etime` 的 `MM:SS` / `HH:MM:SS` / `DD-HH:MM:SS`、带空格 comm/args、三表 PID 缺行、逗号小数不可接受、非数字、缺行和命令超时。

- [ ] **Step 2: 确认测试先失败**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/daemon/systemHealth/macSystemHealthCollector.test.ts`

Expected: FAIL，collector 不存在。

- [ ] **Step 3: 实现独立 parser 与命令 runner**

每条命令单独捕获错误并返回缺失字段；三张 `ps` 表按 PID 连接，只出现在部分表中的 PID 保留可用字段，不能按行号错位。Collector 调用 Task 2 analyzer 后立即释放原始 `comm/args`。质量规则按核心字段判断：能够构造完整 `SystemHealthCurrent` 即 `complete`；核心字段缺失但仍有采集结果为 `partial`；无任何可用指标为 `failed`。磁盘和 `memory_pressure` 是非核心可选字段，缺失不阻止 complete。

```ts
const EXEC_OPTIONS = {
  timeout: 5_000,
  killSignal: 'SIGKILL' as const,
  maxBuffer: 4 * 1024 * 1024,
};

const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
```

CPU 使用 `top` 第二次采样的 `CPU usage` 推导；内存 available 使用规格中的估算公式；`memory_pressure -Q` 只读取 free percentage；字节换算集中到纯函数并拒绝 `NaN`、Infinity、负数。

- [ ] **Step 4: 证明部分失败不会伪造 0**

增加测试：让 `memory_pressure` 超时、其他核心字段成功，断言 `kind === 'complete'`、`memoryPressureFreePercent === undefined`，并记录 `{command:'memory_pressure',code:'timeout'}`；让 `sysctl` 失败导致核心字段缺失，断言 `kind === 'partial'`；让所有命令失败，断言 `kind === 'failed'`。多个错误全部保留，但错误结构不得包含 stderr。

- [ ] **Step 5: 运行 collector 与 analyzer 测试**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/daemon/systemHealth/macSystemHealthCollector.test.ts src/daemon/systemHealth/macProcessSnapshotAnalyzer.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/happy-cli/src/daemon/systemHealth
git commit -m "feat(monitor): collect read-only macOS health metrics

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 实现 30 分钟历史与可恢复告警状态机

**Files:**
- Create: `packages/happy-cli/src/daemon/systemHealth/systemHealthMonitor.ts`
- Create: `packages/happy-cli/src/daemon/systemHealth/systemHealthMonitor.test.ts`

**Interfaces:**
- Produces: `SystemHealthMonitor.record(collection): SystemHealthSnapshot`。
- Keeps: 最近 11 分钟 complete 的 15 秒原始样本（正常情况下最多 45 个）用于持续阈值；最多 30 个按分钟覆盖的公开趋势点。

- [ ] **Step 1: 用 fake time 写失败测试**

用构造器注入 `now`，逐条覆盖规格阈值。至少包含：

```ts
it('enters an instant warning after two complete samples and recovers after three', () => {
  const monitor = createMonitor();
  expect(record(monitor, { orphanWorkerRoots: 1 }).resourceStatus).toBe('healthy');
  expect(record(monitor, { orphanWorkerRoots: 1 }).resourceStatus).toBe('warning');
  record(monitor, { orphanWorkerRoots: 0 });
  record(monitor, { orphanWorkerRoots: 0 });
  expect(record(monitor, { orphanWorkerRoots: 0 }).resourceStatus).toBe('healthy');
});

it('does not advance alert state on partial or failed samples', () => {
  const monitor = createMonitor();
  record(monitor, { orphanWorkerRoots: 1, kind: 'complete' });
  record(monitor, { orphanWorkerRoots: 1, kind: 'partial' });
  expect(record(monitor, { orphanWorkerRoots: 1, kind: 'complete' }).resourceStatus).toBe('warning');
});

it('uses the oldest sample in the 9.5–10.5 minute swap baseline window', () => {
  const snapshot = recordSwapSeries(createMonitor(), { baseline: 0, current: 2 * GiB });
  expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'swap-growing', severity: 'critical' }));
});
```

再覆盖 warning→critical、critical→warning、CPU 2/3 分钟、source CPU 5 分钟、80% 覆盖率、source 消失按 0 恢复、load/core、内存压力、worker RSS、进程数、磁盘、ring buffer 上限和每分钟最后一点覆盖。

- [ ] **Step 2: 确认测试先失败**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/daemon/systemHealth/systemHealthMonitor.test.ts`

Expected: FAIL，monitor 不存在。

- [ ] **Step 3: 实现规则表和 issue key**

规则 key 固定为 `${code}:${subject ?? 'global'}`。所有阈值集中在只读常量中，包含规格列出的 warning/critical 值，不散落在分支代码里：

```ts
const THRESHOLDS = {
  orphanRoots: { warning: 1, critical: 5 },
  swapRatio: { warning: 0.25, critical: 0.5 },
  swapGrowthBytes: { warning: 1 * GiB, critical: 2 * GiB },
  cpuSustained: {
    warning: { value: 85, durationMs: 2 * 60_000 },
    critical: { value: 95, durationMs: 3 * 60_000 },
  },
  loadPerCore: { warning: 1.5, critical: 2 },
  memoryPressureFreePercent: { warningBelow: 10, criticalBelow: 5 },
  workerRssRatio: { warning: 0.2, critical: 0.35 },
  processCount: { warning: 700, critical: 900 },
  diskFreeBytes: { warningBelow: 15 * GiB, criticalBelow: 5 * GiB },
  sourceCpuSustained: {
    warning: { value: 100, durationMs: 5 * 60_000 },
    critical: { value: 200, durationMs: 5 * 60_000 },
  },
} as const;
```

- [ ] **Step 4: 实现持续窗口和恢复**

持续规则只有在窗口时长已到、样本数达到预期的 80%、其中达到阈值的 complete 样本也达到 80% 时才成立。partial/failed 样本既不触发也不推进恢复。单来源 CPU 规则使用 Analyzer 的全部脱敏来源序列，不能只看同步的 top 5；已存在 source 在完整样本中消失时补一个 CPU=0 的观察，用于三样本恢复。

- [ ] **Step 5: 实现历史压缩与 payload 防线**

仅 complete 样本替换 `current/updatedAt`、进入 11 分钟资源窗口和自然分钟历史桶；partial/failed 只更新 `lastAttemptAt` 与 collector 诊断，并保留上次 `current/history/resourceStatus/issues`。历史每桶保留最新 complete 点，最多 30 桶；公开快照分别保留 CPU top 5 与内存 top 5，issues 最多 16。生成快照后运行 `SystemHealthSnapshotSchema.parse(snapshot)`，使非法数值在 CLI 内被拒绝而不是同步。

- [ ] **Step 6: 运行测试并提交**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/daemon/systemHealth/systemHealthMonitor.test.ts`

Expected: PASS。

```bash
git add packages/happy-cli/src/daemon/systemHealth/systemHealthMonitor.ts packages/happy-cli/src/daemon/systemHealth/systemHealthMonitor.test.ts
git commit -m "feat(monitor): track health trends and recoverable alerts

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 将所有 daemonState 写入收口到单航班发布器

**Files:**
- Create: `packages/happy-cli/src/api/daemonStatePublisher.ts`
- Create: `packages/happy-cli/src/api/daemonStatePublisher.test.ts`
- Modify: `packages/happy-cli/src/api/apiMachine.ts`
- Modify: `packages/happy-cli/src/api/apiMachine.test.ts`

**Interfaces:**
- Produces: `DaemonStatePublisher.publish(mutation): Promise<void>`。
- Produces: `publishLatest(coalesceKey, mutation): void`，监控固定使用 `system-health`。
- Produces: `onConnected(generation)`、`onDisconnected(generation)`、`close(shutdownMutation)`。

- [ ] **Step 1: 写并发和代际失败测试**

使用 deferred promises 证明以下行为：

```ts
it('never runs two writes concurrently and keeps only the latest health mutation', async () => {
  const transport = new DeferredTransport();
  const publisher = new DaemonStatePublisher(transport);
  publisher.onConnected(1);

  const ordinary = publisher.publish(setStatus('running'));
  publisher.publishLatest('system-health', setHealth('sample-1'));
  publisher.publishLatest('system-health', setHealth('sample-2'));

  expect(transport.maxConcurrent).toBe(1);
  transport.resolveNext();
  await ordinary;
  transport.resolveNext();
  await publisher.flush();
  expect(transport.appliedHealthIds).toEqual(['sample-2']);
});
```

另测：ACK 5 秒超时；同一 generation 最多 2 次；断线清空普通 pending、作废在途结果但保留 monitor 内最新快照；重连只由运行时重新 enqueue；关闭空闲时尝试 shutting-down；关闭遇在途超过 1 秒时作废 generation 且不并发补写；总关闭不超过 2 秒。

- [ ] **Step 2: 确认发布器测试先失败**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/api/daemonStatePublisher.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现与 Socket 无关的串行队列**

发布器只依赖如下 transport，方便确定性测试：

```ts
export type DaemonStateMutation = (state: DaemonState | null) => DaemonState;

export interface DaemonStateTransport {
  write(mutation: DaemonStateMutation, generation: number, timeoutMs: number): Promise<void>;
}
```

队列最多保留一个同 key latest mutation。`publish` 的 Promise 在成功、代际失效或 close 时明确 resolve/reject，不能悬挂。`publishLatest` 不向采样调用方暴露网络等待。

- [ ] **Step 4: 在 ApiMachineClient 中接入 transport**

把现有 `updateDaemonState` 改为 `publisher.publish(handler)`；提取 `writeDaemonStateOnce` 执行加密、ACK、version mismatch 合并。CAS mismatch 时先采用服务器返回的新 state/version，再对最新 state 重新执行无副作用 patch，证明不会覆盖 `codexUsage`、PID、端口和 startedAt。连接成功递增 generation 并调用 `onConnected`，断开时调用 `onDisconnected`。保留现有公共方法签名，避免 heartbeat、usage 和启动状态调用方回归。

- [ ] **Step 5: 运行发布器和现有 API 测试**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/api/daemonStatePublisher.test.ts src/api/apiMachine.test.ts`

Expected: PASS，且 mocked socket 观察到最大并发数为 1。

- [ ] **Step 6: 提交**

```bash
git add packages/happy-cli/src/api/daemonStatePublisher.ts packages/happy-cli/src/api/daemonStatePublisher.test.ts packages/happy-cli/src/api/apiMachine.ts packages/happy-cli/src/api/apiMachine.test.ts
git commit -m "fix(daemon): serialize encrypted state publication

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 启动 15 秒监控运行时并接入 daemon 生命周期

**Files:**
- Create: `packages/happy-cli/src/daemon/systemHealth/systemHealthRuntime.ts`
- Create: `packages/happy-cli/src/daemon/systemHealth/systemHealthRuntime.test.ts`
- Modify: `packages/happy-cli/src/daemon/run.ts`
- Modify: `packages/happy-cli/src/daemon/types.ts`
- Modify: `packages/happy-cli/src/api/apiMachine.ts`

**Interfaces:**
- Produces: `SystemHealthRuntime.start()`、`publishLatestNow()`、`stop()`。
- Extends: `TrackedSession.spawnedAt: number`。
- Extends: `ApiMachineClient.publishSystemHealth(snapshot): void` 和 lifecycle-aware close。

- [ ] **Step 1: 写 runtime 调度失败测试**

注入 fake timers、collector、monitor、publisher，验证：连接成功 5 秒后首采、之后每 15 秒；上一轮采集未完成时不重叠；断线时继续采集并只保留最新内存快照；重连且 running 状态写成功后 enqueue 最新快照；stop 清 timer 并不再采集。

```ts
expect(collector.maxConcurrent).toBe(1);
expect(publisher.latestSnapshots.map((item) => item.updatedAt)).toEqual([5_000, 35_000]);
```

- [ ] **Step 2: 确认测试先失败**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/daemon/systemHealth/systemHealthRuntime.test.ts`

Expected: FAIL，runtime 不存在。

- [ ] **Step 3: 实现 feature gate 和平台 gate**

唯一启用表达式：

```ts
const supported = process.platform === 'darwin';
const enabled = supported && process.env.HAPPY_SYSTEM_HEALTH_MONITOR === '1';
```

`initialMachineMetadata.systemHealthMonitor` 在 macOS 总是存在，字段为 `{schemaVersion:1,supported:true,enabled,reportedAt:Date.now()}`；后续 metadata 刷新也通过同一个 helper 重算并发布 capability。非 macOS 不添加 capability，且绝不实例化 collector。

- [ ] **Step 4: 给所有 daemon 启动的 root 记录 spawnedAt**

在普通 child 和 tmux tracked session 两个创建点都写 `spawnedAt: Date.now()`；恢复持久化 session 时使用恢复记录时间或当前恢复时间，不允许 `undefined`。把 `pidToTrackedSession` 映射成 runtime 的只读 tracked root 输入。

- [ ] **Step 5: 接入启动、重连和关闭**

daemon API client 建立后启动 runtime；每个样本调用 `publishSystemHealth`，内部走 `publishLatest('system-health', ...)`。重连事件调用 `runtime.publishLatestNow()`。关闭顺序固定为：停止新采样 → `ApiMachineClient.close()` 执行规格中的最多 2 秒发布器关闭 → 继续既有资源清理。

- [ ] **Step 6: 运行 runtime、daemon/API 回归测试**

Run: `pnpm --filter happy-cli exec vitest run --project unit src/daemon/systemHealth/systemHealthRuntime.test.ts src/api/daemonStatePublisher.test.ts src/api/apiMachine.test.ts`

Expected: PASS。

Run: `pnpm --filter happy-cli run build`

Expected: PASS，无未处理 Promise 和类型错误。

- [ ] **Step 7: 提交**

```bash
git add packages/happy-cli/src/daemon/run.ts packages/happy-cli/src/daemon/types.ts packages/happy-cli/src/daemon/systemHealth/systemHealthRuntime.ts packages/happy-cli/src/daemon/systemHealth/systemHealthRuntime.test.ts packages/happy-cli/src/api/apiMachine.ts
git commit -m "feat(daemon): run gated macOS health monitoring

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 在 App 边界解析状态并派生实时健康视图模型

**Files:**
- Create: `packages/happy-app/sources/utils/systemHealth.ts`
- Create: `packages/happy-app/sources/utils/systemHealth.test.ts`

**Interfaces:**
- Produces: `parseSystemHealth(daemonState: unknown): SystemHealthSnapshot | null`。
- Produces: `getSystemHealthAvailability(machine, now): SystemHealthAvailability`。
- Produces: `buildSystemHealthViewModel(machine, now): SystemHealthViewModel`。

- [ ] **Step 1: 写解析、优先级和 freshness 失败测试**

测试表覆盖：非 macOS 不渲染；旧 macOS CLI 无 capability；macOS capability disabled；enabled 但未首样本（`reportedAt` 45 秒内为 pending，超过 45 秒为 unavailable）；schemaVersion 未知；online/offline；45 秒 delayed warning；120 秒 unavailable；资源 critical 优先于 warning，但 offline 高于全部。

```ts
it.each([
  ['offline', offlineMachine(), 0, 'offline'],
  ['stale', machineWithSample({ ageMs: 121_000 }), 0, 'unavailable'],
  ['critical', machineWithIssue('critical'), 0, 'critical'],
  ['delayed', machineWithSample({ ageMs: 46_000 }), 0, 'warning'],
  ['healthy', machineWithSample({ ageMs: 5_000 }), 0, 'healthy'],
])('%s resolves to %s', (_name, machine, now, expected) => {
  expect(buildSystemHealthViewModel(machine, now).status).toBe(expected);
});
```

另测四个 chart series 使用同一 timestamp 但独立 min/max，单点和全相等数据不会产生 NaN；latest/min/max 正确。还要测试 history 时间倒退会被排序/去重、未来超过 5 分钟的点会被忽略，确保异常时钟不污染图表。

- [ ] **Step 2: 确认测试先失败**

Run: `pnpm --filter happy-app exec vitest run sources/utils/systemHealth.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 镜像严格 snapshot schema 并 safeParse**

App schema 与 Task 1 同形但不改变 `Machine.daemonState` 全局类型。只读取 `daemonState.systemHealth`，未知版本或非法值返回 `null` 并映射为 unavailable，同时记录不含 payload 的脱敏诊断，不让机器详情页崩溃。解析后剔除时间倒退、重复分钟桶和未来超过本地时钟 5 分钟的异常历史点。

- [ ] **Step 4: 实现状态优先级和本地 15 秒 freshness tick 输入**

视图模型纯函数只接收 `now`，不自己建 timer。优先级严格为：offline > 无样本/超过 120 秒 > critical > resource warning 或超过 45 秒 > healthy。组件层在 Task 8 每 15 秒更新一次 `now`。

- [ ] **Step 5: 实现四组独立 chart model**

输出固定顺序 `cpuUsedPercent`、`swapUsedBytes`、`processCount`、`orphanWorkerRoots`。每组包含 labelKey、unit、points、latest/min/max、无障碍摘要；swap 转为 GB 只发生在展示模型，不改同步值。

- [ ] **Step 6: 运行测试并提交**

Run: `pnpm --filter happy-app exec vitest run sources/utils/systemHealth.test.ts`

Expected: PASS。

```bash
git add packages/happy-app/sources/utils/systemHealth.ts packages/happy-app/sources/utils/systemHealth.test.ts
git commit -m "feat(app): derive resilient system health view models

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 用 Paws 现有视觉语言实现监控区块与四条趋势图

**Files:**
- Create: `packages/happy-app/sources/components/systemHealth/SystemHealthSection.tsx`
- Create: `packages/happy-app/sources/components/systemHealth/SystemHealthSection.test.tsx`
- Create: `packages/happy-app/sources/components/systemHealth/SystemHealthSparkline.tsx`
- Create: `packages/happy-app/sources/components/systemHealth/SystemHealthMetricGrid.tsx`
- Create: `packages/happy-app/sources/components/systemHealth/SystemHealthSources.tsx`

**Interfaces:**
- Produces: `<SystemHealthSection machine={machine} now={now} />`。
- Consumes: Task 7 视图模型；不直接解析 `daemonState`。

- [ ] **Step 1: 写组件行为失败测试**

用 react-test-renderer mock `react-native-svg` 和 unistyles，测试 capability 状态、告警摘要、四张 sparkline、主要来源、null gap、无障碍 label。测试 `testID` 只用于稳定行为入口：

```ts
expect(root.findAllByProps({ testID: 'system-health-sparkline' })).toHaveLength(4);
expect(root.findByProps({ testID: 'system-health-status' }).props.accessibilityLabel)
  .toEqual(expect.any(String));
```

- [ ] **Step 2: 确认测试先失败**

Run: `pnpm --filter happy-app exec vitest run sources/components/systemHealth/SystemHealthSection.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现只读 sparkline**

使用 `react-native-svg` 的 `Path`、`Circle`、`Line`；每条序列独立 y-scale，共享 timestamp x-scale。宽度由 `onLayout` 获取，0 宽或少于 2 点时退化为点/短线。不要复制 `FinanceChartCard` 的手势或 tooltip，因为本 POC 是只读摘要。

- [ ] **Step 4: 实现符合 Paws 的区块布局**

外层使用现有 `ItemGroup` 和 theme；状态行、当前指标、趋势、来源按垂直信息层级排布，不采用概念图中的独立产品壳。主指标固定为 CPU、available/total memory、used/total swap、总进程；同一区块再以紧凑事实行展示 load 1/5/15、内存压力、压缩内存、磁盘余量、Paws worker roots/processes/RSS 和 orphan roots/processes/RSS，确保当前归因数据不是只存在于同步层。颜色仅使用 `theme.colors` 加 warning/critical 语义色，字体沿用当前 App；内容自然受页面既有 800px 最大宽度约束。

- [ ] **Step 5: 实现全部空态和错误态**

非 macOS 完全不渲染。macOS 区分：旧 CLI 不支持、功能关闭、等待首样本、首次采集中、首次采集失败、采集不可用、离线、正常。partial/failed 只改变 collector 诊断；若已有 complete current，继续展示最后真实值并按 `updatedAt` 降级 freshness，不能用部分字段覆盖 current。缺失可选指标用 `—` 或隐藏，不能显示伪造的 `0`。

来源列表固定先取 CPU 前三，再补最多两个未出现于 CPU 前三的内存来源，最终不超过五行；每行展示名称、CPU、RSS、进程数，来源 age 只用于可选辅助信息。

- [ ] **Step 6: 运行组件测试并提交**

Run: `pnpm --filter happy-app exec vitest run sources/components/systemHealth/SystemHealthSection.test.tsx sources/utils/systemHealth.test.ts`

Expected: PASS。

```bash
git add packages/happy-app/sources/components/systemHealth
git commit -m "feat(app): render Paws-native health monitoring panel

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 集成机器详情页并补齐全部翻译

**Files:**
- Modify: `packages/happy-app/sources/app/(app)/machine/[id].tsx`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/ca.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/es.ts`
- Modify: `packages/happy-app/sources/text/translations/it.ts`
- Modify: `packages/happy-app/sources/text/translations/ja.ts`
- Modify: `packages/happy-app/sources/text/translations/pl.ts`
- Modify: `packages/happy-app/sources/text/translations/pt.ts`
- Modify: `packages/happy-app/sources/text/translations/ru.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hant.ts`

**Interfaces:**
- Inserts: 监控区块位于离线提示之后、“Launch new session”之前。
- Adds: `machine.systemHealth.*` 完整翻译树。

- [ ] **Step 1: 在页面增加本地 freshness 时钟**

页面挂载时以 `Date.now()` 初始化，并每 15 秒更新；卸载清 timer。只把 `machine` 和 `now` 传给组件：

```tsx
{machine && (
    <SystemHealthSection machine={machine} now={healthNow} />
)}
```

放置位置必须在现有 launch `ItemGroup` 前，不改启动会话交互。

- [ ] **Step 2: 增加完整 i18n key**

英文源至少定义 title、状态、空态、指标名、趋势、latest/min/max、单位、来源、告警 code 的展示文案和无障碍摘要模板。10 个翻译文件保持同形；术语 Chrome、CPU、GB 不翻译，句子使用目标语言自然表达。

- [ ] **Step 3: 添加页面级集成断言**

在 `SystemHealthSection.test.tsx` 增加页面依赖所需的最小 props 测试；不通过匹配源代码文本验证顺序。使用 renderer 树中 `system-health-section` 与已有 launch group testID 的相对索引；若现有 launch group 无稳定 testID，只给该可交互分组新增 `machine-launch-section`。

- [ ] **Step 4: 运行 App 测试和类型检查**

Run: `pnpm --filter happy-app exec vitest run sources/components/systemHealth/SystemHealthSection.test.tsx sources/utils/systemHealth.test.ts`

Expected: PASS。

Run: `pnpm --filter happy-app run typecheck`

Expected: PASS；翻译树不存在缺键类型错误。

- [ ] **Step 5: 提交**

```bash
git add packages/happy-app/sources/app/'(app)'/machine/'[id].tsx' packages/happy-app/sources/text packages/happy-app/sources/components/systemHealth/SystemHealthSection.test.tsx
git commit -m "feat(app): integrate localized machine health monitoring

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: 完成协议预算、安全检查与全量回归

**Files:**
- Create: `packages/happy-cli/src/daemon/systemHealth/systemHealthPayload.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Enforces: 最大合法监控快照 JSON 小于 32 KiB。
- Enforces: 评审产物目录不进入 Git。

- [ ] **Step 1: 写最大 payload 测试**

构造 30 个历史点、CPU 与内存各 5 个来源、16 个 issues，断言 schema 可解析且 UTF-8 大小严格小于 32 KiB：

```ts
const bytes = Buffer.byteLength(JSON.stringify(maximalSnapshot), 'utf8');
expect(bytes).toBeLessThan(32 * 1024);
```

同时断言 JSON 不含 fixture 中的用户名、绝对路径、PID 和原始 args。

- [ ] **Step 2: 将评审证据目录加入忽略**

在 `.gitignore` 增加：

```gitignore
# 本地 PC 交互评审证据，不提交
artifacts/interaction-review/
```

验证：

Run: `mkdir -p artifacts/interaction-review && touch artifacts/interaction-review/.probe && git check-ignore -v artifacts/interaction-review/.probe`

Expected: 输出命中 `.gitignore` 的新规则。

- [ ] **Step 3: 跑 CLI 全量测试和构建**

Run: `pnpm --filter happy-cli test`

Expected: PASS，包含 build 与 unit project。

- [ ] **Step 4: 跑 App 全量测试和类型检查**

Run: `pnpm --filter happy-app exec vitest run`

Expected: PASS。

Run: `pnpm --filter happy-app run typecheck`

Expected: PASS。

- [ ] **Step 5: 检查差异和敏感信息**

Run: `git diff --check && git status --short && rg -n "/Users/|private-project|ps -A|args=" packages/happy-app/sources/components/systemHealth packages/happy-app/sources/utils/systemHealth.ts`

Expected: `git diff --check` 无输出；最后一个 `rg` 无输出。CLI 中命令 fixture 可以包含合成路径，但生产同步类型和 App 代码不得出现。

- [ ] **Step 6: 提交**

```bash
git add .gitignore packages/happy-cli/src/daemon/systemHealth/systemHealthPayload.test.ts
git commit -m "test(monitor): enforce payload and review safety limits

Generated with [Claude Code](https://claude.ai/code)
via [Paws](https://paws-landing-eo4.pages.dev)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: 在 Mac mini 上运行 30 分钟只读 POC

**Files:**
- No committed files.
- Local evidence only: `artifacts/interaction-review/mac-mini/`

**Required skill:** `dev-tools:ssh-connect`。先完整读取 skill 与 `experience.local.md`，使用其中的 Mac mini 别名、代理和 daemon 工作流；若其中信息与下列速查冲突，以 skill 为准。

- [ ] **Step 1: 只读检查远端连通性和 ARM 架构**

Run: `ssh jacky@100.109.106.78 'uname -m; sw_vers; happy daemon status; df -h /'`

Expected: `uname -m` 为 `arm64`，SSH 可达；若 daemon 不健康，先记录现状，不执行清理或 kill。

- [ ] **Step 2: 建临时远端 POC worktree**

在远端找到 Happy repo 根目录，验证它是 Git 仓库后，在同级创建 `happy--mac-system-monitor-poc`；禁止覆盖远端主工作树：

```bash
ssh jacky@100.109.106.78 'repo=$(find "$HOME" -path "*/happy-study/happy/.git" -type d -print -quit | sed "s#/.git$##"); test -n "$repo"; cd "$repo"; git status --short --branch'
```

把本地已提交分支打成 bundle 传到远端，再从 bundle 建 sibling worktree。执行前先确认远端目标目录和 POC 分支都不存在；若存在，停止并人工确认，不能删除：

```bash
git bundle create /tmp/happy-mac-system-monitor.bundle feat/mac-system-monitor
scp /tmp/happy-mac-system-monitor.bundle jacky@100.109.106.78:.happy-mac-system-monitor.bundle
ssh jacky@100.109.106.78 'repo=$(find "$HOME" -path "*/happy-study/happy/.git" -type d -print -quit | sed "s#/.git$##"); parent=$(dirname "$repo"); target="$parent/happy--mac-system-monitor-poc"; test -n "$repo"; test ! -e "$target"; ! git -C "$repo" show-ref --verify --quiet refs/heads/feat/mac-system-monitor-poc; git -C "$repo" fetch "$HOME/.happy-mac-system-monitor.bundle" feat/mac-system-monitor:refs/heads/feat/mac-system-monitor-poc; git -C "$repo" worktree add "$target" feat/mac-system-monitor-poc'
```

- [ ] **Step 3: 使用远端原生 ARM Node/pnpm 构建 CLI**

在临时 worktree 复用远端主仓库 `node_modules` symlink（存在时），否则用远端 `/opt/homebrew` ARM 工具链执行 `corepack pnpm install --frozen-lockfile`。随后：

Run remote: `HAPPY_SYSTEM_HEALTH_MONITOR=1 pnpm --filter happy-cli run build`

Expected: PASS；`node -p process.arch` 输出 `arm64`。

- [ ] **Step 4: 以 feature flag 启动 POC daemon**

按 ssh-connect skill 的远端 daemon 启动方式，注入 `HAPPY_SYSTEM_HEALTH_MONITOR=1`，保留既有 server URL、代理和 Happy home。不得同时启动第二个争抢同一 daemon lock 的实例；需要切换版本时使用项目已有优雅 stop/start 命令。

- [ ] **Step 5: 连续观察 30 分钟**

每 5 分钟记录一次 Paws 页面状态和远端只读对照：

Run remote: `/usr/bin/top -l 2 -s 0 -n 0 | tail -20; /usr/sbin/sysctl -n vm.swapusage; /bin/ps -A | /usr/bin/wc -l`

Expected: 正常网络下 Paws 最新 complete 样本延迟不超过 30 秒；30 分钟后趋势达到 30 个自然分钟桶；数值量级与远端对照一致；daemon 日志没有并发 state update、未处理 rejection 或持续采集超时。

- [ ] **Step 6: 验证异常可提前发现但不执行处置**

只使用自然产生的负载或已有进程观察 warning/critical；不得为了测试 fork bomb、填满磁盘、制造 swap 或启动无限循环。若 30 分钟无告警，用自动化 fixture 作为告警状态证据，实机只证明采集、同步和 freshness。

- [ ] **Step 7: 保持 POC daemon 在线供 PC 评审**

再次验证 `happy daemon status`、feature flag 和最后样本时间，把 POC daemon 保持在线进入 Task 12。临时 worktree与 bundle 都保留，不删除任何远端数据；最终是否长期保留由 PC 评审结论决定。

---

### Task 12: 用 PC 交互评审核验 Paws 集成质量

**Files:**
- No committed files.
- Local evidence only: `artifacts/interaction-review/macos-system-monitor/<timestamp>/`。

**Required skill:** `pc-web-interaction-reviewer`，并按它要求调用浏览器控制能力。开始前必须询问用户是否复用当前 Chrome 登录态；用户选隔离环境时不得读取当前浏览器会话。

- [ ] **Step 1: 启动真实 Expo Web**

Run: `pnpm --filter happy-app web`

Expected: 读取终端实际输出的 Expo URL，不假设固定端口；保持进程运行。

- [ ] **Step 2: 走唯一真实 E2E 路径**

从 machines 列表进入 Mac mini 详情，再滚动到系统监控。只使用远端真实 `daemonState`，不在浏览器注入 mock。验证监控区块位于 launch 区之前，且不会改变启动会话、返回、刷新等既有操作。

- [ ] **Step 3: 检查四个桌面/移动视口**

依次验证 1440×900、1280×720、1024×768、390×844。每个视口记录截图，并检查：无横向溢出；四条趋势可辨认；latest/min/max 不互相挤压；来源长名称截断；warning/critical 不只依赖颜色；键盘 focus 与屏幕阅读器 label 可用。

- [ ] **Step 4: 验证真实状态下的实时刷新**

停留至少 45 秒，确认 updated age 和至少一个当前指标随 daemonState 更新，不需要手动刷新。E2E 不停止 daemon、不制造断网或高负载；offline、delayed、unavailable、warning、critical 的非当前状态只引用 Task 7/8 自动化证据，无法从真实状态观察时明确标记“证据不足”。

- [ ] **Step 5: 输出只读 PC 评审报告**

报告写入本次时间戳证据目录的 `report.md`，每项记录视口、复现动作、实际结果、影响、预期、严重度和证据，只给出“通过 / 不通过 / 证据不足”。本步骤只读，不在浏览器评审中顺带修改代码；发现 blocker/major 时结束评审，将问题转成后续独立 TDD 修复任务，修复后再按原路径复评。

- [ ] **Step 6: 最终验收**

Run: `review_dir=$(find artifacts/interaction-review/macos-system-monitor -name report.md -print | sort | tail -1); test -n "$review_dir"; git status --short --branch; git diff --check; git check-ignore -v "$review_dir"`

Expected: 功能文件全部已提交；无未提交代码差异；评审报告命中 ignore。

Run: `pnpm --filter happy-cli test && pnpm --filter happy-app exec vitest run && pnpm --filter happy-app run typecheck`

Expected: 全部 PASS。

验收结论必须明确回答：Mac mini 是否在线、最近样本延迟、30 分钟趋势点数、是否发生告警、主要资源来源、PC 四视口结果、仍存在的 POC 限制。
