# 架构

## Phase 1 Factor Factory Architecture

- `OperatorEngine` sits behind the existing Factor Factory service boundary. The MVP implementation is `PandasBottleneckOperatorEngine`; API and UI contracts store only `compute_backend=pandas_bottleneck`, formula budget, F1 snapshot id, and operator config snapshot id.
- OperatorEngine runs persist the full Raw_F2 batch ledger, matrix, series, and stats artifacts under `artifacts/factor-factory/operator-engine/<run_id>/`; top candidates are a bounded preview/page, not the factory task entry size.
- Factory daily/manual runs use immutable `factor_factory_runs.request_json.config_snapshot` and `summary.config_snapshot`. Runtime draft edits under `GET/PUT /factor-factory/operator-config` do not mutate a current run.
- Governance main chain is `Raw_F2 -> WNZT -> Refined F2`. `O` orthogonalization and extended turnover filtering are optional config flags and default to skipped; `D` decay diagnostics is stored as quarantine evidence rather than a main governance stage.
- Raw_F2 publish is blocked unless a real Refined F2 expression exists, WNZT evidence is complete, quarantine status is `PASSED`, `publish_status` is `ELIGIBLE`, and the candidate carries both `operator_config_snapshot_id` and `f1_catalog_snapshot_id`. Legacy or newly created candidates cannot assert `raw_f2=true`, `refined_f2=true`, and `wnzt_complete=true` without expression-level evidence.
- `GET /factor-factory/overview` projects front-stage monitors from bounded read models: formula count, Raw_F2 delivered count, Refined_F2 delivered count, quarantine pass count, S-grade promotion count, alpha concentration, and rejection reason distribution. Existing JSON fields may carry projections or artifact refs, but a preview JSON blob is never by itself the canonical batch ledger.
- Factor Factory state transitions must be evidence-backed: `Raw_F2` starts as ungoverned, `Refined_F2` requires a generated refined expression plus W/N/Z/T evidence, and publishable rows must be derived from quarantine results rather than a single optimistic metrics blob.
- B3 quarantine rows and B4 publishable factors use `factor_display_name_v4_structured` for the front-stage Chinese name at candidate hydration time. Redundancy pruning groups candidates by both target factor identity and naming collision identity (`target_factor_id` plus `name_collision_key`/`base_display_name_cn`), so a batch cannot keep duplicate publishable rows solely because two formulas resolve to different IDs or because the old compact name hides different parameter chains.
- 因子中文展示名当前执行 `gsl_cn_naming_standard_2026_05`，但继续沿用 `factor_display_name_v4_structured` 协议字段以保持 API 兼容。F1 使用 `[数据源] - [物理科目] (原始)`，F2 使用 `[核心指标] ([窗口/参数]) [Raw|Refined|Rank|Beta-Free]`，F3 使用 `[风格族] - [核心金融语义] ([核心参数]) [Refined|Refined-Rank|Beta-Free]`；`[Beta-Free]` 只在 `Residual` 或明确市场/行业/市值 beta 剥离是核心 Alpha 语义时触发，普通 W/N/Z/T 中性化仍归入 `[Refined]` 或 `[Refined-Rank]`。显示名回填、检疫发布、治理优化发布、因子库列表和因子详情必须复用同一 resolver，并在 `name_audit.structured_components` 中保存参数、治理标签、公式 tooltip、差异化 token 与审计缺口。

本文档描述 Grit Strategy Lab 当前已交付、已恢复的基线架构。它刻意保持务实：只记录那些让当前工作区可运行、可审计、可恢复的机制。

## 1. 恢复模块的间接映射

后端刻意保留了一层“恢复模块间接映射”。

- `grit_backtest_platform` 下的公开导入路径保持稳定。
- 包内部会把这些导入解析到重建或恢复后的实现模块，例如 `_service_rebuilt.py`、`_real_service_rebuilt.py` 与 `_storage_restored.py`。
- 这层间接映射让仓库可以热替换修复后的模块，而不需要在整个代码库里做一次破坏性的统一重命名。
- 实际效果是：即使个别恢复模块还在继续演进，包仍然可以沿用同一套公开导入表面持续交付。

这不是临时补丁，而是一个已经经历过局部损坏与恢复的仓库在当前阶段用于保证高可用性的正式机制。

## 2. 运行时自修复

启动器与仓库内置运行时都被设计成可以自我修复。

- `QuickStart-Grit.ps1` 优先使用仓库本地的 `.python-runtime`。
- 较旧的 `.python314-home` 会被视为遗留来源，并在需要时迁移进 `.python-runtime`。
- `.venv` 由仓库本地运行时派生，并通过 `pyvenv.cfg` 重新绑定到当前运行时根目录。
- 启动器能够发现合适的 Python 3.14 或 3.13 来源，再用该来源修复本地运行时。
- 启动器还会检查前端依赖树，如果 `web/node_modules` 不完整，会自动重新安装。

目标是让仓库尽可能自包含。一个健康的本地检出不应依赖隐藏在用户目录里的 Python 安装，也不应依赖手工维护的 `node_modules`。

## 3. 存储与清理

存储层会把工作台契约、策略记录、回测运行、优化任务以及运行时审计状态持久化到 SQLite。主库连接启用 WAL、`synchronous=NORMAL` 与 30 秒 busy timeout，以容忍长回测 runner 刷新 claim/checkpoint/progress 时的短暂写锁。

关键组成如下：

- `strategy_parameter_versions` 是参数版本的权威表。
- `strategies` 持有 `dataset_snapshot_id` 与 `universe_snapshot_id`，因此正式回测始终绑定显式快照记录，而不是绑定环境中的临时行情状态。
- `backtest_runs` 通过 `is_permanent` 记录某次运行是永久的还是临时的。
- `backtest_runs` 还保存 `artifact_paths_json` 与 `trade_audit_json`，以便工件和审计数据能够被一致地回放或清理。
- `backtest_runs.trade_audit_items_json` 是供运行详情页使用的轻量证据列表投影。完整的 `trade_audit_json` 仍然是单笔交易审计下钻时的事实来源，但详情接口在热路径上不允许解码整个审计大对象。
- `backtest_run_checkpoints` 与 `backtest_run_checkpoint_chunks` 现在是回测恢复链路的正式事实来源。前者保存当前阶段、步进游标、累计净值与恢复元数据，后者按块持久化 `daily_performance` 与 `trades` 增量，用于 `RUNNING -> INTERRUPTED -> resume` 的断点续跑，而不是服务重启后的整段重放。
- `strategies` 与 `backtest_runs` 的列表读模型允许使用带更新时间签名的短时缓存，并在同一轮页面导航内使用突发窗口复用，避免工作台、资产库和策略列表重复解码相同投影。
- `optimization_jobs` 保存优化任务级别的请求、摘要与结果投影。
- `optimization_jobs.summary_json` 现在是运行中详情的主投影。心跳写入会持久化 `completed_combinations`、`next_trial_index`、`best_metrics_summary`、ETA 与 `heartbeat_at`，因此 `GET /optimization-jobs/{id}/detail` 在返回 `QUEUED`、`RUNNING`、`INTERRUPTED` 状态时，无需扫描 `optimization_job_trials`，只有旧记录缺少这些字段时才会回退补水。
- `optimization_jobs.request_json` 与 `summary_json` 不再作为完整候选网格的永久承载面。若 `matching_combinations` 来自 `all_trials` 且已有 `optimization_job_trials` checkpoint，服务会把超大内联候选压缩为轻量投影，只保留 `matching_combination_count` 与来源标记；完整候选集合仍以 trial checkpoint 为事实来源，按需重建。
- `optimization_jobs.candidates_json` 与 `result_json` 现在是终态详情的主投影。新的 `COMPLETED`、`PARTIALLY_FAILED`、`FAILED` 记录可以直接从任务行渲染结果中心，只有旧记录才回退为根据 trial checkpoint 重建。
- `optimization_job_trials` 是优化搜索进度的 checkpoint 真相表。每个已完成或失败的 trial 都按 `job_id + trial_index` 持久化，并保存 `parameter_snapshot_json`、`metrics_json`、`chart_series_json`、`score` 与时间戳，以便中断后的任务继续执行而不需要重放已经完成的组合。
- 同一张 trial 表还下沉了热路径排序字段 `return_sharpe`、`oos_sharpe`、`total_return_pct` 与 `stability`，让运行态与终态投影可以避免在热路径解码完整 metrics JSON。
- `optimization_job_trials.chart_series_json` 采用分层存储：运行中的任务对大多数 trial 只写轻量 `[]`，只有最终 top-K 候选才会回补完整曲线供结果中心展示。
- 优化执行时会保留一个父控制器运行时：一个后台线程独占任务生命周期与全部 SQLite 写入，可选子进程只负责计算 trial 摘要并通过 IPC 返回结果。对于当前的 synthetic evaluator 路径，这个多进程分发默认刻意关闭，因为顺序执行的本地基准更快。
- 这个父线程也是优化任务心跳的唯一写入者：摘要写入最多每秒一次或每完成五个组合时批量落库，而 trial checkpoint 与终态状态切换仍然立即刷盘。
- 在执行过程中，父线程会增量维护 top-K trial 与 heatmap 单元赢家的运行时摘要；终态物化阶段会直接复用这些摘要，只为最终 top 候选回补完整 metrics，从而避免对所有成功 trial 再次做全量重排与重建。
- 市场数据 companion SQLite 现在包含按快照作用域组织的表：`dataset_snapshots`、`universe_snapshots`、`dataset_price_bars`、`dataset_corporate_actions`、`dataset_symbol_coverage`、`dataset_index_valuations`、`dataset_index_valuation_coverage` 与 `universe_membership_snapshots`。
- `ds-index-valuations` 是策略级依赖，不参与 `#/snapshots` 的全局阻塞判定。v1 只发布 `QQQ -> nasdaq100` 代理映射，用 Nasdaq-100 月频估值历史驱动动态定投回测。
- `#/snapshots` 股票/指数 tab 的健康口径拆成三类：股票快照覆盖率来自价格/公司行为 symbol 覆盖，`指数与基准` 来自 `ds-price.metadata.benchmark_etf_coverage` 对 SPY/QQQ 历史价格的完备判断，`权益篮子` 则按标普与纳指 universe 当前成分名单是否可用统计；最新刷新卡片只展示 `snapshot_refresh_jobs.summary_json.refresh_stats` 的本次新增行数/标的数，不展示累计 row/member 总数。
- 本地 live runtime 的主库与 companion 库是一组数据面。`GRIT_BACKTEST_DB=.grit_backtest_platform.sqlite3` 会派生 `.grit_backtest_platform_market_data.sqlite3`；如果 backend 误指向新建空主库，`/workspace/overview` 会显示 0 策略，快照页也会只看到空 market-data 状态。这种情况应先备份再恢复或重指向正确 runtime DB，而不是把页面空态当作真实删除。
- 市场数据 companion SQLite 参与快照刷新、PIT 清洗中心轮询和因子诊断读写，连接必须启用 `busy_timeout=30000`、`journal_mode=WAL` 与 `synchronous=NORMAL`。价格和基础面诊断热路径依赖 `(dataset_snapshot_id, symbol, date)` / `(dataset_snapshot_id, symbol, available_at, date)` 复合索引；刷新任务出现 `database is locked` 时，应先确认连接 pragma、热路径索引与活跃进程，而不是把 PIT 覆盖缺口误判为供应商或 UI 问题。
- Phase 0 F1 原始库以主 SQLite 中的 `pit_preprocessing_runs`、`f1_raw_factor_catalog_snapshots` 与 `f1_raw_factor_fields` 记录目录、覆盖、阻塞和可得时点；密集原始值不复制进主库，仍由 companion market-data / snapshot 数据面按 PIT resolver 读取。
- `operator_registry_snapshots` 与 `operator_registry_items` 保存不可变算子配置快照和 25 个核心算子定义。Factor Factory run 不读取 mutable 草稿，而是在 `factor_factory_runs.request_json.config_snapshot` 中持久化 `operator_config_snapshot_id`、`f1_catalog_snapshot_id`、启用算子、窗口空间、depth 和阻塞字段策略。
- F1 目录准入不引用 RankIC/IR/OOS。缺失 L1 字段必须输出 `NaN` 语义并标记 `DATA_SOURCE_BLOCKED`；工厂表达式展开会按配置排除这些阻塞 F1 字段，候选发布仍沿用 `sandbox -> quarantine -> publish`。
- `symbol_identity_cache` 是内部身份修复表，用于处理已退市符号、ticker 生命周期修正，以及来自 Alpha Vantage、SEC EDGAR 与 FMP 的 CIK/交易所元数据拼接。PIT 清洗中心的 Identity Scraper 会优先批量调用可用身份来源；若外部来源无法解析旧历史 ticker，可写入 `pit_identity_local_fallback` 自映射作为本地 PIT 锚点，关闭身份挂起但不改变价格或公司行为快照的 Full Ready 门禁。
- `pit_research_waivers` 保存 PIT 清洗中心的研究态豁免，只记录当前被忽略的缺失 symbol、原因、创建人和撤销时间；它只能把诊断模式降级为 `LIMITED_READY`，不能把任何策略、因子或组合晋升伪装为 Full Ready。
- `snapshot_refresh_jobs` 是 API 与 CLI 共用的刷新审计日志。它的 `summary_json` 现在携带刷新心跳字段，例如 `current_stage`、`current_stage_label`、`heartbeat_at`、`progress` 与部分 `refresh_stats`，让运行中的任务在完成前也具备可观测性。
- `snapshot_recovery.py` 是 `C:\Fin\Grit_Strategy_Lab2` 的冷备探测与导入边界；Lab2 只被视为恢复来源，绝不能成为实时运行时依赖。
- `universe_history.py` 现在负责点位时刻一致的 universe 来源链，并默认走免费链优先：`SP500` 先使用 wikipedia revision-history、官方指数公告与 GitHub 当前名单校验，`Nasdaq-100` 先使用 `jmccarrell/n100tickers` 的年度 YAML，再退回 wikipedia revision-history 与官方指数公告；`FMP historical constituent` 只在 entitlement probe 成功时作为高级增强源插到链首。`SP500` 行业 PIT 不新增表，随每条成员行写入 `universe_membership_snapshots.metadata_json`，优先来自 Wikipedia revision/current table 和 GitHub 当前 CSV 的 GICS Sector / GICS Sub-Industry / 公司名列。
- `app_runtime_state` 保存清理账本，包括 `last_cleanup_count` 与 `last_cleanup_at`。它还会镜像当前激活的 snapshot refresh 心跳，让中断后的 worker 恢复逻辑可以区分“仍在运行”和“已经卡住”。
- `.tmp/runtime-supervisor/` 是本地脚本控制层的运行目录，不进入正式业务存储。`scripts/runtime_supervisor.py` 在其中维护 `supervisor.sqlite3`、锁、冷却窗口、intent 队列和 `state/*.json` 状态镜像；它只读取现有 `app_runtime_state`、`snapshot_refresh_jobs` 和 optimization runner claim 来判断后台任务是否仍活跃，不替代这些业务审计表。
- `QuickStart-Grit.ps1` 是人工入口但不再默认抢占健康监听。它启动前通过 supervisor guard 获取 `quickstart` 互斥锁；健康的 `backend-api:8000` 和 `frontend-preview:4173` 会被复用，只有 repo-owned 且 unhealthy/stale 的监听才会被停止。高风险动作如 backend/frontend 强制重启、PIT 身份修复和快照刷新重跑都应通过 supervisor 记录 `requested_by`、`reason` 与 cooldown。

