# Live Acceptance Summary

日期：`2026-05-12`

## 验收目标

对齐以下三组对象，并以批准设计包作为唯一视觉基线：

- Live 页面：`http://127.0.0.1:4173/?v=final-20260512#/snapshots?tab=equity`
- Live 页面：`http://127.0.0.1:4173/?v=final-20260512#/pit-data`
- 设计预览：`file:///C:/Fin/Grit_Strategy_Lab/output/ui-artifact-trace/snapshot-pit-layered-readiness-20260512/snapshot-pit-layered-readiness-preview.html#/snapshots?tab=equity`
- 设计预览：`file:///C:/Fin/Grit_Strategy_Lab/output/ui-artifact-trace/snapshot-pit-layered-readiness-20260512/snapshot-pit-layered-readiness-preview.html#/pit-data`

## 视觉取证

最终对拍图与单页截图：

- `design-snapshots-1960-final.png`
- `live-snapshots-1960-final.png`
- `design-pit-1960-final.png`
- `live-pit-1960-final.png`

验收口径：

- 共享 shell 在本轮验收范围内。
- 截图等待首个真实内容模块完成渲染后再采集，不接受仅到页面 H1 或 loading skeleton 的截图。
- 重点核对模块数量、顺序、卡片标题、状态芯片、摘要文案、按钮位置、台账结构和底部 rail。

## 结论

### `#/snapshots?tab=equity`

- 已回到批准稿的信息架构：`5 张健康卡 -> 3 栏工作站 -> 原始快照台账 -> 证据层 / 凭据入口`
- 顶部 `L1-L4 + 最新刷新`、中段 `数据层级工作站 / 异常核查 / 因子维度就绪矩阵`、底部 `原始快照清单 / 数据源证据层 / 凭据与重启入口` 与批准稿一致
- `查看明细` 弹层、`刷新股票快照`、状态点样式与中文金融文案已对齐

### `#/pit-data`

- 已回到批准稿的信息架构：`hero -> 研究豁免 -> L1-L4 PIT 准入卡 -> 数据运维指令 -> 门禁摘要 / 因子诊断矩阵 -> 覆盖率下钻 / 规则工作站 -> 门禁行动列表`
- 顶部窗口、研究豁免条、操作按钮、矩阵文案和行动列表均与批准稿一致
- 状态点样式、中文标签与门禁语义已对齐

## 本轮复盘结论

上一轮跑偏的根因不是“实现没做完”，而是把技术方案中的数据维度直接铺成了前台模块，导致页面超出批准稿范围。对此已在以下文档中加严门禁：

- `TECHNICAL.md`
- `AGENTS.md`
- `CHANGELOG.md`

新增门禁包括：

- 技术方案只决定数据契约与交互责任，批准稿才决定可见模块合同
- 设计锁定页默认冻结前台文案、状态、数字与时间戳，除非 Trace Matrix 明确允许 live 替换
- live-vs-design 对拍必须等待真实内容模块，不接受只到页面标题的截图
- 验收必须明确共享 shell 是否在范围内

## 风险说明

- 最终截图与 live 页面仍可能存在浏览器字体渲染级别的亚像素差异；这类差异不改变模块合同、文案、状态、布局顺序和交互位置
- 若后续要把这套门禁同步进外部 Codex skill 包，需要单独对 `C:\Users\TradeAdmin\.codex\skills\GRIT_Coder\SKILL.md` 进行受控更新；本轮已先将规则固化到仓库文档真相中
