# GSL Design System

> Status: 当前运行中 UI 的视觉真源，基于 2026-04-09 本地运行页面同步  
> Capture basis: `http://127.0.0.1:4173/#/workspace` 与同批核心路由截图  
> Source priority: 2026-04-09 live captures > `web/src/*.css` / `web/src/*.tsx` > `docs/GSL_UI_V1_PLAN.md`  
> Scope: `workspace`、`creation-template`、`creation-session`、`strategy-detail`、`backtest submit`、`runs-index`、`run-detail`、`snapshots`、`optimization`

## 1. 设计定位

- **产品角色**：GSL 是桌面优先的研究工作台，服务“创建策略、发起回测、判断结果、继续调优”的连续链路。
- **当前气质**：不是偏冷硬的终端 UI，也不是消费级 SaaS，而是“浅雾灰底 + 白卡 + 青绿色强调”的研究操作台。
- **核心感受**：理性、轻盈、低噪音、可信，允许一点柔和感，但不能软塌、甜腻或营销化。
- **主任务**：每个页面都要回答三件事，当前是什么、为什么可信、下一步做什么。
- **非目标**：不做霓虹、紫色渐变、玻璃拟态首页、不做厚投影卡片墙、不做宣传型 hero。

## 2. 视觉方向

### 2.1 现行风格关键词

- **浅雾灰底**：全局背景是冷灰白，不是暖米色，也不是纯白铺满。
- **白卡为主**：主要内容放在白色面板中，使用极轻边框和淡阴影建立层级。
- **青绿色主色**：主按钮、激活导航、正向状态、主策略线统一用青绿色，不再使用更深更硬的墨绿。
- **柔和圆角**：常规面板 16-18px，创建链路与模板卡放宽到 20-28px。
- **轻渐变允许**：只允许出现在 hero 卡、创建链路和图表底板上，作用是提气，不是做秀。
- **局部悬浮允许**：compare dock、tooltip、模态允许轻微 blur 和浮层感，但不能扩散成全站玻璃风。

### 2.2 页面共性

- 顶部优先是 **page heading / hero card**，而不是裸标题。
- CTA 不追求巨大按钮，而是 1-2 个主动作 + 1-2 个辅助动作。
- 信息卡都更像“研究卡片”而不是“销售卡片”，文字短、结构明、密度稳定。
- 数据页面把色彩让给状态和趋势，装饰面积极少。

## 3. Token 基线

### 3.1 Color

| Token | Value | Usage |
| --- | --- | --- |
| `--gsl-bg-main` | `#F0F2F5` | 全局背景 |
| `--gsl-bg-surface` | `#FFFFFF` | 主卡、表格、模态背景 |
| `--gsl-bg-surface-soft` | `#FBFCFD` | hero / 特殊面板轻渐变顶色 |
| `--gsl-bg-subtle` | `#F9FAFB` | 次级容器、表头、轻提示区 |
| `--gsl-bg-accent-soft` | `#F5FBF8` | hover / 轻强调底色 |
| `--gsl-color-primary` | `#1F877B` | 主按钮、激活导航、主策略线、正向值 |
| `--gsl-color-primary-strong` | `#176B61` | hover、强强调、深色条 |
| `--gsl-color-primary-soft` | `#E6F4F1` | 激活导航底、正向 badge、轻绿色底 |
| `--gsl-color-benchmark` | `#4C78C7` | 基准线、第二比较线、OOS 辅助语义 |
| `--gsl-color-success` | `#2B8A3E` | 成功状态文字、运行正常点 |
| `--gsl-color-success-soft` | `#ECFDF3` | 成功背景 |
| `--gsl-color-warning` | `#B86813` | 警告文字、待确认状态 |
| `--gsl-color-warning-soft` | `#FFF7E8` | 警告背景 |
| `--gsl-color-danger` | `#C45C4F` | drawdown、错误、失败 |
| `--gsl-color-danger-soft` | `#FFF8F7` | 风险 / 错误背景 |
| `--gsl-color-border` | `#E5E7EB` | 默认边框 |
| `--gsl-color-border-soft` | `#EEF2F4` | 表格分隔、弱边框 |
| `--gsl-color-border-strong` | `#D7E1E5` | hover / active 边框 |
| `--gsl-text-title` | `#111827` | 标题、关键数字 |
| `--gsl-text-main` | `#1F2937` | 正文、主数据 |
| `--gsl-text-sub` | `#64748B` | 说明、次级标签 |
| `--gsl-text-muted` | `#94A3B8` | 时间、版本、弱辅助文字 |

