# GSL Design System

> Status: 当前 UI 设计真源，生效日期 2026-04-01  
> Source priority: 最新截图 > 当前活跃界面与 `web/src` 实现 > `docs/GSL_UI_V1_PLAN.md`  
> Scope: `workspace`、`creation-template`、`creation-session`、`strategy-detail`、`backtest submit`、`runs-index`、`run-detail`、`snapshots`、`optimization`、`compare modal`

## 1. 设计定位

- **产品角色**：GSL 是一个桌面优先的机构级研究工作台，不是营销型 SaaS，也不是审批后台。
- **核心用户**：研究员、策略工程师、量化 PM。用户会连续查看参数、回测、快照、风险诊断和候选版本，不会只停留在单页。
- **界面性格**：冷静、准确、低噪音、有呼吸感，但不软、不飘、不像消费级产品。
- **主任务**：帮助用户判断下一步动作。界面必须始终回答“当前是什么”“为什么可信”“接下来做什么”。
- **非目标**：不追求装饰性 hero、宣传语、发光图表、玻璃拟态、厚重悬浮卡片墙。
- **文档分工**：
  - `design.md` 定义最新视觉、组件、布局和数据可视化规则。
  - `docs/GSL_UI_V1_PLAN.md` 保留 IA、旅程、状态、响应式和无障碍基线，只作为历史输入，不再定义最终视觉。

## 2. 视觉原则

- **冷灰机构风优先**：主背景使用冷灰白而不是暖米色。卡片白底、极细边框、轻阴影，整个系统像研究终端，不像展示页。
- **结构先于装饰**：信息层级、对比度、间距和截断规则优先于任何“设计感”特效。
- **卡片化，但不泡泡化**：系统允许白色卡片和分区容器，但圆角、阴影和渐变都要克制，不能变成统一圆滚滚 SaaS 模板。
- **图表服务判断**：所有 sparkline、绩效曲线、水下曲线、矩阵、滚动指标都服务于结论，不允许为装饰而发光、发霓虹、叠玻璃。
- **文字像工作台，不像宣传页**：标题直接、动词明确、状态清晰，不写营销 headline，不写口号，不写大段空泛说明。
- **桌面优先，移动只读**：研究和调优链路默认桌面完成，移动端最多看摘要、状态和只读视图。

## 3. Token 规范

### 3.1 Color

| Token | Value | Usage |
| --- | --- | --- |
| `--gsl-bg-main` | `#F0F2F5` | 全局主背景，页面冷灰底 |
| `--gsl-bg-surface` | `#FFFFFF` | 主卡、面板、模态背景 |
| `--gsl-bg-subtle` | `#F9FAFB` | 次级信息区、指标矩阵、轻提示区 |
| `--gsl-color-primary` | `#2D4E44` | 品牌色、主按钮、主趋势线、激活态文字 |
| `--gsl-color-primary-strong` | `#1A322C` | 品牌块、深色强调、hover 后的主色层 |
| `--gsl-color-primary-soft` | `#E9F2F0` | 激活导航背景、正向 badge 背景、面积图浅填充 |
| `--gsl-color-success` | `#52C41A` | 绿色状态点、就绪状态、成功提示 |
| `--gsl-color-warning` | `#EF9B3C` | 带警告完成、黄色提醒、warning badge |
| `--gsl-color-danger` | `#C45C4F` | 失败、风险提示、水下曲线边界 |
| `--gsl-color-border` | `#E5E7EB` | 默认 1px 边框 |
| `--gsl-color-border-strong` | `#D8DDE4` | hover、焦点、强调边框 |
| `--gsl-text-strong` | `#111827` | 页面标题、卡片标题、关键数字 |
| `--gsl-text-main` | `#1F2937` | 默认正文、数据标签 |
| `--gsl-text-sub` | `#6B7280` | 说明文案、日期、次级标签 |
| `--gsl-text-muted` | `#BFBFBF` | 骨架、极弱辅助文字 |
| `--gsl-color-positive` | `#CF1322` | 收益类正值、累计收益、年化收益 |
| `--gsl-viz-benchmark` | `#4C78C7` | 基准线、滚动 Sharpe 第二条线 |
| `--gsl-viz-benchmark-soft` | `#DDE8FF` | 样本外分区底色、蓝色面积提示 |
| `--gsl-viz-danger-soft` | `#FFF1F0` | 负向区域、水下曲线填充、失败背景 |
| `--gsl-viz-success-soft` | `#DDF0EE` | workspace sparkline 填充、样本内浅色带 |

