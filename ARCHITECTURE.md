# 架构

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

存储层会把工作台契约、策略记录、回测运行、优化任务以及运行时审计状态持久化到 SQLite。

关键组成如下：

- `strategy_parameter_versions` 是参数版本的权威表。
- `strategies` 持有 `dataset_snapshot_id` 与 `universe_snapshot_id`，因此正式回测始终绑定显式快照记录，而不是绑定环境中的临时行情状态。
- `backtest_runs` 通过 `is_permanent` 记录某次运行是永久的还是临时的。
- `backtest_runs` 还保存 `artifact_paths_json` 与 `trade_audit_json`，以便工件和审计数据能够被一致地回放或清理。
- `backtest_runs.trade_audit_items_json` 是供运行详情页使用的轻量证据列表投影。完整的 `trade_audit_json` 仍然是单笔交易审计下钻时的事实来源，但详情接口在热路径上不允许解码整个审计大对象。
- `optimization_jobs` 保存优化任务级别的请求、摘要与结果投影。
- `optimization_jobs.summary_json` 现在是运行中详情的主投影。心跳写入会持久化 `completed_combinations`、`next_trial_index`、`best_metrics_summary`、ETA 与 `heartbeat_at`，因此 `GET /optimization-jobs/{id}/detail` 在返回 `QUEUED`、`RUNNING`、`INTERRUPTED` 状态时，无需扫描 `optimization_job_trials`，只有旧记录缺少这些字段时才会回退补水。
- `optimization_jobs.candidates_json` 与 `result_json` 现在是终态详情的主投影。新的 `COMPLETED`、`PARTIALLY_FAILED`、`FAILED` 记录可以直接从任务行渲染结果中心，只有旧记录才回退为根据 trial checkpoint 重建。
- `optimization_job_trials` 是优化搜索进度的 checkpoint 真相表。每个已完成或失败的 trial 都按 `job_id + trial_index` 持久化，并保存 `parameter_snapshot_json`、`metrics_json`、`chart_series_json`、`score` 与时间戳，以便中断后的任务继续执行而不需要重放已经完成的组合。
- 同一张 trial 表还下沉了热路径排序字段 `return_sharpe`、`oos_sharpe`、`total_return_pct` 与 `stability`，让运行态与终态投影可以避免在热路径解码完整 metrics JSON。
- `optimization_job_trials.chart_series_json` 采用分层存储：运行中的任务对大多数 trial 只写轻量 `[]`，只有最终 top-K 候选才会回补完整曲线供结果中心展示。
- 优化执行时会保留一个父控制器运行时：一个后台线程独占任务生命周期与全部 SQLite 写入，可选子进程只负责计算 trial 摘要并通过 IPC 返回结果。对于当前的 synthetic evaluator 路径，这个多进程分发默认刻意关闭，因为顺序执行的本地基准更快。
- 这个父线程也是优化任务心跳的唯一写入者：摘要写入最多每秒一次或每完成五个组合时批量落库，而 trial checkpoint 与终态状态切换仍然立即刷盘。
- 在执行过程中，父线程会增量维护 top-K trial 与 heatmap 单元赢家的运行时摘要；终态物化阶段会直接复用这些摘要，只为最终 top 候选回补完整 metrics，从而避免对所有成功 trial 再次做全量重排与重建。
- 市场数据 companion SQLite 现在包含按快照作用域组织的表：`dataset_snapshots`、`universe_snapshots`、`dataset_price_bars`、`dataset_corporate_actions`、`dataset_symbol_coverage` 与 `universe_membership_snapshots`。
- 本地 live runtime 的主库与 companion 库是一组数据面。`GRIT_BACKTEST_DB=.grit_backtest_platform.sqlite3` 会派生 `.grit_backtest_platform_market_data.sqlite3`；如果 backend 误指向新建空主库，`/workspace/overview` 会显示 0 策略，快照页也会只看到空 market-data 状态。这种情况应先备份再恢复或重指向正确 runtime DB，而不是把页面空态当作真实删除。
- `symbol_identity_cache` 是内部身份修复表，用于处理已退市符号、ticker 生命周期修正，以及来自 Alpha Vantage、SEC EDGAR 与 FMP 的 CIK/交易所元数据拼接。
- `snapshot_refresh_jobs` 是 API 与 CLI 共用的刷新审计日志。它的 `summary_json` 现在携带刷新心跳字段，例如 `current_stage`、`current_stage_label`、`heartbeat_at`、`progress` 与部分 `refresh_stats`，让运行中的任务在完成前也具备可观测性。
- `snapshot_recovery.py` 是 `C:\Fin\Grit_Strategy_Lab2` 的冷备探测与导入边界；Lab2 只被视为恢复来源，绝不能成为实时运行时依赖。
- `universe_history.py` 现在负责点位时刻一致的 universe 来源链，并默认走免费链优先：`SP500` 先使用 wikipedia revision-history、官方指数公告与 GitHub 当前名单校验，`Nasdaq-100` 先使用 `jmccarrell/n100tickers` 的年度 YAML，再退回 wikipedia revision-history 与官方指数公告；`FMP historical constituent` 只在 entitlement probe 成功时作为高级增强源插到链首。
- `app_runtime_state` 保存清理账本，包括 `last_cleanup_count` 与 `last_cleanup_at`。它还会镜像当前激活的 snapshot refresh 心跳，让中断后的 worker 恢复逻辑可以区分“仍在运行”和“已经卡住”。

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

