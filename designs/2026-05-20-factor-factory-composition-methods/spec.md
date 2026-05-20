# 因子工厂配置弹层 - 组合方法 Tab UI 稿

## 交付状态

- 设计包：`C:\Fin\Grit_Strategy_Lab\designs\2026-05-20-factor-factory-composition-methods`
- Canonical HTML：`C:\Fin\Grit_Strategy_Lab\designs\2026-05-20-factor-factory-composition-methods\spec.html`
- Canonical PNG：`C:\Fin\Grit_Strategy_Lab\designs\2026-05-20-factor-factory-composition-methods\spec.png`
- 目标路由：`http://127.0.0.1:4173/#/factors/factory`
- 目标弹层：`FactorFactoryConfigModal`
- 桌面基线视口：`1440 x 980`
- 设计日期：`2026-05-20`

## 设计目标

在现有 `因子工厂配置` 弹层中新增 `组合方法` Tab，用于配置 `Refined F2 -> F3` 的组合候选生成方法。该 Tab 不替代现有 `算子注册 / 治理协议 / 准入闸门 / WNZT 证据与检疫裁决 / 配置快照`，而是在 `算子注册` 后插入一个可快照化的组合方法库。

核心用户是因子研究与风控运营人员。页面要让他们快速判断哪些组合方法启用、依赖哪些源因子、公式如何生成、参数是否安全、下一次工厂运行是否会引用该配置。

## 当前项目基线

- 当前弹层已采用三栏结构：`196px` tab rail、`minmax(0, 1fr)` 主内容、`330px` 右侧证据 rail。
- 当前 footer 固定为 `取消 / 保存草稿 / 生成配置快照`。
- 当前配置快照语义是：草稿保存不影响当前 run，生成快照后才会被下一次手动或每日工厂运行引用。
- 当前工厂链路必须保留 `D1 Mining Sandbox -> D2 Quarantine -> Publish`，F3 组合候选不得直接写入正式因子库。
- 当前已有 `HYBRID_COMPOSITION`、`source_factor_ids`、`recipe_families`、`composition_policy` 等组合执行语义可作为后续实现基础。

## 可见结构

Tab 顺序：

1. `算子注册`
2. `组合方法`
3. `治理协议`
4. `准入闸门`
5. `WNZT 证据与检疫裁决`
6. `配置快照`

`组合方法` Tab 主体：

1. 顶部说明与状态 chip：`组合方法库`、`F3 组合候选`、`草稿已修改`。
2. KPI 条：`启用方法`、`源因子池`、`动态权重`、`发布边界`。
3. 筛选/控制条：业务主题、方法类型、只看启用。
4. 方法清单：7 种主流方法，展示启用状态、业务主题、组合类型、公式、关键参数和快照状态。
5. 详情面板：选中方法的组合类型、源因子、参数、公式模板、执行边界。
6. 右侧 rail：快照影响、当前引用、硬规则。

## 方法库口径

| 方法 ID | 可见名称 | 业务主题 | 组合类型 | 默认状态 | 公式摘要 |
| --- | --- | --- | --- | --- | --- |
| `linear_weighting` | 线性加权合成 | 风格复合 | `LINEAR_WEIGHTING` | 开启 | `F3 = Σ(w_i * ZScore(F2_i))` |
| `ratio_risk_adjusted` | 比例/风险调整合成 | 风险调节 | `RATIO_RISK_ADJUSTED` | 开启 | `F3 = Rank(F2_alpha) / max(Rank(F2_risk), floor)` |
| `residual_orthogonal` | 残差/正交化合成 | 残差/中性化 | `RESIDUAL_ORTHOGONAL` | 开启 | `F3 = Residual(F2_A, by=F2_B)` |
| `rank_pooling` | 排名均值/交集法 | 均衡严选 | `RANK_POOLING` | 开启 | `F3 = Rank(F2_A) + Rank(F2_B)` |
| `ffblend_style` | FFBlend 风格融合 | 风格复合 | `FFBLEND_STYLE` | 开启 | `F3 = FFBlend(Value, Momentum, Quality, Size)` |
| `divergence_penalty` | 背离惩罚 | 背离惩罚 | `DIVERGENCE_PENALTY` | 关闭 | `F3 = Rank(primary) - penalty * Rank(control)` |
| `ts_denoise` | 时序降噪 | 时序降噪 | `TIME_SERIES_DENOISE` | 关闭 | `F3 = TsRank(signal, 252)` |

## 参数槽位

