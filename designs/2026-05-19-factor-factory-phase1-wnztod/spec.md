# 因子工厂 Phase 1 UI 重设计稿

## 交付状态

- 设计包：`C:\Fin\Grit_Strategy_Lab\designs\2026-05-19-factor-factory-phase1-wnztod`
- HTML 稿：`spec.html`
- PNG 基线：`spec.png`
- 规格文件：`spec.md`
- 状态：按用户反馈重设计，待确认。
- `DESIGN.md`：未修改。确认方向后再沉淀系统规则。

## 本轮变更目标

这版不改变线上页面模块样式。主页面继续沿用当前 Factor Factory 的 `hero + status strip + metrics + 三栏 workbench + 准入规则` 结构，只改模块内容表达。

本轮明确处理 5 个要求：

- 保持线上页面模块样式不变，继续使用现有 `factor-phase2-*` / `factor-factory-*` 模块语法。
- 在“因子任务”模块中，把每日挖掘任务表达为 `F1 -> 算子展开 -> Raw_F2`。
- 在“因子任务”模块中，把每日治理任务表达为 `Raw_F2 -> WNZT -> Refined F2`。
- “因子检疫”模块结构不变，只优化检疫内容和拒绝原因表达。
- “工厂配置抽屉”和“WNZT 证据与检疫裁决”统一放进 `工厂配置` 弹层，以 tab 展示。
- 本轮继续优化：B2 缩窄并精简候选卡片，B3 加宽以完整展示建议表格，配置弹层大小和布局对齐 Phase 0 参考稿。
- 本轮继续优化：治理任务改为 WNZT 标准流，O/T 扩展改为可选配置且默认关闭；全局模块标题、副标题和 tab 文案统一为简洁中文金融表达。

## Canonical Artifact Contract

| 项 | 值 |
| --- | --- |
| 主路由 | `#/factors/factory` |
| 兼容入口 | `#/factors/sandbox`、`#/factors/quarantine` |
| Canonical HTML | `C:\Fin\Grit_Strategy_Lab\designs\2026-05-19-factor-factory-phase1-wnztod\spec.html` |
| Canonical PNG | `C:\Fin\Grit_Strategy_Lab\designs\2026-05-19-factor-factory-phase1-wnztod\spec.png` |
| 桌面基线 | 1440px |
| 平板基线 | 1024px |
| 移动基线 | 390px |

## 页面结构

页面顺序保持线上结构：

1. 顶部 hero：每日因子生产台标题、调度动作按钮。
2. 状态条：执行时点、生产批次、配置快照、运行快照锁定。
3. 基础监视器：昨日公式量、初筛通过、检疫通过、S 级晋升、Alpha 浓度、阻断原因。
4. 三栏 workbench：
   - B1 任务流。
   - B2 候选评分。
   - B3 检疫建议。
5. 发布准入规则。
6. `工厂配置` 弹层打开态，作为独立状态展示。

## 因子任务模块

### 每日挖掘任务

卡片标题建议：

- `今日挖掘任务`

副文案：

- `F1 字段经算子族展开，生成 Raw_F2 候选池。`

算子展开区固定三行：

| 算子族 | 展开表达 | 产物 |
| --- | --- | --- |
| `TS_Return` | `TS_Return(F1, n) -> Raw_F2 return signal` | Raw_F2 |
| `TS_Rank` | `TS_Rank(TS_Return(F1, n), m) -> Raw_F2 momentum` | Raw_F2 |
| `TS_Corr` | `TS_Corr(F1_a, F1_b, n) -> Raw_F2 relation` | Raw_F2 |

底部 chip：

- `F1 字段池 128`
- `窗口 3/5/10/21/63/126/252`
- `10,000 公式预算`
- `842 初筛通过`

### 每日治理任务

卡片标题建议：

- `今日治理任务`

副文案：

- `Raw_F2 进入 WNZT 标准流，治理后生成 Refined F2。`

四段标准治理条：

| 阶段 | 文案 |
| --- | --- |
| W | 去极值并记录裁剪率 |
| N | 行业 / 市值 / 风格中性化 |
| Z | 截面标准化 |
| T | 时序平滑与换手约束 |