### 3.2 Recommended CSS Variables

```css
:root {
  --gsl-bg-main: #f0f2f5;
  --gsl-bg-surface: #ffffff;
  --gsl-bg-subtle: #f9fafb;
  --gsl-color-primary: #2d4e44;
  --gsl-color-primary-strong: #1a322c;
  --gsl-color-primary-soft: #e9f2f0;
  --gsl-color-success: #52c41a;
  --gsl-color-warning: #ef9b3c;
  --gsl-color-danger: #c45c4f;
  --gsl-color-border: #e5e7eb;
  --gsl-color-border-strong: #d8dde4;
  --gsl-text-strong: #111827;
  --gsl-text-main: #1f2937;
  --gsl-text-sub: #6b7280;
  --gsl-text-muted: #bfbfbf;
  --gsl-color-positive: #cf1322;
  --gsl-viz-benchmark: #4c78c7;
}
```

### 3.3 Radius, Border, Shadow

| Token | Value | Usage |
| --- | --- | --- |
| `--gsl-radius-btn` | `6px` | 主次按钮 |
| `--gsl-radius-field` | `12px` | 输入框、表单字段、轻卡片 |
| `--gsl-radius-card` | `16px` | 主卡片、面板、模态 |
| `--gsl-radius-pill` | `999px` | badge、状态 pill、run kind pill |
| `--gsl-border-default` | `1px solid #E5E7EB` | 默认边框 |
| `--gsl-shadow-card` | `0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px 0 rgba(0,0,0,0.06)` | 默认卡片阴影 |
| `--gsl-shadow-hover` | `0 4px 12px rgba(0,0,0,0.06)` | hover 卡片、可点击 run card |

### 3.4 Spacing Scale

| Token | Value | Usage |
| --- | --- | --- |
| `space-1` | `4px` | 图标与文案微距 |
| `space-2` | `8px` | badge 组、紧凑内距 |
| `space-3` | `12px` | 卡片内部栅格 gap |
| `space-4` | `16px` | 默认组件内距、小节间距 |
| `space-6` | `24px` | 主卡 padding、一级组件 gap |
| `space-8` | `32px` | 页面主 padding |
| `space-10` | `40px` | workspace 主内容区与大型 hero 内距 |
| `space-12` | `48px` | 特大模块间距，仅用于长页面分节 |

### 3.5 Motion And Layering

| Token | Value | Usage |
| --- | --- | --- |
| `motion-fast` | `140ms ease` | 按钮、导航、轻交互 |
| `motion-medium` | `160ms ease` | 卡片 hover、列表卡反馈 |
| `motion-panel` | `200ms ease` | 模态、对比舱、筛选分段 |
| `layer-sticky` | `10` | sticky rail、顶部筛选带 |
| `layer-modal` | `100` | compare modal、promote note modal |

### 3.6 Breakpoints

| Range | Behavior |
| --- | --- |
| `>= 1440px` | 标准桌面，保留完整双栏与宽图表 |
| `1024px - 1439px` | 窄桌面，侧栏压缩、内容保持双栏但图表高度收紧 |
| `768px - 1023px` | 平板，creation / strategy-detail / snapshots 从双栏变上下分区 |
| `< 768px` | 只读优先，保留摘要与状态，禁止完整研究与调优操作 |

## 4. Typography 规范

### 4.1 Font Stack