清理行为如下：

- `purge_expired_temporary_runs()` 会删除 `is_permanent == 0` 且 `created_at` 超过 24 小时的运行记录。
- 清理路径不仅会删除数据库记录，也会删除关联的工件路径。
- `web/dist/plots/{run_id}` 下的绘图工件被视为可丢弃的清理目标。
- 清理会在启动时执行一次，此后每 6 小时由后台线程再次执行。
- `GET /workspace/overview?include_cleanup_audit=1` 会把最近一次清理数量作为 `last_cleanup_count` 暴露出来；默认工作台契约在未传查询参数时保持不变。

这套设计的目的，是避免本地实验室被短命实验塞满，同时保留永久运行及其审计轨迹。

## 3.1 Phase 1 组合与腿部持久化边界

一期 Compose First 采用“组合为核心、腿部分层建模”的边界：

- `组合` 是一期唯一新增的正式持久化核心对象。
- `资产腿` 与 `现金腿` 只做最小持久化定义，用于支持组合装配、冻结与回看。
- `策略腿` 不建立独立真相表；它始终是由 `strategies + strategy_parameter_versions + latest eligible run` 投影出来的可管理读模型。
- 这条边界是刻意保持的：一期不建立统一 `sleeve registry`，也不把策略研究主链路复制成第二套组合子系统。

当前新增或扩展的持久化对象如下：

- `asset_leg_definitions`
- `cash_leg_definitions`
- `compositions`
- `composition_legs`
- `composition_source_freezes`

其中：

- `asset_leg_definitions` 与 `cash_leg_definitions` 只保存最小定义、状态、引用与配置摘要，不承担完整版本树职责。
- `compositions` 保存组合级身份、状态、基准、再平衡频次、成本口径与汇总投影。
- `composition_legs` 保存组合内腿的排序、权重、锁定状态与来源引用。
- `composition_source_freezes` 保存组合落库时的来源冻结证据，用于详情页审计与后续回看。
- `composition_backtest_runs` 与 `composition_allocation_jobs` 是 Sleeve OS 组合层运行记录表面。v2 已把新建 run/job 从只写运行态 artifact state 升级为持久记录：记录保存请求配置、结果摘要、订单或候选投影、证据快照、运行状态和时间戳；旧 artifact state 只作为历史兼容 fallback，命中 fallback 后会回写专表。
- Sleeve OS v2 新增 `composition_versions` 表，保存组合版本快照：`id`、`composition_id`、`version_number`、`status`、`source_kind`、`source_ref_id`、`snapshot_json`、`diff_json`、`evidence_json`、`created_at`。组合配置实验结果现在仅作为测试参考，不再从 allocation 候选生成 `DRAFT` 版本或运营待办；历史版本表继续服务手工保存与审计读取。
- Sleeve OS v2 新增 `composition_decision_packets` 表，保存 readonly 决策包：`id`、`composition_id`、`version_id`、`source_refs_json`、`packet_json`、`export_markdown`、`export_html`、`created_at`。决策包是创建时不可变快照，读取和导出不得重新拼接当前运行态。
- 组合回测详情接口还兼容组合冻结来源中引用的策略回测 run id：当该 run id 属于当前组合的来源证据或标准化腿配置时，服务会用当前组合详情快照生成只读组合回测诊断、订单与证据投影，避免旧深链把策略来源 run 误判为缺失的组合 run。订单投影必须覆盖完整收益窗口内的全部调仓事件，不能再截断为详情页摘要用的少量示例事件；首个订单事件必须按组合建仓买入生成，后续事件按组合再平衡生成；策略腿订单的可见 `symbol` 必须按事件日期穿透到当时有效的底层成交标的，如果首个建仓日早于该策略源运行的首笔成交，则只在首个建仓事件使用首个可用策略持仓作为初始建仓穿透，并优先使用建仓日行情价格；来源腿只保留在 `source_leg_*` 字段中用于追溯，订单查询与导出支持先按 `source_leg` 再按 `symbol` 收窄；全量流水必须输出模拟成交价、美元手续费；触发原因只表达组合层建仓或再平衡动作，策略腿信息以持仓穿透来源呈现，不能把策略内逻辑和组合再平衡拼成同日双触发。

## 4. 参数版本真相

参数版本的真相存放在参数版本表里，而不是散落在临时 UI 状态中。

- `strategy_parameter_versions` 是版本化策略参数的事实来源。
- `strategy.parameter_history` 是给 UI 与 API 消费方使用的真相投影。
- 每个版本记录保存参数快照，并携带系统生成的变更摘要、用户决策备注、来源优化任务 / 回测运行 / 候选 / 基线版本元数据、可对照的替代版本，以及面向 UI 的可回滚状态。
- 每条历史记录都可以带 `comment` 或决策备注，当候选版本带着修订说明被提升时会写入对应说明字段。
- 创建会话既可以以 `CREATE` 模式开始，也可以以 `REVISION` 模式开始，并且会在会话契约中保留 `base_strategy_id` 与 `base_parameter_version_id`。
- 提升与物化路径会强制校验基线版本；如果基线已经移动，就返回 `409 stale_base_parameter_version`。
- 优化结果页可以有意把旧优化任务的候选晋升到当前策略版本：点击“晋升当前版本”时，前端必须把已经加载的 `strategy.current_parameter_version_id` 作为 `base_parameter_version_id` 提交。这样后端仍会校验用户看到的当前版本是否新鲜，但不会因为任务最初的 `job.base_parameter_version_id` 落后于策略当前版本而误拒绝。
- “回滚至该版本”不是改写历史记录，而是把某个历史版本的参数复制成一个新的当前版本；旧版本、来源关系和审计说明都必须继续保留。

关键规则是：UI 永远不自己发明版本。它只反映已经持久化的版本历史，包括解释“为什么出现这个新版本”的说明。

## 5. 交易审计流水线

回测执行现在会产出比平铺交易流水更有解释力的交易审计。

流水线摘要如下：

1. 提交一次回测。
2. 引擎计算运行结果并组装 `trade_audit_json`。
3. 服务同时持久化 `trade_audit_items_json`，作为证据栏的轻量投影。
4. `GET /backtest-runs/{id}/detail` 读取轻量投影，避免解码完整审计载荷。
5. `GET /backtest-runs/{run_id}/trades/{trade_id}/audit` 为单笔交易返回完整的 episode 级审计载荷。

审计模型以 episode 为单位：

- 一条审计记录代表某个 symbol 从入场到出场的一整个持仓 episode。
- 它不是 fill 级别，也不是 tick 级别的模型。
- UI 用 `trade_audit_items` 渲染列表行，而完整审计接口负责图表同步与诊断下钻。

完整审计载荷包括：

- 与相关 symbol 上下文对应的 `price_series`
- 用于说明交易理由的信号状态快照 `trigger_snapshot`
- 含 MFE、MAE、MFE/MAE 比率、滑点成本与说明文字的 `risk_evaluation`
- 用于图表锚点定位的 `entry_marker` 与 `exit_marker`
- 用于标识开仓到平仓区间的 `chart_band`

这样一来，运行详情页可以真正服务人工复盘，而不是假装一张平铺交易表就足够解释交易为何发生。

### 5.1 资产配置回测执行语义

资产配置型回测的再平衡由引擎生成交易审计与订单流水：

- 固定频率再平衡（月度、季度、半年、年度）表示在调仓点后的下一个可交易日执行目标权重校准。
- 偏离阈值只作为额外漂移触发，不取消固定频率触发。
- 显式资产篮子是硬契约：`allocation_assets` 或 `allocation_weight__*_pct` 声明的每个标的都必须在价格快照中具备可用历史。缺任一标的时，preview 与 submit 都必须通过 `REQUEST_SYMBOLS_MISSING_PRICE_HISTORY` 阻断；引擎直调只能返回空结果和缺价 warning，不能把缺价资产静默剔除后重配剩余权重。

## 6. 指标基线

恢复后的数学层刻意保持保守。

- `relative_metrics` 与 `drawdown_events` 被视为 Python 3.13 下的基线实现。
- 当前恢复路径假设只依赖标准库的数值行为。
- 已交付的指标层不依赖 numpy 或 pandas。
- 验收标准是能在当前运行时稳定复现，而不是与外部分析栈逐位对齐。

这点很重要，因为仓库已经跨越运行时变化被恢复过。即使原始环境不同，当前基线也必须在 Python 3.13 上保持稳定。

## 7. 公开 API 契约

稳定的 API 表面被刻意收窄，并且尽量具体。

