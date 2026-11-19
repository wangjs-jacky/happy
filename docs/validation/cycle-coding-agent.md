# 编程智能体图标轮换与按电脑配置

## 最终需求

用户否定上一版通用双向箭头，要求使用Codex/Claude Code/OpenCode自己的图标；点击当前图标轮换，无Agent下拉。用户自行配置电脑上哪些Agent参与轮换，并参考Magpie支持版本检查和更新。用户于本轮明确不需要截图；未启动浏览器截图或原生设备视觉验收。

## 行为

- 新建会话浮层右上角显示当前Agent品牌SVG，切换后换成下一Agent图标；管理入口位于浮层内，也可从设置→编程智能体进入。
- 按machineId保存启用项并通过账号设置同步。无配置默认仅Codex；显式空列表保持空，不用已安装项自动补齐。只轮换同时已启用、机器可用且Paws已有执行适配器的Agent。
- 现有五种执行器为Codex、Claude Code、OpenCode、Gemini、OpenClaw。本次没有将Magpie的全部Agent目录伪装成Paws支持。
- 模型与Agent独立；相同模型ID可保留，模型选择不切执行器。空配置时显示管理入口，禁止新建编程会话；实际派发前再次核对最新偏好。
- 设置页逐电脑展示Agent图标、已安装/当前版本/最新版本及启用开关。用户点击检查才查询远端版本，无新轮询；进入页面只检测当前安装。
- 更新复用加密machine RPC和现有有界processRunner。标准npm全局安装验证package元数据及真实路径后按确定版本更新；明确的Claude/OpenCode原生安装用原生更新器；Homebrew沿实际prefix/formula/cask更新。自定义Codex独立版本目录保持手动更新，不改安装渠道。
- 更新采用单次预览token、过期和来源/路径/版本复核、全局更新锁；拒绝任意命令和重复/过期调用，结束后重新读取实际版本。没有更新用户实际Agent、停止现有会话或替换daemon。

## 来源

参考Magpie固定提交289184a409c0e38a3a0a5282dbde93b56da309ca的internal/gui/assets/agentsmanager.js、internal/agent/cliupdate.go。图标源为Magpie同提交的Lobe Icons资产，MIT归属和许可随组件保留；没有复制轮询或读写Magpie模型配置。

## 验证与交付边界

App组件/真实Zustand状态/设置持久化/空配置派发门禁/OTA契约定向148项回归通过；wire请求白名单2项通过；CLI service、processRunner、环境RPC与machine集成47项回归通过，共197项。App/CLI typecheck与构建、Android导出通过。

真实本机只读探针按宿主正常PATH（排除pnpm exec注入的workspace .bin）确认：Codex独立目录为manual，Claude/OpenCode为可验证的npm安装，后二者能检测版本差异。未执行真实升级，不把mock更新通过称为本机已升级。初次直接从pnpm exec探测命中了开发依赖的CLI包装器，版本失败；排除开发工具注入后复验正常。自动探针遇到启动失败保留installed状态并显示check-failed。

新版界面和启用配置可通过定向preview验收；版本管理需要目标电脑运行本分支配套CLI。旧daemon明确提示先更新Paws CLI。本轮未切换当前稳定执行端、未合并或发布正式Web/production OTA，也没有验证手机已加载。前一版preview 1795093720149属于已被用户修正的箭头方案，不作为当前设计验收版本。

## 定向 preview 回执

源码提交：ce3adc22；发布时工作区干净。channel=preview，platform=android，runtimeVersion=24。stamp=1795097438405；Update ID=d3e71b9b-2476-78ac-c7ba-aff9c3e3e578。

不可变manifest：https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/24/preview/1795097438405.json

匿名读回清单核对id/runtime/源码，主包44,085,036字节完整下载并核验SHA-256与manifest一致。707项既有资源由发布脚本复用，没有逐项重新下载全部资源；未覆盖preview latest。仅代表制品发布与主包校验，用户手机加载、实际更新和正式上线未验。

当前稳定daemon未激活配套CLI；version管理在旧daemon显示需要升级Paws CLI的提示。图标与按电脑配置无需新native模块。用户单次选择不截图已在本文件保留，不扩为未来任务豁免。Android OPS的model-connection-catalog和harness已按证据补充经验；Magpie参考没有浏览器操作，无Ego成功日期写回。

