# Sleeve OS 组合中心 v2 Trace Matrix

> 范围：Sleeve OS v2 全局索引、持久 run/job、候选晋升 draft version、readonly decision packet 与验收证据。本文档把 v2 技术方案、最新批准 UI 稿、实现文件和固定验证串起来。

## 1. 基线与拒收规则

- v2 延续 Compose First / Sleeve OS v1 的 Split-only 路线，不新建第二套 shell、router 或 Stepper。
- 新增全局索引入口：`#/compositions/list`、`#/compositions/backtest-runs`、`#/compositions/lab`。
- 保留既有深链：`#/compositions/:id`、`#/compositions/:id/backtest-runs/new`、`#/compositions/:id/backtest-runs/:runId`、`#/compositions/:id/allocation-lab`、`#/compositions/:id/allocation-jobs/:jobId`。
- 后续实现不得伪造 evidence grade、promotion readiness、真实订单、真实成交价或 20Y/30Y 底层持仓；模拟订单必须显式标记。
- allocation 候选不能绕过 diff、约束检查、迁移成本和证据质量门禁直接成为正式版本。
- decision packet 必须是创建时 readonly 快照，不能随当前组合或 job 运行态漂移。

## 2. 批准 UI Artifact

| 页面 key | 目标路由 | 批准 HTML/SPEC | 桌面截图 | 移动截图 | 布局验收 |
| --- | --- | --- | --- | --- | --- |
| `composition-list` | `#/compositions/list` | `output/ui-artifact-trace/sleeve-os-v2-global-pages/sleeve-os-v2-global-pages-preview.html`、`output/ui-artifact-trace/sleeve-os-v2-global-pages/sleeve-os-v2-global-pages-design-spec.md` | `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-list-desktop.png` | `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-list-mobile.png` | 1920 画布，内容区 `x≈268 / width≈1620`，hero `172px`，metric `104px`，list 起点 `y≈352` |
| `composition-backtests` | `#/compositions/backtest-runs` | 同上 | `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-backtests-desktop.png` | `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-backtests-mobile.png` | 与组合列表同一 hero / metric / list 坐标；无 topbar 状态条 |
| `composition-lab` | `#/compositions/lab` | 同上 | `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-lab-desktop.png` | `output/ui-artifact-trace/sleeve-os-v2-global-pages/composition-lab-mobile.png` | 与组合列表同一 hero / metric / list 坐标；实验室是作业列表页 |

允许偏离：真实数据数量、组合名称、run id、候选名可以由 runtime 返回；布局、模块顺序、状态中文文案、按钮语义和三页无跳动要求不能偏离。

## 3. 页面到实现目标

| 页面 | 实现目标 | 数据来源 | 必须呈现 | 不得出现 |
| --- | --- | --- | --- | --- |
| 组合列表 | 全局组合运营索引，展示配置版本、证据质量、10Y核心指标、周期完整度和待决策 rail | `GET /compositions` 的轻量列表扩展，直接携带当前配置版本、10Y/20Y/30Y 覆盖和待决策摘要 | `组合 / 证据质量 / 10Y年化/夏普/回撤 / 周期完整度 / 待决策 / 操作`，配置版本并入组合名单元，右侧待决策事项 | `127.0.0.1:8000 已同步`、`进入组合工作台`、`导出列表`、`来源复核`、`正式版本`、`证据 A/B` 未解释标签 |
| 组合回测列表 | 跨组合追踪回测 run、压力窗口、订单证据和风险预算 | `GET /compositions/backtest-runs` | 运行状态、组合版本、裁决、压力窗口、订单证据、风险预算、场景过滤入口 | `订单导出服务可用` 顶部模块、Stepper、mock-only 文案 |
| 组合实验室 | 配置实验作业列表和晋升审查队列 | `GET /compositions/allocation-jobs` | 作业、组合版本、方法、候选、晋升门禁、迁移成本、右侧晋升审查 rail | `候选门禁已启用` 顶部模块、有效前沿全局大图、直接保存正式版本 |

