# RareUI GitHub activity 与 Paws 热图集成评估

2026-11-25。已完成参考组件的真实浏览器交互、固定提交源码和许可核对，以及 Paws 当前实现审查。结论：可以承接其卡片与交互设计；建议用 Paws 现有组件独立实现。未安装组件、修改业务代码、发布或部署。

## 原界面与保留边界

- 原来源：用户本会话提供的使用情况截图，以及 main `dd5fce94c1fc2926ec795e0f89bd7d90b4ec4c35` 的 `packages/happy-app/sources/components/usage/UsagePanel.tsx`。
- 截图可见滚动年度日历、月份标签、热度图例及大块日详情；本次源码审查没有启动 Paws 真实页面，不把源码或截图当成真实 Paws 浏览器验收。
- 保留使用情况弹窗、上方账号 quota、机器活动来源及下方 API 用量；改动目标仅为年度活动组件及其日详情。
- 原位技术来源是 React Native/Expo + Unistyles。颜色沿用当前 `surface`、`surfaceHigh`、`accent`、`text`、`textSecondary` 和 `divider`；选中/焦点使用独立边界，不能覆盖热度底色。

## RareUI 实际观察

官方页面：[GitHub activity](https://www.rareui.com/components/githubactivity)。已通过 Ego 真实操作：

1. 从组件目录进入目标组件，阅读参数及许可说明。
2. 点击 Show top repositories，看到展开的三行仓库排名；点击 Hide top repositories 收起。
3. 悬停日期格，读回对应日期及贡献数提示。三个关键结果已通过同一 runId 回传 Happy Skills。

真实预览采用紧凑圆角卡片、约11px方格、3px间隙；底部折叠条展开后覆盖网格。预览标题为2025年贡献数，属于作者固定演示数据，不是当前真实 GitHub 统计。

浏览器已验证的是参考组件的展开/收起/鼠标悬停，不包括 Paws 集成、手机、键盘或所有断点。

## 当前 Paws 为什么显得奇怪

| 现象 | 源码原因 | 改法 |
|---|---|---|
| 网格显大，容器较窄时裁切或强制横滚 | cell min=max=16，gap min=max=4；53周固定占1056px，外加24px | 采用明确的紧凑密度；保留全年可横滚，不因窄屏静默删除早期周 |
| 高用量日期选中后变灰，像空数据 | selected/hover/pressed 覆盖活动底色 | 保留强度底色，用独立外圈表示选中和焦点 |
| 调整窗口或数据更新时跳回最近日期 | onLayout/onContentSizeChange 每次 scrollToEnd | 只首次定位最近日期，其后保留用户滚动位置 |
| 两个“11月”，缺少范围上下文 | 滚动365天跨年，但缺少年份/准确日期范围 | 显示实际起止日期，月份与星期对齐 |
| 悬停看详情需要看下方大卡 | 没有格旁提示；hover直接改整块详情 | 鼠标/键盘聚焦显示短提示；点击固定选中日并展示详情 |
| 键盘操作繁琐 | 每格Pressable，无方向键/单一Tab停靠策略 | 焦点与hover等价，使用方向键逐日/逐周移动，保持可见focus-ring |

已执行纯日期模型：当前窗口为2025-11-26至2026-11-25，365天/53周；日期本身不是月份错位。

## 数据可以直接适配，组件不能无改动安装

RareUI 的自定义输入为 `Contribution { date, count, level: 0|1|2|3|4 }[]`。Paws 已有每日日志汇总，可把 `totalTokens` 映射为热度值；日提示继续拆分非缓存输入、缓存、输出，标明含缓存总量。

不提供 `username`，不调用其 GitHub/第三方贡献 API。原组件同时依赖 HTML、react-dom/createPortal、motion/react、ResizeObserver、Tailwind 及 utils，不能直接在 React Native 上运行。

源码还有需主动修正的边界：自定义数组简单按7天分组，不自动排序补日或对齐星期；响应式策略会隐藏早期周，但标题仍统计全部数据；日格仅支持pointer hover；没有Paws所需的日期选择回调、token formatter和locale。直接换组件仍会留下数据理解和触控问题。

## 建议的具体接入形态

1. 顶部：保留“过去一年的活动”，补准确日期范围和机器级统计说明；使用紧凑图例。
2. 主体：约11–13px的紧凑格子、约3px间隙，月份与星期定位清楚；宽屏完整显示，窄屏横向查看全年。热度、选中和焦点相互独立。
3. 悬停/焦点：格旁显示日期、含缓存总量和会话数；触控点击可得到等价信息。
4. 底部：借鉴 RareUI 的收起/展开层次，将现有大详情改成可展开的“所选日期明细”，展示非缓存输入、缓存、输出。
5. 不照搬作者仓库排名。Paws 当前日汇总没有模型/项目/会话排行明细；该能力需后续请求账本支持，不能用假数据填充。
6. 模型与展示分离：纯 `codexActivityCalendar.ts` 负责日期/强度；Web实现隔离DOM交互；RN实现保留触控。`UsagePanel`仅消费现有快照，不改变quota选择和RPC。

这是可实施方案，尚未制作原型或替换真实组件。验收应覆盖跨年/闰日/时区、约360/768/1280px宽度、深色非默认主题、hover/点击/键盘、滚动保留及减少动态；现有mock RN测试不能替代真实页面验证。

## 许可与一手来源

固定SHA：`0e9f0ef86bd690b16175fb81950ce38a5e689cd4`。

- [组件源码](https://github.com/swamimalode07/rare-ui/blob/0e9f0ef86bd690b16175fb81950ce38a5e689cd4/components/ui/github-activity.tsx)
- [Registry数据](https://github.com/swamimalode07/rare-ui/blob/0e9f0ef86bd690b16175fb81950ce38a5e689cd4/public/r/github-activity.json)
- [LICENSE](https://github.com/swamimalode07/rare-ui/blob/0e9f0ef86bd690b16175fb81950ce38a5e689cd4/LICENSE)

实际许可为 MIT + Commons Clause + Attribution，并非标准MIT。允许作为应用/网站/产品的一部分使用，要求保留版权与许可并提供可发现的Rare UI链接；对组件本身及移植版本的再分发等另有限制。不能把复制部分直接重标为Paws的纯MIT源码，也不能泛称开源应用完全不可使用。

本轮没有复制第三方运行代码。推荐参考其可观察交互独立实现Paws组件；若后续明确选择复制原组件，应独立保留其许可与署名并核对具体分发范围。