## 4. 参数版本真相

参数版本的真相存放在参数版本表里，而不是散落在临时 UI 状态中。

- `strategy_parameter_versions` 是版本化策略参数的事实来源。
- `strategy.parameter_history` 是给 UI 与 API 消费方使用的真相投影。
- 每条历史记录都可以带 `comment`，当候选版本带着修订说明被提升时会写入该字段。
- 创建会话既可以以 `CREATE` 模式开始，也可以以 `REVISION` 模式开始，并且会在会话契约中保留 `base_strategy_id` 与 `base_parameter_version_id`。
- 提升与物化路径会强制校验基线版本；如果基线已经移动，就返回 `409 stale_base_parameter_version`。

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
- `/leg-inventory` 负责输出一期统一腿部读模型。它把策略腿视为投影，把资产腿/现金腿视为最小持久化定义。
- `/asset-legs` 与 `/cash-legs` 负责写入最小定义能力，不承担策略版本化职责。
- `/strategy-creation-sessions/*` 负责创建与修订工作流。
- `/backtest-runs/*` 覆盖预览、提交、克隆、详情、交易列表与单笔交易审计。
- `GET /backtest-runs/{id}/detail` 明确针对页面加载做了优化。它可以包含 `trade_audit_items`，但不能物化完整的 `trade_audit` 记录；完整审计只属于 `GET /backtest-runs/{run_id}/trades/{trade_id}/audit`。
- `/compositions`、`/compositions/{id}`、`/compositions/preview` 与 `/compositions/{id}` 的 patch 面共同构成一期组合工作台和组合详情页契约。预演接口负责返回收益流预览、相关性矩阵、风险贡献、维护成本与再平衡摘要，而不直接改写持久化状态。
- `/optimization-jobs` 返回按 `updated_at DESC` 排序的优化任务列表，并投影任务状态、策略关联、预算进度、`progress_pct`、`current_stage`、`latest_update`、`estimated_remaining_minutes`、`estimated_completed_at` 以及带类型的 `best_metrics_summary`，供优化实验室索引页与工作台混合时间线使用。
- `POST /strategies/{strategy_id}/optimization-jobs` 现在接收 `base_parameter_version_id`、`source_run_id`、`entry_point`、`validation_mode`、`budget_combinations` 与 `search_space`；只有参数配置页显式发起优化时才会创建任务。
- `POST /optimization-jobs/{id}/resume` 接收 `idempotency_key`，并且只会从 `next_trial_index` 继续 `INTERRUPTED` 任务；对同一 key 的重复调用必须保持幂等。
- `/optimization-jobs/*` 覆盖任务详情、候选创建、候选删除、恢复执行以及带说明的提升。
- `GET /optimization-jobs/{id}` 返回已补水的 `request`、`summary` 与 `result` 三段。`summary.best_metrics_summary` 不再是松散的指标袋，而是持久化的 trial-summary 结构：`trial_index`、`label`、`status`、`parameter_snapshot`、`metrics`、`score`、`error_message`、`started_at`、`completed_at`。`QUEUED`、`RUNNING` 与 `INTERRUPTED` 响应刻意保持轻量：只暴露进度、ETA、当前最佳指标与恢复元数据，而不物化完整候选网格。终态才会根据持久化的 trial 记录物化完整结果中心，其中包含验证窗口的 `annualized_return`，但只会为排名 top-K 的候选加载完整曲线。
- 体量较大的优化任务仍然保留了一套 Windows 安全的 `spawn` 进程分发实现，并隐藏在服务边界之后。它不是 API 层用户可配置的能力，会根据运行时内存压力自动下调 worker 目标，也能在不改变持久化任务契约的前提下回退到单 worker 模式；不过当前 synthetic evaluator 默认关闭这条路径，直到出现真正需要它的重型 evaluator。
- 当前优化 evaluator 路径刻意脱离 `_prepare_backtest_run_context()`。活跃的 `_service_rebuilt.py` evaluator 是 synthetic 且以摘要驱动的，因此优化执行期间不会预加载准备好的 snapshot bars。
- `/data-snapshots/overview` 返回正式快照契约：`overall_status`、`last_refreshed_at`、`dataset_snapshots[]`、`universe_snapshots[]`、`latest_job`、`blocking_code`、`blocking_target`、`message` 与 `allowed_actions`。
- 债券治理页不单独新开快照 API。`/data-snapshots/overview` 追加 `bond_fixed_income` 分段，只发布 market-data repository 中真实的 runtime eligible sources / instruments / raw registry；没有 runtime 债券行时，曲线预览与 registry 必须为空，不允许 deterministic seed 或 phase1 proxy 兜底。
- `/admin/snapshot-refresh-jobs` 接收 `reason`、`mode` 与 `targets`，返回的是刷新后的 overview 契约，而不是裸任务载荷。
- `python -m grit_backtest_platform.main refresh-snapshots --reason ... --mode incremental|repair|full --targets price,corporate,universes` 是供 Windows Task Scheduler 使用的调度安全 CLI 入口；API 进程并不持有 18:00 的触发责任。
- 运行中的刷新任务现在会在仍处于 `RUNNING` 时持续写出心跳 checkpoint 与部分合并后的 dataset snapshot；overview 消费方应预期 `latest_job.summary.refresh_stats` 会先变化，再等到终态任务写入落地。
- 运行中的市场数据来源链按角色分工：价格走 `Yahoo -> Tiingo -> Longbridge -> AkShare -> FMP`，标准公司事件走 `Yahoo/Tiingo -> Alpha Vantage -> SEC EDGAR`，ticker 生命周期修复走 `Tiingo symbology -> Longbridge static info -> FMP delisted -> Alpha listing status`。
- `Longbridge` 只是当前或最近窗口的美股云端增强源；它绝不能被当成 1996 起全历史的规范来源，也不能参与历史 universe 锚点。
- Universe snapshot 只有在每个锚点都来自历史来源时才算 `READY`，即必须来自 `historical_dataset`、`wikipedia_revision` 或 `official_announcement` 这类历史语义来源；当前页面或静态种子回退都必须明确标成不完整，避免正式回测悄悄滑向幸存者偏差 universe。

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

