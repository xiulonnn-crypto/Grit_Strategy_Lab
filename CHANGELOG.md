# 更新日志

此文件记录项目中所有值得关注的历史变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
并遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

本文件已于 2026-04-15 根据仓库提交历史与现有项目文档完成历史回填。

## [未发布]

### 新增

- 数据集快照新增 `yfinance` 补洞提供方，在 `Yahoo HTTP` 没有 bars 数据、长历史存在缺口或需要补齐 `dividend/split` 时，优先提供 Yahoo 体系的回退能力。
- 新增股票池阶段的 heartbeat 更新与定向修复窗口，使实时任务现在会以可见的阶段变化依次经过 `selection -> latest_market_data -> finalizing -> universe_provider`。
- 新增 Optimization Lab 模块，提供独立的参数配置、结果展示、轮询刷新流程，以及针对配置页、进度页、结果页的专项测试覆盖。
- 新增动量策略支持，贯通策略模板、回测指标、策略详情和相关运行引用链路。
- 新增更完整的市场数据与股票池历史能力，接入官方指数公告链路，以及 FMP、Tiingo、Alpha Vantage、SEC EDGAR、AkShare US、Longbridge 等数据提供方。
- 新增纳斯达克 100 的 Wikipedia 变更表回填能力；当历史修订表不可用时，可基于当前页面的成分变更历史并以 `2015` curated dataset 为基线，重建 `2007+` 的锚点缺口。
- 新增纳斯达克 100 旧版 Wikipedia 列表解析器；即使 `2005-2007` 的旧修订只有 `Components` 或 `NASDAQ-100` 项目列表、没有 wikitable，也仍可生成历史锚点。
- 新增 Internet Archive / 归档 Wikipedia 快照回填能力，用于补齐 2004 年以前剩余的纳斯达克 100 回退锚点；当实时 Wikipedia 修订历史不足时，仍可重建更早的半年度节点。
- 新增运行详情总览、诊断、属性等视图，可直接查看执行证据、参数快照和优化上下文。
- 新增面向贡献与验收的 harness 文档、fixture 生成能力、smoke 脚本和技术操作指南，使本地重复验证成为标准工作流的一部分。

### 变更

- 数据集价格链调整为 `Yahoo HTTP -> yfinance -> Tiingo -> Longbridge -> AkShare -> FMP`，并将 `Alpha Vantage` 价格端限制为仅在 `repair` 缺口批次下执行 `targeted_price_repair`。
- 运行时提供方遥测新增 `yfinance` 的 `selected_primary_symbols`、`succeeded_not_selected_symbols` 统计，并把 `Alpha Vantage` 的定点补价与普通价格链分开落库。
- 股票池免费链默认顺序调整为 `Wikipedia 历史修订 + 官方公告 + GitHub curated dataset`，并将 `FMP historical constituent` 降级为仅在 entitlement probe 成功时启用的付费可选源。
- 将股票池修复范围限制为不完整的半年度锚点，不再在每次运行时都重新加载过去 30 年窗口内所有 `01-01 / 07-01` 锚点。
- 扩展标普 500 历史修复逻辑，在裁剪结果前额外抓取一个下游半年度锚点，使 Wikipedia 变更表回填可以基于更晚版本重建更旧的回退锚点。
- 股票池刷新统计新增历史锚点进展字段，支持区分“成员行未变化”和“历史锚点质量已提升”两类刷新结果。
- 改进快照刷新与恢复逻辑，使官方来源回退、证券身份映射、股票池历史更新更加稳定可靠。
- 调整快照页 `READY/就绪` 状态标签样式，使已完成的股票池卡片呈现明确的绿色成功态。
- 扩展工作台、快照页、运行列表、回测提交页、策略详情页的串联体验，让研究链路从创建一路连通到优化阶段。
- 升级优化任务执行与续跑机制，在后端 API 和前端页面中持久化更多 trial 进度、heartbeat、ETA 与候选结果状态。
- 提升本地运行时的回测与优化性能，尤其改善 Windows 下长时间任务的执行体验。
- 同步刷新架构、技术、设计与 README 文档，使当前工作流和运维脚本与代码实现保持一致。

### 修复

