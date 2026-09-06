## Summary

<!-- What changed and why? -->

## Visual evidence

- 截图状态：待确认（用户要求 / 用户确认不需要 / 已询问待回复 / 不涉及可见变更）
- 用户要求的截图范围：无
- 已完成的视觉验证与未执行项：无

<!--
前后截图由用户确认是否需要，不是默认合并门禁。
开始截图或为截图搭建环境前先询问用户；已有明确要求时不重复询问。
未回复时不采集截图，继续必要检查；不得把未回复写成用户已确认。
无需截图豁免、GitHub 确认评论或绑定 head SHA。

用户要求逐 Case 截图时才添加以下内容，并仅覆盖约定范围：
Visible UI cases: N
| Case | 问题 | 修复前 | 修复后 |
| --- | --- | --- | --- |

图片使用不可变 commit SHA URL 或 GitHub 上传附件，保持前后视口与缩放可比。
更新 PR 后打开实际页面确认图片渲染。未要求截图时无需 Case 矩阵或截图完成勾选。
-->

## E2E acceptance

<!--
When E2E or mobile video acceptance is requested, add one row per Case.
The video link must be accessible from the review device; a local absolute path is not evidence.
State mobile playback as confirmed only after the reviewer can open the same file on mobile.
只有用户同时要求截图时，视频才需要与约定的截图证据配套；不自动增加截图要求。
-->

| Case | Result | Spec / rerun | Mobile video | Report / Trace |
| --- | --- | --- | --- | --- |
| N/A | Not requested | N/A | N/A | N/A |

- Environment and side effects: N/A
- Mobile playback: not requested
- Known gaps: none

## Validation

<!-- Tests, typecheck, E2E, independent review, and known gaps. -->

- [ ] 已如实记录截图需求状态；仅在用户要求时核对约定场景的前后图片、视口与稳定链接（未要求时不适用）。
- [ ] Requested E2E videos use a non-local stable URL, map to a Case, and disclose mobile playback status.
- [ ] 用户要求的截图已在实际 PR 页面核对渲染（未要求时不适用；不默认增加独立截图验收）。
- [ ] Independent code review passed.
- [ ] Relevant automated tests passed.
- [ ] Typecheck passed, or the PR explains why it is not applicable.
- [ ] Every CI check triggered for the current head passed.
- [ ] The exact merge message was shown to and approved by the maintainer.
- [ ] The merge does not bypass branch protection.