正式的前端路由表固定为：

- `#/workspace`
- `#/compositions`
- `#/legs`
- `#/compositions/workbench`
- `#/compositions/:id`
- `#/creation/new`
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

一期 Compose First 的前端运行时规则补充如下：

- `#/compositions` 是组合仪表板，不复用旧 workspace 页面换皮。
- `#/legs` 是资产库，负责管理策略腿投影、资产腿定义与现金腿定义。
- `#/compositions/workbench` 必须先于 `#/compositions/:id` 被 route parser 匹配，避免工作台被详情路由误吞。
- `#/compositions/workbench` 与 `#/compositions/:id` 都通过现有 shell/runtime 边界接入，不允许另起第二套路由层。
- 左侧导航当前分为 `组合` 与 `策略` 两组；组合组包含 `组合仪表板` 与 `资产库`，策略组保留既有主链路，并把 `workspace` 对外标签统一为 `策略工作台`。

优化生命周期真相固定为：

- 任务状态流转为 `QUEUED -> RUNNING -> COMPLETED|PARTIALLY_FAILED|FAILED`，任何服务重启都会把进行中的 `QUEUED/RUNNING` 任务转成 `INTERRUPTED`。
- `INTERRUPTED` 任务保留 `completed_combinations`、`persisted_trial_count`、`next_trial_index` 与 `best_metrics_summary`；详情页会展示轻量进度面板以及“继续优化”操作。
- 当前端在任务运行中或中断时，不渲染半成品候选区。完整候选架、稳定性中心、heatmap 与多窗口验证区只会在终态物化后出现。
- 终态优化渲染按数据是否存在来控制，而不是按标题是否存在来控制：候选表和候选架要求真实 `candidates[]`，稳定性中心要求候选指标或检查结果，heatmap 要求 `heatmap.cells[]`，多窗口验证要求 `validation_windows[]`。空壳结果区必须主动隐藏。

编排规则很简单：worker 可以构建页面局部视图，但不能重定义路由解析、应用外壳、共享 token 或运行时客户端边界。

## 9. 前端视图模型边界

截图驱动的恢复依赖的是前端视图模型，而不是去改写后端契约。

