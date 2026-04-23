# 回测详情页布局调研与 3 版优化方案

## 1. 现状判断

当前 `run-detail` 页已经具备不错的数据骨架:

- 顶部有 hero、状态标签和动作按钮。
- 中段有 KPI、主绩效曲线、回撤、月度矩阵、rolling 指标。
- 下段把成交明细和证据轨迹作为次级分析区，默认折叠。

但从“研究工作台”角度看，它还有 3 个明显问题:

1. 首屏缺少一句话结论。
   用户能看到很多数字，但还看不到“这次回测值不值得继续相信，下一步该做什么”。
2. 信息分区还是偏长页。
   设计真源要求 `KPI strip + tabs`，但当前实现仍是“诊断全展开 + 交易/证据折叠”，进入成本偏高。
3. OOS / benchmark / 证据链没有形成清晰的阅读层级。
   图表和表格都有，但“可信度判断”没有被显式组织出来。

## 2. 行业调研摘要

### TradingView

- 官方把 Strategy Tester 分成 `Overview`、`Performance Summary`、`List of Trades`、`Properties` 四个标签页。
- `Overview` 用一张总览图把 `Equity`、`Drawdown`、`Buy & hold equity` 放在一起，适合先扫结论。
- `List of Trades` 再单独承接逐笔明细。

对 GSL 的启发:

- 回测详情页不该一开始就把所有模块摊开。
- “总览”和“逐笔”必须分层。
- 参数 / 属性应该是附属页，不该和主诊断抢首屏。

### QuantConnect

- 官方 Backtest Report 把 `Key Statistics` 放在最上面。
- 后面连续展示 `Returns per Trade`、`Daily Returns`、`Monthly Returns`、`Annual Returns`、`Cumulative Returns`。
- 这是典型的“研究报告流”，适合认真复盘和导出分享。

对 GSL 的启发:

- 顶部必须先给结论型指标。
- 曲线不只是一张主收益图，最好组织成有顺序的诊断画廊。
- 月度热力图和 rolling 指标非常适合做第二层诊断，而不是压在首屏最顶。

### RiceQuant / JoinQuant

- RiceQuant 官方文档明确把“策略编辑页”与“完整回测结果页”拆开，结果页承接 `仓位、盈亏、交易、风险`。
- JoinQuant 官方文档显示，性能分析是回测结果页中的附加能力，而不是默认首屏核心。

对 GSL 的启发:

- 回测详情页要服务“运行后判断”，不是继续承担参数录入职能。
- 交易、持仓、性能分析都很重要，但阅读顺序必须让位于“先判断，再下钻”。
- 深度能力应该进 tab 或次级 panel，不要直接压首屏。

## 3. 行业共性结论

主流回测网站在布局上基本都遵循 4 条线:

1. 首屏先给 verdict，不先给明细。
2. 明细通过 tab、二级页或折叠面板承接。
3. benchmark / drawdown / OOS 是最重要的三类对照信息。
4. rerun、clone、optimize、export 这类动作始终离结果很近。

这和 GSL `design.md` 里的定位完全一致: 回测详情页应该回答“当前是什么”“为什么可信”“接下来做什么”，而不是做一张长报表。

## 4. 三版优化方案

---

## 方案 A: 决策驾驶舱版

### 适用场景

最适合 GSL 当前定位。给研究员、策略工程师、量化 PM 用，首屏 10 秒内看懂“是否值得继续”。

### 布局结构

```text
[Hero: 策略名 / run 状态 / run 元数据 / 主动作]
[Verdict Strip: 是否通过 / OOS 状态 / 相对基准 / 下一步建议]
[KPI x 6]

[主绩效曲线 2/3] [决策侧栏 1/3]
                 - OOS 起点
                 - benchmark 差值
                 - 最大回撤状态
                 - 推荐动作

[Tabs]
  诊断 Diagnostics
  成交 Trades
  证据 Evidence
  配置 Properties
```

### 诊断页内容

```text
诊断 tab:
[回撤曲线] [Top drawdown 事件]
[月度矩阵] [Rolling return / Sharpe]
[一句话风险点评]
```

### 核心改动

- 在 hero 下新增 `Verdict Strip`，直接给出 `通过/观察/拒绝` 之类的结论。
- 把当前“交易明细”“证据轨迹”从长页折叠块升级为真正 tab。
- 在主曲线右侧增加 sticky 决策侧栏，不再让 action 只停留在 hero 右上角。
- 显式标出 OOS 起点和 benchmark 差值，让“可信度”不是靠用户自己脑补。

