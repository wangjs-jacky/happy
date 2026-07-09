# 健康面板扩展 · 运动 + 饮食 + 域切换 Implementation Plan

> 承接睡眠面板（同分支 `health-sleep-contract` / PR #174）。方向 A：域切换。

**Goal:** 把健康打卡面板从「只有睡眠」扩成「睡眠/运动/饮食」三域切换，运动/饮食走稳健指标（打卡频率/摄入热量），不套睡眠的重 Hero。

**关键现实（决定设计）：** 运动/饮食数据极稀疏、且运动常无量化（`消耗卡路里: null`）。故运动趋势用 `hasExercise` 打卡频率（不用热量），饮食趋势用 `汇总.摄入卡路里`。

## File Structure
- Modify `sources/utils/healthLog.ts`：HealthLog 加 `exerciseTypes/exerciseBurn/meals/intakeKcal`；`extractSection` 帮助函数；`buildExerciseView`/`buildDietView`
- Modify `sources/utils/healthLog.test.ts`：新增单测
- Modify `sources/sync/localSettings.ts`：加 `healthActiveDomain: 'sleep'|'exercise'|'diet'`
- Modify `sources/text/translations/*.ts`（10）：新增 `healthPanel.*` 运动/饮食/切换 字符串
- Create `sources/components/rightPanel/HealthDomainSwitcher.tsx`：顶部三域分段 + 今天已记录圆点
- Create `sources/components/rightPanel/ExerciseCard.tsx`：今日运动 + 本周频率
- Create `sources/components/rightPanel/DietCard.tsx`：今日餐次 + 本周摄入热量
- Modify `sources/components/rightPanel/HealthCheckinPanel.tsx`：切换器 + 按域渲染

## Chunk 1: 解析层（TDD）
### Task 1: extractSection + 运动/饮食解析 + 视图模型
- HealthLog 追加：
  - `exerciseTypes: string[]`（运动块内所有 `类型:` 值）
  - `exerciseBurn: number | null`（运动块内 `消耗卡路里:` 数字之和；无则 null）
  - `meals: { name: string; kcal: number | null }[]`（饮食块逐项 `餐:`+`卡路里:`）
  - `intakeKcal: number | null`（`汇总.摄入卡路里`；无则退化为 meals kcal 之和；再无则 null）
- `extractSection(fm, key)`：取顶层 `key:` 到下一个顶层键（列 0）之间的缩进块文本。正则：`(?:^|\n)${key}:[ \t]*\n((?:[ \t]+.*(?:\n|$))*)`。
- 解析规则（在 section 文本内、避免跨块串味）：
  - 运动 types：section 内 `类型:\s*(.+)` 全匹配 → trim。
  - 运动 burn：section 内 `消耗卡路里:\s*(\d+)`（`null` 不匹配 `\d+`，自动跳过）求和；无匹配→null。
  - 饮食 meals：按 `- ` 或 `餐:` 切项；每项 `餐:\s*(.+)` 名字 + `卡路里:\s*(\d+)` 数字（无则 kcal=null）。
  - intakeKcal：`摄入卡路里:\s*(\d+)`（唯一键，可整串抽）；无→meals kcal 求和；无→null。
- `buildExerciseView(log): { types: string[]; burn: number|null } | null`（无 types 且无 burn → null）
- `buildDietView(log): { meals; intakeKcal: number|null } | null`（无 meals 且无 intakeKcal → null）
- **TDD fixtures（真实数据）**：
  - 运动 06-17：`运动:\n  - 类型: 力量/健身房\n    消耗卡路里: null` → exerciseTypes=['力量/健身房'], exerciseBurn=null。
  - 饮食 07-09：`饮食:\n  - 餐: 夜宵\n    卡路里: 760\n汇总:\n  摄入卡路里: 760` → meals=[{name:'夜宵',kcal:760}], intakeKcal=760。
- 验证：`pnpm test -- healthLog --run` 全绿 + `pnpm typecheck`。

## Chunk 2: localSettings + i18n
### Task 2: localSettings `healthActiveDomain`（enum sleep/exercise/diet，默认 sleep）
### Task 3: i18n 10 语言新增 `healthPanel.*`：`sleepTab/exerciseTab/dietTab`（切换）、`exerciseToday/noExerciseToday/burnedKcal/exerciseFreqTitle`、`dietToday/noDietToday/intakeTitle/intakeKcalUnit`、`kcalSuffix`、以及域感知记录按钮 `logSleep/logExercise/logDiet`（或复用 logToday）。

## Chunk 3: 组件 + 面板组装
### Task 4: HealthDomainSwitcher（分段控件，props: active, onSelect, doneMap{sleep,exercise,diet}）
### Task 5: ExerciseCard（props: view + trend[HealthLog]）：今日 类型 列表 + 消耗；本周按 hasExercise 逐日打卡条（有=实心）
### Task 6: DietCard（props: view + trend[HealthLog]）：今日 餐+卡路里 + 摄入合计；本周每日摄入热量 bars（复用 barTrack/barFill）
### Task 7: HealthCheckinPanel 接入 `useLocalSettingMutable('healthActiveDomain')`：顶部 Switcher；按 active 渲染 睡眠(Hero+Trend)/运动/饮食；记录按钮域感知；移除底部三对勾卡（信息进 Switcher 圆点）
- 验证：typecheck + 全量 test + 交互（切换持久化、空态、真机）。

## Chunk 4: 契约 + 迁移 + 验收
### Task 8: `健康打卡/CLAUDE.md` 补运动/饮食格式规范（消耗卡路里/卡路里/摄入卡路里 纯数字、缺失整行省略禁 null）
### Task 9: 迁移 06-17：删 `消耗卡路里: null` 行（禁 null）；`自拍:` 非 schema 键——移到 `备注` 或删（保留原图记录）
### Task 10: `pnpm typecheck` + `pnpm test --run` + push（更新 PR #174）+ `pnpm ota:selfhost:preview`

## YAGNI
不做：净卡路里能量平衡卡（数据不足）、运动距离/心率可视化、饮食营养素、体征域。