- **UI / Body**：`Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif`
- **Monospace / IDs**：`"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`
- **禁止回退为默认主字体**：`IBM Plex Sans / IBM Plex Mono` 不再作为全站默认字体，只保留为原始 UI 稿历史输入。

### 4.2 Type Scale

| Role | Size / Line Height | Weight | Usage |
| --- | --- | --- | --- |
| `page-title` | `32 / 40` | `700` | 页面主标题、workspace 标题、run detail 标题 |
| `section-title` | `20 / 28` | `700` | 面板标题、模块标题 |
| `card-title` | `16 / 24` | `700` | 策略卡标题、快照卡标题、模板卡标题 |
| `body` | `14 / 22` | `400` | 默认说明文本 |
| `body-strong` | `14 / 22` | `500` | 标签、数据列正文、按钮文案 |
| `meta` | `12 / 18` | `500` | 日期、状态说明、字段来源 |
| `micro` | `11 / 16` | `600` | eyebrow、胶囊说明、图表辅助标签 |
| `metric-xl` | `24 / 28` | `600` | KPI 数值、健康度指标 |
| `run-id` | `13 / 18` | `500` | run id、snapshot id、版本号、参数 hash |

### 4.3 Typography Rules

- 页面标题、卡片标题、重要数字优先使用 `#111827`。
- 次级说明统一使用 `#6B7280`，不要混用多套灰色。
- 数字、版本号、run id、snapshot id、参数 hash 使用 monospace 或 tabular 数字。
- 中文正文不要过度压缩字距，标题可以轻微负字距，正文保持默认。
- 不使用宣传型大写英文标签，不引入“marketing hero”式粗大标题系统。

## 5. Layout 规范

### 5.1 App Shell

- Sidebar 固定 `240px`，背景纯白，右侧 1px 边框。
- Brand mark 为 `32x32` 深墨绿圆角矩形，圆角 `10px`。
- Topbar 高度 `80px`，横向 padding `32px`，背景半透明白但视觉上仍是扁平浅面，不做玻璃感。
- 主内容区默认 `32px` padding；workspace 可放宽到 `32-40px` 的视觉呼吸。
- Sidebar 激活态为 `#E9F2F0` 底，左内侧 `3px` 深墨绿提示线，不用高饱和蓝色。

### 5.2 Page Templates

| Pattern | Layout | Primary Use |
| --- | --- | --- |
| `hero + stacked panels` | 顶部 hero，下面单列或多列面板 | `workspace`、`run-detail`、`snapshots` |
| `hero + two-column workspace` | 顶部 hero，下面 `1.1fr / 0.95fr` | `creation-session`、`strategy-detail`、`backtest submit` |
| `hero + card grid` | 顶部 hero，下面模板卡阵列 | `creation-template` |
| `hero + dense table` | 顶部 hero，下面单张表格卡 | `runs-index` |
| `hero + candidate grid + modal compare` | 顶部 hero，下面候选卡与对比 modal | `optimization` |

### 5.3 Route-Level Layout Rules

- **Workspace**：健康度头卡全宽，下方固定 `2fr / 1fr`。左侧为策略看板两列卡片，右侧为最近回测单列列表。
- **Creation Template**：hero 全宽，模板卡 auto-fit 但视觉上优先呈现 `2 x 2 + 1` 的卡阵列。
- **Creation Session**：左侧对话区，右侧动态表单控制台。桌面端固定双栏，平板以下改成上下分区。
- **Strategy Detail**：上层 `1fr / 1fr`，下层 `1fr / 0.78fr`。左侧偏信息总览，右侧偏当前版本与动作。
- **Backtest Submit**：沿用 creation 的双栏模板，左侧配置，右侧预览摘要。
- **Runs Index**：hero + 单表；表格容器允许横向滚动，但整个页面不出现横向滚动。
- **Run Detail**：顶部 hero，下面 KPI strip，再下方分 tab 进入诊断、交易、证据轨迹。图表默认单列堆叠，部分诊断卡允许 `2 x 1`。
- **Snapshots**：hero + 顶部 stats + 下方 `1.1fr / 0.9fr` 双栏。
- **Optimization**：hero + candidate grid + compare modal；候选卡优先使用 auto-fit 栅格。