| 方法 | 必填参数 | 默认值 | UI 控件 |
| --- | --- | --- | --- |
| 线性加权合成 | 源因子、权重模式、动态窗口 | 等权、21d 动态权重关闭 | segmented control、toggle、数字输入 |
| 比例/风险调整合成 | alpha 因子、risk 因子、分母 floor、Rank 空间 | `floor=0.05`、Rank 空间开启 | select、数字输入、toggle |
| 残差/正交化合成 | target、control、滚动窗口、更新频率 | `252d`、月度 | select、数字输入、select |
| 排名均值/交集法 | Rank 方向、TopK、交集策略 | `Top 10%`、求和 + 交集 | segmented control、百分比输入 |
| FFBlend 风格融合 | 风格桶、暴露上限、衰减系数 | 单风格上限 `45%`、decay `0.94` | multi-select、百分比输入、数字输入 |
| 背离惩罚 | primary、control、惩罚系数 | `0.35` | select、slider、数字输入 |
| 时序降噪 | signal、平滑窗口、降噪方式 | `252d`、TsRank | select、数字输入、segmented control |

## 快照合同建议

在 `ApiOperatorConfigDraft`、`OperatorConfigRequest` 与 `ApiOperatorConfigSnapshot` 中新增：

```ts
type CompositionMethodType =
  | 'LINEAR_WEIGHTING'
  | 'RATIO_RISK_ADJUSTED'
  | 'RESIDUAL_ORTHOGONAL'
  | 'RANK_POOLING'
  | 'FFBLEND_STYLE'
  | 'DIVERGENCE_PENALTY'
  | 'TIME_SERIES_DENOISE';

type CompositionMethodConfig = {
  id: string;
  label: string;
  theme: string;
  method_type: CompositionMethodType;
  enabled: boolean;
  formula_template: string;
  source_factor_ids: string[];
  params: Record<string, unknown>;
  publish_boundary: 'D2_QUARANTINE_ONLY';
};
```

快照字段建议命名为 `composition_methods`。如果落到 SQLite 快照表，可用 `composition_methods_json` 存储，并把该字段纳入 config signature。

## 状态与交互

- Loading：主内容显示加载条，rail 保留 skeleton。
- Empty：如果后端尚无 `composition_methods`，前端回退为默认 7 项方法库。
- Dirty：顶部与配置快照 Tab 同步显示 `草稿已修改`。
- Disabled：源因子缺失时，方法行保留但 toggle 禁用，状态显示 `缺少源因子`。
- Error：公式校验失败或参数不合法时，行内显示红色状态，不允许生成配置快照。
- Save：`保存草稿` 只保存 draft，不影响当前运行。
- Snapshot：`生成配置快照` 固化组合方法，并作为下一次 run 的 `operator_config_snapshot_id` 附属内容。

## UI Trace Matrix

| 需求 | HTML 区域 | 实现建议 | 验收方式 |
| --- | --- | --- | --- |
| 新增 Tab 且不改页面壳 | 左侧 tab rail | `FACTORY_CONFIG_TABS` 增加 `composition` | DOM 文本顺序与设计一致 |
| 展示组合类型、公式、是否开启 | 方法清单 | `composition_methods` map 到 method row | 每行有 toggle、类型、公式 |
| 支持六个业务主题 | 方法清单与详情面板 | `theme` 字段 | 业务主题 chip 可见 |
| 支持主流七类方法 | 默认配置与类型枚举 | default methods + enum | 7 行均可见 |
| 快照影响明确 | 右侧 rail | 复用 config side | 显示草稿、快照、下一次 run |
| 保留 D2 检疫边界 | 右侧 rail 与详情面板 | `publish_boundary` 固定 | 不出现直接发布按钮 |
| 响应式可读 | CSS media query | `<980px` 单列 | 移动宽度无横向溢出 |

## 组件与文件落点

- `web/src/pages/factor-factory-page.tsx`
  - 扩展 `FactoryConfigTab`
  - 增加 `compositionTab`
  - 增加方法行、详情面板、参数控件
- `web/src/pages/factor-phase2-pages.css`
  - 增加 `.composition-method-*` 样式
  - 继续复用 `.factor-config-*`、`.factor-phase2-chip`、`.factor-phase2-button`
- `web/src/types.ts`
  - 增加 `ApiCompositionMethodConfig`
  - 扩展 `ApiOperatorConfigDraft` 与 `ApiOperatorConfigSnapshot`
- `src/grit_backtest_platform/models.py`
  - 增加 Pydantic model
  - 扩展 `OperatorConfigRequest`

## 开放问题

- 是否把 `线性加权合成` 与 `FFBlend 风格融合` 同时默认开启：本稿默认两者都开启，但执行层可用探索预算限制避免重复放大风格暴露。
- `IC/IR 加权` 的滚动窗口默认值是否统一为 `21d`：本稿按用户方案采用 `21d`，如果后续与月度调仓冲突，可在实现时改成可选。
- `Rank Pooling` 是否纳入用户列出的六个主题：本稿作为机构常用方法保留，主题命名为 `均衡严选`。
