# P0 可信研究生产化页面 UI 设计稿

冻结时间：2026-05-26
设计包：`C:\Fin\Grit_Strategy_Lab\designs\2026-05-26-p0-trust-control-plane`
适用方案：可信状态总控台、Factor Factory 血缘真相收敛、Snapshot/PIT 修复工作台产品化

## 目标用户与页面目标

目标用户是策略研究员、因子研究员、数据运维操作者和发布前 reviewer。页面的核心任务不是展示更多数据，而是把研究生产链路收敛成三个可操作判断：

- 今天是否可以继续研究。
- 当前数据、批次和运行时为什么可信或不可信。
- 下一步应该修复什么，以及修复动作是否真实可执行。

本设计覆盖三个前台页面：

- `#/workspace`：新增可信状态总控台，保留策略看板与最近回测。
- `#/factors/factory`：新增当前批次真相条，保留因子工厂三栏工作台。
- `#/snapshots` 与 `#/pit-data`：新增修复队列，把 `INCOMPLETE/BLOCKED` 转成可执行动作。

## 批准视觉方向

方向名：可信操作台。

视觉继承当前 `DESIGN.md` 的浅雾灰底、白卡、青绿色主动作和轻边框体系。页面不做独立监控大屏，不新建营销式 hero，不替换现有工作台骨架。所有新增模块都以“状态判断 + 证据 + 下一步动作”为结构核心。

设计 artifact：

- HTML：`C:\Fin\Grit_Strategy_Lab\designs\2026-05-26-p0-trust-control-plane\spec.html`
- PNG：`C:\Fin\Grit_Strategy_Lab\designs\2026-05-26-p0-trust-control-plane\spec.png`

## 页面布局

### `#/workspace`

首屏顶部替换为“可信研究工作台”总控台。总控台包含：

- 一句话裁决：`今日结论：需修复后研究`
- 六张状态卡：运行时、Snapshot/PIT、Factor Factory、Quarantine、Optimization、Composition
- 今日优先修复队列：最多三条首屏任务，按 `BLOCKED > DEGRADED > WARN` 排序
- 证据入口：每张状态卡都有 `查看证据`

现有策略看板、策略卡、sparkline、最近回测列表和 compare dock 不替换，只在可信总控台下方继续承载研究入口。

### `#/factors/factory`

在现有 hero 与三栏工作台之间新增“当前批次真相”模块。模块必须显示：

- `current_batch_id`
- `source_job_id`
- Raw_F2、Refined_F2、Artifact、Quarantine、Preview 五个口径
- preview 明确标注 `仅预览`
- manifest 或 count mismatch 以警告条展示
- 操作：`查看证据链`、`打开检疫分页`、`查看发布去重组`

当 `current_batch_truth.status` 为 `WARN` 或 `BLOCKED` 时，页面不得显示生产可发布完成态。发布动作应降级为查看阻断原因或禁用态。

### `#/snapshots` 与 `#/pit-data`

在数据层健康卡之前新增“修复队列”。队列卡片包含：

- 问题域：价格缺口、公司行为缺口、Provider 凭据、Universe 生命周期、研究豁免
- 状态：`OPEN`、`BLOCKED`、`DONE`
- 影响范围：动量、波动、长周期回测、因子准入、资产腿创建
- 主动作：刷新、配置凭据、查看缺口、进入观察清单
- 证据入口：查看来源、blocking item、provider readiness 或 PIT 诊断

Provider 凭据类动作必须明确“需要在启动 QuickStart 的同一个 PowerShell 中配置并重启”，不得暗示前端直接落库或改变 provider 状态。

## 组件清单

### TrustStatusCard

用途：Workspace 总控台状态卡。

结构：

- domain 标题
- 状态 chip
- 一句话业务原因
- 一个关键数值或影响范围
- 主动作按钮
- 证据 text button

状态颜色：

- READY：`#ECFDF3` / `#2B8A3E`
- WARN：`#FFF7E8` / `#B86813`
- BLOCKED：`#FFF8F7` / `#C45C4F`
- DEGRADED：`#EEF6FF` / `#4C78C7`

### BatchTruthPanel

用途：Factor Factory 当前批次真相。

结构：

- 左侧批次 id 和 source job id
- 中间五张 count card
- 下方 warning strip
- 右侧或底部操作按钮

约束：