### 3.2 颜色使用规则

- 正收益、已完成、主趋势默认走 **青绿色**，不再用旧版文档里的偏红收益色。
- 风险和 drawdown 才用 **暖红**，不要把“正值”和“风险”混成同一色相体系。
- 基准、对照、样本外辅助线统一走 **蓝色**，避免再引入第三套比较色。
- 页面主色出现频率要克制，青绿色负责“方向”和“动作”，不负责铺满页面。

### 3.3 Radius / Border / Shadow

| Layer | Value | Usage |
| --- | --- | --- |
| `radius-pill` | `999px` | 状态胶囊、tab、chips |
| `radius-field` | `12px - 14px` | 输入框、轻量按钮、子卡片 |
| `radius-panel` | `16px` | 默认 panel、表格 shell、模态 |
| `radius-card` | `18px` | workspace 卡、run-detail KPI 卡、dock |
| `radius-hero` | `24px - 28px` | 创建链路 hero、模板卡、创建标题卡 |
| `border-default` | `1px solid #E5E7EB` | 默认边框 |
| `shadow-card` | `0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px 0 rgba(0,0,0,0.06)` | 默认卡片阴影 |
| `shadow-float` | `0 16px 36px rgba(15,23,42,0.12)` | compare dock、明显浮层 |
| `shadow-soft-lift` | `0 18px 40px rgba(17,24,39,0.06)` | 模板卡、创建家族大卡 |

### 3.4 Spacing

- **基准单位**：`4px`
- **常用节奏**：`8 / 12 / 14 / 16 / 18 / 20 / 24 / 28 / 32`
- **页面主 padding**：桌面 `32px`，移动 `20px`
- **常规 panel 内边距**：`18px - 24px`
- **hero / heading card 内边距**：`24px - 28px`
- **卡片栅格 gap**：`12px - 16px`

### 3.5 Motion / Layering

| Token | Value | Usage |
| --- | --- | --- |
| `motion-fast` | `140ms ease` | hover、按钮、chip |
| `motion-medium` | `160ms ease` | 卡片 hover、导航切换 |
| `motion-overlay` | `120ms - 140ms ease` | tooltip、dock、轻浮层 |
| `hover-lift` | `translateY(-1px)` | 卡片和按钮 hover |
| `layer-dock` | `8` | workspace compare dock |
| `layer-modal` | `100` | 模态、compare cockpit |

- 默认 hover 只允许轻抬 1px，不允许夸张位移。
- blur 只允许用于 dock / tooltip / modal，不要扩展到页面主体。

## 4. Typography

### 4.1 Font Stack

- **UI / Body**：`Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif`
- **Monospace / IDs**：`"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`
- **原则**：全站不引入装饰字体，信息密度靠字重和间距，不靠换字体风格。

### 4.2 Type Scale

| Role | Size / Line Height | Weight | Usage |
| --- | --- | --- | --- |
| `page-heading` | `28 / 34` | `700` | 顶部主标题、创建页标题 |
| `hero-title` | `28 - 38 / 1.18` | `700` | run-detail / hero 大标题 |
| `section-title` | `20 / 28` | `700` | 主面板标题 |
| `card-title` | `16 / 22` | `700` | 策略卡、快照卡、候选卡标题 |
| `body` | `14 / 22` | `400` | 正文说明 |
| `body-strong` | `14 / 22` | `600` | 按钮、重点标签 |
| `meta` | `12 / 18` | `600` | 状态、日期、版本、字段来源 |
| `micro` | `11 / 16` | `600` | eyebrow、极细辅助标签 |
| `metric-xl` | `24 / 28` | `600` | KPI 数值 |
| `run-id` | `12 / 16` | `500` | run id、version id、snapshot id |

### 4.3 文字规则

- 标题保持直接，不写营销 headline。
- 次级说明统一用 `#64748B` 左右的 slate gray，不混多套灰。
- run id、snapshot id、parameter version、时间窗口标签优先 monospace。
- 不做通篇大写英文标签，也不做海报式排版。

## 5. 布局规则

### 5.1 App Shell

- Sidebar 桌面宽度 `240px`，`<1280px` 压缩到 `92px`，`<767px` 折成顶部区块。
- Sidebar 纯白底，激活态用 `#E6F4F1` + 左侧深青绿色内嵌线。
- Topbar 高度 `80px`，背景纯白，底边线清晰，不做整条玻璃感。
- 主内容区使用 `32px` padding，并统一放进 page-shell 中。

### 5.2 Route-Level Layout