- 修复实时快照刷新编排问题；当同步重建全部历史锚点时，`repair + universes` 不再长时间显示为卡在 `preflight`。
- 修复 Optimization Lab 结果页过滤统计与“当前组合”展示割裂的问题：当当前组合满足快捷过滤条件时，顶部“符合约束”统计会纳入当前组合，页面也不再错误显示“当前约束下暂无候选版本通过过滤”。
- 修复 Optimization Lab 结果页问题：首屏区域现在会展示当前生效的约束标签，候选表只显示满足当前约束规则的版本，零匹配任务也会回退到明确的空结果状态，而不会展示不符合约束的候选项。
- 修复 Optimization Lab 首屏操作按钮样式，使结果页和配置页保持一致的按钮宽度与换行表现，不再把标签挤压成狭窄的纵向堆叠。
- 再次修复优化任务首组 trial 启动过慢的问题：将快照就绪预检迁移到 `dataset_symbol_coverage`，并让 `run-optimization` 延迟加载应用与提供方启动逻辑，使真实子进程校验耗时降至 `1.639s`，`opt_c9192c66f58e` 的第 `1/4` 组 trial 启动耗时降至 `1.655s`。
- 修复参数优化任务首组启动过慢的问题：优化热路径读取 `dataset_price_bars` 时不再为每根 bar 解码无关的 `metadata_json`，使真实策略的首组开始时间从约 84 秒缩短到约 13 秒，首组完成时间从约 160 秒缩短到约 30 秒。
- 修复 Optimization Lab 手动“继续优化”后返回旧的 `QUEUED` 快照的问题；恢复操作现在会立即基于已持久化 trial 进度返回 `RUNNING` 状态，并同步 `completed_combinations`、`persisted_trial_count` 与 `next_trial_index`，避免前端进度长时间看起来没有变化。
- 修复 `repair` 路径错误消耗 `Alpha Vantage` 免费价格额度的问题，`incremental` 默认不再触发 Alpha 价格全池尝试。
- 保持规范数据集快照的事实层语义为原始 `OHLC + adj_close`，不将 adjusted OHLC 或 forward fill 写入持久化快照。
- 修复快照页顶部“最近刷新”摘要只按股票池成员行增量判断进展的问题；现在即使 `updated_row_count = 0`，只要历史锚点从 fallback 提升为历史来源，前端也会显示如“纳指100股票池9个历史锚点，进度23/61”的新增说明。
- 修复多处快照与市场数据边界场景，降低刷新或修复任务后本地数据平面不完整或不一致的风险。
- 修复优化进度可见性问题，使运行中或被中断的任务能在 API 与 UI 中呈现更清晰且一致的状态。
- 修复本地 smoke 与 live acceptance 的准备链路，通过统一 fixture 重置、测试入口和真实 API 验证脚本提升可重复性。

## [0.1.1] - 2026-04-01

### 新增

- 新增更完整的 Windows 快速启动流程，包含运行时校验、修复辅助脚本和更稳妥的本地启动默认项。
- 新增基于路由的 React 应用入口，以及工作台、策略创建、回测提交、运行详情、运行列表、快照页、策略详情等一组正式页面。
- 新增 shell 框架、中文运行时入口，以及覆盖恢复主链路的更多前后端聚焦测试。
- 新增快照恢复、回退提供方支持和 live acceptance 辅助脚本，用于在本地数据上验证恢复后的主链路。
- 新增恢复方案文档与设计稿沉淀，用于记录重建后的产品方向。

### 变更

- 将恢复后的平台从初始基线扩展为更完整的 `workspace -> creation -> backtest -> run detail -> snapshots` 主链路体验。
- 改进恢复态后端服务、存储层、市场数据访问和 API 契约，让基于本地 SQLite 的流程更接近可用产品，而不是局部修复快照。
- 完成围绕 `app-runtime` 路由、共享适配层和页面级测试覆盖的前端架构收口。
- 更新 README 与架构文档，使其与真实路由图、运行约束和启动方式一致。

### 修复

- 修复多处本地环境阻塞问题，包括 GitHub 推送辅助链路、凭证受阻场景和快速启动健康检查。
- 修复策略创建、运行详情、工作台和快照相关视图中的多项恢复回归问题，使项目恢复度提升至约 80%。

## [0.1.0] - 2026-03-30

### 新增

- 新增 Grit Strategy Lab 在 2026 年 3 月恢复工作后的首个可运行基线，重新建立 FastAPI 后端与 React/Vite 前端工作台。
- 新增基线恢复提交中提到的生命周期清理、交易审计能力和运行时自愈机制。
- 新增本地 SQLite 种子数据库、打包后的 Python 运行时资源，以及在 Windows 上启动重建平台所需的初始工程结构。
## [Unreleased]

### Fixed

- 修复动量回测只实际使用 `lookback_months` 和 `top_n` 的问题；`skip_recent_months`、`hold_rank_threshold`、`weighting_method`、`rebalance_anchor_dates` 现在都会进入真实调仓逻辑，`capital` 也会同步写入 `initial_equity`。
- 修复优化评分被 `total_return_pct` 放大的问题；现在改为以 `return_sharpe`、`out_of_sample_sharpe`、Calmar、稳定度、回撤和换手约束为主的风险调整排序。
- 修复 Optimization Lab 结果中心在调整约束后仍复用旧候选池的问题；现在会基于完整 `optimization_job_trials` 重建候选、去重相同结果，并优先返回满足当前约束的不同候选版本。