- `/workspace/overview` 负责保持顶层工作台契约稳定。
- `/leg-inventory` 负责输出一期统一腿部读模型。它把策略腿视为投影，把资产腿/现金腿视为最小持久化定义，并直接返回 `strategy_reference_counts`，供资产库首屏展示策略腿引用数，避免前端再逐个拉取组合详情。
- `/asset-legs` 与 `/cash-legs` 负责写入最小定义能力，不承担策略版本化职责。
- `/strategy-creation-sessions/*` 负责创建与修订工作流。策略级 `ASSET_ALLOCATION` 使用独立 `#/creation/asset-allocation/new` 配置页完成标的、权重、执行模式、再平衡与成本参数录入；标的与基准选项来自 `/data-snapshots/overview` 的价格快照和“指数与基准”覆盖对象。`POST /strategy-creation-sessions/{session_id}/asset-allocation/recommendation` 只提供风险预算/风险平价导向的推荐权重，并且要求所有所选标的具备足够价格历史，不能用等权静默替代风险平价；最终产物仍通过同一策略物化、详情、回测与优化契约流转。
- `/backtest-runs/*` 覆盖预览、提交、克隆、详情、交易列表与单笔交易审计。
- `GET /backtest-runs/{id}/detail` 明确针对页面加载做了优化。它可以包含 `trade_audit_items`，但不能物化完整的 `trade_audit` 记录；完整审计只属于 `GET /backtest-runs/{run_id}/trades/{trade_id}/audit`。
- `/compositions`、`/compositions/{id}`、`/compositions/preview` 与 `/compositions/{id}` 的 patch 面共同构成一期组合工作台和组合详情页契约。预演接口负责返回收益流预览、相关性矩阵、风险贡献、维护成本与再平衡摘要，而不直接改写持久化状态。组合详情的 `backtest_history` 只投影已保存组合回测运行的冻结记录，每行必须保留运行创建时的组合配置版本、运行发起日、周期、收益和夏普，不能用当前组合配置、运行完成时间或当前策略来源覆盖旧记录；策略腿参数版本只作为二级审计事实，不作为历史主版本标签。组合列表契约同时负责仪表板所需的证据质量、当前配置版本、周期完整度与新版本提示，列表热路径不得物化完整详情或要求前端逐条详情补水。
- `/compositions/{id}/backtest-runs/*` 是组合层回测契约，服务“测稳定性”而不是策略参数搜索。结果分为诊断、订单和证据三组：诊断说明稳定性、跨周期指标、归因、动态风险暴露、压力窗口和底层标的集中度；订单暴露完整收益窗口的事件聚合、全量流水、过滤、CSV 导出与内部对冲下钻，并且策略腿订单必须显示穿透后的底层成交标的而不是 `STRATEGY` 汇总占位；证据保留冻结配置、数据足迹、代理映射、算法 spec 和审计轨迹。
- `/compositions/{id}/allocation-jobs/*` 是组合层资产配置测试参考契约，服务“定义分配政策并比较候选结果”。配置以意图导航、风险边界、换手约束、资产微调和相关性矩阵为主；结果保留当前组合候选、参考组合、有效前沿、候选权重、风险贡献、ENB、扣费后夏普、约束违反和迁移成本拆解。`current` candidate 是优化结果页当前组合指标的事实来源，前端不得用静态 Current / Benchmark 指标替代运行时任务返回值。候选默认不暴露 `promote_candidate`，配置实验不得生成待晋升候选、晋升审查任务或组合列表待决策数；后端旧提交口保留防御性拒绝，避免历史深链写入草稿版本。
- Sleeve OS v2 全局索引和闭环契约包括：`GET /compositions/backtest-runs`、`GET /compositions/allocation-jobs`、`GET /compositions/{id}/versions`、`GET /compositions/{id}/versions/{versionId}`、`POST /compositions/{id}/decision-packets`、`GET /compositions/{id}/decision-packets/{packetId}`、`GET /compositions/{id}/decision-packets/{packetId}/export?format=markdown|html`。这些接口保持 additive，不破坏 v1 Split 页面；allocation 全局索引只展示测试参考作业，`decision_queue` 对配置实验保持为空，version 与 decision packet 的读写都要走后端 contract，不允许前端凭静态样例生成“已通过”或“已晋升”状态。
- `/optimization-jobs` 返回按 `updated_at DESC` 排序的优化任务列表，并投影任务状态、策略关联、预算进度、`progress_pct`、`current_stage`、`latest_update`、`estimated_remaining_minutes`、`estimated_completed_at` 以及带类型的 `best_metrics_summary`，供优化实验室索引页与工作台混合时间线使用。
- `POST /strategies/{strategy_id}/optimization-jobs` 现在接收 `base_parameter_version_id`、`source_run_id`、`entry_point`、`validation_mode`、`budget_combinations` 与 `search_space`；只有参数配置页显式发起优化时才会创建任务。
- `POST /optimization-jobs/{id}/resume` 接收 `idempotency_key`，并且只会从 `next_trial_index` 继续 `INTERRUPTED` 任务；对同一 key 的重复调用必须保持幂等。
- `/optimization-jobs/*` 覆盖任务详情、候选创建、候选删除、恢复执行以及带说明的提升。
- `PATCH /optimization-jobs/{id}` 只用于结果页约束重新过滤预览，不改写已完成任务的永久快照。需要持久化过滤结果时，必须调用 `POST /optimization-jobs/{id}/filtered-results` 创建新的 `COMPLETED` 优化任务，并保留 `source_optimization_job_id` 指向原任务。该预览响应不是存储快照：当 `matching_combination_source=all_trials` 时，即使持久化层为了压缩清空了 `request_json/summary_json.matching_combinations`，响应也必须从 `optimization_job_trials` 重建并返回完整 `matching_combinations`，供“查看全部组合”弹层分页和排序使用。
- `GET /optimization-jobs/{id}` 返回已补水的 `request`、`summary` 与 `result` 三段。`summary.best_metrics_summary` 不再是松散的指标袋，而是持久化的 trial-summary 结构：`trial_index`、`label`、`status`、`parameter_snapshot`、`metrics`、`score`、`error_message`、`started_at`、`completed_at`。`QUEUED`、`RUNNING` 与 `INTERRUPTED` 响应刻意保持轻量：只暴露进度、ETA、当前最佳指标与恢复元数据，而不物化完整候选网格。终态才会根据持久化的 trial 记录物化完整结果中心，其中包含验证窗口的 `annualized_return`，但只会为排名 top-K 的候选加载完整曲线。
- `GET /optimization-jobs/{id}/detail?matching_limit=N` 是优化结果页首屏专用的候选预览契约：响应可以只返回前 N 条 `matching_combinations`，但必须保留真实的 `matching_combination_count` 与 `matching_combination_source`。用户打开“查看全部组合”时，前端再读取不带 limit 的详情来补全候选集合。
- 体量较大的优化任务仍然保留了一套 Windows 安全的 `spawn` 进程分发实现，并隐藏在服务边界之后。它不是 API 层用户可配置的能力，会根据运行时内存压力自动下调 worker 目标，也能在不改变持久化任务契约的前提下回退到单 worker 模式；不过当前 synthetic evaluator 默认关闭这条路径，直到出现真正需要它的重型 evaluator。
- 当前优化 evaluator 路径刻意脱离 `_prepare_backtest_run_context()`。活跃的 `_service_rebuilt.py` evaluator 是 synthetic 且以摘要驱动的，因此优化执行期间不会预加载准备好的 snapshot bars。
- `/data-snapshots/overview` 返回正式快照契约：`overall_status`、`last_refreshed_at`、`dataset_snapshots[]`、`universe_snapshots[]`、`latest_job`、`blocking_code`、`blocking_target`、`message` 与 `allowed_actions`。数据源治理在既有 `provider_readiness_summary` 之外，继续 additive 增加 `data_layer_readiness`、`snapshot_quality_alerts` 与 `factor_dimension_readiness`，用于股票快照 tab 的 L1-L4 分层治理；这些字段只能增强运营与诊断表达，不得改变既有阻塞判定或 bond 分段逻辑。
- `POST /admin/snapshot-refresh-jobs` 与 `refresh-snapshots` CLI 的 repair 模式默认按小批 missing-symbol 轮转以保护免费源配额；需要一次性验证指定价格缺口时，可传 `repair_symbol_limit` / `--repair-symbol-limit N` 扩大本次 job 的缺口选择范围，选择结果写入 `summary_json.selection_metadata.repair_symbol_limit`。
- `GET /data-snapshots/provider-registry` 与 `GET /data-snapshots/provider-attempts` 是只读数据源治理投影。它们从运行时 provider 链、`missing_provider_reasons`、快照 `metadata.provider_summary` 与最近 `snapshot_refresh_jobs.summary_json.refresh_stats` 归一化 registry/attempts，不新增表、不写数据库、不发起外部 provider 请求。读取端复用 snapshot overview 的短缓存与市场数据签名，避免底部可信层或 raw registry 重复重建完整快照读模型。
- Provider registry 固定暴露 `provider_id`、来源名称、access tier、凭据需求、目标类型、fallback 顺序、最近尝试、quota/cooldown、错误摘要和 PIT 权限。凭据字段只能显示环境变量名称、configured/missing 状态和 `secret_persistence=disabled`，绝不能返回密钥值。
- API-key provider 的上游拒绝必须分清 `credential_rejected` 与 `entitlement_required`：前者表示 key 形态或 token 本身无效，后者表示 key 已被读取但当前账户、套餐或 legacy 数据库没有资源权限。错误投影只能保存状态码、无密钥的 provider error fingerprint 与操作建议，不得保存完整响应体或请求 URL。
- Provider readiness 的运营口径必须区分四层：`registered` 表示静态定义或运行时可见；`enabled` 表示当前 provider 链注册且未被 OpenBB 开关或 missing-provider 标记禁用；`credential_ready` 表示当前启用口径下所需只读环境变量已配置；`usable` 表示 enabled 且 credential-ready 且没有当前 quota/cooldown。`provider-attempts.rollup` 使用 `unique_provider_latest_job_priority`，先按最新 job 选每个 provider 的代表尝试，再回退到快照 metadata，避免把同一 provider 的 job 与 metadata 双重投影误读为新增收益。
- 数据可信层不新增 `data_trust_events` 或独立证据账本。Registry item 只 additive 暴露 `trust_profile`，`/data-snapshots/overview` 与 `/pit-data` additive 暴露同构 `data_trust_summary`，从 snapshot metadata、provider registry、provider attempts 与 PIT overview 归纳“能证明什么、不能证明什么、能否推进 Full Ready”。
- `data_trust_summary.layers[]` 固定按角色聚合：价格主链、成分股历史、退市/身份、公司行动/zero-event、长周期补丁、精修来源。`Tiingo` 是 EOD OHLCV 与公司行动修复首选；`FMP historical constituent` 证明历史成员 in/out 日期；`SEC EDGAR/CIK` 只证明身份和生命周期，不提供价格且停止申报不能直接等同破产；`Nasdaq WIKI`、Nasdaq Data Link Tables EOD、`Stooq` 与 Kaggle 是 price-only 补丁，不能单独清公司行动或身份门禁；`Finnhub` 只作为身份/listing 辅助与 targeted candle fallback，不是 PIT GICS 权威源；`EODHD` 是显式授权的退市价格/分红拆分/基础面补源，需记录 `SYMBOL_old.US` 等 provider-specific 映射；`Polygon` 只在 key 存在时作为关键缺口精修。
- `dataset_snapshots[]` 现在包含 `ds-index-valuations`；其 metadata 会发布 `proxy_keys`、`observation_frequency`、`latest_pe_ttm` 与 `latest_percentile_10y`，供 `#/snapshots` 和动态定投策略诊断使用。
- 债券治理页不单独新开快照 API。`/data-snapshots/overview` 追加 `bond_fixed_income` 分段，只发布 market-data repository 中真实的 runtime eligible sources / instruments / raw registry；没有 runtime 债券行时，曲线预览与 registry 必须为空，不允许 deterministic seed 或 phase1 proxy 兜底。
- 债券治理页的健康仪表盘以 `bond_fixed_income` 当前运行时契约状态为异常队列口径；共享 overview 的股票、公司行为、估值或股票池阻塞只能作为完整刷新链路的背景，不进入债券异常队列或系统诊断。债券页的刷新 CTA 使用完整目标 `price,corporate,valuations,universes,bond`，避免七条债券行就绪时掩盖跨资产刷新动作的覆盖范围。
- `/pit-data` 是多因子 PIT 清洗中心契约，读取点时价格、基础面点位、样本池与异常清洗状态，服务因子诊断的数据门禁；契约保持 additive，除原有门禁摘要外还发布 `coverage_gap`、`status_reasons`、`ops_guidance`、`cleaning_rule_previews`、`universe_history_series`、`adjustment_trace`、`research_waiver`、`full_ready_repair_plan`、`fundamental_snapshot_id`、`fundamental_status` 与 `fundamental_coverage`。本期继续 additive 增加 `pit_layer_readiness`、`factor_diagnostic_readiness`、`pit_quality_alerts` 与 `snapshot_layer_linkage`，把 snapshot 源就绪映射到 PIT 可回放/可诊断/可晋升表达，并统一 `VERIFIED / SANDBOX / BLOCKED / DISABLED` 的内部状态枚举。基础面 PIT 默认挂在 `ds-fundamentals`，本地启动会幂等生成 repo-controlled 种子快照，字段覆盖 `ltm_earnings`、`book_value_equity`、`market_cap`、`shares_outstanding`、`operating_cash_flow`、`capex`、`enterprise_value`、`total_debt` 与 `cash_and_equivalents`，不覆盖外部 provider 数据。基础面观测必须使用 `available_at` 作为可得日，诊断与模型只能读取 `available_at <= as_of_date/observation_date` 的行，不能用财报期末日伪装可用。`coverage_gap` 按当前核心成员、历史生命周期、非核心缺口、公司行为对齐和身份映射待解析分桶；每个分桶发布缺口数量占比、市值权重占比、历史锚点时间分布和可修复 symbol 详情；`full_ready_repair_plan` 按免费源极限路线发布 Full Ready 修复队列、免费供应商冷却、alias 候选、zero-event certificate 计数和拒绝伪 Ready 规则；`status_reasons` 给顶部状态卡提供微缩阻断原因，避免只显示 `BLOCKED`；`ops_guidance` 给数据运维提供当前优先指令。读取端使用短时服务级缓存，PIT 写入接口会主动失效缓存，因此重复打开 PIT 清洗中心、因子库和因子详情时不应每次重建完整 overview。
- `/pit-data` 的 L1-L4 层级允许返回 `PARTIAL_READY`，前台显示为“部分可用”。该状态只用于 readiness/read-model，不写入底层 `dataset_snapshots.status`。`pit_layer_readiness[]` 可以携带 `submodules[]` 与 `upstream_capabilities[]`，`factor_diagnostic_readiness[]` 可以携带 `required_checks`、`satisfied_checks`、`blocked_checks` 与能力列表；`snapshot_layer_linkage[]` 必须区分 `hard_blocking` 与 `capability_mode`。因此 L2 财务字段、L3 卖空样本、L4 宏观/期权特征源即使所在大层未 Full Ready，也能作为子模块暴露给因子研究、沙箱诊断或 feature preview；正式诊断与晋升仍必须满足对应因子族的必需检查，尤其是需要 forward return / IC 的路径仍依赖 L1 价格和历史样本池。
- `/pit-data.factor_admission_coverage` 是因子库正式准入 read model，固定使用最近 10 年 PIT 价格与样本池覆盖计算。当前核心成员缺价、10 年窗口硬缺口、基础面 `available_at` 和行业 PIT 缺口仍是硬阻断；30 年 Full Ready 归档缺口、非核心历史缺口、场景证据不足和元数据复核差异进入 warning/repair，不单独阻断普通因子诊断、检疫或多因子策略创建。Full Ready 仍保持更严格定义，不能被 10Y 准入状态替代。
- `full_ready_repair_plan.queue_sample[]` 现在会为每个缺口附带 `next_provider`、`provider_priority`、`required_evidence` 与 `trust_blocker`。Full Ready 统一要求可审计价格、PIT 成员历史、公司行动或 zero-event certificate、稳定身份映射同时闭合；研究态 waiver、price-only 来源、identity-only 来源或当前成分兜底都不能让正式门禁变绿。
- `zero_event_certificates[]` 是证书候选投影，不是最终事实落库。它必须绑定 symbol、CIK 或生命周期证据、成员退出日期、last filing evidence 与 price/action provider negative result；只有当正式 provider 返回空事件或不可恢复证据时，才能把公司行动缺口晋升为 zero-event certificate。
- `universe_history_series` 是给 `#/pit-data` 趋势图使用的年度 read model，每个自然年只发布该年最后一个有效历史锚点；原始锚点总数通过 `coverage.universe_history_anchor_count` 与 `source.historical_universe_anchor_count` 暴露，避免把逐锚点明细内联进 PIT 首屏热路径。
- `/pit-data` 首屏读取 `universe_membership_snapshots` 时使用 SQL 聚合和 `(universe_snapshot_id, effective_date, symbol)` / active partial indexes 生成冷路径 read model；不能为覆盖率分桶或 temporal preview 全量水合百万级成员行。`coverage_gap.buckets[].temporal_distribution` 是有界预览，完整逐锚点缺口分布属于显式下钻或导出能力。
- `POST /pit-data/identity-overrides` 写入人工 Mapping Overwrite 到 `symbol_identity_cache`，用于把身份映射待解析的历史 ticker 临时绑定到 canonical symbol；该接口只更新身份修复缓存，不直接刷新价格、不绕过 Full Ready，也不替代后续 provider / scraper 的正式补数。
- `POST /pit-data/identity-scraper/restart` 执行 PIT 身份映射修复任务：读取当前 `coverage_gap.identity_unresolved` symbol，调用运行时 market-data provider 的 `resolve_identity()`，并把成功解析的结果写回 `symbol_identity_cache`。响应包含 `job_id`、`status`、尝试/成功/失败数量、执行前后 pending 数、成功/失败 symbol 列表和刷新后的 `pit_data`。没有可用 identity provider 时返回 `BLOCKED` 结果，不把缺口伪装成修复成功。
- `POST /pit-data/research-waiver` 创建或替换当前 PIT 研究态豁免，默认只预选 `coverage_gap.default_ignored_symbols` 中的非核心缺失 symbol；`DELETE /pit-data/research-waiver/{id}` 撤销豁免。豁免只允许研究诊断进入 `LIMITED_READY`，`research_waiver.impact_estimate` 会记录被忽略 symbol 的缺口占比、市值权重和估算 IC 扰动；诊断摘要必须写入 `pit_readiness_mode`、`waiver_id`、`ignored_symbol_count`、`waiver_impact_estimate` 和 `promotion_eligible=false`；正式晋升、策略 Promotion、组合入库仍必须满足 `READY` / Full Ready。
- `/pit-data` 的阻塞项必须携带行动目标：价格快照阻塞跳转 `#/snapshots?tab=equity&target=ds-price`，Universe 阻塞跳转同页 universe target；`#/snapshots` 只解析并高亮目标行，不改变股票/债券快照页面信息架构。
- `/factors`、`/factors/{factor_id}` 与 `/factors/{factor_id}/diagnostics` 构成因子库、因子详情/诊断和因子编辑器契约。`GET /factors` 默认保留七个 canonical baseline seed：`s_val_ep_ltm_raw`、`s_val_bp_latest_raw`、`s_mom_12m1m_rank`、`s_qlty_roe_ltm_raw`、`s_qlty_fcfy_ttm_raw`、`s_vol_252d_rank` 与 `s_size_cur_log`，并在同一 Factor Zoo 种子层 additive 扩展 beta、价值、质量、投资、动量、风险、流动性和 alpha blend 描述符；旧默认 ID 只作为 alias 解析到 canonical 因子，不能再出现在列表展示中。`GET /factors` 保持旧字段语义，同时追加 `ui_state` / `ui_state_label`、`batch_diagnostic_summary`、`correlation_cluster_summary`、`blocker_reason_summary` 与 `strategy_creation_risk` 轻量投影；`lifecycle=online|offline|all` 控制线上与已下线视图，默认只返回未下线因子，已下线项保留 `offline_reason`、`offline_at`、`offline_command` 与 `offline_detail` 供审计读取。`GET /factors/{factor_id}` 也属于因子研究热路径，必须复用因子库轻量 PIT 投影来计算 readiness、阻断和治理摘要；完整 PIT overview 只属于 `GET /pit-data`、研究豁免写入和正式诊断提交校验，不能被详情页首屏同步阻塞。`POST /factors` 写入自定义因子时必须提供 `source_category_metric_window_operator` 描述符，人工因子 ID 由 `m_<category>_<metric>_<window>_<operator>` 生成；重复描述符返回 409。诊断预览走 `POST /factors/diagnostics/preview`，报告导出走 `GET /factors/{factor_id}/diagnostics/{run_id}/report`。
- 因子库一期治理在 `GET /factors` 追加 F1/F2/F3 列表投影，但不改变既有字段和写入路径：`tier_level` 映射 `F1 原始 / F2 改造 / F3 组合`，`lifecycle` 映射 `沙箱 / 线上 / 待校准 / 已归档`，`factor_level` 映射 `S/A/B/C/D`，`op_status` 发布 `W/N/Z/T` 去极值、中性化、标准化、时序排名状态灯，`lineage_summary` 只给列表页判断能否打开血缘树，`quality_view` 给 RankIC、IR、衰减、覆盖率与 IC sparkline。生命周期查询新增 `all/sandbox/online/to_be_verified/archived`，旧 `online/offline/all` 继续兼容；无参默认仍按未归档 active 语义保护旧调用。F1/F2/F3 清洗必须综合表达式、descriptor、source、metadata 和 `factor_lineage_edges`，不得只按 `_raw` 后缀判定；派生因子缺少持久化 lineage 时允许通过表达式解析补出只读 lineage 投影。`GET /factors/{factor_id}` 承接列表页移除的右侧审计栏，返回完整 `lineage_tree`、父因子、算子参数和审计轨迹。因子工厂、D2 quarantine、publish 自动化路径不属于本期改造范围。
- 因子诊断按数据源分层：动量与低波继续使用价格 PIT；估值、质量与规模按 observation date 读取不晚于该日期的最新基础面 PIT 点位。市值采用复权收盘价乘 `shares_outstanding`，供应商市值只保留校验差异；企业价值优先供应商 EV，缺失时回退为 `MarketCap + TotalDebt - CashAndEquivalents`。七个默认因子在基础面种子快照存在时至少可进入 Sandbox 诊断，完整价格和样本池 PIT 通过后可进入 Verified 诊断；基础面快照缺失或字段不全时必须显示明确的 `基础面 PIT 缺口`，而不是泛化为“待生成”。
- `factor_expression_engine.py` 是诊断、挖掘和多因子打分共享表达式引擎。它只开放白名单字段和算子，统一执行 Winsorize/ZScore/方向调整；`import`、`eval`、`__`、分号、未知字段、未知算子、过深 AST 与未来引用必须被拒绝。行业中性化仅在 PIT 行业字段存在时执行，缺字段时返回 blocker。长窗口 `Std/StdDev` 使用滑动累计计算，避免多因子低波类回测按 symbol/date 重复扫描 252 日窗口。
- 因子治理投影把后端细粒度状态映射为前台四类语义：`robust/稳健`、`needs_calibration/待校准`、`decayed/失效` 与 `sandbox/沙箱`。前台分类标签使用六类标准风格口径：`mom=动量`、`size=规模`、`val=估值`、`qlty/inv=质量`、`vol/beta=风险`、`liq=情绪`；不在六类内的 composite/alpha 描述符统一显示为“其他”。其中 asset growth 与 capex 归入质量，残差 beta 归入风险，换手率归入情绪。`GET /factor-governance/overview` 只返回可执行治理任务：`DEPRECATE`、`PRUNE` 与 `FACTOR_MODEL_SUGGESTION`，历史 `REVIEW/CROWDED/DECAYED` 诊断消息不进入任务弹层。没有正式诊断但可通过 `POST /factors/diagnostics/preview` 得到 `FACTOR_EXPRESSION_PREVIEW` 只读证据的线上因子，也必须纳入治理概览的 DEPRECATE 判定，并在 `offline_detail.preview_only=true` 中保留预览来源。
- PRUNE 冗余裁剪采用“真实可复核证据优先”的治理口径：同簇候选、MVP 和执行前重算仍共享治理概览中预览增强后的线上因子宇宙，但裁剪触发必须同时满足同一相关簇、相同 W/N/Z/T 算子状态灯、对齐日期后的诊断 `ic_series` Pearson 相关性样本重叠不少于 6 个观测、绝对相关性大于 `0.90`。因子库热力图、descriptor 启发式、表达式同族判断和 cluster top-N 只能作为 warning/审计线索，不能单独写入 `PRUNED`。服务端执行时必须重新计算实测证据与状态灯一致性，不能只信前端 payload；历史 `PRUNED` 因子可通过 `/factor-governance/prune-recovery/preview` 与 `/factor-governance/prune-recovery/apply` 回溯，缺少高于阈值的实测/检疫冗余证据或历史裁剪双方算子状态灯不同的因子应恢复为 `VERIFIED`，并写入 `factor_governance_events`。
- `POST /factor-governance/actions/{action_id}/execute` 只接受带 `confirm=true` 的执行类治理任务：`DEPRECATE` 要求 Grade D 噪声证据（`|Rank IC| < 0.01` 且 `|IR| <= 0.2`），严格下线证据还会记录 20 个交易日低效和 Q1/Q5 倒挂；`PRUNE` 只下线同簇实测高相关冗余因子，在 `offline_detail` 记录保留 MVP、相关性、证据来源、样本数、IR 与覆盖率比较。下线使用 `FactorLifecycleStatus.DEPRECATED/PRUNED` 加软下线字段，不使用 `deleted_at`；下线因子仍可被已下线 tab 与详情页读取，但必须被策略配置、因子模型预览/创建和算力预览排除。相关性高、同族重叠、IC/IR 不稳定、coverage 边缘、换手衰减和诊断过期属于策略创建风险提示；PIT 缺口、未来函数、不可回放/current-only 字段、unsafe expression、缺失 `available_at`、启用中性化但缺行业 PIT 才是硬阻断。
- 因子库列表不得再用前五个基准因子复制新增因子的 IC/IR；没有正式诊断的人工因子或新增默认因子在 `GET /factors` 中保持无 `last_diagnostic_run_id` 与无正式摘要，前端再通过 `POST /factors/diagnostics/preview` 的只读批量投影按该因子自身 expression、direction、PIT 价格和基础面点位计算 `data_lineage.kind=FACTOR_EXPRESSION_PREVIEW` 的真实口径指标。系统默认扩展因子也不得用同一个 `Return(Close,252)` 包装成不同风格名：Beta 使用等权市场回归，残差 Beta 使用回归残差波动，Asset Growth 使用 PIT 股本增长与 Capex 强度，下行波动、最大回撤、换手、Amihud 与 FF Blend 都要走各自的可回放代理。该投影不写入 `factor_diagnostic_runs`，不能晋升为正式 Verified 诊断；批量投影复用轻量 PIT overview、最新有效 universe anchor 和请求内共享的 bars/fundamentals 缓存，首屏只读预览默认取最近 12 期口径，完整 Verified 绑定校验仍保留给正式诊断提交。`VERIFIED_PIT_WINDOW_INCOMPLETE` 只表示完整 Verified 窗口仍未满足，在 Sandbox/Limited 研究态属于风险提示；除多因子低风险非核心价格缺口例外外，`PRICE_SNAPSHOT_NOT_READY`、`PIT_GATE_BLOCKED`、`UNIVERSE_HISTORY_BLOCKED`、基础面/行业 PIT 缺口、未来函数和不可回放字段仍保持硬阻断。
- 因子压力场景固定为 2000 互联网危机、2008 金融危机和 2022 熊市/加息冲击。压力场景是审计与极端行情证据层，返回必须标明真实 PIT、历史代理或待补源来源，默认 `blocks_factor_admission=false`，除非另有硬门禁失败。
- `POST /factors/diagnostics/preview` 保持单因子 preview 旧契约，并 additive 支持 `{batch: true, factor_ids, diagnostic_mode, include}` 只读批量投影，返回 `mode=BATCH`、`items` 与 `batch_summary`；batch preview 不写入 `factor_diagnostic_runs`，正式单因子诊断仍只由 `POST /factors/{factor_id}/diagnostics` 落库。
- `factor_mining_jobs` 与 `factor_mining_candidates` 是挖掘沙盒主库表。`POST /factor-mining/jobs` 当前使用本地同步小批量 runner，父线程独占 SQLite 写库，候选保存表达式、Rank IC、fitness、覆盖率、换手、风格相关性惩罚、最大回撤相对基准、Auto-Residual 摘要和失败样本；候选不得写入 `factor_definitions`，后续进入正式因子库必须走检疫/人工验证。API 创建挖掘任务必须从 `ds-price` 运行时价格快照读取市场数据，至少两个标的具备可用价格序列才允许执行；同一挖掘配置按样本池、日期、算子集合、候选数、IC 门槛和表达式深度做事前校验与列表去重，随机种子不单独制造一条视觉重复任务；运行中任务必须通过候选检查点刷新 `progress_json` 与 `updated_at`，让页面轮询能看到已评估候选数和百分比，而不是只在创建与完成时更新；`top_candidates` 按表达式去重后再发布给沙盒摘要；`factor_mining.py` 的 synthetic 数据只允许作为纯 runner 单元测试默认，不得作为 API 或页面运行时兜底。
- `POST /factor-models/preview` 是零写入预览，返回权重归一、PIT 覆盖、score preview、换手估计、PIT blocker、行业中性化状态和 additive `strategy_creation_risk`。`POST /factor-models` 复用现有 `strategies` 与 `strategy_parameter_versions`，写入 `strategy_type=MULTI_FACTOR`，并保存 `factor_ids`、`weights`、`directions`、`neutralization`、`scoring_method`、`rebalance_frequency` 与 `pit_snapshot_refs`；创建前必须重新跑 preview，只有 `strategy_creation_risk.hard_blockers` 或启用中性化但缺 PIT 行业字段时拒绝物化，高相关和同族重叠只提示风险。核心/历史核心 PIT 价格缺口为 0 且非核心缺口市值权重为 0 的价格缺口只进入 `admission_risk_context` 和 `summary_label=低风险准入`，不作为 `POST /factor-models` 物化阻断。
- 多因子行业映射只读取 `effective_date <= as_of_date` 且成员状态仍可用的 `universe_membership_snapshots` 行，并在 SQL 层按当前预览/回测候选 symbol 切片，避免从百万级 universe membership 历史全量扫描。行业解析按 `gics_sector` / `GICS Sector` / `sector` 等真实 metadata 字段执行，并把 `taxonomy=GICS`、`industry_field`、覆盖/缺失数量和来源名作为 additive neutralization evidence 返回。旧成员行没有行业 metadata 时继续形成 blocker，不允许单一行业、静态十个 symbol 或未来日期兜底。
- 多因子第二期第二步继续复用既有策略、回测和优化数据流，不新增表。策略参数快照仍是 `strategies` 与 `strategy_parameter_versions` 的 JSON truth，回测运行读取运行时参数快照，优化任务仍写入现有 `optimization_jobs` 与 trial/checkpoint 结构。
- `MULTI_FACTOR` 回测必须走 type-aware 信号路径：运行时参数快照中的 `factor_ids`、权重、方向、打分方法和行业中性化设置必须进入截面排序与持仓选择。不得退化到通用价格动量或模板默认 `_signal_score`；新增或修改回测路径时必须有差异化回归，证明两个不同因子篮子会产生不同排序、交易或指标。
- 第二步在现有响应上追加可选 view-model：`multi_factor_profile` 从策略参数、因子库元数据、PIT 覆盖和诊断状态构建；`multi_factor_precheck` 在回测 preview 与 submit 前构建并作为提交门禁；`multi_factor_attribution` 从回测运行参数、因子得分、持仓/收益摘要生成，并用 `attribution_source` 标明完整归因或估算归因；`multi_factor_parameter_ranges` 把因子权重、打分方法、再平衡频率和中性化方法映射为现有优化参数范围，不把 `neutralization.enabled` 暴露成搜索参数。
- 行业中性化是证据门禁，不是展示装饰。只有 PIT 行业字段存在且执行路径有证据时才允许展示为已执行；缺字段时 profile/precheck/attribution 都必须暴露 blocker 或未执行状态，submit 也必须拒绝启用中性化的多因子回测。
- 优化配置把多因子权重等参数折叠进现有 search space，不另建多因子优化服务。候选参数摘要、结果卡和参数差异渲染必须经统一 formatter 输出中文业务文案，不能直接暴露 raw JSON、raw enum 或嵌套对象字符串。
- 多因子回测配置 preview 是门禁视图，不是回测结果视图；服务层应从策略参数快照、PIT 覆盖摘要和快照元数据构建 `multi_factor_precheck`，避免触发完整回测模拟或大 universe 明细读取。多因子优化沿用现有 trial/checkpoint 存储，但因子权重 search space 必须带默认合计 100% 约束，旧任务 hydrate 时要修复或过滤不满足约束的候选。
- `/admin/snapshot-refresh-jobs` 接收 `reason`、`mode` 与 `targets`，返回的是刷新后的 overview 契约，而不是裸任务载荷。
- `python -m grit_backtest_platform.main refresh-snapshots --reason ... --mode incremental|repair|full --targets price,corporate,valuations,universes` 是供 Windows Task Scheduler 使用的调度安全 CLI 入口；API 进程并不持有 18:00 的触发责任。
- 运行中的刷新任务现在会在仍处于 `RUNNING` 时持续写出心跳 checkpoint 与部分合并后的 dataset snapshot；overview 消费方应预期 `latest_job.summary.refresh_stats` 会先变化，再等到终态任务写入落地。
- 运行中的市场数据来源链按角色分工：PIT 缺口修复优先级是 `Tiingo -> FMP -> Nasdaq WIKI/Tables EOD/Stooq/Kaggle -> Finnhub/SEC/CIK -> EODHD -> Polygon`。价格热路径仍可使用 Yahoo/yfinance 等公开源，但 Full Ready 修复必须把 Tiingo 视为 EOD 与公司行动首选、FMP 视为成分股和退市身份增强、Nasdaq WIKI/Tables EOD/Stooq/Kaggle 视为 price-only 长周期补丁、Finnhub 视为身份/listing 辅助与小批 targeted candle fallback、SEC EDGAR/CIK 视为身份生命周期确权、EODHD 视为 `EODHD_API_TOKEN` 门控的退市 bundle lane、Polygon 视为 key-gated 精修 lane。`NASDAQ_DATA_LINK_API_KEY` 只用于 Data Link WIKI 与 Tables API；Nasdaq real-time/delayed API 需要独立 client ID、client secret 与 base URL，当前不接入 Full Ready 主链。
- `GRIT_ENABLE_OPENBB_PROVIDER=1` 时，OpenBB 作为可选增强层加入既有快照 provider 链：`openbb_yfinance` 是公开价格补充，`openbb_tiingo` 只在 repair 等 quota-aware 路径使用，`openbb_alpha_vantage` 只参与 targeted price repair，`openbb_fmp` 需要 key 且仍按 paid-optional 处理；默认安装和默认启动不依赖 OpenBB。未启用时，registry 可列出 OpenBB 静态定义但必须显示 `enabled=false`，运行时不得 import、实例化或尝试 `openbb_provider`。
- OpenBB 固定收益层只包裹现有官方债券 provider。官方 Treasury / TreasuryDirect / iShares 行优先保留；`openbb_federal_reserve` 与 `openbb_fred` 只用于填补或交叉校验缺失的 UST/TIPS 曲线行。若 OpenBB 生成路由与 provider interface 版本不匹配，adapter 会降级调用对应 provider fetcher，并把 OpenBB decimal rate 归一为本项目的 `ytm_pct` 百分点口径；该降级只影响 OpenBB 增强层，不改变官方债券来源优先级。LQD 仍以官方/iShares 证据为准，除非 OpenBB 返回足以满足当前字段门禁的 ETF 证据。
- OpenBB 密钥只读环境变量 `TIINGO_API_TOKEN`、`ALPHAVANTAGE_API_KEY`、`FMP_API_KEY` 与 `FRED_API_KEY`；响应、SQLite、OpenBB user settings 与 snapshot metadata 都不能持久化密钥值。
- `Longbridge` 只是当前或最近窗口的美股云端增强源；它绝不能被当成 1996 起全历史的规范来源，也不能参与历史 universe 锚点。
- Universe snapshot 只有在每个锚点都来自历史来源时才算 `READY`，即必须来自 `historical_dataset`、`wikipedia_revision` 或 `official_announcement` 这类历史语义来源；当前页面或静态种子回退都必须明确标成不完整，避免正式回测悄悄滑向幸存者偏差 universe。
- OpenBB `index.constituents` 只写 `metadata.openbb_current_constituent_check`、`provider_summary.providers.openbb_index_constituents` 与 provider attempt 辅助校验，`pit_permission.mode=metadata_only` 且 `can_upgrade_pit_readiness=false`；它不能新增历史锚点，不能把当前成分或静态/当前页 fallback 提升成 `READY`。