### 5.4 Sticky / Scroll / Truncate

- 右侧 rail 仅在桌面端 sticky，移动端取消 sticky。
- 表格只在容器内横向滚动，外层页面不横向滚动。
- `workspace recent runs` 的策略名必须单行省略号，run id 保持单行。
- compare modal 内表格允许横向滚动，不能靠强行压缩列宽解决。
- 所有 hero action cluster 允许换行，但按钮高度和圆角保持一致。

## 6. Component 规范

### 6.1 Shell

- **用途**：提供全站统一框架、导航位置和品牌识别。
- **Visual anatomy**：brand block、sidebar nav、topbar title、status pill、page shell。
- **状态**：导航只有默认、hover、active 三态；topbar status pill 只表达系统联机状态。
- **尺寸 / 间距**：sidebar item 最小高度 `48px`，topbar padding `18-32px`。
- **禁止项**：导航不加图标噪声，不做营销式插画，不做多色渐变背景。
- **当前代码映射**：`web/src/app-shell-frame.css`

### 6.2 Base Panel, Button, Badge

- **用途**：作为全站可复用视觉基础。
- **Visual anatomy**：
  - `panel/card`：白底、1px 边框、16px 圆角、24px padding、轻阴影。
  - `primary-button`：深墨绿实底、白字、`min-height: 44px`、`radius: 6px`。
  - `ghost-button`：白底细描边、深色文字。
  - `status-chip`：999px pill，用于状态、来源、类别、分组标签。
- **状态**：默认、hover、disabled；hover 只允许轻微上浮或边框增强。
- **禁止项**：主按钮不使用渐变，不做巨大块状 CTA，不做厚投影。
- **当前代码映射**：`web/src/app-shell-frame.css`

### 6.3 Workspace Family

- **用途**：承接工作台首页的健康度、策略对比与最近回测。
- **Visual anatomy**：
  - `workspace-health`：标题、说明、双按钮、四个指标块、可选 warning strip。
  - `workspace-strategy-card`：版本 pill、状态 pill、对比框、sparkline、2x2 指标矩阵、元数据、打开策略按钮。
  - `workspace-recent-runs`：状态点、monospace run id、run kind pill、策略名、日期区间、收益/Sharpe badge、相对完成时间。
- **状态**：loading、empty、error、selected for compare、compare modal open。
- **尺寸 / 间距**：策略卡 `min-width: 320px`，指标矩阵使用 `12px` gap 和 `#F9FAFB` 底。
- **禁止项**：
  - 不回到一整屏巨型健康度卡。
  - 不把 compare summary 常驻占屏。
  - 不让长策略名撑破右栏。
- **当前代码映射**：
  - `web/src/pages/workspace-page-lane-b.css`
  - `web/src/page-sections/workspace-lane-b.tsx`
  - `web/src/page-sections/workspace-recent-runs-lane-b.tsx`
  - `web/src/page-sections/workspace-recent-runs-lane-b.css`

### 6.4 Creation Family

- **用途**：承接模板选择、对话式创建、动态表单控制台和确认前检查。
- **Visual anatomy**：
  - `creation-template-card`：标题、说明、提示、宽按钮条。
  - `message-bubble`：系统/助手白底，用户浅绿底，时间戳次级显示。
  - `field-card`：字段标题、来源标签、手动编辑输入框。
  - `info-card`：待补参数、冲突说明、预览警告。
- **状态**：draft、prepare confirmation、manual override、pending input、manual conflict、busy。
- **尺寸 / 间距**：creation 双栏采用 `1.1fr / 0.95fr`；消息和字段卡内部 padding `14-16px`。
- **禁止项**：
  - 不把创建链路退化为单纯表单页。
  - 不把来源标签藏掉，必须显式区分用户输入、系统推断、系统默认。
  - 不用大块空白替代结构化摘要。
