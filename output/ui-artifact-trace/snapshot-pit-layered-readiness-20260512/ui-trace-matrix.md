# 数据快照 / PIT 联动升级 UI Trace Matrix

## 设计来源

- 批准设计包：`output/ui-artifact-trace/snapshot-pit-layered-readiness-20260512/`
- 核心稿件：
  - `snapshots-equity-layered-readiness-desktop.png`
  - `snapshots-equity-coverage-modal-desktop.png`
  - `pit-layered-readiness-desktop.png`
  - `snapshot-pit-layered-readiness-design-spec.md`
- 目标路由：
  - `#/snapshots?tab=equity`
  - `#/pit-data`

## Route 1: `#/snapshots?tab=equity`

| 项 | 映射 |
| --- | --- |
| 页面模块 | `web/src/pages/snapshots-page.tsx`、`web/src/page-sections/snapshots-equity.tsx`、`web/src/pages/snapshots-page.css` |
| 设计骨架 | 保留线上页头、股票/指数 tab、健康仪表盘、`查看明细` 弹层、`刷新股票快照`、底部数据可信层与凭据 rail |
| 新增模块 | 分层工作站、异常告警区、因子维度就绪矩阵、原始快照台账 |
| 顶部卡片映射 | `data_layer_readiness[]` 前四卡对应 `L1 基础行情 / L2 财务截面 / L3 分析师与情绪 / L4 宏观与衍生品`；第五卡来自 `latest_job` 与 refresh stats，展示 `最新刷新（EST）` |
| 弹层映射 | `查看明细` 弹层读取 `data_layer_readiness[]`、`snapshot_quality_alerts[]`、`factor_dimension_readiness[]`，展示分层覆盖、最近时间、入库/待修复/阻断项、影响因子维度、数据源与凭据提示 |
| 告警映射 | `snapshot_quality_alerts[]` 映射到异常告警区，典型码包括 `FUNDAMENTAL_BALANCE_CHECK_PENDING`、`CONSENSUS_BLIND_SPOT`、`SHORT_VOLUME_JUMP_REVIEW`、`RATE_BETA_CALIBRATING` |
| 因子矩阵映射 | `factor_dimension_readiness[]` 映射四类维度卡：价格与流动性、质量与估值、情绪与微观、宏观与衍生品 |
| 原始台账映射 | `dataset_snapshots[]` + `universe_snapshots[]` 继续驱动原始快照清单；不回退到静态批准稿数字 |
| 状态映射 | `READY -> 已就绪`、`WARNING -> 需复核`、`BLOCKED -> 已阻断`、`DISABLED -> 已停用`、`CALIBRATING -> 校准中` |
| 关键交互 | tab 切换、刷新股票快照、查看明细、凭据选择器、复制设置并重启命令、跳转 target 高亮 |
| 响应式 | 维持现有 route shell；1960 桌面稿为主基线，移动稿保留卡片堆叠顺序与中文状态芯片 |

## Route 2: `#/pit-data`

| 项 | 映射 |
| --- | --- |
| 页面模块 | `web/src/pages/factors-page.tsx`、`web/src/pages/factors-page.css` |
| 设计骨架 | 保留 hero、研究豁免 banner / revoke flow、覆盖率下钻、规则工作站、异常动作清单 |
| 新增模块 | `L1-L4 PIT 准入卡`、`因子诊断准入矩阵`、`snapshot -> PIT` 逻辑映射区 |
| 顶部卡片映射 | `pit_layer_readiness[]` 驱动四张摘要卡，对应基础行情、财务截面、分析师与情绪、宏观与衍生品 |
| 因子矩阵映射 | `factor_diagnostic_readiness[]` 驱动四类分组：价格型、质量/估值型、情绪/微观型、宏观/衍生品型 |
| 告警映射 | `pit_quality_alerts[]` 映射门禁/核查列表；典型码包括 `CURRENT_ONLY_DATA`、`MISSING_AVAILABLE_AT`、`NON_REPLAYABLE_FIELD`、`RESEARCH_WAIVER_OBSERVATION`、`RATE_BETA_CALIBRATING` |
| 逻辑映射 | `snapshot_layer_linkage[]` 明确 snapshot 检查项如何点亮 PIT 与因子算子；研究豁免只能进入 observation/review，不允许映射为 verified |
| 旧链路复用 | `coverage_gap`、`factor_admission_coverage`、`ops_guidance`、`research_waiver`、`diagnostic_windows` 继续存在，但首屏统一收敛进新模块表达 |
| 状态映射 | `VERIFIED -> 已验证`、`SANDBOX -> 沙箱观察`、`BLOCKED -> 已阻断`、`DISABLED -> 已停用` |
| 关键交互 | 下钻分析、研究豁免撤销、身份修复重启、阻塞码跳转 `#/snapshots?tab=equity&target=...` |
| 响应式 | 首屏保持轻量；长表与 trace 留在现有 drilldown/dialog，不塞回 hero 下首屏 |

## 文案与状态规则

- 所有新增用户可见文案统一中文化，采用简洁专业的金融治理表达。
- 页面不直接展示英文状态词、raw enum 或实现说明文案。
- 内部枚举保持英文常量值，前台统一通过本地化映射落为中文状态词。

## 交互与验证证据

- Focused backend：
  - `python -m pytest tests/test_backend_api.py -k "snapshot_overview_contract_is_exact_on_fresh_database" -q`
  - `python -m pytest tests/test_factor_research_api.py -k "pit_data_overview_requires_dataset_and_universe_snapshots or pit_data_blocks_current_universe_membership_fallback or fundamental_pit_loader_filters_on_available_at_not_period_end" -q`
- Focused frontend：
  - `cmd /c npx vitest run src/snapshots.page.test.tsx`
  - `cmd /c npx vitest run src/app.routes.foundation.test.tsx`
- 全局类型：
  - `cmd /c npx tsc --noEmit --pretty false`

## 已批准偏差

- 股票 tab 的旧三张“股票快照 / 指数与基准 / 权益篮子”不再位于健康仪表盘前四卡，而是下沉到分层工作站解释与原始快照台账中；这是本期已批准的结构调整。
- `#/pit-data` 没有拆新路由，仍由 `web/src/pages/factors-page.tsx` 承载；这是本期明确的实现边界。
