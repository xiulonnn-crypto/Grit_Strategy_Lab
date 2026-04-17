# 更新日志

此文件记录项目中所有值得关注的历史变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，
并遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

本文件已于 2026-04-15 根据仓库提交历史与现有项目文档完成历史回填。

## [Unreleased]

### 优化 (Changed)

- **目标排序**: Optimization Lab 配置页与结果页统一支持 `收益夏普 Max / 年化收益率 Max / 综合得分 Max` 三种目标排序，重新过滤与结果排名现在都会按当前目标字段严格主键重排。
- **约束条件**: Optimization Lab 结果页将“快捷过滤”统一改名为“约束条件”，并移除顶部预设标签、符合约束计数与逐条约束标签串；配置页与结果页对外公开约束同步收口为 5 项，不再暴露 `换手率`。
- **策略详情摘要**: `#/strategies/:id` 标题下方不再展示类型 / 股票池 / 基准 / 再平衡等标签串，改为基于当前参数生成一句策略摘要，直接概括信号逻辑、持仓规则与调仓节奏。

### 修复 (Fixed)

- **QuickStart 前端预览**: `QuickStart-Grit.ps1` 现在会以 `--rebuild-on-start` 启动 `web/preview-server.mjs`，避免默认 `http://127.0.0.1:4173/#/workspace` 在冷启动时返回 `Frontend build not ready yet.`。
- **查看全部组合弹层**: `#/optimization-jobs/:id` 的“查看全部组合”弹层改为桌面安全宽度，避免结果表在电脑屏幕上横向撑出滚动条；底部操作栏固定；弹层打开时会锁定背景页面滚动，并将头部/底部区域的滚轮转发到表格区，保证弹层与表格都能顺畅使用滚轮浏览。
- **演示 API 合同**: `web/src/lib/demoStore.ts` 与 `web/src/lib/demoStorePhase4.ts` 补齐 `updateOptimizationJobConstraints`，前端全局 `tsc --noEmit` 不再被这两条已知基线错误阻塞。
- **策略版本展示**: 策略主名称恢复为基础名，不再把版本号写进 `策略名vN`；`#/workspace` 最近回测优化、`#/runs`、回测详情、策略详情与优化相关页面改为展示“策略名 + 版本标签”，其中回测与优化任务会优先使用各自持久化的历史版本信息，不再被当前最新版本覆盖。
- **优化配置版本一致性**: `#/optimization-jobs/new/config` 在无 `source_run_id` 的菜单入口下，参数范围“当前值”现在优先读取策略当前参数版本，不再被历史 `confirmation_fields` 旧值覆盖，避免页面显示高版本标签时仍沿用旧版本默认参数而造成版本判断错误。
- **旧任务约束清洗**: 旧版 Optimization Lab 任务在详情读取、结果页水合与重新过滤时会主动清洗 legacy `turnover` 约束，避免“约束条件”模块重新冒出已下线的第六项 `换手率`。
- **优化结果评分一致性**: Optimization Lab 结果页的“当前组合”基线行改为复用候选组合同一套稳定度与综合评分模型，不再出现当前组合显示稳定度 `88`、综合得分 `1.325`，而候选列表却按另一套分数与稳定度排序的口径不一致问题。
- **优化结果稳定度显示**: Optimization Lab 结果页加载“当前组合”基线行时不再只取 `view=metrics` 的轻量回测详情，避免缺少 `consistency_score` / `chart_series` 时把稳定度错误回退为 `0`。
- **优化配置**: `#/optimization-jobs/new/config` 的 `观察周期` 不再被错误建模为单值范围，现改为 `每日 / 每周 / 每月` 多选项，并同步支持后端按离散枚举展开优化组合。
- **动量调仓频率**: `#/optimization-jobs/new/config` 现支持将动量策略 `调仓频率` 作为 `每月 / 每季度 / 每半年 / 每年` 离散优化维度；候选晋升与复制版本时也会同步更新策略顶层 `rebalance_frequency`，保证策略详情页与新建-动量策略页展示一致。
- **优化结果计数**: 旧版只保存 `candidates_json`、未落 `optimization_job_trials` 的优化任务，现在会按已保存候选重算 `matching_combination_count`，避免出现“符合过滤条件的组合共 0 个”却仍显示“当前首选组合”的矛盾状态。
- **历史任务结果提示**: `#/optimization-jobs/:id` 遇到缺少全量 `optimization_job_trials` 的旧任务时，会明确标记“仅基于已保存候选”，不再把 4 个历史候选误说成 2880 组组合的完整筛选结果。
- **参数候选盘排序**: `#/optimization-jobs/:id` 读取完成态优化任务时，若历史 `candidates_json` 的首位候选已经落后于 `matching_combinations` 的真实头名，会自动基于持久化 `optimization_job_trials` 重建候选版本，避免参数候选盘第 1 名低于“查看全部组合”的实际 `年化收益率 Max`。
- **重新过滤列表闪动**: `#/optimization-jobs/:id` 点击“重新过滤”后，参数候选盘改为等待重新过滤结果返回后再统一刷新，不再先按页面本地状态重排、再跟随后端响应二次更新造成列表连续跳动。
- **多窗口验证**: 多窗口验证表现在会补充每个窗口的 `YYYY-MM-DD 至 YYYY-MM-DD` 周期说明，并修复窗口年化收益率错误显示为 `-` 的问题。