- `Preview` 卡必须写 `仅预览`。
- `Artifact` 数量与 Raw/Refined 不一致时必须显示 warning。
- 缺 `formula_count` 或 `created_at` 时必须显示 warning。

### RepairQueueCard

用途：Snapshot/PIT 修复工作台。

结构：

- 问题标题
- 状态 chip
- root cause
- 影响范围 chips
- 主动作和证据入口

禁用态：

- disabled action 必须显示 `blocked_reason_cn`。
- 不能只把按钮置灰而不解释原因。

### EvidenceDrawer

用途：所有页面共享的证据抽屉。

结构：

- 判断来源
- 关键证据
- 阻断原因
- 下一步动作

桌面宽度 `420px`，移动端全屏。ID 使用 monospace；不展示 raw JSON。

## 文案与数值格式

必须使用中文前台文案。保留英文的场景仅限真实 ID、API 字段、ticker、第三方 provider 名称和 route。

状态词：

- `READY` 显示为 `可继续`
- `WARN` 显示为 `需复核`
- `BLOCKED` 显示为 `阻断`
- `DEGRADED` 显示为 `降级`
- `OPEN` 显示为 `待处理`
- `DONE` 显示为 `已处理`

关键文案：

- `今日结论：需修复后研究`
- `策略研究可继续，因子发布需等待批次真相通过。`
- `完整批次账本是准入口径；top candidates 与第一页列表只作为预览。`
- `manifest 缺少 formula_count 与 created_at，本批次不能作为最终发布证据。`
- `研究豁免只能进入观察或审核，不会自动变成正式发布证据。`

## 响应式行为

桌面 `>=1280px`：

- Workspace 状态卡 6 张以 `repeat(3, 1fr)` 或 `repeat(6, minmax(...))` 适配宽屏。
- Factor Factory 保留三栏工作台。
- Snapshot 修复队列三列，L1-L4 健康四列。
- Evidence drawer 右侧固定宽度 `420px`。

平板 `768-1279px`：

- 状态卡两列。
- Factor Factory 三栏堆叠为单列。
- Snapshot 修复队列两列。

手机 `<768px`：

- 首屏保留裁决、前三个阻断/警告、一枚主按钮。
- Drawer 全屏。
- 表格改为摘要卡或允许横向滚动，但修复队列不得依赖横向滚动。

## 实现映射

建议实现路径：

- Workspace：`web/src/page-sections/workspace-lane-b.tsx` 和 `web/src/pages/workspace-page-lane-b.css`
- Factor Factory：`web/src/pages/factor-factory-page.tsx` 和 `web/src/pages/factor-phase2-pages.css`
- Snapshot：`web/src/page-sections/snapshots-operations-console.tsx` 和 `web/src/pages/snapshots-page.css`
- 类型镜像：`web/src/types.ts`

实现前必须创建 Trace Matrix：

- `output/ui-artifact-trace/p0-trust-control-plane/trace-matrix.md`

Trace Matrix 至少覆盖：

- 设计源：本 `spec.md`、`spec.html`、`spec.png`
- Routes：`#/workspace`、`#/factors/factory`、`#/snapshots`、`#/pit-data`
- Viewports：`1440x1200`、`390x844`
- 条件态：READY、WARN、BLOCKED、DEGRADED、empty、error、drawer open、disabled action
- 字段分类：`must-match-copy`、`live-substitutable`、`evidence-only`

## 允许的 live-data 替代

允许替代：

- 具体 count 数字
- `current_batch_id`
- `source_job_id`
- provider 名称
- latest job 时间
- repair queue 数量

必须保持：

- 模块顺序
- 状态词中文映射
- `Preview` 仅预览语义
- 阻断/警告必须有原因和动作
- Provider 凭据重启提示
- 不展示 raw JSON

## 验收标准

- HTML 与 PNG 指向同一视觉方向。
- Workspace 首屏能在 10 秒内回答“今天能不能研究/发布”。
- Factor Factory 能明确区分 batch truth 与 preview。
- Snapshot/PIT 能把阻断状态转成修复队列。
- 所有可见文本为中文，除真实 ID 和 provider 名称。
- 无 `NaN`、raw enum、英文实现文案、placeholder。
- 移动端不出现文字重叠、按钮溢出或不可关闭 drawer。

## Deferred

- 不新增 `#/trust-control-plane` 独立路由。
- 不更新 `DESIGN.md`，等待用户确认设计方向后再提炼系统级规则。
- 不实现真实产品代码；本包是 UI 设计与实现 handoff。