前后端测试都是围绕这些契约写的，而不是围绕内部实现细节写的。

## 8. 前端运行时真相

恢复后的前端现在有明确的运行时边界，应该被当成一级架构表面来对待。

- `web/src/app-runtime.tsx` 是稳定的入口 shim。
- `web/src/app-runtime-cn.tsx` 是当前激活的运行时实现。
- `web/src/lib/appRouteContext.tsx` 是唯一的 hash 路由解析与导航真相。
- `web/src/shell-frame-cn.tsx`、`web/src/shell-route-meta-cn.ts` 与 `web/src/app-shell-frame.css` 定义共享应用外壳。
- `web/src/lib/demoStoreContext.tsx` 通过 `useApiClient` 构成真实浏览器 HTTP 客户端边界。
- `web/src/app.routes.foundation.test.tsx` 是路由 smoke 的真相文件；`web/src/app.routes.test.tsx` 仅用于兼容。
- `web/src/pages/optimization-lab-page.tsx` 把优化详情视为三态页面：进度态（`QUEUED/RUNNING`）、中断态（`INTERRUPTED`）与终态（完整结果中心）。
- 优化结果页会用单飞轮询循环读取运行中任务详情，并采用自适应节奏：前台标签页更快，后台标签页自动降频，临时请求错误则走有界退避。

