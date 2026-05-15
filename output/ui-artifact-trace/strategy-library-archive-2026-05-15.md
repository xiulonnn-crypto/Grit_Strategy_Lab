# 策略库归档 UI Trace Matrix

- 设计来源: 用户指定 `#/strategies` 策略库列表改动；以现有 `DESIGN.md` 的二次确认与逻辑删除规则为约束。
- 验收路由: `http://127.0.0.1:4173/?v=strategy-archive-live-1778824866019#/strategies`。
- 页面模块: 策略库表格、10Y/20Y/30Y 长期指标列、操作列、归档校验 toast、归档二次确认弹窗。
- 选择器/文件映射: `web/src/pages/creation-template-page.tsx` 负责行模型、指标格式、归档交互；`web/src/pages/creation-backtest.css` 负责归档弹窗与移动端布局；`src/grit_backtest_platform/_service_rebuilt.py` 负责 `/strategies/{id}/archive-preview` 与 `/strategies/{id}/archive`。
- 文案与状态映射: 10Y 表头为 `10Y年化收益/夏普/回撤`，20Y/30Y 表头保留 `年化收益/夏普`；操作列只保留 `查看`、`归档`；二次确认说明归档是隐藏/逻辑删除，不物理清库。
- 数据映射: 10Y 值读取 `annualized_return + sharpe + max_drawdown`；20Y/30Y 只渲染 `annualized_return + sharpe`；归档 preview 返回策略腿引用数、待逻辑删除回测数、待逻辑删除优化数。
- 交互映射: 点击 `归档` 先调用引用校验；引用数大于 0 只显示阻断 toast；引用数为 0 时打开二次确认；确认后调用归档 API 并刷新策略库。
- 响应式验收: 桌面 1440x1100 与移动端 390x844 均已截图；移动端归档弹窗无横向溢出，按钮纵向排列。
- 已批准偏差: 未在 live 验收中点击最终 `确认归档`，避免修改本机真实策略数据；级联逻辑删除由 pytest 与前端单测覆盖。
- 证据: `output/ui-artifact-trace/strategy-library-archive-20260515.png`、`output/ui-artifact-trace/strategy-library-archive-mobile-20260515.png`。
