# Personal 隔离浏览器电脑验收

2026-11-14，分支 personal-dots。Before 可重放基线：3005863d39f09312871955829b2e1cc99b55f2d2。方案以用户指定报告重新设计，并按追加决定使用固定 chrome-use v1.5.291；不宣称未能观察的 dots 已经完成 1:1。

| Case | 结果 | 实际证据 |
| --- | --- | --- |
| P1 个人对话 | 通过 | 完整 App、隔离 PGlite、真实加密消息/RPC；发送、固定审批、停止、同 ID 重连、多行草稿刷新。回复与审批执行为测试替身，无外部模型。 |
| P2 新建及返回 | 通过 | 显式 Docker 选择、旧执行器能力门禁、历史切回原 local、草稿保留；组件与真实 App 均覆盖。 |
| C1 浏览器工具 | 通过 | 真实 Docker Linux ARM64；chrome-use 连接精确标签、交互快照、引用填表/按键/点击提交并读回成功。 |
| C2 控制链 | 通过 | 真实加密电脑 RPC 与 1280×800 图像；查看、接管、导航、展开/分栏、关闭仍暂停、重新接管、交还只读、停止。 |
| C3 隔离及恢复 | 通过 | 真实 Docker：workspace/profile marker 重启保留；旧 viewer 与 Agent 动作拒绝；接管终止子进程；metadata 403；任务无法访问浏览器 CDP/profile。Stop 移除容器/网络，保留卷。 |
| V1 桌面视觉 | 通过 | 独立 reviewer 核对5项桌面视觉/状态；1680×960 默认深色、Gingham Dark 及 1024×900 桌面，无横向溢出；展开画面可读。截图未外推为键盘焦点或原生验收。 |

复跑入口：[完整 App 验收](../../packages/happy-app/e2e/fixtures/personal-agent/README.md)。真实 Docker 单独运行：

```sh
PAWS_COMPUTER_SMOKE=1 pnpm exec tsx --tsconfig packages/happy-cli/tsconfig.json packages/happy-cli/src/personal/computer/smoke.ts
```

该命令显式创建隔离电脑，结束时停止并保留资料卷。

最终定向 App：6 suites / 67 tests；CLI engine/config/tools/runtime：6 suites / 69 tests。完整 App 类型检查、CLI 构建及 SDK/wire 构建通过。另先前完整 sync.messageVisibility 等集成集合 249 项通过；最后 UI 改动由定向回归覆盖，未声明整仓测试。CLI 构建保留既有 goalBoard circular-dependency 警告，构建后的 `personal --help` 已实际运行。

独立评审与真实集成中修复了：帧 epoch/sequence 与断线解密竞争、无界解密并发、控制转换竞争、重复 Start、停机/attach 和 dispose 清理、重复 view 与 ACK 失败后假直播、Stopped 标题误报、旧对话可达性、展开画面可读性及停止后的网络池资源残留。

录像为同一候选的两个隔离片段，使用真实 Ego 屏幕采样及绑定关键帧：25.9 秒、1680×960、H.264/yuv420p/30fps、无音轨、faststart；完整解码及全时段/展开关键帧检查通过，已通过 Happy 媒体卡发送。不把采样视频描述为 30fps 原生采集；尚未确认另一手机实际播放。详细证据保存在本机 ignored test-results 及 Goal First 目标，不公开账号资料。

边界：单标签 Linux 浏览器电脑，非完整 OS 桌面；Chromium 使用 `--no-sandbox`，不具备已验证的多租户 microVM 隔离。弹窗切换到其他标签会拒绝操作，当前不自动接管新标签。真实账号登录 Cookie、真实外部模型浏览器任务、Android/iOS 真机和跨设备实际接管未验。Linux ARM64 已运行，Linux x64 包哈希已核但未实际运行。

未合并 main、未发布 Web/OTA/npm，未替换生产 daemon 或既有 worker。日常网页调研/验收仍使用 Ego；chrome-use 例外仅限此隔离电脑。
