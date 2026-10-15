# Mermaid 图片预览验收

目标：聊天正文完整缩略展示流程图，点击进入全屏，再缩放和拖拽阅读。
基线：`b5953bf995da2c62690532366cb36cb719b43a5f`。

## 真实组件复跑

```sh
node packages/happy-app/e2e/fixtures/mermaid/serve.mjs
```

仅监听 `127.0.0.1:49828`，使用实际 MermaidRenderer、Mermaid、Panzoom、React Native Web
以及 `ginghamDark` / `caramelLight` 主题。WebView 与图标的原生加载边界被隔离；
图标使用实际 Feather 字体。内容为合成流程图，不连接生产会话、不发送消息。

通过 Ego 创建一次任务空间，记录 numeric spaceId 和 p1 的精确 targetId，
打开 `http://127.0.0.1:49828/?theme=dark` 后调用：

```js
const { verifyMermaidPreview } = await import('file:///absolute/worktree/packages/happy-app/e2e/fixtures/mermaid/verify.ego.mjs');
await verifyMermaidPreview(
    { taskSpace, cdp, pageInfo, currentTab, listTaskSpaces, useOrCreateTaskSpace },
    { taskSpaceId: RECORDED_SPACE_ID, targetId: RECORDED_TARGET_ID, record: false },
);
```

`record: true` 在同一组已通过动作后生成新的、归属校验过的 JPEG 帧，用于逐状态演示；
它不是连续录屏。Happy 关键步骤截图另走当次 session/run 绑定的捕获与上报工具。
结束后关闭本次任务空间并停止该服务。用户要求前后截图时才加 `--before` 构建固定基线。

## 2026-10-15 结果

| Case | 结果 |
| --- | --- |
| BOUNDED-WHOLE-IMAGE | 完整图片成功解码，画布≤320px，后文同屏；无内联 SVG 手势或缩放工具栏 |
| PAGE-SCROLL | 鼠标位于缩略图上时普通滚轮滚动页面 |
| KEYBOARD-OPEN-ESCAPE | Enter 打开、Escape 关闭，等待 Modal 完成退出后焦点返回触发器，滚动位置保持 |
| FULLSCREEN-FIT-ZOOM-PAN-RESET | 初始图形位于视口内，普通滚轮不缩放，修饰键滚轮、按钮、拖拽和重置正常，关闭按钮可用 |
| LIGHTBOX-CHROME-PERCENT-DOWNLOAD | 深色遮罩、圆角画布、独立右上角操作区及底部居中缩放条；百分比与真实比例一致，下载完整原始SVG |
| LIGHT-WIDE | 浅色横图完整解码，无横向页面溢出 |
| LIGHT-390 | 390px 窄屏无横向溢出，可打开全屏及关闭返回 |

用户补充参考图后，大图已更新为独立查看器。组件与序列化单测18项通过，App typecheck通过。
新增实际比例适配、百分比同步及原图下载的浏览器验证，暗色普通与浅色逐状态演示模式均通过七组Case。
WebView bootstrap在jsdom中实际执行，覆盖HTML场景作为Panzoom target、完整SVG导出；不能把该测试描述为Native真机验证。
SVG 转图片时特别覆盖中文、`<br>`、`&nbsp;` 和 XHTML namespace，避免只通过空 SVG mock。

边界：这是实际 Web 组件的隔离验收，不是完整会话/生产站回归。
Native 仅验证静态预览手势开关、全屏与安全区的组件契约；未做 Android/iOS 真机回归。
未执行现有 Playwright 浏览器 runner（本机浏览器操作统一使用 Ego）；其 spec 已同步新契约。
额外 Before/After 对比截图已询问、待回复，不作为默认合并门禁。