- **当前代码映射**：
  - `web/src/pages/creation-template-page.tsx`
  - `web/src/pages/creation-session-page.tsx`
  - `web/src/pages/backtest-submit-page.tsx`
  - `web/src/pages/creation-backtest.css`

### 6.5 Strategy Detail Family

- **用途**：展示策略定义、当前参数版本、最近回测和下一步动作。
- **Visual anatomy**：
  - `strategy-detail-hero`：页面标题、描述、返回、运行回测、打开优化。
  - `summary-grid`：策略类型、对象池、再平衡、快照等基础信息卡。
  - `history-card`：版本号、版本 id、备注、创建时间。
  - `action panel`：允许动作和主要 CTA。
- **状态**：有最近回测、无最近回测、有优化入口、无优化入口。
- **禁止项**：不回到旧稿那种重表格终端风，不把全部信息堆进单列大 JSON 面板。
- **当前代码映射**：
  - `web/src/pages/strategy-detail-page.tsx`
  - `web/src/pages/strategy-detail-page.css`
  - `web/src/pages/creation-backtest.css`

### 6.6 Dense Table And Compare Surface

- **用途**：用于 runs index、对比表、快照列表类高密度信息。
- **Visual anatomy**：白底容器、细分隔线、轻 hover、状态 badge、可横滚。
- **状态**：hover row、selected row、warning row、failed row。
- **尺寸 / 间距**：表头比正文更紧凑，badge 高度 `28-32px`。
- **禁止项**：不使用过厚表格边框，不用多色填满整行，不做花哨 hover 动画。
- **当前代码映射**：
  - `web/src/pages/runs-index-page.tsx`
  - `web/src/pages/runs-index-page.css`
  - workspace compare panel / optimization compare modal

### 6.7 Data Viz Components

- **用途**：提供 run detail 与 workspace 所需的图表语法。
- **Visual anatomy**：
  - `sparkline`：深墨绿折线，浅绿面积填充，永远轻量。
  - `main equity chart`：主策略线 + 基准线 + 样本外阴影区 + IS/OOS rail。
  - `drawdown chart`：红色线和浅红填充，强调风险。
  - `monthly return matrix`：正收益浅绿底与绿色字，负收益浅红底与红字，空值用 `—`。
  - `rolling metrics chart`：绿色收益线 + 蓝色 Sharpe 线。
- **状态**：empty、loading skeleton、data-ready、warning annotation。
- **颜色规则**：
  - 主策略线使用 `#2D4E44`
  - 基准线 / 第二比较线使用 `#4C78C7`
  - 样本外分区使用 `#DDE8FF`
  - drawdown 使用 `#C45C4F` + `#FFF1F0`
  - workspace strategy return 类指标用 `#CF1322`
- **禁止项**：
  - 不使用霓虹发光线
  - 不使用紫色渐变
  - 不将装饰背景叠到影响读数
- **当前代码映射**：
  - `web/src/pages/run-detail-page.tsx`
  - `web/src/pages/run-detail-page.css`
  - `web/src/page-sections/workspace-lane-b.tsx`

### 6.8 Snapshots And Recovery

- **用途**：展示数据可用性、最近刷新任务和阻塞修复入口。
- **Visual anatomy**：hero、stats grid、coverage cards、job summary、warnings/errors、repair panel。
- **状态**：ready、stale、incomplete、failed、refreshing。
- **禁止项**：不写成纯治理表格页，不隐藏阻塞原因，不把修复入口埋进底部说明文字。
- **当前代码映射**：
  - `web/src/pages/snapshots-page.tsx`
  - `web/src/pages/snapshots-page.css`
  - `web/src/pages/run-detail-page.css`

### 6.9 Compare Cockpit Modal

