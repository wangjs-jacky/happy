# 狗头军师专属侧栏验收

2026-09-06，Ego Lite 隔离任务空间 88，本地 authenticated-empty 环境；修复前 `7ca7f327`，修复后 `d19df147`。同一视口 1440×900，DPR 1，同一测试账号/历史数据。实际生产 Web 未发布。

| Case | 操作与结果 | Before | After |
| --- | --- | --- | --- |
| C1 | 进入 `/relationship-advisor?conversationId=advisor-demo-1`，普通会话/分类栏消失，只显示军师专属历史 | case-1-before.png | case-1-after.png |
| C2 | 点击普通“历史对话”入口：修复前停留军师页，修复后回到 `/` 并恢复通用列表 | case-2-before.png | case-2-after.png |

补充行为检查：30 条军师历史；专属列表高度 888px，滚动区域 852px、内容 1502px，可滚至 scrollTop=650。选择第二条会话后 conversationId 和右侧消息均匹配。新建生成新 ID 并显示空白对话，历史总数受现有上限约束仍为 30。

独立视觉复审 PASS：专属隔离、列表高度、选中态、新建和删除入口发现性均无阻断发现。删除确认、键盘和其他主题未包含在本次用户确认的两场景范围内。

网络与页面：第一次切回首页时观察到一次后台 `TypeError: Failed to fetch`，未记录到 URL，原因未确定。随后加入请求 URL 记录，完整往返和录屏两次复跑均无新增失败请求、HTTP >=400 或页面 error/unhandledrejection。该瞬时现象已保留，不归因于修复也不声称根因已解决。

数据：4 条普通开发会话 + 30 条军师历史均为隔离夹具。Before 的插件目录使用与真实清单一致的已安装夹具；After 改用隔离服务端真实安装状态。插件使用 example.invalid，不发送 AI 请求。未读取或修改生产账号数据。

录像 `advisor-sidebar-acceptance.mp4`：同 Case 成功后的复跑，0–2s 展示专属列表，2–4.6s 切换第二条军师会话，4.6–7.2s 返回普通历史。1440×900 H.264，30fps，216 帧，完整解码通过；三个阶段抽帧核对。视频使用连续 Ego 页面采样，按固定时间间隔编码，仅展示操作顺序，不用于计时性能结论。截图和视频已通过 Happy 媒体工具交付，手机实际播放未由用户确认。

最短重放路径：使用 `environments/environments.ts` 的 `createEnvironment({noSwitch:true})`、`startEnvironmentServices(...,{startWeb:false})`、`seedEnvironment(...,{startDaemon:false})` 与 `startEnvironmentWeb` 启动隔离实例；使用该实例 authenticatedWebUrl 登录 Ego。测试数据写入本地实例与其 local-settings，所有网页操作只经 `ego-browser nodejs`。在相同实例重放 C1/C2，按 DOM testID 断言第二栏专属列表/普通列表互斥，并逐轮通过 `report_browser_step` 回传截图。结束后停止并删除隔离环境。