| Route | Current Layout | Notes |
| --- | --- | --- |
| `#/workspace` | 健康度头卡 + `1.05fr / 0.95fr` 双栏 | 左侧 2x2 策略卡，右侧最近回测列表 |
| `#/creation/new` | heading card + 2 列模板卡 | 卡片大圆角、按钮全宽 |
| `#/creation/sessions/:id` | 标题卡 + `1.05fr / 0.95fr` 双栏 | 左对话，右 sticky 步骤/字段编辑 |
| `#/strategies/:id` | heading card + action hero + 两层双栏 | 上层摘要/版本，下层最近回测/下一步 |
| `#/strategies/:id/backtest-runs/new` | hero + 单大 panel + 3 列子卡 | 当前不是左右双栏，而是三段确认区 |
| `#/runs` | heading card + 单表格卡 | 表格密度高但边框轻 |
| `#/runs/:id` | hero + 5 KPI 卡 + `1.82fr / 340px` 主区 + tabs | 图表与判断轨是页面主体 |
| `#/snapshots` | heading card + 双列覆盖卡 | 左数据集，右 universe / repair |
| `#/optimization-jobs/:id` | heading card + job hero + 候选列表 panel | 有 compare 入口，但默认不常驻 compare 区 |

### 5.3 响应式边界

- `>= 1280px`：完整桌面布局，保留所有双栏和 rail。
- `1024px - 1279px`：侧栏压缩，workspace/run-detail 开始收紧。
- `768px - 1023px`：创建页、策略页、run-detail 改为单列堆叠。
- `< 768px`：page padding 缩到 `20px`，保留读数和主动作，不保证完整研究效率。

## 6. 组件家族

### 6.1 Shell / Heading

- 统一使用 **page heading card** 作为页面起点。
- heading 结构固定为 `eyebrow + h1 + 一句话说明`。
- CTA 放在 heading 同级或下一张 hero 卡，不塞进标题行末尾做挤压式布局。

### 6.2 Workspace Family

- **工作台健康度卡**：四个指标块 + 双 CTA，指标块本身也用轻渐变白卡。
- **策略卡**：标题、版本 / 状态 badge、sparkline、2x2 指标矩阵、底部元信息和 CTA。
- **最近回测列表**：左侧状态点，中部 run 信息，右侧状态 / 时间胶囊。
- **Compare dock**：允许轻 blur、半透明白底和更强阴影，但只在选择对比时出现。

### 6.3 Creation Family

- **模板卡**：`24px` 圆角、较高阴影、按钮全宽，是全站最柔和的一组卡片。
- **创建标题卡**：`28px` 圆角，允许轻渐变顶色。
- **消息卡**：系统消息偏浅蓝白，用户消息偏浅青绿。
- **步骤 chip**：胶囊结构，带状态点；warning 用暖橙，success 用绿。
- **字段卡**：20px 左右圆角，输入框 14px 圆角，来源标签常驻右上。

### 6.4 Strategy Detail / Backtest Submit

- **策略详情** 不是 dense table，而是摘要卡 + 当前版本卡 + 最近回测卡 + 下一步动作卡。
- **提交回测** 当前视觉是三段式确认卡，不是表单左栏 + 摘要右栏。
- 参数、快照、运行来源都走键值卡片，不堆原始 JSON。

### 6.5 Runs / Dense Table

- runs index 使用单张大表卡，表头浅灰底，hover 轻高亮。
- dense table 只在列表和 compare 内使用，不向 workspace / creation 蔓延。
- badge 高度保持紧凑，颜色轻，不做整行着色。

### 6.6 Run Detail Family

- **KPI 卡**：当前是 5 张并列卡，含主值、趋势、对照、洞察，不再是简单四格数值块。
- **主图表卡**：左大图右判断轨，图表背景轻渐变，tooltip 可轻 blur。
- **决策轨**：独立右栏，分数条 + 3 条行动判断，是页面核心语义层。
- **tab strip**：使用 pill tab，不再是硬分段器或下划线 tab。
- **诊断卡**：drawdown、月度矩阵、最差事件、滚动指标采用统一白卡 + 轻色底图。

### 6.7 Snapshots Family

- 当前快照页以 **覆盖卡 / 修复卡** 为主，不是顶部 KPI 墙。
- 不完整状态通过浅红 / 浅橙 message panel 表示，文字说明比颜色更重要。
- 时间、覆盖率、窗口、来源全部落在小卡片里，而不是写成长段落。

### 6.8 Optimization Family

- 当前优化页更像 **作业页 + 候选列表**，不是满屏 candidate grid。
- 顶部动作区维持 3 个操作按钮，下面再进入候选差异表述。
- compare 是按需能力，不是默认常驻版式。

