# 新建会话：独立循环切换编程智能体

用户要求：用浮层右上角的切换图标替换重置，点击一次切换一个 Agent，不增加 Agent 下拉框。Magpie 的模型名称不能决定执行 Agent。

实现：新建会话的右上角使用 swap-horizontal-outline；按 Codex → Claude Code → OpenCode → Gemini → OpenClaw 循环，仅纳入目标机器声明可用且产品支持的 Agent。模型入口和浮层显示当前 Agent，模型列表仅展示当前 Agent 的目录。选模型不切 Agent。同名模型在下一 Agent 目录存在时保留，否则解析该 Agent 的配置默认值。权限按新 Agent 默认设置，推理强度校验后保留或回退，Fast 清除。无推理选项时仍能切换；只有一个 Agent 时禁用循环按钮。

范围：截图对应的新建会话入口；已有会话保留原行为，本次没有实现已有执行线程的跨 Agent 迁移，也没有更改 Magpie 或注入新模型目录。

验证：组件、真实 Zustand 选择状态、同名 Magpie 模型、连续往返切换、不可用 Agent 过滤和 live send selection 回归；App TypeScript 检查通过。Android OTA runtime 契约通过；Android export 构建通过。未进行本轮浏览器/原生设备视觉验收，未发布正式 Web 或 production OTA。

preview 制品回执在发布完成后补充。
