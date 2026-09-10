# 实时正文与慢请求回归证据

实现版本：`9e1d3a96d40d521072557064617250b72e106701`。
开发基线：`38af1519f6e7b627789a4e4ee0a889f685789adf`。
验证日期：2026-09-09。平台：真实 Paws Web，1440×900 CSS px，DPR 1。

## 范围与结果

| Case | 普通回归 | 录像复跑 | 通过标准 |
| --- | --- | --- | --- |
| LIVE-HTTP-01 | pass | pass | 历史 HTTP 未返回时，连续实时消息进入列表；阅读位置不被抢走；真实滚轮可看到末尾；旧响应不回退或重复正文 |
| RESULT-SYNC-02 | pass | pass | 执行完成但正文有已知缺口时显示“执行完成，正在同步结果”；补齐后显示正文并恢复完成 |

独立代码评审、独立 PC 交互评审及独立视频评审均通过。
用户确认范围为这两个操作场景的必要截图和录像；没有另行运行旧版 Before 截图矩阵。
本目录图片均是修复版本不同操作状态，不能当作修复前后对比。

## 截图与视频

- [历史请求仍挂起，实时正文末尾可达](live-http-pending.png)
- [执行结束但结果尚在同步](result-syncing.png)
- [正文补齐，末尾可达并恢复完成](result-complete.png)
- [两个 Case 的连续回归录像](regression.mp4)

MP4：H.264、yuv420p、1440×900、30 fps、12.333 秒、461127 字节、静音、faststart。
`ffprobe` 校验及 `ffmpeg -v error -i regression.mp4 -f null -` 完整解码通过。
首尾、跨全片抽帧及关键状态视觉检查通过；截图和 MP4 已通过 Happy 发送。
未声称已在手机实际播放，也未以 PC 录像代替原生移动端验收。

视频按 267 张 CDP screencast 帧和总时长统一帧率编码，不是逐帧墙钟重建。
前半段展示慢 HTTP 下实时正文到达与手动滚动；中段展示结果同步提示；结尾展示最终正文。
精确异步关系以如下断言为准，不能仅凭画面推断 HTTP 已挂起。

## 实测断言

普通 LIVE-HTTP-01：

- 基线 applied=41；上滑后 scrollTop=3905，scrollHeight=4936，clientHeight=626。
- 保持 after_seq=41 的请求挂起，真实服务端写入并通过 socket 推送消息 42。
- HTTP 仍未返回时 applied=42，scrollHeight=5630；scrollTop 仍是 3905。
- 三次真实滚轮后 scrollTop=5004，`5004+626=5630`；END 文本 y=605..623，在列表 y=56..682 内。
- 释放预先读取的旧空响应后，消息仅出现一次，applied、位置与高度不回退。

普通 RESULT-SYNC-02：

- 两行批量写入创建 43/44，服务端批量消息接口仅推送最后一行，产生真实 socket 序号缺口。
- forward HTTP 挂起时 known=44、applied=42；已有正文保留，缺失正文未假装出现，同步提示可见。
- 释放真实 API 的两行响应后 applied=44，两行正文出现，提示消失，末尾可滚到。

录像复跑：

| 阶段 | applied | scrollHeight | scrollTop | 末尾可见 | 正在同步 |
| --- | --- | --- | --- | --- | --- |
| 基线 | 44 | 7018 | 5992 | 否 | 否 |
| 实时消息到达，HTTP 仍挂起 | 45 | 7712 | 5992 | 否 | 否 |
| 手动滚到新正文末尾 | 45 | 7712 | 7042 | 是 | 否 |
| 结果 46/47 存在缺口 | 45 | 7712 | 7042 | 新结果否 | 是 |
| 结果补齐并滚到末尾 | 47 | 9100 | 8451 | 是 | 否 |

## 最短复跑方案

这是受控故障注入的真实 App 集成回归，不是 mock UI，也不是生产会话重放。

1. 在独立 worktree 使用 `environments/environments.ts` 创建 `noSwitch` 环境；设置 `authenticated-empty` 模板，仅启动 server、seed（`startDaemon:false`）和 Web。全部使用合成测试账号、项目与正文。
2. Ego 打开该环境的真实 Web，完成隔离登录后移除认证 query，再开始截图/录像。确认构建的 `Sync` 已含 `queueMicrotask` 修复，不固定使用跨构建可能变化的 Metro module ID。
3. 创建足够产生滚动的合成会话，读取实际 projected frontier。Ego CDP `Fetch.enable` 仅拦截该隔离 session 的 `/v3/sessions/:id/messages?after_seq=*`，其他请求放行。
4. 为确定性地制造在途历史请求，调用当前实例 `pendingHistoryTargets.set(sessionId, projected + 1)` 与 `getMessagesSync(sessionId).invalidate(projected + 1)`。此处是测试触发点；没有替换真实网络、socket、store 或列表。
5. LIVE-HTTP-01：拦截到正确 cursor 后，用 Node 侧隔离 API 预先读取旧响应；随后 POST 一行合成正文。HTTP 保持挂起时断言 applied、列表高度、原位置，再滚到 END。最后 `Fetch.fulfillRequest` 释放旧响应，检查不重复/不回退。
6. RESULT-SYNC-02：在下一条 forward 请求挂起时批量 POST 两行正文并保持真实会话 execution 为 completed；确认 known > applied 且完整同步提示可见。读取并释放真实 API 响应，检查两行均出现且提示清除。
7. 对实际 `[data-testid="conversation-transcript-list"]` 测量边界，再以 `Input.dispatchMouseEvent({type:'mouseWheel',x,y,deltaX:0,deltaY:450})` 向列表中心发送真实滚轮。当前 Web 为正常方向，正数向最新内容滚动。用 END 文本的 DOM rect 与列表 rect 相交断言终点，不能只等固定延时或假定滚轮已生效。
8. 普通模式先通过，再用 CDP `Page.startScreencast` 录像复跑同一 Case；每轮使用 `captureVerifiedBrowserStep` 私有截图并报告给 Happy。最后停服务并删除本次创建的隔离环境，不碰用户 daemon 或生产数据。

首次探索中 Ego 通用 scroll helper 未可靠把滚轮发给列表，导致“末尾可见”断言失败；切换上述定点真实 wheel 后完成普通与录像回归。这是测试操作定位问题，未记为一次通过，也没有修改产品代码绕过它。

## 自动化验证与边界

- 相关 11 个测试文件共 364 项：最终完整 visibility suite 165/165 通过，其他 10 个相关文件 199 项通过；不是一次全量无失败运行。
- 早先并行组合运行出现 2000 行压力用例超时及一次本地 paint 等待失败，隔离重跑通过；最后完整 visibility suite 再跑通过（约 94 秒）。
- `pnpm typecheck` 通过；实现此后没有修改，仅追加本目录证据。
- 最短逻辑回归：在 `packages/happy-app` 运行 `pnpm exec vitest run sources/sync/sync.messageVisibility.test.ts sources/hooks/useSessionResultSyncing.test.tsx sources/utils/sessionState.test.ts`，以及 `pnpm typecheck`。
- 未覆盖原生 Android/iOS、其他宽度或原生产私有会话；不能声称原用户设备已验证修好。
- Header 同步文案在当前宽度省略，输入框上方有完整提示，独立评审判为非阻塞。
- 正式 Web 未部署；待 PR 合并后的 main CI。Android runtime 23 preview OTA 已独立发布并校验，不代表真机验收。