## 7. 数据可视化语法

### 7.1 Color Semantics

- **主策略线**：`#1F877B`
- **基准线 / 第二比较线**：`#4C78C7`
- **主策略面积填充**：`rgba(31, 135, 123, 0.12)`
- **drawdown 线 / 面积**：`rgba(196, 92, 79, 0.9)` / `rgba(196, 92, 79, 0.14)`
- **月度矩阵正负色**：正值浅绿，负值浅红，空值灰
- **判断轨分数条**：`#176B61 -> #1F877B` 水平渐变

### 7.2 图表规则

- 图表永远服务于判断，不允许炫技动画和发光描边。
- benchmark 只能是蓝色虚线，不要每页重新发明基准样式。
- tooltip 可以浮，但信息必须短，优先日期、策略值、基准值、阶段。
- OOS / benchmark / risk 的语义要在 workspace、run-detail、snapshots 中保持一致。

## 8. 可访问性与内容语气

### 8.1 Accessibility

- 正文与背景对比度至少 `4.5:1`。
- 所有状态胶囊除了颜色都必须有文字。
- 主要按钮、输入框、tab、chip 点击热区不低于 `44px`。
- 表格、诊断切换、run-detail tabs 需要清晰 focus ring。
- 图表必须有文字摘要或判断轨，不靠图像单独表达结论。

### 8.2 Content Tone

- 标题回答“这是什么”，按钮回答“下一步做什么”。
- 说明文字以操作和判断为主，不写口号。
- 错误 / 阻塞要贴近上下文写清楚原因，例如快照不完整、公司行为缺口、历史锚点未修复。

## 9. 2026-04-09 Drift Cleanup

这次同步，文档从“上一轮偏冷硬的设计判断”收敛到当前真实 UI：

| Area | Previous Doc | Current Truth |
| --- | --- | --- |
| 主色 | `#2D4E44` 深墨绿 | `#1F877B` 青绿色 |
| 主基调 | 冷灰机构终端，更硬 | 浅雾灰研究工作台，更柔和 |
| 正收益颜色 | 偏红收益语义 | 青绿 / 绿色正值 |
| workspace 主布局 | `2fr / 1fr` | 接近 `1.05fr / 0.95fr` |
| backtest submit | 左配置右摘要 | 单大 panel 内三段确认卡 |
| snapshots | hero + stats + 双栏 | heading + 覆盖卡 / 修复卡双栏 |
| optimization | 候选 grid 优先 | 作业头卡 + 候选列表 panel |
| 创建链路 | 应去掉软糯感 | 当前保留 20-28px 圆角与轻渐变 |
| 浮层态度 | 不做任何玻璃感 | 允许 compare dock / tooltip 局部 blur |

## 10. 实现映射

| Surface | Primary Files |
| --- | --- |
| app shell | `web/src/app-shell-frame.css` |
| workspace | `web/src/pages/workspace-page-lane-b.css`, `web/src/page-sections/workspace-lane-b.tsx`, `web/src/page-sections/workspace-recent-runs-lane-b.css` |
| creation | `web/src/pages/creation-backtest.css`, `web/src/pages/creation-template-page.tsx`, `web/src/pages/creation-session-page.tsx` |
| strategy detail | `web/src/pages/strategy-detail-page.css`, `web/src/pages/strategy-detail-page.tsx` |
| backtest submit | `web/src/pages/backtest-submit-page-cn.tsx`, `web/src/pages/creation-backtest.css` |
| runs index | `web/src/pages/runs-index-page.css`, `web/src/pages/runs-index-page.tsx` |
| run detail | `web/src/pages/run-detail-page.css`, `web/src/pages/run-detail-page.tsx` |
| snapshots | `web/src/pages/snapshots-page.css`, `web/src/pages/snapshots-page.tsx` |
| optimization | `web/src/page-sections/optimization-manual-lab-phase4.tsx`, `web/src/pages/manual-lab-page.tsx` |

## 11. Design QA Checklist

- 有没有把主色重新拉回更深更硬的旧墨绿，而不是当前青绿色。
- 有没有把正收益重新画成红色，导致与风险语义冲突。
- 有没有把创建链路的 20-28px 柔和圆角粗暴压回 16px。
- 有没有把 workspace 和 run-detail 的白卡 + 雾灰底改成满屏纯白。
- 有没有把 compare dock、tooltip 的局部浮层感扩散成全站玻璃风。
- 有没有让 backtest submit、snapshots、optimization 回到旧版不符合现状的布局判断。