正式的前端路由表固定为。Sleeve OS v2 全局路由已接入同一套 shell/runtime，不新建第二套路由层：

- `#/workspace`
- `#/compositions`
- `#/legs`
- `#/compositions/workbench`
- `#/compositions/list`
- `#/compositions/backtest-runs`
- `#/compositions/lab`
- `#/compositions/:id`
- `#/compositions/:id/backtest-runs/new`
- `#/compositions/:id/backtest-runs/:runId`
- `#/compositions/:id/allocation-lab`
- `#/compositions/:id/allocation-jobs/:jobId`
- `#/strategies`
- `#/creation/asset-allocation/new`
- `#/creation/sessions/:id`
- `#/strategies/:id`
- `#/strategies/:id/backtest-runs/new`
- `#/runs`
- `#/runs/:id`
- `#/optimization-jobs`
- `#/optimization-jobs/new`
- `#/optimization-jobs/new/config?...`
- `#/optimization-jobs/:id`
- `#/snapshots`
- `#/pit-data`
- `#/factors`
- `#/factors/new`
- `#/factors/factory`
- `#/factors/sandbox`
- `#/factors/quarantine`
- `#/factors/:id`
- `#/factor-models/new`

一期 Compose First 的前端运行时规则补充如下：

- `#/compositions` 是组合仪表板，不复用旧 workspace 页面换皮。
- `#/legs` 是资产库，负责管理策略腿投影、资产腿定义与现金腿定义。
- `#/compositions/workbench` 必须先于 `#/compositions/:id` 被 route parser 匹配，避免工作台被详情路由误吞。
- Sleeve OS v2 的 `#/compositions/list`、`#/compositions/backtest-runs`、`#/compositions/lab` 也必须先于 `#/compositions/:id` 匹配；这些是组合域全局索引页，不是组合 id。
- `#/compositions/workbench` 与 `#/compositions/:id` 都通过现有 shell/runtime 边界接入，不允许另起第二套路由层。
- Sleeve OS v1 只实现 Split 方案：组合回测配置页进入组合回测结果页，组合优化配置页进入组合优化结果页；历史 Stepper 设计稿不进入正式路由。
- Sleeve OS v2 在 v1 Split-only 之上增加全局组合列表、组合回测列表和组合实验室列表；三页共用批准 UI artifact 的紧凑 hero、四张指标卡和 dense table 节奏。全局实验室只列配置实验作业和测试参考状态，不再生成晋升审查队列；有效前沿仍属于单个 allocation job 结果页。它的组合、优化方法、候选状态和参考状态筛选必须是 URL/query-backed 真控件，作业表固定为任务、优化方法、预期绩效、状态标签、迁移成本和操作六列。
- 组合回测结果页使用 Diagnosis / Orders / Evidence 三个 tab。诊断页回答结果是否稳健，订单页回答完整历史窗口内如何调仓与省下多少外部成交，证据页回答数据、代理和算法是否可信；真实 API 返回空数组时页面必须保持空态，不能用内置示例订单补位。
- 组合优化页面不复用策略优化语义。配置页以“波动最小 / 风险平价 / 收益最大 / 专家模式”意图导航为入口，结果页用有效前沿和候选卡说明哪个方案最符合目标。
- 左侧导航当前分为 `组合`、`策略`、`因子`、`数据` 四组；组合组包含 `组合仪表板`、组合列表、组合回测、组合实验室与 `资产库`，策略组保留既有主链路并把 `workspace` 对外标签统一为 `策略工作台`，因子组主导航只展示 `因子库` 与 `因子工厂`。`#/factors/factory` 是挖掘沙盒与检疫工作台的统一生产入口，旧 `#/factors/sandbox` 和 `#/factors/quarantine` 继续兼容并进入同一页面对应分区；数据组保留 `PIT 清洗中心` 与 `数据快照`。本期数据页升级为“快照分层治理 + PIT 门禁联动”：`#/snapshots?tab=equity` 保留线上股票 tab 的工作台骨架并引入 L1-L4 分层治理，`#/pit-data` 保留既有清洗入口并新增 L1-L4 PIT 准入与因子维度就绪矩阵。

