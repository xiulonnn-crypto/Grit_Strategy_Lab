# 组合因子策略创建页 UI 稿

## 设计来源

- 基准页面：`http://127.0.0.1:4173/?v=route-reload-1779094281976#/factor-models/new`
- 基准模块：`factor-phase2-page factor-model-builder-page`
- 基准结构：`factor-phase2-hero` + `factor-phase2-workbench factor-phase2-workbench--model`
- 输出目录：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\composite-factor-builder-live-remix-20260518`
- 本轮仅优化 UI 稿和 trace 文件，未修改应用源码，未修改 `DESIGN.md`。

## 页面定位

面向美股的 L3 因子组合策略配置页。页面只接收已完成 WNZT、S/A 级、L3 层级的美股因子，默认因子权重锁定为 100%，再把因子分数转为可回测策略参数。

本轮优化目标：

- 精简参数占位面积，提升桌面三栏信息密度。
- 所有交易状态参数改为美股语境，移除 `ST/*ST` 等 A 股概念。
- 可见文案改为简洁、专业的中文金融表达。

## 可视结构

- 左栏：`因子来源`，展示已选 L3 因子、准入标签、核心统计、100% 权重锁定、Diagnostic Summary。
- 中栏：`配置与权重预览`，承载四步配置：股票池过滤、权重映射、再平衡逻辑、实盘约束。
- 右栏：`策略创建风险`，实时监测 L3 准入、行业裁断预测、成本预估、交易可执行性和跟踪误差提示。

## UI Trace Matrix

| 需求 | UI 模块 | 选择器 / 组件锚点 | 可见文案与状态 | 验收点 |
| --- | --- | --- | --- | --- |
| 基于当前创建页模块改造 | 页面根与工作台 | `[data-page-root="factor-model-builder"]`, `.factor-phase2-workbench--model` | `组合因子策略创建` | 保持 live 页 1140px 内容区、三栏密度和左侧导航语境 |
| 美股专用策略语境 | Hero 与因子来源 | `.factor-phase2-hero`, `[aria-labelledby="factor-model-select"]` | `COMPOSITE_FACTOR · 美股 L3 单因子 100%`, `美股因子` | 页面不出现 A 股状态概念 |
| 因子来源仅支持 WNZT 完成 S/A L3 | 因子来源卡 | `.factor-pick` | `WNZT 完成`, `S 级`, `L3`, `诊断完成` | 不出现普通 D1/D2 或未完成因子入口 |
| 默认单因子权重 100% | 权重锁定条 | `.locked-weight` | `因子权重已锁定 100%` | 没有多因子权重滑块，避免误导为可拆分权重 |
| 选中因子带 Diagnostic Summary | 诊断简报 | `.diagnostic-card` | `Diagnostic Summary`, `公用事业 -0.18 IC`, `能源 -0.12 IC`, `房地产 -0.09 IC` | 简报放在左栏，用户开始股票池过滤前即可看到最弱行业 |
| 成交额门槛与退市窗口同排 | Step 01 控件 | `[aria-label="股票池过滤"] .control-grid` | `成交额门槛 5,000,000 20D`, `退市窗口期 未来 30 天` | 两个主控件桌面同排，减少纵向占位 |
| 美股交易状态过滤一排 | Step 01 勾选框 | `.checkbox-list`, `.check-row` | `停牌`, `OTC/Pink`, `LULD 暂停`, `退市窗口` | 桌面四项同排，移除 `ST/*ST` 和 `涨跌停` |
| 诊断驱动行业干预 | Step 01 行业开关 | `.trace-strip` | `公用事业 保守降权`, `能源 ADV 加严`, `房地产 压力检查`, `低流动性 17 只剔除` | 与左栏 Diagnostic Summary 对齐 |
| 权重映射三模式 | Step 02 模式卡 | `[aria-label="权重映射模式"]`, `.mapping-card` | `等权 Top-K`, `分值比例法`, `风险优化启发式` | 默认选中等权 Top-K |
| 权重四项输入一排 | Step 02 控件 | `.control-grid--four` | `Top-N 50`, `行业上限 20.0%`, `个股上限 2.0%`, `最低权重 0.25%` | 桌面四项同排，控制集中度和风险边界 |
| 行业硬上限 Sector Cap | Step 02 行业模块 | `.sector-cap-module` | `科技 31.4% → 20.0%`, `截断超额 11.4%`, `残余现金 0.6%` | 体现循环裁断与按分数比例重分摊，不依赖 CVXPY |
| 裁断权重重分配 | Step 02 双选项 | `.allocation-switch`, `.segmented-control` | `保持现金`, `按比例回填` | 默认保持现金；回填选项用于目标满仓 |
| 再平衡逻辑 | Step 03 控件 | `[aria-label="再平衡逻辑"]`, `.control-grid` | `每月`, `首个交易日`, `跌出前 20%`, `10,000 USD` | 控制调仓节奏与交易指令下限 |
| 实盘约束 | Step 04 控件 | `[aria-label="实盘约束"]`, `.control-grid` | `10,000,000 USD`, `1.5 bps`, `0.0 bps`, `2.5 bps`, `冲击系数 β 0.65`, `75 bps` | 成本模型进入回测参数，不只做提示 |
| L3 准入实时门禁 | 右侧校验器 | `.validator-card`, `.wznt-strip` | `W`, `N`, `Z`, `T`, `可创建` | 任一 WNZT 项不满足时创建按钮应禁用 |
| 行业裁断预测 | 右侧校验器 | `.validator-card`, `.risk-kpi-grid` | `被裁断权重 11.4%`, `残余现金 0.6%`, `满仓率 99.4%`, `超额行业 1 个` | 根据 Step 02 参数实时提示现金留存和跟踪误差风险 |
| 成本预估 | 右侧校验器 | `.validator-card--warn` | `平均每笔滑点 6.8 bps`, `固定成本 1.5 bps`, `冲击系数 β 0.65`, `单笔上限 75 bps` | 基于 Step 04 本金和订单 / ADV 比例估算 |
| 创建后沿用其他策略流程 | 右侧 CTA | `.factor-model-submit` | `Strategy Type: COMPOSITE_FACTOR`, `创建可回测策略` | 创建后进入现有策略详情、回测、优化链路 |
| 移动端 | 响应式断点 | `@media (max-width: 720px)` | 三栏改为单列 | 390px 宽度无横向溢出，控件单列展开 |

## 交互与数据映射

- `#/strategies` 新建策略弹层新增入口时，点击进入该页面并带入 `strategy_type=COMPOSITE_FACTOR`。
- `#/factors` 操作列“配置策略”仅对 WNZT 完成、S/A、L3 美股因子出现，点击后进入该页面并带入 `factor_id`。
- 页面初始化从因子详情读取 `Diagnostic Summary`，其中 `sector_performance` 映射为左栏最弱行业列表和 Step 01 行业开关。
- Step 01 建议 payload：`min_adv_usd`, `adv_window`, `exclude_halted`, `exclude_otc_pink`, `exclude_luld_paused`, `delisting_window_days`, `sector_overrides`。
- Step 02 建议 payload：`method`, `top_n`, `sector_cap_pct`, `max_position_pct`, `min_target_weight_pct`, `cap_redistribution_mode`。
- `cap_redistribution_mode` 默认 `cash`; 切换按比例回填时为 `proportional_refill`，目标满仓但需右侧同步更新成本和行业预测。
- Step 03 建议 payload：`rebalance_frequency`, `rebalance_calendar_rule`, `exit_rank_percentile`, `min_trade_notional_usd`。
- Step 04 建议 payload：`notional_usd`, `commission_bps`, `stamp_tax_bps`, `base_slippage_bps`, `impact_beta`, `max_impact_bps`。
- 创建 payload 中保留 `strategy_type: COMPOSITE_FACTOR`，回测与优化复用现有策略流程。

## 视觉规则

- 沿用当前 `factor-model-builder-page` 的白色面板、细边框、低阴影和绿色主操作。
- 主色：`#16897b`；正文：`#071423`；弱文本：`#52697a`；警示：`#a76616`；风险：`#b4403a`。
- 参数模块采用短标签和并排控件，减少说明性文字。
- 桌面端 Step 01 交易状态过滤、Step 02 权重输入必须横向排列；移动端允许单列以确保无横向溢出。
- 右侧风险栏使用动态 KPI 卡和状态 chip，不再只是静态文案。

## 已渲染验证

- 桌面截图：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\composite-factor-builder-live-remix-20260518\composite-factor-builder-live-remix-desktop.png`
- 移动截图：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\composite-factor-builder-live-remix-20260518\composite-factor-builder-live-remix-mobile.png`
- 基准截图：`C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\composite-factor-builder-live-remix-20260518\live-factor-models-new-baseline-desktop.png`
- 几何检查：桌面根模块高度约 `2026`，中栏高度约 `1826`，相比上一版约 `2317` 明显收紧；桌面四个交易状态过滤同排，四个权重输入同排；移动端 `390px` 宽无横向溢出。