## [0.1.1-003] - 2026-04-16 - 新增离线价格补源与优化实验室结果兜底入口

### 新增 (Added)

- **数据源**: 引入离线 `Stooq` ZIP 价格源，可从 `GRIT_STOOQ_US_DAILY_ZIP` 或默认冷启动包补齐长历史日线。
- **交互**: Optimization Lab 结果页新增“一键放宽到有结果”入口，可按当前最佳候选自动回填阈值并立即重新过滤。

### 优化 (Changed)

- **策略列表性能**: 策略选择页改为复用 `latest_completed_run_summary` 摘要数据，不再逐条拉取完整回测详情，显著缩短首屏等待。
- **轮询链路**: Optimization Lab 进度轮询加入自适应退避、抖动、失焦暂停与恢复后即时拉取，减少无效请求并保留 `inFlight` 去重。
- **后端吞吐**: `get_optimization_job_detail` 在运行态加入 `job_id + updated_at` 的 1 秒短时复用，降低无变更窗口下的重复聚合查询。
- **可观测性**: `get_optimization_job_detail` 补充请求频率、平均耗时和 snapshot 命中率指标，便于量化提速方案的回归效果。
- **快照遥测**: `provider_summary` 现在会持久化到数据集 metadata，并将纯价格源排除在 corporate action provider summary 之外。

### 修复 (Fixed)

- **快照编号**: 修正 `pre-push` 补跑 `CHANGELOG.md` 时的快照编号与日期规则，避免补推送被错误记为 `-001`。
- **公司行为诊断**: 补充 `complete_no_events` probe coverage，消除无正式事件 symbol 被误判为 corporate missing 的假阴性。
- **快照修复**: repair 会按 `covered_symbols` 重算缺口与状态，避免陈旧 `missing_symbols` 让任务卡在历史假状态。
- **重新过滤**: 当前组合仍通过但候选全被快捷过滤挡住时不再无入口卡死；筛空结果时也不会错误落盘并切换本地结果态。
- **错误提示**: “无符合条件的组合” 统一改用顶部居中的 `error-banner` 展示，解决右下角私有样式带来的溢出问题。
- **护栏卡片**: 配置页将约束改写为“最大回撤 ≤ 25%”这类规则句，并移除卡片内重复的“当前判定”信息，提升两列布局可读性。
- **时间窗口继承**: 使用 `source_run_id` 创建优化任务时会继承原始 `request_json` 时间窗口，缺失窗口时直接报错，不再回退整段历史数据。
- **结果计数**: 终态详情缺少 `matching_combination_count` 时会直接报错并停止展示，避免把候选池数量误当成符合条件的组合总数。

## [0.1.1-002] - 2026-04-15 - 引入 Optimization Lab 并补强快照修复与历史数据链路

### 新增 (Added)

- **价格补洞**: 数据集快照新增 `yfinance` 回退提供方，用于 `Yahoo HTTP` 缺 bars、长历史缺口或公司行为补齐场景。
- **任务心跳**: 股票池阶段新增 heartbeat 与定向修复窗口，实时任务会显式经过 `selection -> latest_market_data -> finalizing -> universe_provider`。
- **参数优化**: 新增 Optimization Lab 模块，打通参数配置、结果展示、轮询刷新及对应页面测试。
- **策略类型**: 新增动量策略，贯通策略模板、回测指标、策略详情和运行引用链路。
- **数据覆盖**: 新增更完整的市场数据与股票池历史能力，接入官方指数公告及 FMP、Tiingo、Alpha Vantage、SEC EDGAR、AkShare US、Longbridge 等提供方。
- **历史回填**: 新增纳斯达克 100 的 Wikipedia 变更表回填能力，可在历史修订不足时基于 `2015` curated dataset 重建 `2007+` 锚点缺口。
- **旧版解析**: 新增纳斯达克 100 旧版 Wikipedia 列表解析器，支持 `2005-2007` 缺失 wikitable 的历史页面。
- **归档回退**: 新增 Internet Archive / 归档 Wikipedia 快照回填，用于补齐 2004 年以前的纳斯达克 100 历史锚点。
- **运行详情**: 新增总览、诊断、属性等视图，可直接查看执行证据、参数快照和优化上下文。
- **验证工具**: 新增 harness 文档、fixture 生成能力、smoke 脚本和技术操作指南，让本地重复验证成为标准流程。