O/T 扩展配置：

| 配置项 | 默认状态 | 说明 |
| --- | --- | --- |
| O 正交化 | 默认关闭 | 仅在配置快照中显式启用，用于剔除同族或既有风格成分 |
| T 扩展滤波 | 默认关闭 | 仅在配置快照中显式启用，用于追加高阶平滑或额外换手惩罚 |

底部 chip：

- `Raw_F2 842`
- `WNZT 完整 216`
- `Refined F2 37`
- `O/T 关闭`

## 因子检疫模块

结构保持线上不变：

- Header：`B3 检疫建议` / `发布准入建议`。
- 筛选行：日期、因子名、裁决、查询。
- 表格列：日期、因子名、裁决、原因、操作。

只优化内容：

- PASS 原因必须表达完整治理证据和硬闸门结果。
- WARN 原因用于 WNZT 主干通过但仍需观察的非阻断事项。
- FAIL 原因用于 OOS 熔断、P-value 不显著、S 级相关性大于 0.70、容量或回撤硬阻断。
- 不再用泛化的“风险提示”替代具体硬闸门原因。

示例内容：

- `WNZT 完整，OOS/IS 0.81，S 级相关 0.41，容量通过。`
- `O/T 扩展未启用，主干证据完整，进入观察池。`
- `OOS 崩盘熔断，P-value 不显著，自动剔除。`
- `与 S 级动量因子相关性 0.74，大于 0.70 自动废弃。`

## B2 / B3 宽度与密度

三栏工作台建议从均分改为偏向 B3：

```css
.factor-factory-workbench--b1b4 {
  grid-template-columns:
    minmax(310px, 0.82fr)
    minmax(218px, 0.54fr)
    minmax(552px, 1.42fr);
}
```

B2 候选卡片规则：

- 缩小卡片宽度后，因子名后方不再追加 `Refined F2`、`Raw_F2`、`分数` 等长信息。
- 因子名下一行只保留 `WNZT 4/4`。
- chip 最多展示 2 个关键裁决信号，例如 `RankIC 0.047`、`OOS/IS 0.81`、`O/T 关闭`、`P-value 0.041`。
- 分数圆点保留，但尺寸缩小到约 `32px`。

B3 建议表格规则：

- B3 外栏最小宽度提高到 `552px`。
- 表格列必须完整可见：日期、因子名、裁决、原因、操作。
- 原因列优先获得空间，因子名允许适度换行，但不能挤掉裁决和操作列。

## 工厂配置弹层

`工厂配置` 弹层改为 tab 结构。不要把配置抽屉、WNZT 证据、检疫裁决做成页面下方独立模块。

弹层大小和布局对齐参考稿：

- 参考文件：`C:\Fin\Grit_Strategy_Lab\designs\factor-phase0-f1-operator-config\factor-phase0-f1-operator-ui-preview.html`
- 宽度：`width: min(1500px, calc(100vw - 96px))`
- 高度：`max-height: calc(100vh - 72px)`，主体区 `minmax(0, 1fr)`
- 主体布局：`196px minmax(0, 1fr) 330px`
- 左侧：垂直 tab rail。
- 中间：当前 tab 内容，可滚动。
- 右侧：摘要、约束、快照引用，可滚动。
- Footer：底部固定操作区，右侧排列 `取消 / 保存草稿 / 生成配置快照`。

Tab 顺序：

1. `算子注册`
2. `治理协议`
3. `准入闸门`
4. `WNZT 证据与检疫裁决`
5. `配置快照`

### 算子注册

显示内容：

- 算子开关。
- F1 字段池。
- 窗口空间。
- depth。
- 每日公式预算。

### 治理协议

显示内容：

- WNZT 四段治理启停。
- O/T 可选配置，默认关闭。
- 每段证据字段。
- Raw_F2 治理缺失处理策略。
- `Raw_F2 -> Refined F2` 产物流说明。

### 准入闸门

显示内容：

- RankIC。
- IC_IR。
- OOS/IS。
- P-value。
- 与 S 级因子相关性。
- 拥挤度。
- 回撤。
- 容量。

### WNZT 证据与检疫裁决