### 借鉴对象

- TradingView 的 tab 分层
- RiceQuant / JoinQuant 的结果页角色定义
- GSL 自身 `research workbench` 定位

### 评价

这是最平衡的一版。既不把页面做成报告，也不把证据链埋掉。

---

## 方案 B: 研究报告版

### 适用场景

适合“复盘、评审、汇报”场景。更像 QuantConnect 的 report，适合长时间阅读和截图分享。

### 布局结构

```text
[Hero: 策略名 / 状态 / 时间区间 / 导出与复跑]
[Key Statistics]

[章节 1: 主绩效曲线]
[章节 2: 回撤与极端事件]
[章节 3: 月度收益矩阵]
[章节 4: Rolling 指标]
[章节 5: 交易分布 / 逐笔明细]
[章节 6: 证据附录 / 参数 / 环境]
```

### 核心改动

- 整页改成纵向叙事，不强调 tab，而强调阅读顺序。
- 每个章节顶部都有一句“这张图说明什么”。
- 交易明细和证据链移到更后面，作为附录阅读。
- 可以天然支持导出 PDF 或分享报告。

### 借鉴对象

- QuantConnect 的 `Key Statistics + returns gallery`
- 机构研究报告的阅读流

### 评价

可读性强，适合 review，但不如方案 A 高效。对日常高频看 run 的用户来说略慢。

---

## 方案 C: 证据审计版

### 适用场景

适合“为什么这次结果不可信”“为什么 OOS 失真”“这笔交易到底怎么成交”的排障与审计场景。

### 布局结构

```text
[Hero: run 摘要 + 风险结论 + 审计入口]
[KPI strip]

[左主栏 1.5fr]
  - 主绩效曲线
  - 回撤事件时间线
  - 逐笔交易流

[右侧 sticky rail 1fr]
  - 当前选中交易证据卡
  - 参数快照
  - 数据快照
  - 环境摘要
  - 滑点 / 触发条件
```

### 核心改动

- 不再把证据轨迹放到底部折叠区，而是升格为右侧常驻 rail。
- 左边看“结果怎么发生”，右边看“为什么会发生”。
- 选中一笔交易时，主图、事件卡、证据卡联动。
- 更适合排查 OOS 崩坏、滑点异常、成交逻辑问题。

### 借鉴对象

- TradingView 的 trade-to-chart 对位思路
- QuantConnect 的深入分析气质
- GSL 当前已有的 `trade audit + snapshot` 能力

### 评价

专业感最强，但日常浏览门槛也最高。更像“审计工作台”，不是“默认回测详情页”。

## 5. 推荐结论

### 推荐主线: 方案 A

原因很简单:

- 最符合 GSL 在 `design.md` 里定义的“研究工作台”定位。
- 最接近当前代码结构，改造成本可控。
- 能把“先判断，再下钻”真正落到布局上。

### 推荐组合

最稳的做法不是三选一，而是:

1. 默认详情页用方案 A。
2. 在方案 A 的 `Evidence` tab 里吸收方案 C 的证据卡思路。
3. 未来如果有导出 / 分享诉求，再把方案 B 发展成“报告视图”。

## 6. 建议的下一步落地顺序

1. 先把当前页改成真实 tab 结构，替换现在的长页折叠块。
2. 在 hero 下补 `Verdict Strip`，明确 OOS、benchmark、最大回撤、下一步建议。
3. 在主曲线中显式加入 OOS 分区和 benchmark 对照强化。
4. 把 `Properties / 参数快照 / 环境摘要` 从主阅读流再后移一级。
5. 如果你决定走方案 A，我下一步可以直接给出低保真线框图，或者直接改 `run-detail-page.tsx` / `run-detail-diagnostics.tsx` 做第一版落地。

## 7. 参考来源

- TradingView Strategy Tester 文档: https://www.tradingview.com/pine-script-docs/v5/concepts/strategies/
- TradingView 导出策略数据文档: https://www.tradingview.com/support/solutions/43000613680-how-to-export-strategy-data/
- QuantConnect Backtest Report 文档: https://www.quantconnect.com/docs/v2/cloud-platform/backtesting/report
- RiceQuant 回测文档: https://www.ricequant.com/doc/quant/backtest.html
- JoinQuant API / 回测结果页性能分析文档: https://cdn.joinquant.com/help/img/JoinQuantAPI.pdf