## Milestone 3 factor quarantine and governance

Milestone 3 keeps the existing `MULTI_FACTOR`, backtest, and optimization execution lanes, and adds a governance loop around factor publishing:

- The fixed chain is `Mining Sandbox -> Quarantine -> Orthogonal Engine -> Auto-Publish -> Factor Library -> Factor Model Draft -> Optimization Lab -> Crowding Governance`.
- Mining candidates are stored as quarantine candidates first. D1 candidates must not write directly to `factor_definitions`; only `PASSED` and `ELIGIBLE` D2 candidates may be auto-published as `AUTO_MINED / VERIFIED`.
- `Factor Factory` is the unified runtime orchestration surface for B1-B4. It persists daily/manual factory runs in `factor_factory_profiles`, `factor_factory_runs`, and `factor_factory_run_items`, while reusing `factor_mining_jobs`, `factor_mining_candidates`, `factor_quarantine_candidates`, `factor_publish_events`, and lineage/crowding tables for the research evidence chain. `POST /factor-factory/automation/start` enables daily automation and creates or reuses the current `GMT+8 14:00` daily run; `POST /factor-factory/run-now` creates a one-shot run without changing the daily automation profile and accepts `pipeline_scope` for compatible B1-B4 orchestration. `GET /factor-factory/overview` now projects `task_rows`, `scoring_candidates`, `quarantine_result_rows`, and `publishable_factors` for `B1 因子任务 -> B2 因子打分 -> B3 因子检疫 -> B4 发布准入`. Once a factory run finishes mining, the service automatically intakes the full persisted Raw_F2 batch into quarantine and executes checks, recording `raw_f2_batch_delivered_count`, `auto_intake_count`, `auto_quarantine_count`, status counts, and run-item audit rows; the first 50 rows are only the default quarantine page. Mining IC uses a non-overlapping signal anchor and forward-return window, and quarantine IR is persisted as a Newey-West/Bartlett overlap-adjusted value with holding period, lag count, naive IR, and pure residual IC evidence for long-horizon momentum.
- `POST /factor-factory/refine-online-raw-f2` is the one-shot online-library repair path for existing Raw_F2 factors. It reads all non-deleted F2 definitions whose expressions still miss WNZT evidence, including active, sandbox, blocked, deprecated, and pruned rows, creates a completed factory run plus mining job with `generation_mode=ONLINE_RAW_F2_REFINEMENT`, writes a Refined_F2 ledger and manifest under `artifacts/factor-factory/online-raw-f2/<run_id>/`, and then reuses the same D2 quarantine intake/execution pipeline. Quarantine rows may still dedupe by normalized expression, but merged rows must preserve every source Raw_F2 `source_factor_id` in metrics and lineage. This route must never write directly to `factor_definitions`; publication still requires quarantine `PASS`, `ELIGIBLE`, WNZT completeness, and snapshot evidence.
- Factor Factory has a single batch-lineage contract. Current-batch read models must resolve `current_batch_id`, `source_job_id`, `artifact_id`, `is_preview`, `total_candidates`, and `page_count` before projecting task cards, quarantine rows, publishable factors, or detail evidence. `top_candidates`, first-page rows, and default `page_size=50` responses are preview/page projections only and must never be used as total count or source-of-truth. Full Raw_F2/Refined_F2 ledgers must carry a manifest with `job_id`, `source_job_id`, `formula_count`, `refined_count`, `hash`, and `created_at`; APIs and detail modals must expose enough manifest evidence to prove the visible expression/evidence belongs to the current batch.
- Factor mining supports F1/L1 raw PIT factor discovery plus `HYBRID_COMPOSITION` as additive generation modes for the same factory. F1 raw candidates may be published into the raw library after PIT admission audit only; RankIC/ICIR/OOS/turnover/drawdown thresholds are advisory evidence for F1 and must not block publishing. L2 refinement candidates must persist the standard `Raw -> Winsorize -> Neutralize -> Z-Score -> Rank` chain and use `TRANSFORMED_FROM` lineage. L3 composition candidates must be built from admitted L2 parents or explicit exemptions, persist the seven configured composition methods (`风格复合`, `比例/风险调整（含估值锚定）`, `排名均值/交集`, `Fama-French 风格融合`, `背离惩罚`, `残差/中性化`, `时序降噪`), investment logic, parent factors, and correlation/orthogonality audit, then publish with `COMPOSED_FROM` lineage. No B1 candidate writes directly to `factor_definitions`.
- Factor publishing uses the F1/F2/F3 naming contract: F1 raw facts publish as `f1_<source>_<raw_field>` with no Rank/ZScore operator token; F2 transformed alpha features publish as `s_f2_<category>_<operator>_<window>_<f1_alias>`; F3 strategy-ready factors publish as `s_alpha_<strategy_group>_<ordered_processing_chain>`. Quarantine auto-publish and governance optimized-factor publish must both record the naming rule version in publish metadata.
- Factor display naming is a projection layer on top of canonical factor identity. `factor_display_name_v4` and `factor_display_name_v4_structured` generate `display_name_cn`, `short_name_cn`, `governance_badges`, `base_display_name_cn`, `name_collision_key`, `name_dedupe_suffix`, and `name_collision_group`, but they do not rewrite canonical ids, expressions, versions, lineage, diagnostics, or historical publish events. Online-visible F2/F3 uniqueness is resolved by the shared naming resolver with the `parameter_first_then_sha8` strategy: first differentiate by window/parameter, governance chain, benchmark, parent/composition evidence, and only then append a stable `[SHA-8]`. Missing benchmark metadata is recorded as an audit gap rather than defaulted to `SP500`. `/factors`, factor detail, display-name backfill, quarantine publish, and governance optimized-factor publish must all use the same resolver so display names and collision suffixes cannot drift by path.
- PIT readiness in factor factory quarantine is diagnostic evidence for L2/L3, while F1 raw mining uses PIT admission as its publishing gate. Non-Full-Ready PIT must be written to diagnostic warnings, factor grade, publish audit, and risk flags; it must not alone set `REJECTED` or `MANUAL_REVIEW_REQUIRED` for L2/L3. L2/L3 hard blockers remain leakage/future-reference suspicion, `Rank IC > 0.8`, OOS/IS ratio below `0.6`, logical duplication, failed residual signal, capacity failure, and max drawdown relative to SPY above `1.2x`; F1 keeps leakage/duplication safeguards but skips predictive-threshold blockers.
- Style orthogonality and logical orthogonality are separate gates. Logical duplication rejects. Style correlation above `0.3` triggers Auto-Residual, stores original/residual expression and control-factor lineage, then reruns IS/OOS and drawdown gates on the residual signal. Mining ranks candidates by `fitness_score`; raw `rank_ic` remains visible for research review.
- Quarantine persistence is split across `factor_quarantine_candidates`, `factor_quarantine_runs`, `factor_publish_events`, `factor_lineage_edges`, and `factor_crowding_snapshots`. Large IC series, factor-value matrices, and correlation artifacts are referenced by artifact paths instead of embedded as large SQLite JSON blobs.
- Auto-publish writes the new factor, an active factor version, the latest verified diagnostic summary, a publish event, lineage edges, and a crowding snapshot. It never overwrites `SYSTEM_SEED` or `MANUAL` factors.
- `GET /factors` exposes only the lightweight `governance_queue_count` for first paint. Full governance actions are lazy-loaded from the governance overview when the factor-library metric card opens the queue modal.
- Factor detail keeps the existing layout and replaces the former compliance rail with an audit trail projection. The trail prefers persisted `audit_trail` entries and falls back to compliance metadata for older diagnostic summaries.
- Governance queue strategy suggestions route to `#/factor-models/new` with factor ids, weights, directions, and draft source metadata. A strategy draft suggestion is created only for a generated F3/L3 factor graded `S` or `A` that is not already referenced by an active `MULTI_FACTOR` strategy; the target route preselects that factor at `100%` weight and uses `XXX因子策略` as the draft strategy name. The builder only preloads a draft or review suggestion; it does not modify production strategy versions.
- 多因子第二期第一步正式可操作页面覆盖 `PIT 清洗中心`、`因子库`、`因子详情/诊断`、`因子编辑器`、`#/factors/sandbox` 与 `#/factor-models/new`。策略详情、回测提交、回测详情、优化配置与优化结果仍沿用既有页面模板，不在第一步增加 type-aware 模块。页面标题区保持紧凑，右侧说明模块移除，只保留返回、诊断、导出、新建等必要操作按钮，前台文案必须全部中文，因子入口不得使用广场类命名。

优化生命周期真相固定为：

- 任务状态流转为 `QUEUED -> RUNNING -> COMPLETED|PARTIALLY_FAILED|FAILED`，任何服务重启都会把进行中的 `QUEUED/RUNNING` 任务转成 `INTERRUPTED`。
- `INTERRUPTED` 任务保留 `completed_combinations`、`persisted_trial_count`、`next_trial_index` 与 `best_metrics_summary`；详情页会展示轻量进度面板以及“继续优化”操作。
- 当前端在任务运行中或中断时，不渲染半成品候选区。完整候选架、稳定性中心、heatmap 与多窗口验证区只会在终态物化后出现。
- 终态优化渲染按数据是否存在来控制，而不是按标题是否存在来控制：候选表和候选架要求真实 `candidates[]`，稳定性中心要求候选指标或检查结果，heatmap 要求 `heatmap.cells[]`，多窗口验证要求 `validation_windows[]`。空壳结果区必须主动隐藏。

编排规则很简单：worker 可以构建页面局部视图，但不能重定义路由解析、应用外壳、共享 token 或运行时客户端边界。

## 9. 前端视图模型边界

截图驱动的恢复依赖的是前端视图模型，而不是去改写后端契约。