这是当前设计稿展示的 active tab。

内容区三栏：

- 左 rail：配置分段摘要。
- 中央：候选表达式、WNZT 四段证据、O/T 可选配置、检疫裁决指标。
- 右侧：发布边界、阻断规则、快照引用。

候选证据卡必须展示：

- W 去极值。
- N 中性化。
- Z 标准化。
- T 平滑。
- O 正交化，默认关闭。
- T 扩展滤波，默认关闭。

裁决指标必须展示：

- RankIC。
- IC_IR。
- OOS/IS。
- P-value。
- S 级相关。
- 容量与回撤。

### 配置快照

显示内容：

- 当前草稿状态。
- 最新配置快照 ID。
- 当前 run 引用的快照 ID。
- F1 catalog snapshot。
- gate policy snapshot。
- “保存草稿不影响当前 run，生成快照后下一次自动任务引用新版本”的固定提示。

## 实现映射

推荐修改文件：

- [factor-factory-page.tsx](C:/Fin/Grit_Strategy_Lab/web/src/pages/factor-factory-page.tsx)
- [factor-phase2-pages.css](C:/Fin/Grit_Strategy_Lab/web/src/pages/factor-phase2-pages.css)
- [types.ts](C:/Fin/Grit_Strategy_Lab/web/src/types.ts)
- [demoStoreContext.tsx](C:/Fin/Grit_Strategy_Lab/web/src/lib/demoStoreContext.tsx)

现有组件可以保留：

- `FactorFactoryPage`
- `FactorFactoryConfigModal`
- `factor-phase2-hero`
- `factor-factory-status-strip`
- `factor-phase2-metrics`
- `factor-factory-workbench--b1b4`
- `factor-factory-task-card`
- `factor-factory-score-card`
- `factor-factory-result-table`

建议新增局部 class：

```css
.task-flow {}
.task-flow__row {}
.wnzt-strip {}
.wnzt-step {}
.optional-governance {}
.optional-governance__item {}
.factor-config-tabs {}
.factor-config-tab {}
.evidence-grid {}
.evidence-step {}
.decision-grid {}
.decision-card {}
```

## UI Trace Matrix 种子

| 需求 | UI 区域 | 建议选择器 | 验证 |
| --- | --- | --- | --- |
| 保持线上模块样式 | 主页面全部模块 | `.factor-phase2-*`, `.factor-factory-*` | 不引入新页面壳和新卡片体系 |
| 每日挖掘表达 F1 -> Raw_F2 | 因子任务第一张卡 | `.task-flow__row` | 三个算子族和 10,000 公式预算可见 |
| 每日治理表达 Raw_F2 -> Refined F2 | 因子任务第二张卡 | `.wnzt-strip` | W/N/Z/T 四段主干可见，O/T 可选项默认关闭 |
| 检疫结构不变 | B3 检疫建议 | `.factor-factory-result-table` | 列仍为日期、因子名、裁决、原因、操作 |
| 证据与裁决进入配置弹层 | 工厂配置 modal | `.factor-config-tabs` | `WNZT 证据与检疫裁决` tab 可见 |
| Raw_F2 不得直发 | 治理卡和裁决 tab | `.decision-card`, `.evidence-step` | 证据缺失状态不得展示可发布 |
| B2 缩窄 | B2 候选评分 | `.factor-factory-score-card` | 卡片只保留短副信息和最多两个 chip |
| B3 加宽 | B3 检疫建议 | `.factor-factory-result-row` | 五列表格完整可见，无横向裁切 |
| 配置弹层对齐 Phase 0 | 工厂配置 modal | `.factor-config-modal__body` | 三栏为 196px / 内容区 / 330px |

## 响应式要求

- `>=1280px`：保持三栏 workbench。
- `1024px-1279px`：workbench 和配置弹层主体转单列，保留所有内容。
- `<820px`：任务流、WNZT 条、O/T 配置、检疫表格转纵向卡片，禁止横向溢出。

## 开放问题

- `Refined F2` 是否作为正式产品名进入前端文案，还是仅在配置弹层中使用。
- `工厂配置` 弹层是否需要支持候选搜索，还是只展示当前选择候选的证据与裁决。