- **用途**：展示多策略或候选参数的并排对比。
- **Visual anatomy**：居中模态、标题区、关闭动作、横向可滚表格或并排列。
- **状态**：workspace compare、optimization compare、long-table horizontal scroll。
- **尺寸 / 间距**：modal shell 使用白底 `16px` 圆角，遮罩轻模糊。
- **禁止项**：不把 compare cockpit 变成常驻首页面板，不把表格压缩到不可读。
- **当前代码映射**：
  - `web/src/page-sections/workspace-lane-b.tsx`
  - `web/src/pages/app-shell-frame.css`
  - `web/src/page-sections/optimization-manual-lab-phase4.tsx`

### 6.10 Optimization Manual Lab

- **用途**：查看 candidate differences、手动新增候选、删掉亏损候选、晋升候选。
- **Visual anatomy**：hero、candidate grid、compare modal、promote note modal。
- **状态**：promoting、deleting、conflict message、no candidates。
- **禁止项**：不重新退化为旧稿“参数表 + Top-N 表”纯终端布局；保留卡片差异视图和 compare modal。
- **当前代码映射**：
  - `web/src/pages/manual-lab-page.tsx`
  - `web/src/page-sections/optimization-manual-lab-phase4.tsx`

## 7. 页面原型库

| Surface | Goal | Layout | Key Components | Behavior Rules |
| --- | --- | --- | --- | --- |
| `#/workspace` | 5 秒内看懂工作台现状和下一步 | 全宽健康度 + `2fr / 1fr` | health header、strategy board、recent runs、compare modal | 右栏长标题截断，compare 仅在选中 2 张及以上策略后出现 |
| `#/creation/new` | 选择创建入口，不直接进复杂配置 | hero + 模板卡阵列 | template cards、返回工作台按钮 | CTA 统一全宽或近全宽，模板卡不使用 dense table |
| `#/creation/sessions/:id` | 对话生成结构化策略稿 | `1.1fr / 0.95fr` | conversation panel、message bubbles、dynamic form console、pending/conflict cards | 桌面双栏，平板堆叠；来源标签必须可见 |
| `#/strategies/:id` | 看清策略定义、当前版本和下一步动作 | 两层双栏 | strategy summary、current version、history cards、recent run card、action panel | 无最近回测时保留空状态和回测 CTA |
| `#/strategies/:id/backtest-runs/new` | 提交正式回测前做最后检查 | `1.1fr / 0.95fr` | submit form、date fields、preview summary、warning/info cards | 先预览后提交；快照警告贴近摘要显示 |
| `#/runs` | 以时间流查看正式回测 | hero + dense table | hero、table shell、status badge | 表格可横滚，hover 行轻反馈，点击整行进入详情 |
| `#/runs/:id` | 判断 run 是否可信，并深入看收益、风险、交易、证据 | hero + KPI strip + stacked panels | KPI strip、main chart、tabs、diagnostics、trade table、audit panel | 图表优先；tab 切换不改变页面壳层；IS/OOS 语义一致 |
| `#/snapshots` | 判断当前快照是否可用并快速修复 | hero + stats + `1.1fr / 0.9fr` | stats grid、coverage cards、job panel、repair panel | 刷新动作固定可见；warning / error 分区明确 |
| `#/optimization-jobs/:id` | 评估候选参数并晋升或剔除 | hero + candidate grid + modal | candidate cards、compare modal、revision note modal | compare modal 只为候选差异服务；晋升动作必须带 note |
| `compare modal` | 横向比较策略或候选参数 | centered modal | compare columns、table shell、close button | 支持横向滚动；不作为独立路由和常驻面板 |

### 7.1 Legacy IA Mapping

- 从 `docs/GSL_UI_V1_PLAN.md` 继承并继续生效的内容：
  - 页面职责与 IA 判断
  - 关键旅程 A-D
  - empty / loading / error state
  - 桌面优先、移动只读的交互边界
  - 图表文本替代、键盘焦点、状态文字不可仅靠颜色区分