## 4. Contract / Storage Trace

| 能力 | 后端契约目标 | 存储目标 | 前端类型目标 | 验收信号 |
| --- | --- | --- | --- | --- |
| 持久化组合回测 run | `GET /compositions/backtest-runs`；组合结果对象补 `evidence_grade`、`scenario_anchors`、`risk_budget_timeline` | `composition_backtest_runs` 保存请求配置、组合版本、结果摘要、证据快照、运行状态、审计指纹；legacy artifact state 只做 fallback | `ApiCompositionBacktestRunListItem`、`ApiEvidenceGrade`、scenario/risk timeline 类型 | run 可跨刷新重载；列表不需要逐条详情补水 |
| 持久化 allocation job | `GET /compositions/allocation-jobs`；allocation 结果补 `promotion_readiness` | `composition_allocation_jobs` 保存请求配置、候选摘要、证据快照、运行状态和审计指纹 | `ApiCompositionAllocationJobListItem`、promotion readiness 类型 | job 可重载；全局实验室显示候选、门禁和迁移成本 |
| 组合版本快照 | `GET /compositions/{id}/versions`、`GET /compositions/{id}/versions/{versionId}` | 新增 `composition_versions`：`id`、`composition_id`、`version_number`、`status`、`source_kind`、`source_ref_id`、`snapshot_json`、`diff_json`、`evidence_json`、`created_at` | `ApiCompositionVersion` | draft version 与 active version 分离；读取历史不受当前组合编辑漂移 |
| 候选晋升 draft | `POST /compositions/{id}/allocation-jobs/{jobId}/candidates/{candidateId}/promote-draft` | 写入 `composition_versions` 的 `DRAFT` 记录，并追加审计事件 | `ApiPromotionReview`、`ApiPromoteDraftResponse` | 不可晋升候选返回阻断原因；可晋升候选生成 draft，不改写 active |
| 决策包 | `POST /compositions/{id}/decision-packets`、`GET /compositions/{id}/decision-packets/{packetId}`、export markdown/html | 新增 `composition_decision_packets`：`source_refs_json`、`packet_json`、`export_markdown`、`export_html` 作为创建时快照 | `ApiCompositionDecisionPacket` | 创建后 readonly；修改组合或 job 不改变 packet 内容 |
| 场景订单过滤 | 组合 orders 查询保留 `source_leg` / `symbol` / export / netting，并增加 `scenario` 过滤 | 复用 run/job 证据快照与订单投影 | Orders query params 类型同步 | 选择 2008 / 2020 / 2022 等压力窗口后，诊断、订单、证据定位一致 |

## 5. Frontend Route / UI Trace

| 目标 | 文件族 | 测试目标 | 关键验收 |
| --- | --- | --- | --- |
| 静态路由优先级 | `web/src/lib/appRouteContext.tsx`、`web/src/app-runtime-cn.tsx`、`web/src/shell-route-meta-cn.ts` | `web/src/app.routes.foundation.test.tsx` | `list`、`backtest-runs`、`lab` 必须先于 `#/compositions/:id` 匹配 |
| 三个全局索引页 | `web/src/pages/composition-global-index-page.tsx`、`web/src/pages/composition-global-index-page.css` | `web/src/composition.global-index.test.tsx` | hero / metric / list 坐标一致；hash 切换无感知跳动；无 topbar 状态条 |
| 回测结果 v2 | `composition-backtest-result-page` | `composition.backtest.result.test.tsx` | Diagnosis / Orders / Evidence 可通过 scenario anchors 互相定位，订单支持场景过滤 |
| Allocation v2 | `composition-allocation-page` | `composition.allocation.test.tsx` | 临时候选和正式 job 候选进入同一晋升审查；门禁阻断态可见 |
| 决策包视图 | 后续新增 readonly packet page 或 drawer | 对应页面测试 + export contract 测试 | Markdown / HTML export 使用 packet 快照，不读取当前运行态 |