### 优化 (Changed)

- **价格链路**: 数据集价格链调整为 `Yahoo HTTP -> yfinance -> Tiingo -> Longbridge -> AkShare -> FMP`，并把 `Alpha Vantage` 价格端收敛到 `repair` 缺口批次。
- **遥测落库**: 运行时 provider telemetry 新增 `yfinance` 选中与未选中成功统计，并将 `Alpha Vantage` 定点补价与普通价格链分开落库。
- **股票池免费链**: 默认顺序调整为 `Wikipedia 历史修订 + 官方公告 + GitHub curated dataset`，`FMP historical constituent` 降级为 entitlement 成功后的付费可选源。
- **历史修复范围**: 股票池修复改为只处理不完整的半年度锚点，不再每次重载过去 30 年全部 `01-01 / 07-01` 节点。
- **标普回填**: 标普 500 历史修复会预抓一个下游半年度锚点，便于基于更晚版本重建更早回退锚点。
- **刷新统计**: 股票池刷新统计新增历史锚点进展字段，可区分“成员行未变化”和“历史锚点质量提升”。
- **刷新稳定性**: 快照刷新与恢复逻辑整体加强，使官方来源回退、证券身份映射和股票池历史更新更稳定。
- **状态视觉**: 快照页 `READY/就绪` 标签调整为明确绿色成功态，完成状态更容易识别。
- **研究链路**: 工作台、快照页、运行列表、回测提交页与策略详情页的串联体验扩展到优化阶段。
- **续跑可见性**: 优化任务执行与续跑机制升级，在后端 API 与前端页面中持久化更多 trial 进度、heartbeat、ETA 和候选结果状态。
- **本地性能**: 本地运行时的回测与优化性能进一步提升，尤其改善 Windows 下的长时间任务体验。
- **文档同步**: 架构、技术、设计与 README 文档同步刷新，使工作流和运维脚本与当前实现保持一致。

### 修复 (Fixed)

- **快照编排**: 同步重建全部历史锚点时，`repair + universes` 不再长时间卡在 `preflight`。
- **过滤统计**: 当前组合满足快捷过滤条件时，结果页顶部“符合约束”统计会纳入当前组合，不再错误显示“暂无候选版本通过过滤”。
- **空结果态**: 结果页首屏会展示当前约束标签，候选表只保留满足约束的版本，零匹配任务会明确回退到空结果状态。
- **首屏按钮**: Optimization Lab 结果页与配置页的首屏按钮宽度和换行表现保持一致，不再挤成纵向堆叠。
- **首组启动**: 快照就绪预检迁移到 `dataset_symbol_coverage`，并让 `run-optimization` 延迟加载应用与提供方逻辑，显著缩短首组 trial 启动时间。
- **热路径读取**: 优化任务读取 `dataset_price_bars` 时不再为每根 bar 解码无关 `metadata_json`，显著缩短真实策略的首组开始与完成时间。
- **继续优化**: 手动“继续优化”后会立即返回 `RUNNING` 快照，并同步 `completed_combinations`、`persisted_trial_count` 与 `next_trial_index`。
- **价格额度**: `repair` 路径不再错误消耗 `Alpha Vantage` 免费价格额度，`incremental` 默认也不会触发 Alpha 全池尝试。
- **事实层语义**: 规范数据集快照继续保持原始 `OHLC + adj_close` 事实层，不再把 adjusted OHLC 或 forward fill 写入持久化快照。
- **刷新摘要**: 即使 `updated_row_count = 0`，只要历史锚点来源提升，快照页顶部也会显示历史进展摘要。
- **数据边界**: 多处快照与市场数据边界场景得到修复，降低刷新或 repair 后本地数据平面不完整或不一致的风险。
- **进度状态**: 运行中或被中断的优化任务现在能在 API 与 UI 中呈现更清晰且一致的状态。
- **验证链路**: 本地 smoke 与 live acceptance 的准备链路统一为 fixture 重置、测试入口和真实 API 校验脚本，提升重复验证稳定性。
- **动量参数**: 动量回测现在会真实使用 `skip_recent_months`、`hold_rank_threshold`、`weighting_method` 和 `rebalance_anchor_dates`，并把 `capital` 写入 `initial_equity`。
- **评分排序**: 优化评分不再被 `total_return_pct` 放大，改为以 `return_sharpe`、`out_of_sample_sharpe`、Calmar、稳定度、回撤和换手约束为主的风险调整排序。
- **候选重建**: 调整约束后，Optimization Lab 结果中心会基于完整 `optimization_job_trials` 重建候选，并优先返回满足当前约束的不同版本。

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