- 不再作为最新真值的内容：
  - 暖米色背景体系
  - `IBM Plex Sans / IBM Plex Mono` 默认字体
  - “少卡片，多表格与分区” 作为全站主原则
  - `我的策略 / 优化实验室` 作为一级导航真值
  - “不使用首页 KPI 卡片墙” 这类与当前 workspace 相冲突的判断

## 8. 可访问性与内容语气

### 8.1 Accessibility

- 正文和背景对比度至少 `4.5:1`。
- 所有状态 badge 除颜色外必须有明确文字。
- 图表必须附带同页文本摘要，复杂图表提供表格替代视图或摘要卡。
- 所有主要按钮、segmented tabs、筛选 chip 可触达区域不低于 `44px`。
- 所有主表格支持键盘焦点移动，当前行或当前单元必须有高可见 focus ring。
- `aria-live` 用于回测状态更新、优化进度更新和刷新任务完成反馈。
- sticky rail 在读屏顺序里不能先于上下文标题出现。

### 8.2 Content Tone

- 用语直接，不写营销文案。
- 标题尽量回答“这是什么”，按钮尽量回答“下一步做什么”。
- 错误提示贴近上下文，例如快照阻塞直接显示阻塞原因，而不是泛化成“系统异常”。
- 空状态要明确区分“还没有数据”和“当前筛选无结果”。

## 9. 现状映射与 Drift 清单

| Area | Legacy / Current Source | Current Standard | Follow-up Direction |
| --- | --- | --- | --- |
| 全局背景 | `docs/GSL_UI_V1_PLAN.md` 使用暖米色 `#F5F1E8` | 改为 `#F0F2F5` 冷灰背景 | 所有新页面与后续视觉 QA 以冷灰白体系为准 |
| 默认字体 | 旧稿指定 `IBM Plex Sans / IBM Plex Mono` | 改为 `Inter + PingFang SC + monospace ids` | 已有页面逐步移除旧终端风默认字体 |
| 卡片哲学 | 旧稿强调“少卡片，多表格” | 最新界面采用克制卡片化 | 保留 dense table 在 runs / compare 中，其他页面使用白卡分区 |
| Workspace 首页 | 旧稿反对 KPI 卡片墙 | 最新标准为窄横条健康头卡 + 策略板 + 最近回测 | 保留三段式，不回到 mosaic，但接受健康指标卡 |
| 一级 IA | 旧稿有 `我的策略`、`优化实验室` 一级导航 | 当前 runtime 无 `我的策略` 独立路由，`optimization` 以 job 页存在 | 未来若恢复策略索引页，样式遵循本设计体系，不回用旧稿视觉 |
| `runs-index-page.css` | 仍有 `28px` hero 圆角和旧 token 命名 | 标准主卡圆角 `16px` | 后续实现时收敛到统一 panel token |
| `creation-backtest.css` | 20-22px 半透明软卡和较重漂浮感 | 标准创建链路仍保留双栏和卡片，但降低软糯感 | 保留结构，减轻圆角和玻璃感 |
| `run-detail-page.css` | 现有图表颜色混合了 teal / blue / red 方案 | 本文统一主策略、基准、风险三套语义色 | 后续图表与 legend 按统一语法收敛 |
| `snapshots` 视图 | 当前实现已接近卡片化，但仍沿用 run detail 共享样式 | 快照是独立页面族 | 后续拆清快照专属 card token 和 warning panel |
| `optimization` | 当前由共享 compare/grid 样式支撑，无独立视觉说明 | 本文将其收编到全站组件体系 | 后续若扩展优化实验室，延续 candidate card + compare modal 体系 |

### 9.1 Design QA Checklist

- 有没有把暖米色、厚重投影或 IBM Plex 重新带回主界面。
- 有没有把 workspace 右栏标题撑破布局，或把 compare 入口常驻占位。
- 有没有让 run detail、snapshots、optimization 各自用一套 badge、图表和圆角。
- 有没有在 creation 链路里隐藏来源标签、冲突状态或确认前检查。
- 有没有把 dense table 误用到需要卡片化分区的页面。