- `web/src/types.ts` 现在把快照建模成两个显式数组：`dataset_snapshots[]` 与 `universe_snapshots[]`。
- `web/src/pages/snapshots-page.tsx` 只消费正式 overview 契约；股票/指数 tab 必须保留 Compose First 批准稿的头部、健康仪表盘、查看明细弹层、刷新按钮、工作站与底部可信层结构，同时将前四张健康卡升级为 `L1 基础行情 / L2 财务截面 / L3 分析师与情绪 / L4 宏观与衍生品`，并从 `data_layer_readiness[]`、`snapshot_quality_alerts[]`、`factor_dimension_readiness[]`、`dataset_snapshots[]` 与 `universe_snapshots[]` 映射真实 runtime 行。
- `#/snapshots?tab=bond` 的质量审计、一键修复规则、原始快照与调度在无异常时默认折叠，只保留标题、状态和展开按钮；系统诊断置于详情区顶部，并且只显示当前债券分段自身的字段缺口、曲线阈值、来源登记、刷新风险或内存余量不足这类可处理问题，正常内存指标、股票/指数门禁和通用说明不得渲染成债券“待关注”。
- `web/src/pages/asset-allocation-config-page.tsx` 是策略级资产配置创建页，不属于组合层 Allocation Lab。页面单屏完成配置，不使用创建会话步骤条；保存后仍物化为普通策略记录，并沿用 `strategy-detail`、`backtest submit` 与 `optimization` 页面。
- `web/src/pages/strategy-detail-page.tsx` 与回测预览/详情页面不能再把 `dynamic_investment_logic` 当成“天然不支持”的文案警告；真实 warning 只允许来自估值时间序列缺口或过期 observation 的逐笔回退。
- `#/runs/:id` 的配置 tab 负责把参数快照、数据快照摘要和运行态字段本地化；`allocation_assets` 等结构化字段要渲染为中文摘要，不能把 raw key 或 JSON 作为主要说明暴露给操作者。权重归一属于内部执行口径，不作为警告条暴露；缺失行情、可用标的和覆盖范围由数据快照摘要表达。
- `#/snapshots` 的股票/指数 tab 不能使用批准稿静态行作为生产兜底；如果 runtime 表为空，页面显示 0 或待补，不显示 `99.8%`、`Universe-US-Equity-*` 这类设计稿数字。
- `#/snapshots?tab=bond` 同样保留批准稿的中文信息架构，但所有来源、可创建资产腿、审计和 raw registry 内容都必须来自 `bond_fixed_income` runtime 分段；后端英文运行标签进入 UI 前需要本地化，不能用 mock 债券、deterministic 曲线或 phase1 proxy 填充。
- 当刷新任务处于 `RUNNING` 时，只要部分 `refresh_stats` 已经被持久化，快照页就可以提前显示增量“新增...”摘要；如果还没有部分统计，则回退为简单的“最近刷新 ...”时间戳。
- 快照页会把后端源代码值 `longbridge`、`akshare_us`、`nasdaq_wiki`、`finnhub`、`fmp_historical_constituent`、`tiingo`、`alpha_vantage`、`sec_edgar`、`official_announcement`、`wikipedia_revision_history`、`wikipedia_current_page`、`static_seed` 与 `local_cold_backup` 映射成面向用户的来源链标签，而不是直接暴露原始 provider id。
- 快照页保持人类可读的状态语义：不完整快照显示“部分可用”，只有运行中的任务显示“后台更新中”，旧契约响应则展示“需要重启后端”的提示，而不是静默失败。
- `web/src/shell-route-meta-cn.ts` 对 `#/snapshots` 关闭 shell 标题，让页面自己拥有单独的卡内标题。
- 这些字段依然是后端真实契约字段；前端必须把它们视为可选字段，不能把它们收窄成只为截图服务的特殊形状。
- `web/src/lib/workspace-adapters.ts` 是工作台卡片、对比状态与最近运行投影的唯一 adapter 真相。
- `web/src/lib/adapters.ts` 仅保留为非工作台消费者提供兼容导出表面。
- `web/src/pages/workspace-page-lane-b.tsx` 与 `web/src/page-sections/workspace-recent-runs-lane-b.tsx` 现在把右侧栏视为混合活动时间线，而不是只显示回测列表：回测与优化任务会按 `completed_at ?? updated_at ?? created_at` 合并排序，并截断到最新 8 项；优化卡片只消费 `/optimization-jobs` 的列表投影，保证工作台不会为了每个任务详情发起扇出请求。

这样既能让 UI 保持表达力，又不会在 API 之外凭空造出第二份真相。

## 10. 设计原则

几个务实原则共同约束当前系统：

- 比起隐式 UI 猜测，更偏好显式状态与修订标记。
- 永久运行必须和可丢弃的临时运行分离。
- 存储时要保留能解释结果的数据，而不只是最终分数。
- 为了保证恢复路径可逆，应优先保留间接映射，而不是一次性硬改名所有文件。
- 在让用户排查运行时之前，先让启动器尽量自修复运行时。

这就是当前基线的形状：可恢复、可审计，而且足够务实，能持续在本地工作。
## 2026-04-16 Snapshot Routing Update

- The snapshot data plane now has an explicit offline `Stooq` price provider for long-history cold starts. It is a price-only source and should never be treated as a formal company-action provider.
- `Stooq` is registered only when an offline ZIP archive is available, and `incremental` refreshes exclude it so the current-window path keeps using live-capable providers.
- `EODHD` is registered as a paid optional provider when `EODHD_API_TOKEN` or `EODHD_API_KEY` is present. It tries active and delisted provider symbols (`SYMBOL.US`, `SYMBOL_old.US`) and can contribute EOD OHLCV plus dividend/split evidence, but entitlement, quota, or no-history failures remain visible provider evidence.
- Yahoo historical HTML probing is a last-resort observation lane behind `GRIT_ENABLE_YAHOO_HTML_HISTORY`; it cannot fabricate price rows when the page is blocked or only shows a shell.
- Corporate-action readiness is determined by formal `dividend/split/reverse_split` probe coverage. A symbol can be complete with zero formal events if an action-capable provider successfully probed the window and returned no events.
- That zero-event state is persisted in `dataset_symbol_coverage.metadata_json` with `coverage_kind=corporate_probe` and `probe_status=complete_no_events`, allowing `ds-corporate-actions` to reach `READY` without fabricating placeholder events.
- Snapshot `metadata_json` now stores `provider_summary` so the persisted dataset state reflects which providers were attempted, selected, skipped, or unavailable for both price and corporate refresh phases.

## 2026-04-21 Free Snapshot Completion Extension

- Market-data repair now schedules providers by access tier: anonymous/public providers first, then free-account providers, and finally paid-optional providers only when explicitly enabled.
- `Yahoo`/`yfinance` are the default price plus company-action probe path. Once a public action-capable provider returns bars and completes the probe, later price providers are marked `skipped` instead of spending extra quota.
- `Alpha Vantage` now has a formal company-action lane built on `DIVIDENDS` and `SPLITS`. It emits `history_availability` results with `actions_supported`, `probe_complete`, `quota_limited`, and `next_retry_at`, so "no verified events" can still count as corporate coverage.
- `Tiingo` remains available for repair, but it is now treated as a quota-aware free-account source. `429` responses surface structured cooldown metadata, and non-repair scopes exclude it from the hot path.
- `provider_summary` and `metadata.provider_results` now expose stable fields for snapshot UI and persistence: `actions_supported`, `access_tier`, `quota_limited`, `probe_complete`, and `next_retry_at`.
- Nasdaq-100 historical repair now has two additional free historical layers ahead of current-page fallback: repo-local official provenance seeds and Internet Archive captures of the official Nasdaq activity page.
- Universe refresh stats now publish `official_seed_status`, `official_seed_source_count`, and `official_seed_missing_anchors`, allowing `#/snapshots` to show exactly which anchors still block 100% historical readiness.

## 2026-04-23 Optimization Results Promotion Rules

- When `matching_combination_source` is `all_trials`, the Optimization Results page must use the full `detail.matching_combinations` collection as the source for counts, filtering, sorting, and the “查看全部组合” modal. The compact “参数候选盘” and “快速切换候选版本” surfaces intentionally show only the top 3 ranked matching combinations plus the “当前组合” baseline, so a completed job can preserve the full eligible set without flooding the primary decision surface.
- Large all-trial matching sets have three separate contracts: persisted `optimization_jobs.request_json/summary_json` may compact `matching_combinations`, `PATCH /optimization-jobs/{id}` and unbounded detail hydration must return the full matching collection for explicit user actions, and frontend pagination/sort must be tested against that full collection rather than the top candidate preview.
- The persisted detail payload is the stable source for all-trials matching rows. A filtered candidate subset may be useful for saved-candidate fallback paths, but it must not hide eligible completed combinations from the all-combinations dialog.
- The “当前组合” baseline should be fetched from `request.source_run_id` first; if that run is missing, the UI falls back to `strategy.latest_completed_run_summary.run_id` and then `strategy.latest_run_id` so historical optimization tasks still render a comparison baseline.
- Constraint refiltering must wait for `updateOptimizationJobConstraints` to resolve before re-ranking or replacing candidate rows. That API is preview-only; after it resolves the page may expose “保存新结果”, and only `saveOptimizationFilteredResult` may persist the filtered result as a new optimization job. If previewing fails, the UI may apply the filter locally for continuity but must not expose a save-new-result action.
- Candidate display should prefer version-style candidate labels over raw `Trial` ids when rendering full matching combinations. Trial-like labels such as `Trial 2402` should fall back to `候选 N` by rank.
- Mixed English summary tokens such as `daily`, `weekly`, `monthly`, `sharpe`, `oos`, and `max drawdown` should be localized before they reach shelf or row copy.
- Regression coverage for these rules lives in `web/src/optimization.module.test.tsx`, including tests for full matching combinations, stable refilter behavior, Chinese candidate labels, and localized shelf copy.

## Phase 1.1 composition persistence and freeze model

Compose First Phase 1.1 treats the persisted composition tables as the source of truth for saved portfolios:

- `asset_leg_definitions` and `cash_leg_definitions` are durable truth tables for asset/cash legs. They carry `status`, `revision`, `current_freeze_generation`, `created_at`, `updated_at`, `deleted_at`, and `deleted_reason`. Active natural-key uniqueness is enforced with partial indexes, and referenced legs expose `reference_protected` instead of allowing in-place edits.
- Strategy legs remain projection-only, but `GET /leg-inventory` no longer auto-lists every strategy parameter version. Inventory defaults to durable asset/cash rows; the create-strategy-leg drawer builds transient candidates from the latest completed backtest run per strategy plus strategy metadata, using `strategy_leg::{strategy_id}::{parameter_version_id}` refs and the selected run metrics for the validation chart/KPIs until explicit strategy-leg persistence is added. Saving a strategy-leg candidate records that stable `strategy_leg` ref in the browser inventory preference, rehydrates the row from the latest candidate data after a document refresh, shows a success toast, and must not redirect to the composition workbench.
- `compositions` carries the saved composition header, `status`, `revision`, and `current_freeze_generation`. `PATCH /compositions/{id}` with only `status` is a status write; structural patches replace the current revision and freeze generation.
- The `#/compositions` dashboard may derive lightweight observation cards from the `GET /compositions` list, but it must not ship static market curves, fixed period chips, or hard-coded ETF/benchmark commentary as production analytics.
- `composition_legs` is append/supersede by generation. Old rows are soft-deleted when a structural update writes a new generation.
- `composition_source_freezes` stores the frozen evidence used by detail pages. Current detail reads only current, non-deleted freezes, so later leg or bond snapshot changes cannot drift saved composition evidence.
- UI entry points that trigger Phase 1.1 logical deletion, including composition `ARCHIVED` status writes, asset/cash leg `ARCHIVED` status writes, and locally saved strategy-leg removal, must show a second confirmation surface before dispatching the write or preference removal.

Save semantics:

- `POST /compositions/preview` is zero-write and only calculates the normalized draft.
- `POST /compositions` and structural `PATCH /compositions/{id}` validate total weight, duplicate legs, stale or invalid sources, missing snapshots, and non-eligible bond sources before writing.
- Bond asset legs can be created only from runtime eligible `bond_fixed_income` snapshots; fallback/proxy curve data is not published as a promotable or display source.
- The `#/legs` asset-leg drawer must source its bond choices from `GET /data-snapshots/overview.bond_fixed_income.eligible_instruments`, not from static presets; the picker should leave search empty on open so all READY runtime bond instruments, including UST 3M T-Bill, remain visible and selectable.
- Equity asset-leg creation must stay disabled/empty until an explicit runtime equity source contract exists; approved UI preset names such as `Equity-*` are design examples, not promotable source IDs.
- `GET /data-snapshots/overview` publishes `bond_fixed_income.eligible_sources`, `eligible_instruments`, and `raw_registry` from the market-data repository. The repository stores clean/net price, dirty/full price, accrued interest, YTM, duration, convexity, source, refresh status, missing-field status, inferred-field status, and raw payload evidence; `curve_preview` remains empty until a real runtime curve source exists.
- The bond snapshot overview now publishes the current seven-row fixed-income contract used by runtime refresh and tests: UST 3M T-Bill plus 2Y/10Y/30Y CMT points, TIPS 5Y/10Y, and LQD. It exposes group counts, UST 10Y-2Y spread, TIPS real-yield/inflation-factor/breakeven metrics, and LQD duration/SEC-yield/credit-quality/tracking status; older historical rows and manual smoke rows stay stored but do not dilute current coverage. The bond tab's top readiness and asset-leg gate use this current seven-row contract, while shared snapshot blockers remain diagnostic reminders when the bond runtime contract is already `READY`. LQD becomes `READY` only when a published tracking-error source is present and preserved in raw evidence, while T-Bill accrued interest may be field-status `WAIVED`.

## Phase 1.2 composition trust and compute quality

Phase 1.2 extends the Phase 1.1 persistence model without adding a second composition, leg, or snapshot system:

