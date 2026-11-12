# Magpie 账号面板验收

基线：`d1b9c0628c787df2435a1633200c52b6364e11c3`。目标是设备环境页的账号、额度展示和简单控制。

## 实现范围

- 按设备读取已安装 Magpie 的账号、套餐、额度窗口、读取时间和当前登录；未安装、离线、读取失败分别提示。
- 手动刷新单个账号额度、修改别名；确认后切换设备上的 Agent 登录，并重新读取核对结果。
- 操作经现有加密 machine RPC 交付给设备；命令固定、无 Shell 拼接、无自动写重试，未知结果要求手动重新读取。
- 原 Happy 账号、设备绑定与隔离会话仍单独管理。没有迁移认证、修改运行中会话或接入 Magpie 模型网关。
- 不开放本机管理端口，不复制 OAuth 凭据；新增链路没有轮询。Magpie 自己会读取/缓存额度，不能据此称额度实时；原 Happy 账号观察器已有周期同步，本次未改变该既有路径。

## Case 与证据

| Case | 通过标准 | 结果与边界 |
| --- | --- | --- |
| M1 账号展示 | 所选设备、账号、额度及读取时间一致 | 受控真实组件浏览器通过；新设备适配器真实读取本机两个 Codex 账号通过 |
| M2 手动刷新 | 单次对应账号动作，读回最新状态 | 浏览器动作计数一次；真实 Magpie 刷新通过 |
| M3 别名 | 本地校验，保存后核对名称 | 浏览器一次改名；真实临时别名保存/读回/恢复通过，登录未变 |
| M4 登录切换 | 取消零动作，确认一次，读回当前账号 | 合成账号浏览器通过；真实账号切换未执行，避免影响当前工作 |
| M5 作用域/异常 | 不展示旧设备库存，离线禁用，迟到响应隔离，未知写不报成功 | 组件回归通过；浏览器未安装清除通过 |
| M6 自适应 | 非默认深色主题、390px无横向溢出 | 1680×885与390×844通过；独立PC截图评审通过。未验原生移动端 |

浏览器入口复用 `packages/happy-app/sources/trash/environment-dashboard/build.mjs`，使用真实 `DeviceEnvironmentView`、`MagpieSection`、`useMagpie` 和协议schema，替换 RPC、认证及确认/输入边界。确认框为浏览器原生对话框；这不证明正式App Modal的焦点/Escape。

真实适配器探针与浏览器证据分开：适配器读取/刷新/临时改名通过；现有 `RpcHandlerManager` 加密请求→真实适配器→加密响应的只读往返通过。未启动正式设备daemon，未验证生产socket全链路。

## 自动检查与独立评审

- CLI `src/magpie/service.test.ts`：14项通过，覆盖白名单投影、参数校验、无确认拒绝、账号消失、单次刷新、别名/切换读回、未知写和并发拒绝。
- App：`MagpieSection.test.tsx` 13项、`DeviceEnvironmentView.test.tsx` 25项、桌面设置Modal集成1项通过，共39项。
- happy-wire构建、CLI构建以及CLI/App typecheck通过。新工作树先构建paws-agent，解决其缺dist的初始化检查失败。
- 独立代码评审通过；发现的无效名称误报连接失败、设备Web选中语义缺失已修复并复跑。
- 独立PC截图评审通过；不等同完整键盘/hover或正式App的交互验收。

最短回归：先构建 happy-wire、paws-agent；CLI运行 `pnpm exec vitest run --project unit src/magpie/service.test.ts`，App运行上述三份测试。浏览器仅使用 Ego。

## 可视证据与上线边界

四个本轮关键结果帧已通过Happy Skills面板回传。前后截图需求已询问，用户尚未回复，未制作PR前后对比组。

`packages/happy-app/test-results/magpie-panel/magpie-panel-states.mp4` 为本轮四状态演示（非连续录屏），12秒、1280×720、H.264/yuv420p、30fps，完整解码通过并已通过Happy发送。合成账号不含真实凭据；未确认用户手机播放。

源码尚未合并、Web/OTA未发布、正式CLI未激活。上线需要客户端与目标设备的Paws CLI同时包含此变更；旧CLI显示连接/升级提示，不会伪造安装状态。