## 6. 文案与 DOM 扫描门禁

必须存在或可由运行态生成的中文词汇：

- `组合列表`、`组合回测列表`、`组合实验室`
- `证据质量`、`10Y年化/夏普/回撤`、`周期完整度`、`待决策`
- `压力窗口`、`订单证据`、`风险预算`
- `晋升审查`、`生成草稿版本`、`迁移成本`、`政策违反`
- `决策包`、`证据说明`、`模拟订单已标记`

必须扫描禁止出现：

- `Stepper`
- `mock-only`
- `placeholder`
- `127.0.0.1:8000 已同步`
- `订单导出服务可用`
- `候选门禁已启用`
- 未本地化 raw enum 或实现说明词
- `来源复核`
- `正式版本`

## 7. Fixed Validation Commands

源码实现切片必须至少执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes
```

建议补充验收：

- `tests/test_composition_api.py`：run/job 持久化重载、版本列表、draft promotion、decision packet immutable、scenario/evidence fields。
- `web/src/app.routes.foundation.test.tsx`：新增静态路由优先级。
- `web/src/composition.backtest.result.test.tsx`：场景复盘、订单场景过滤、Evidence grade。
- `web/src/composition.allocation.test.tsx`：候选晋升审查、门禁阻断、迁移成本。
- DOM 文案扫描：检查禁止词和 raw enum。
- 视觉验收：1920 桌面与窄屏截图；`127.0.0.1:4173/?v=<timestamp>#/...` cache-busting reload。

当前实现已覆盖 `tests/test_composition_api.py` 的 run/job 持久化、版本晋升、decision packet immutable 与 scenario/evidence 字段；fixture-backed live acceptance 仍需在固定脚本可用时另行声明。

当前验收记录（2026-04-30）：

- Backend fixed slice：`198 passed`。
- Frontend fixed slice：`202 passed`。
- Frontend global type report：fixed script 仍记录既有 `optimization.module.test.tsx(2476,26)` 类型债务，本次前端 Vitest 切片不受阻断。
- Live API：重启最终代码后的 `GET /compositions/backtest-runs` 与 `GET /compositions/allocation-jobs` 均返回 `200`。
- Live route screenshots / DOM：`artifacts/sleeve-os-v2-live/composition-list-1920.png`、`artifacts/sleeve-os-v2-live/composition-backtest-runs-1920.png`、`artifacts/sleeve-os-v2-live/composition-lab-1920.png`；本次组合列表版本与周期完整度增量证据位于 `artifacts/composition-list-version-20260430/`。
- Live DOM 禁止词扫描：未命中 `Stepper`、`mock-only`、`placeholder`、`127.0.0.1:8000 已同步`、`订单导出服务可用`、`候选门禁已启用`、`进入组合工作台`、`导出列表`、`证据 A/B`、`证据 [ABC]`、旧英文候选标签、`待补`、`Updated`、`quarterly`、`Allocation Lab` 和 `<th>Run</th>`。

## 8. Worker Ownership

| Agent | 文件 / 模块边界 | 产出 |
| --- | --- | --- |
| A0 Trace Owner | 本文件、批准 UI artifact 对照、DOM/截图证据收口 | selector/API/截图/测试证据矩阵 |
| A1 Contract & Storage | backend models/API/storage 与 `web/src/types.ts` mirror | run/job/version/packet 契约和持久化 |
| A2 Version Promotion | allocation candidate -> draft version | diff、约束、迁移成本、证据门禁、审计事件 |
| A3 Backtest v2 UI | 全局回测列表与结果页三 tab 增量 | 场景复盘、订单过滤、证据评分 |
| A4 Allocation v2 UI | 全局实验室列表与晋升审查 | Current/Candidate diff、临时候选审查 |
| A5 Decision Packet | readonly packet view/export | Markdown / HTML export |
| A6 Tests & Docs | 固定测试、文档、CHANGELOG、验收报告 | 可跑测试与已知 blocked 记录 |