- `POST /compositions/preview` and `GET /compositions/{id}` now publish Phase 1.2 trust fields beside the Phase 1.0/1.1 fields: `return_quality_summary`, `rebalance_events`, `source_integrity`, and expanded `risk_contribution_preview`. Older UI consumers must continue to work from `returns_preview`, `correlation_matrix`, and the original risk fields.
- Return, correlation, and risk previews prefer aligned leg return streams from strategy backtest `chart_series`, bond/asset price history, and cash-rule streams. Bond fixed-income snapshot rows whose prices are inferred par proxies or whose snapshot rows are too sparse to satisfy return-history rules are risk/source metadata, not tradable price history; when no separate price history exists, Treasury CMT/TIPS, T-Bill, bond-ETF, and other bond snapshot asset legs are covered by managed fixed-income return-profile streams and must not extend the alignment window or create leg-level sample gap cards. Saved composition detail and preview responses default to the latest 120 monthly labels for metrics and `returns_preview`/`benchmark_series`/`spread_series`; the detail KPI contract derives `beta_exposure` from realized composition-versus-benchmark return covariance whenever both streams have variance. If a non-managed asset leg has no aligned return stream, the compute path must still include that leg with profile-based fallback returns, mark the gap in `return_quality_summary.fallback_used`, and let weight/rebalance edits change KPIs instead of silently reducing the portfolio to the remaining real stream.
- Rebalance frequency is treated as simulated events, not a label. The payload exposes event date/index, turnover, cost drag, cash-buffer impact, and before/after weights while keeping preview zero-write.
- Saved composition details still read frozen evidence from `composition_source_freezes`. `source_integrity` and extended `source_evidence` compare frozen hashes/refs against current refs and surface drift or invalidation as advisory evidence only; they do not mutate saved legs or frozen snapshots.
- `POST /compositions/{id}/source-freezes/refresh` is the explicit operator acceptance path for source-fingerprint drift. It rebuilds the frozen source evidence from current leg inventory projections while preserving composition weights, records a `source_refreeze` audit event, and recalculates diagnoses so accepted current sources stop appearing as unresolved logic drift.
- Composition trust is exposed to operators through `primary_diagnosis` and `diagnoses`, whose user-facing label is always `状态标签` in the form `稳健/待校准/失效：问题类型`. Raw facts such as `return_quality_summary.fallback_used`, `missing_points`, and `source_integrity` remain audit/debug inputs, not primary UI headings. `审计门禁硬阻断` is no longer a standalone diagnosis; failed diagnoses carry the system disposition `存在未关闭的失效问题，晋升门禁已暂停。`.
- Global composition work surfaces, including `GET /compositions/backtest-runs`, `GET /compositions/allocation-jobs`, backtest result pages, allocation result pages, and the composition dashboard, must display the same current `状态标签` as `GET /compositions`. Persisted run/job snapshots may keep historical metrics, but their visible status label and repair actions are overlaid from the current composition diagnosis so stale `evidence_grade` values cannot create a different operator queue. Allocation job results remain test references and must not publish promotion readiness as an operator queue.
- Planned proxy coverage is resolved before creating pending work. System infrastructure proxies are read from dataset snapshot/proxy registry metadata, including `QQQ -> NASDAQ100` and `BOXX -> BIL`, and become `稳健：系统代理覆盖`. User confirmations are persisted in `composition_proxy_confirmations` by composition, leg, horizon, coverage window, and proxy signature; the same confirmed proxy signature becomes `稳健：人工确认代理覆盖` and must not re-enter the pending queue. Unregistered and unconfirmed proxies remain `待校准：代理覆盖待确认`; empty return streams, discontinuities, and abnormal fallback estimates cannot be closed by confirmation.
- `composition_audit_events` is the append-only backend audit table for composition creation, structural writes, source freeze, rebalance checks, status changes, and snapshot-refresh impact checks. `audit_trail` in detail responses is read from this persisted stream, with a legacy projection fallback only for older rows that predate the table.
- Bond risk contribution fields reserve `duration_contribution_years` and `convexity_contribution` so fixed-income legs can feed risk-budget prechecks without changing the Phase 1.1 leg storage model.
- `GET /data-snapshots/overview` remains the only snapshot overview endpoint. Its `bond_fixed_income` segment adds `quality_audit`, `repair_rules`, `daily_accrual_status`, and `risk_budget_inputs`; refresh/repair actions still use `POST /admin/snapshot-refresh-jobs` with target `bond` and mode `repair` or `full`.

## Snapshot / PIT phase2 data plane (2026-05-13)

- Snapshot / PIT 继续共用 `GET /data-snapshots/overview` 与 `GET /pit-data` 两条 additive 读模型，不新增第二套快照 API，也不改变 `#/snapshots?tab=equity`、`#/snapshots?tab=bond`、`#/pit-data` 的批准信息架构。
- L2 基础面层现在由 `ds-fundamentals`、`dataset_fundamental_points` 与 `dataset_fundamental_coverage` 承担正式时态职责。`publish_date` 与 `available_at` 是独立字段：前者表示供应商可公开披露时间，后者表示本系统可安全消费时间；两者缺一不可，`period_end_date` 只保留为 statement period 证据，不能再参与 PIT readiness 冒充。SEC EDGAR 基础面解析支持 US-GAAP 与 IFRS companyfacts；历史 ticker 通过 curated CIK alias、SEC browse 和公司名检索修复；FDIC BankFind 只作为 SEC/FMP 无结构化银行点位时的官方 Call Report 兜底。对 SEC/FMP/FDIC 仍无法形成 rawF2 点位的缺口，`fundamental_gap_policy` 负责分类降级：ETF/基金进入 `financial_logic=N/A`，无 XBRL 或旧退市样本进入 `Thin_Data_Stock`，两类都不生成合成财务点，只能使用价格、成交量、动量、波动与流动性因子。
- L3 / L4 phase2 数据面通过 `dataset_signal_points` 与 `dataset_signal_coverage` 持久化 `ds-analyst-consensus`、`ds-short-volume`、`ds-macro-rates`、`ds-option-skew`。这些 snapshot row 会与 provider-attempt evidence 一起投影到快照页与 PIT 页，但 raw signal ledger 继续留在 metadata / raw payload，不直接进入首屏 contract。
- snapshot read model 允许“正式 dataset row”和“readiness-only provider evidence”并存，但必须显式区分：`dataset_snapshots[]` 只包含真实持久化 row；`data_layer_readiness[]`、`factor_dimension_readiness[]` 与 snapshot/PIT linkage 如果引用的是未落库证据，必须明确标记为 readiness-only，而不是让页面看起来像已有正式 snapshot row。
- Snapshot 与 PIT 的状态机继续解耦。快照页回答“源侧有没有刷新到、证据健不健康”，PIT 页回答“这些数据能不能重放、能不能做诊断”。因此同一层可以出现 `L3 WARNING` vs `L3 DISABLED/OBSERVATION`、`L4 BLOCKED` vs `L4 CALIBRATING` 的差异，但差异原因要由后端读模型负责，不交给前端猜测。
- `POST /admin/snapshot-refresh-jobs` 仍是唯一刷新入口，phase2 target 扩展为 `fundamentals`、`sentiment`、`macro_derivatives`。refresh payload 支持 `symbols`、`phase2_scope`、`phase2_max_symbols` 与 `phase2_cursor`；`sp500_10y`、`l1_all` 与 `custom` 三种 scope 分别绑定十年 S&P 500 成分、现有 L1 价格覆盖与显式标的列表，并通过 cursor 分批推进 100% 覆盖。phase2 refresh 只负责 snapshot/provider/readiness 数据面，不允许把任何候选因子、检疫结果或发布结果直接写入正式因子库。
- phase2 refresh 执行路径现在以 point + coverage 合并落库为准：L2 先写入 SEC EDGAR companyfacts PIT points，只有 SEC 未覆盖的 symbol 才调用 FMP statement rows 作为补丁，若退市银行在 SEC/FMP 均无结构化点位则调用 FDIC BankFind financials 并用 `REPDTE + 45d` 作为保守可得日；L3 先写入 Alpha Vantage `EARNINGS_ESTIMATES`，在 estimates 为空或限流时回退 earnings events 与 `price_momentum_proxy`，FINRA short-volume 缺少历史文件或标的记录时写入 `price_volume_proxy` archive-gap 标记；L4 FRED macro rates 固定覆盖 10 条官方利率序列，Massive/Polygon option skew 不可用时降级 CBOE delayed quotes，个股期权链缺失时只允许 SPY benchmark proxy。落库前统一过滤 `publish_date` 与 `available_at`，过滤掉的 provider row 只能作为 provider summary / readiness-only evidence 暴露；只有存在 landed rows 与 coverage 的 dataset 才会进入 `dataset_snapshots[]`。
- L4 IV / macro evidence 的默认生产基线是 Massive/Polygon 精修链路，CBOE 是权限失败时的 delayed-quote 降级源。`MASSIVE_API_KEY` 驱动 precision / option-skew 相关证据；ThetaData 在 architecture 上被视作后续可插拔 provider，而不是 phase2 必选主路径。
- factor governance 仍坚持 staged publishing：phase2 新增的数据面只提升 `Factor Factory -> D2 Quarantine -> Publish` 的证据质量，不改变“10Y admission 可推进、30Y Full Ready 继续补证”的准入分层，也不允许 mining sandbox 候选绕过 D2 直接写 `factor_definitions`。

## PIT external-source repair architecture

- `/pit-data` owns the operator-facing repair state. Its `external_source_readiness` field is additive and summarizes external evidence readiness without changing existing PIT blockers or snapshot routes.
- `.tmp/pit-bulk-cache` is the default local cache root for Kaggle ZIP/CSV payloads, Matrix manifests, DuckDB lookup catalogs, and partitioned Parquet output. If older imports are nested one level deeper under `grit-pit-bulk-cache`, the PIT readiness resolver treats that child directory as the active cache when the outer root has no manifests, catalog, or normalized artifacts. These large or third-party files are local runtime artifacts inside the project temp area and must be referenced by manifest hash, schema fingerprint, row count, license, source URL, and import time.
- Historical component Matrix sources such as `github_sp500_historical_components` are membership skeletons only. They can decide whether a symbol belonged to the S&P 500 at an effective date, but they cannot provide price, split, dividend, or delisting evidence by themselves.
- Kaggle bulk sources such as `kaggle_huge_stock_market_dataset` and delisted archives are price-only PIT inputs. They may fill adjusted OHLCV gaps for repair-queue symbols after conflict checks against `ds-price`, but they do not clear corporate-action blockers unless separate split/dividend evidence or a zero-event certificate exists.
- Polygon/Massive is an optional precision layer. When `MASSIVE_API_KEY` is present, targeted repair can use aggregates for OHLCV, ticker/reference for inactive identity, and splits/dividends for corporate-action evidence. The provider defaults to `https://api.massive.com` and can be overridden with `MASSIVE_API_BASE_URL` or `POLYGON_API_BASE_URL`; without a key, it remains registered but reports missing credentials.
- Provider registry entries for external PIT sources expose governance metadata (`source_url`, license, hash, row count, schema fingerprint, last import time, PIT permission) and credential status only. Secret values must never cross API, storage, logs, manifests, screenshots, or docs.
- Diff repair imports only symbols in the current `/pit-data.full_ready_repair_plan` queue, never an entire 20GB-class dataset. Existing price rows win when adjusted-price deltas exceed the configured conflict threshold; those candidates stay blocked as `price_conflict` until reviewed.

## Backtest recovery and multi-factor execution note (2026-05-13)

- 回测执行现在和优化任务一样具备正式的恢复状态机：服务启动可按 `GRIT_STARTUP_BACKTEST_RECOVERY=resume|interrupt|skip` 处理遗留 `QUEUED/RUNNING` 记录，默认采用 `interrupt`。`interrupt` 会把它们显式转成 `INTERRUPTED`；`resume` 只会继续真正可恢复的 checkpoint。若服务重启时还没有可恢复 checkpoint，系统会把 run 转成 `INTERRUPTED` 并要求人工通过 `POST /backtest-runs/{id}/resume` + `idempotency_key` 明确确认是否从头重跑，而不会再静默重新认领。
- 回测列表和详情读取前会调解无活跃 runner claim 且 `updated_at` 已超过 runner lease 的 `QUEUED/RUNNING` 记录：这类 orphan run 会被转成 `INTERRUPTED` 并保留 checkpoint/进度投影，防止 API 进程仍健康但后台 runner 已丢失时，`#/runs` 长时间停留在“计算中”。
- `app_runtime_state` 中的 `backtest_runner_claim:*` 是跨进程 runner claim 真相；claim 按 owner + lease 维护，用来防止多个服务实例同时认领同一个回测 run。当前进程仍持有活跃 runner 线程时，进度刷新允许重建缺失的本地 claim；没有本地活跃线程或 owner 不匹配时仍必须拒绝继续执行。`POST /backtest-runs/{id}/resume` 只允许恢复 `INTERRUPTED` run，并要求 `idempotency_key` 来保证人工恢复操作幂等。
- 对于多因子等长准备态任务，claim 刷新不能只依赖首个日度 checkpoint。准备阶段现在也会周期性写出 `PREPARING` checkpoint 与 run 预览进度，包括快照解析、价格历史加载、基础面读取、因子预计算和启动逐日模拟等子阶段；这样即使首个 `daily_performance` checkpoint 还没产生，也不会因为 5 分钟 lease 到期而被别的实例误判为可重新认领。
- Multi-factor execution no longer re-queries `universe_membership_snapshots` on every rebalance date. The runner preloads industry membership history once per run and reuses in-memory mappings for each rebalance date.
- Universe symbol resolution for backtests now uses a targeted `load_universe_membership_symbols_as_of(...)` repository query instead of loading the full membership history and filtering in Python. This is the hot-path read model for long-history reruns and should stay index-friendly.