- `web/src/types.ts` 现在把快照建模成两个显式数组：`dataset_snapshots[]` 与 `universe_snapshots[]`。
- `web/src/pages/snapshots-page.tsx` 只消费正式 overview 契约；股票/指数 tab 必须保留 Compose First 批准稿的全局视角、三位一体工作站、原始快照清单、数据诊断报告与就绪标准结构，同时只从 `dataset_snapshots[]` 与 `universe_snapshots[]` 映射真实 runtime 行。
- `#/snapshots` 的股票/指数 tab 不能使用批准稿静态行作为生产兜底；如果 runtime 表为空，页面显示 0 或待补，不显示 `99.8%`、`Universe-US-Equity-*` 这类设计稿数字。
- `#/snapshots?tab=bond` 同样保留批准稿的中文信息架构，但所有来源、可创建资产腿、审计和 raw registry 内容都必须来自 `bond_fixed_income` runtime 分段；后端英文运行标签进入 UI 前需要本地化，不能用 mock 债券、deterministic 曲线或 phase1 proxy 填充。
- 当刷新任务处于 `RUNNING` 时，只要部分 `refresh_stats` 已经被持久化，快照页就可以提前显示增量“新增...”摘要；如果还没有部分统计，则回退为简单的“最近刷新 ...”时间戳。
- 快照页会把后端源代码值 `longbridge`、`akshare_us`、`fmp_historical_constituent`、`tiingo`、`alpha_vantage`、`sec_edgar`、`official_announcement`、`wikipedia_revision_history`、`wikipedia_current_page`、`static_seed` 与 `local_cold_backup` 映射成面向用户的来源链标签，而不是直接暴露原始 provider id。
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

- When `matching_combination_source` is `all_trials`, the Optimization Results page must prefer the full `detail.matching_combinations` collection over filtered `job.candidates`. Otherwise a completed job can report more valid matching combinations from the API than the rows rendered in the results center.
- The persisted detail payload is the stable source for all-trials matching rows. A filtered candidate subset may be useful for the current view, but it must not hide eligible completed combinations from the results center.
- Constraint refiltering must wait for `updateOptimizationJobConstraints` to resolve before re-ranking or replacing candidate rows. Only fall back to a local constraint application when saving constraints fails.
- Candidate display should prefer version-style candidate labels over raw `Trial` ids when rendering full matching combinations. Trial-like labels such as `Trial 2402` should fall back to `候选 N` by rank.
- Mixed English summary tokens such as `daily`, `weekly`, `monthly`, `sharpe`, `oos`, and `max drawdown` should be localized before they reach shelf or row copy.
- Regression coverage for these rules lives in `web/src/optimization.module.test.tsx`, including tests for full matching combinations, stable refilter behavior, Chinese candidate labels, and localized shelf copy.

## Phase 1.1 composition persistence and freeze model

Compose First Phase 1.1 treats the persisted composition tables as the source of truth for saved portfolios:

- `asset_leg_definitions` and `cash_leg_definitions` are durable truth tables for asset/cash legs. They carry `status`, `revision`, `current_freeze_generation`, `created_at`, `updated_at`, `deleted_at`, and `deleted_reason`. Active natural-key uniqueness is enforced with partial indexes, and referenced legs expose `reference_protected` instead of allowing in-place edits.
- Strategy legs remain projection-only, but `GET /leg-inventory` no longer auto-lists every strategy parameter version. Inventory defaults to durable asset/cash rows; the create-strategy-leg drawer builds transient candidates from the latest completed backtest run per strategy plus strategy metadata, using `strategy_leg::{strategy_id}::{parameter_version_id}` refs and the selected run metrics for the validation chart/KPIs until explicit strategy-leg persistence is added. Saving a strategy-leg candidate records that stable `strategy_leg` ref in the browser inventory preference, rehydrates the row from the latest candidate data after a document refresh, shows a success toast, and must not redirect to the composition workbench.
- `compositions` carries the saved composition header, `status`, `revision`, and `current_freeze_generation`. `PATCH /compositions/{id}` with only `status` is a status write; structural patches replace the current revision and freeze generation.
- `composition_legs` is append/supersede by generation. Old rows are soft-deleted when a structural update writes a new generation.
- `composition_source_freezes` stores the frozen evidence used by detail pages. Current detail reads only current, non-deleted freezes, so later leg or bond snapshot changes cannot drift saved composition evidence.

Save semantics:

- `POST /compositions/preview` is zero-write and only calculates the normalized draft.
- `POST /compositions` and structural `PATCH /compositions/{id}` validate total weight, duplicate legs, stale or invalid sources, missing snapshots, and non-eligible bond sources before writing.
- Bond asset legs can be created only from runtime eligible `bond_fixed_income` snapshots; fallback/proxy curve data is not published as a promotable or display source.
- `GET /data-snapshots/overview` publishes `bond_fixed_income.eligible_sources`, `eligible_instruments`, and `raw_registry` from the market-data repository. The repository stores clean/net price, dirty/full price, accrued interest, YTM, duration, convexity, source, refresh status, missing-field status, inferred-field status, and raw payload evidence; `curve_preview` remains empty until a real runtime curve source exists.
