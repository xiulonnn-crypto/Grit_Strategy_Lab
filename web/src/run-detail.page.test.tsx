import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunDetailPage } from './pages/run-detail-page';
import type {
  ApiBacktestRunDetail,
  ApiBacktestRunTradeAudit,
  ApiBacktestRunTradePage,
} from './types';

const fakeApi = vi.hoisted(() => ({
  getBacktestRunDetail: vi.fn(),
  saveBacktestRun: vi.fn(),
  getBacktestTradeAudit: vi.fn(),
  getBacktestRunTrades: vi.fn(),
  createOptimizationJob: vi.fn(),
})) as {
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
  saveBacktestRun: ReturnType<typeof vi.fn>;
  getBacktestTradeAudit: ReturnType<typeof vi.fn>;
  getBacktestRunTrades: ReturnType<typeof vi.fn>;
  createOptimizationJob: ReturnType<typeof vi.fn>;
};

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const detail: ApiBacktestRunDetail = {
  id: 'bt-9.6802970000',
  strategy_id: 'strat-001',
  strategy_name: '美股质量动量',
  status: 'COMPLETED',
  request: {
    benchmark_id: 'SPY',
    rebalance: 'monthly',
  },
  metrics: { total_return: 2.323, sharpe: 0.85, max_drawdown: -0.249 },
  chart_series: [
    { trade_date: '2024-03-21', equity: 100, benchmark: 100, drawdown: 0, is_oos: false },
    { trade_date: '2025-03-24', equity: 170.3, benchmark: 132.1, drawdown: -8.2, is_oos: false },
    { trade_date: '2026-03-24', equity: 332.3, benchmark: 142.4, drawdown: -24.9, is_oos: true },
  ],
  monthly_returns: [
    { month: '2024-03', return_pct: 0.8, segment: 'IS' },
    { month: '2025-03', return_pct: 4.2, segment: 'IS' },
    { month: '2026-03', return_pct: 1.1, segment: 'OOS' },
  ],
  drawdown_events: [
    { start_date: '2025-12-27', trough_date: '2026-03-18', drawdown_pct: -24.9, recovery_date: null, status: 'open', segment: 'OOS' },
    { start_date: '2025-02-19', trough_date: '2025-03-16', drawdown_pct: -14.3, recovery_date: '2025-06-09', status: 'closed', segment: 'IS' },
  ],
  rolling_metrics: [
    { trade_date: '2026-03-20', trailing_252_return: 13.8, trailing_252_sharpe: 1.02 },
    { trade_date: '2026-03-24', trailing_252_return: 17.1, trailing_252_sharpe: 0.81 },
  ],
  snapshot_summary: {
    dataset_snapshot_id: 'ds-001',
    universe_snapshot_id: 'un-001',
    execution_policy: 'T_CLOSE_TO_T1_OPEN',
  },
  parameter_snapshot: {
    strategy_type: 'quality_momentum',
    objective: '美股质量动量',
  },
  environment_summary: {
    runtime: 'local',
    mode: 'production',
    symbols: ['AAPL', 'AMZN', 'MSFT', 'NVDA', 'META', 'GOOGL', 'TSLA', 'AVGO', 'BRK-B', 'JPM', 'LLY', 'COST'],
  },
  data_segment_type: 'FULL',
  parameter_version_id: 'v2',
  oos_start_date: '2024-03-21',
  is_permanent: true,
  trades_count: 222,
  analysis: {
    subtitle: '测试集仍为正收益，但回撤修复仍需观察。',
    kpi_cards: [
      {
        key: 'total_return',
        label: '总收益',
        primary_text: '+232.3%',
        trend_direction: 'up',
        trend_text: '↑ 90.0%',
        compare_text: '基准: +142.4% | 差值: +89.9%',
        insight_text: '收益仍显著跑赢基准，建议继续检查 Beta 暴露。',
        insight_tone: 'positive',
        state: 'healthy',
      },
      {
        key: 'sharpe',
        label: '夏普比率',
        primary_text: '0.85',
        trend_direction: 'up',
        trend_text: '↑ 0.23',
        compare_text: '基准: 0.62 | 差值: +0.23',
        insight_text: '风险回报尚可，建议进一步压缩尾部波动。',
        insight_tone: 'positive',
        state: 'healthy',
      },
      {
        key: 'max_drawdown',
        label: '最大回撤',
        primary_text: '-24.9%',
        trend_direction: 'down',
        trend_text: '↓ 4.8%',
        compare_text: '基准: -29.7% | 差值: +4.8%',
        insight_text: '回撤仍偏深，建议复核止损与仓位节奏。',
        insight_tone: 'warning',
        state: 'watch',
      },
      {
        key: 'rolling_252_return',
        label: '最新 252 日滚动收益',
        primary_text: '+17.1%',
        trend_direction: 'flat',
        trend_text: 'Sharpe 0.81',
        compare_text: '基准: +11.6% | 差值: +5.5%',
        insight_text: '最近窗口仍领先，但测试集稳定性还需继续观察。',
        insight_tone: 'neutral',
        state: 'watch',
      },
      {
        key: 'trade_count',
        label: '交易数',
        primary_text: '222',
        trend_direction: 'down',
        trend_text: '测试集 1 笔',
        compare_text: '训练集 1 | 测试集 1',
        insight_text: '测试集样本偏少，警惕随机性造成的过拟合。',
        insight_tone: 'warning',
        state: 'watch',
      },
    ],
    decision_rail: {
      score: 67,
      summary: '测试集维持正收益，但回撤修复速度偏慢。',
      items: [
        {
          key: 'result',
          title: '结果判断',
          body: '测试集仍跑赢基准，方向暂未失真。',
          tone: 'positive',
        },
        {
          key: 'risk',
          title: '风险判断',
          body: '最近一段回撤恢复偏慢，需要核查仓位与退出规则。',
          tone: 'warning',
        },
        {
          key: 'next',
          title: '下一步动作',
          body: '优先查看测试集交易证据，再决定是否进入下一轮调参。',
          tone: 'neutral',
        },
      ],
    },
  },
  trade_audit_items: [
    {
      trade_id: 'trade-001',
      symbol: 'QQQ',
      segment: 'IS',
      opened_at: '2026-03-23T09:30:00Z',
      closed_at: '2026-03-23T16:00:00Z',
      pnl_pct: 3.2,
      max_favorable_excursion_pct: 4.1,
      max_adverse_excursion_pct: -0.7,
      slippage_cost_pct: 0.18,
      commentary: '均线回归继续围绕基线展开。',
    },
    {
      trade_id: 'trade-002',
      symbol: 'AAPL',
      segment: 'OOS',
      opened_at: '2026-03-24T09:30:00Z',
      closed_at: '2026-03-24T16:00:00Z',
      pnl_pct: -1.4,
      max_favorable_excursion_pct: 0.8,
      max_adverse_excursion_pct: -2.4,
      slippage_cost_pct: 0.22,
      commentary: '样本外回撤略高，但仍保持在阈值范围内。',
    },
  ],
};

const auditOne: ApiBacktestRunTradeAudit = {
  trade_id: 'trade-001',
  symbol: 'QQQ',
  segment: 'IS',
  opened_at: '2026-03-23T09:30:00Z',
  closed_at: '2026-03-23T16:00:00Z',
  pnl_pct: 3.2,
  max_favorable_excursion_pct: 4.1,
  max_adverse_excursion_pct: -0.7,
  slippage_cost_pct: 0.18,
  commentary: '均线回归继续围绕基线展开。',
  price_series: [
    { date: '2026-03-23', open: 590, high: 594, low: 588, close: 593, adj_close: 593, volume: 1_000_000 },
  ],
  trigger_snapshot: {
    execution_policy: 'T_CLOSE_TO_T1_OPEN',
    signal: 'mean_reversion',
    threshold: 2,
  },
  risk_evaluation: {
    max_favorable_excursion_pct: 4.1,
    max_adverse_excursion_pct: -0.7,
    mfe_mae_ratio: 5.86,
    slippage_cost_pct: 0.18,
    commentary: '均线回归继续围绕基线展开。',
  },
  entry_marker: { date: '2026-03-23', price: 591 },
  exit_marker: { date: '2026-03-23', price: 593 },
  chart_band: {
    start_date: '2026-03-23T09:30:00Z',
    end_date: '2026-03-23T16:00:00Z',
    color: 'green',
    pnl_pct: 3.2,
  },
};

const auditTwo: ApiBacktestRunTradeAudit = {
  ...auditOne,
  trade_id: 'trade-002',
  symbol: 'AAPL',
  segment: 'OOS',
  pnl_pct: -1.4,
  commentary: '样本外回撤略高，但仍保持在阈值范围内。',
  chart_band: {
    start_date: '2026-03-24T09:30:00Z',
    end_date: '2026-03-24T16:00:00Z',
    color: 'red',
    pnl_pct: -1.4,
  },
};

const trades: ApiBacktestRunTradePage = {
  items: [
    {
      trade_time: '2026-03-23T09:30:00Z',
      symbol: 'QQQ',
      side: 'BUY',
      quantity: 8,
      price: 591,
      net_amount: 4728,
      pnl_contribution: 3.2,
      segment: 'IS',
    },
    {
      trade_time: '2026-03-24T09:30:00Z',
      symbol: 'AAPL',
      side: 'SELL',
      quantity: 5,
      price: 189,
      net_amount: 945,
      pnl_amount: -67,
      pnl_contribution: -1.4,
      segment: 'OOS',
    },
  ],
  page: 1,
  page_size: 12,
  total: 2,
  total_pages: 1,
};

const legacyTradeEvents: ApiBacktestRunTradePage = {
  items: [
    {
      trade_date: '2016-03-24',
      symbol: 'SPY',
      action: 'buy',
      price: 202,
      weight_before: 0,
      weight_after: 0.2,
      reason: 'grid:init',
      segment: 'IS',
    },
  ],
  page: 1,
  page_size: 12,
  total: 1,
};

beforeEach(() => {
  fakeApi.getBacktestRunDetail.mockReset();
  fakeApi.saveBacktestRun.mockReset();
  fakeApi.getBacktestTradeAudit.mockReset();
  fakeApi.getBacktestRunTrades.mockReset();
  fakeApi.createOptimizationJob.mockReset();
  fakeApi.saveBacktestRun.mockResolvedValue({
    ...detail,
    is_permanent: true,
  });
  fakeApi.createOptimizationJob.mockResolvedValue({ id: 'opt-001' });
  vi.stubGlobal('confirm', vi.fn(() => true));
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('RunDetailPage', () => {
  it('renders diagnostics by default and switches between trades, evidence, and properties tabs', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);
    fakeApi.getBacktestRunTrades.mockResolvedValue(trades);
    fakeApi.getBacktestTradeAudit.mockImplementation(async (_runId: string, tradeId: string) =>
      tradeId === 'trade-001' ? auditOne : auditTwo,
    );

    const { container } = render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(screen.getByText('业绩曲线')).toBeInTheDocument();
    const curveCard = container.querySelector('.run-detail-curve-card--overview');
    expect(curveCard?.textContent).not.toContain('测试集仍为正收益，但回撤修复仍需观察。');
    expect(screen.queryByText(/参数版本/, { selector: '.run-detail-hero__tag' })).not.toBeInTheDocument();
    expect(screen.queryByText(/测试集起点/, { selector: '.run-detail-hero__tag' })).not.toBeInTheDocument();
    expect(screen.queryByText(/回测区间/, { selector: '.run-detail-hero__tag' })).not.toBeInTheDocument();
    expect(screen.queryByText(/来源/, { selector: '.run-detail-hero__tag' })).not.toBeInTheDocument();
    expect(screen.getAllByText('+232.3%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('基准值').length).toBeGreaterThan(0);
    expect(screen.getAllByText('训练集').length).toBeGreaterThan(0);
    expect(screen.getAllByText('测试集').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '总收益 指标说明' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最新 252 日滚动收益 指标说明' })).toBeInTheDocument();
    const rollingCard = screen.getByText('最新 252 日滚动收益').closest('.run-detail-kpi-card');
    const rollingCompare = rollingCard?.querySelector('.run-detail-kpi-card__compare');
    expect(rollingCompare?.textContent).toContain('基准值');
    expect(rollingCompare?.textContent).not.toContain('训练集');
    expect(rollingCompare?.textContent).not.toContain('测试集');
    const tradeCountCard = screen.getByText('交易数').closest('.run-detail-kpi-card');
    const tradeCountCompare = tradeCountCard?.querySelector('.run-detail-kpi-card__compare');
    expect(tradeCountCompare?.textContent).not.toContain('基准值');
    expect(tradeCountCard?.textContent).not.toContain('测试集 1 笔');
    expect(screen.getByRole('tab', { name: '诊断', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '交易' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '证据' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '配置' })).toBeInTheDocument();
    expect(screen.getByText('回撤曲线')).toBeInTheDocument();
    expect(fakeApi.getBacktestRunTrades).not.toHaveBeenCalled();
    expect(fakeApi.getBacktestTradeAudit).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: '全部' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '最近1年' }).length).toBeGreaterThan(0);
    expect(screen.getByText('最低 -24.9%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '交易' }));
    expect(screen.getByRole('tablist', { name: '成交区段' })).toBeInTheDocument();
    await waitFor(() =>
      expect(fakeApi.getBacktestRunTrades).toHaveBeenCalledWith('bt-9.6802970000', {
        page: 1,
        page_size: 12,
        segment: 'all',
      }),
    );
    expect(screen.getAllByText('QQQ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0);
    expect(screen.getByText('-US$67')).toBeInTheDocument();
    expect(screen.getByText('-1.4%')).toBeInTheDocument();
    expect(screen.getByText('AAPL').closest('tr')?.textContent).toContain('测试集');

    fireEvent.click(screen.getByRole('tab', { name: '证据' }));
    expect(await screen.findByText('QQQ 证据卡')).toBeInTheDocument();
    await waitFor(() =>
      expect(fakeApi.getBacktestTradeAudit).toHaveBeenCalledWith('bt-9.6802970000', 'trade-001'),
    );
    expect(screen.getAllByText('数据快照摘要').length).toBeGreaterThan(0);
    expect(screen.getAllByText('参数快照').length).toBeGreaterThan(0);
    expect(screen.getAllByText('环境摘要').length).toBeGreaterThan(0);
    expect(screen.getAllByText('执行策略').length).toBeGreaterThan(0);
    expect(screen.getAllByText('T日收盘信号，T+1开盘成交').length).toBeGreaterThan(0);
    expect(screen.getAllByText('运行环境').length).toBeGreaterThan(0);
    expect(screen.getAllByText('本地').length).toBeGreaterThan(0);
    expect(screen.getAllByText('运行模式').length).toBeGreaterThan(0);
    expect(screen.getAllByText('生产').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AAPL, AMZN, MSFT, NVDA, META, GOOGL, TSLA, AVGO, BRK-B, JPM ...').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: '配置' }));
    expect(await screen.findByText('基准标的')).toBeInTheDocument();
    expect(screen.getByText('SPY')).toBeInTheDocument();
    expect(screen.getByText('再平衡')).toBeInTheDocument();
    expect(screen.getByText('每月')).toBeInTheDocument();
    expect(screen.getByText('策略类型')).toBeInTheDocument();
    expect(screen.getByText('质量动量')).toBeInTheDocument();
    expect(screen.getAllByText('参数快照').length).toBeGreaterThan(0);
    expect(screen.getAllByText('数据快照摘要').length).toBeGreaterThan(0);
    expect(screen.getAllByText('环境摘要').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AAPL, AMZN, MSFT, NVDA, META, GOOGL, TSLA, AVGO, BRK-B, JPM ...').length).toBeGreaterThan(0);
  });

  it('shows a month tooltip when hovering the monthly return heatmap', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);

    const { container } = render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    const heatCell = container.querySelector('.run-detail-heat-cell:not(.run-detail-heat-cell--empty)') as HTMLButtonElement | null;
    expect(heatCell).toBeTruthy();

    fireEvent.mouseEnter(heatCell!, { clientX: 120, clientY: 160 });

    expect(screen.getByText('2024年3月')).toBeInTheDocument();
    expect(container.querySelector('.run-detail-heatmap-tooltip span')?.textContent).toBe('+0.8%');
  });

  it('renders rolling return and sharpe from generic rolling metric fields when trailing fields are absent', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      rolling_metrics: [
        { trade_date: '2026-03-20', window_days: 252, window_return_pct: 13.8, window_sharpe: 1.02 },
        { trade_date: '2026-03-24', window_days: 252, window_return_pct: 17.1, window_sharpe: 0.81 },
      ],
    } satisfies ApiBacktestRunDetail);

    const { container } = render(<RunDetailPage runId="bt-rolling-generic-fields" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    const note = container.querySelector('.run-detail-diagnostics-note');
    expect(note?.textContent).toContain('收益 +17.1%');
    expect(note?.textContent).toContain('夏普 0.81');
  });

  it('keeps drawdown values in percentage-point units on the diagnostics chart', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      chart_series: [
        { trade_date: '2026-03-22', equity: 101, benchmark: 100, drawdown: -0.2, is_oos: false },
        { trade_date: '2026-03-23', equity: 100, benchmark: 100, drawdown: -1, is_oos: false },
        { trade_date: '2026-03-24', equity: 102, benchmark: 100, drawdown: -0.4, is_oos: true },
      ],
    } satisfies ApiBacktestRunDetail);

    render(<RunDetailPage runId="bt-drawdown-percent-points" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(screen.getByText('最低 -1.0%')).toBeInTheDocument();
    expect(screen.queryByText('最低 -100.0%')).not.toBeInTheDocument();
  });

  it('renders trade rows from legacy action-based payloads without crashing the trades tab', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      chart_series: [
        { trade_date: '2016-03-24', equity: 10000, benchmark: 100, drawdown: 0, is_oos: false },
        { trade_date: '2016-03-25', equity: 10100, benchmark: 101, drawdown: 0, is_oos: false },
      ],
    });
    fakeApi.getBacktestRunTrades.mockResolvedValue(legacyTradeEvents);

    render(<RunDetailPage runId="bt-legacy-trades" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '交易' }));

    expect(await screen.findByText('SPY')).toBeInTheDocument();
    expect(screen.getByText('买入')).toBeInTheDocument();
    expect(screen.getAllByText('20160324').length).toBeGreaterThan(0);
    expect(screen.getByText('9.90')).toBeInTheDocument();
    expect(screen.getByText(/2,000/)).toBeInTheDocument();
  });

  it('renders strategy and benchmark curves on a shared normalized scale', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      chart_series: [
        { trade_date: '2024-03-21', equity: 100000, benchmark: 100, drawdown: 0, is_oos: false },
        { trade_date: '2025-03-24', equity: 110000, benchmark: 150, drawdown: -8.2, is_oos: false },
        { trade_date: '2026-03-24', equity: 105000, benchmark: 125, drawdown: -24.9, is_oos: true },
      ],
    });

    const { container } = render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    const equityPath = container.querySelector('.run-detail-equity-path');
    const benchmarkPath = container.querySelector('.run-detail-benchmark-path');
    const axisLabels = container.querySelectorAll('.run-detail-chart-axis-label');

    expect(equityPath?.getAttribute('d')).toBeTruthy();
    expect(benchmarkPath?.getAttribute('d')).toBeTruthy();
    expect(equityPath?.getAttribute('d')).not.toBe(benchmarkPath?.getAttribute('d'));
    expect(axisLabels.length).toBeGreaterThan(0);
    expect(screen.getAllByText('+232.3%').length).toBeGreaterThan(0);
  });

  it('maps hovered curve position to the matching tooltip date', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      chart_series: [
        { trade_date: '2024-01-31', equity: 100, benchmark: 100, drawdown: 0, is_oos: false },
        { trade_date: '2024-02-29', equity: 120, benchmark: 110, drawdown: -3.2, is_oos: false },
        { trade_date: '2024-04-30', equity: 140, benchmark: 120, drawdown: -5.4, is_oos: true },
      ],
    } satisfies ApiBacktestRunDetail);

    const { container } = render(<RunDetailPage runId="bt-hover" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    const hoverTarget = container.querySelector('.run-detail-line-chart rect[fill="transparent"]') as SVGRectElement | null;
    expect(hoverTarget).toBeTruthy();

    Object.defineProperty(hoverTarget, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 300,
        bottom: 100,
        width: 300,
        height: 100,
        toJSON: () => ({}),
      }),
    });

    fireEvent.mouseMove(hoverTarget!, { clientX: 150 });

    await waitFor(() =>
      expect(container.querySelector('.run-detail-chart-tooltip strong')?.textContent).toBe('20240229'),
    );
  });

  it('keeps the performance tooltip away from the top phase label zone', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      chart_series: [
        { trade_date: '2024-01-31', equity: 100, benchmark: 100, drawdown: 0, is_oos: false },
        { trade_date: '2024-02-29', equity: 120, benchmark: 118, drawdown: -2.1, is_oos: false },
        { trade_date: '2024-04-30', equity: 145, benchmark: 132, drawdown: -4.2, is_oos: true },
      ],
    } satisfies ApiBacktestRunDetail);

    const { container } = render(<RunDetailPage runId="bt-tooltip-phase-rail" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    const hoverTarget = container.querySelector('.run-detail-line-chart rect[fill="transparent"]') as SVGRectElement | null;
    expect(hoverTarget).toBeTruthy();

    Object.defineProperty(hoverTarget, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 300,
        bottom: 100,
        width: 300,
        height: 100,
        toJSON: () => ({}),
      }),
    });

    fireEvent.mouseMove(hoverTarget!, { clientX: 300 });

    await waitFor(() => {
      const tooltip = container.querySelector('.run-detail-chart-tooltip') as HTMLDivElement | null;
      expect(tooltip).toBeTruthy();
      expect(tooltip?.style.bottom).not.toBe('');
      expect(tooltip?.style.top).toBe('');
    });
  });

  it('requests fullscreen from the whole performance panel', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);

    const { container } = render(<RunDetailPage runId="bt-fullscreen" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    const chartPanel = container.querySelector('.run-detail-curve-card--overview') as HTMLElement | null;
    expect(chartPanel).toBeTruthy();

    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(chartPanel, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });

    fireEvent.click(screen.getByRole('button', { name: '全屏查看业绩曲线' }));

    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));
  });

  it('shows only rerun and optimization actions for permanent runs', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);

    render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(screen.getByText('永久回测')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存回测' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重跑回测' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动优化' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重跑回测' }));
    await waitFor(() =>
      expect(window.location.hash).toBe('#/strategies/strat-001/backtest-runs/new?source_run_id=bt-9.6802970000'),
    );
  });

  it('saves temporary runs as permanent after confirmation', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      id: 'bt-temp-run',
      is_permanent: false,
    } satisfies ApiBacktestRunDetail);
    fakeApi.saveBacktestRun.mockResolvedValue({
      ...detail,
      id: 'bt-temp-run',
      is_permanent: true,
    } satisfies ApiBacktestRunDetail);

    render(<RunDetailPage runId="bt-temp-run" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    const temporaryTag = screen.getByText('临时回测');
    expect(temporaryTag).toBeInTheDocument();
    expect(temporaryTag.className).toContain('run-detail-hero__tag--temporary');
    expect(screen.getByRole('button', { name: '保存回测' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存回测' }));

    await waitFor(() =>
      expect(window.confirm).toHaveBeenCalledWith('是否要将该回测保存为永久回测？保存后将不再按临时回测自动清理。'),
    );
    await waitFor(() => expect(fakeApi.saveBacktestRun).toHaveBeenCalledWith('bt-temp-run'));
    expect(await screen.findByText('已保存为永久回测。')).toBeInTheDocument();
    expect(screen.getByText('永久回测')).toBeInTheDocument();
    expect(screen.queryByText('临时回测')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存回测' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重跑回测' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动优化' })).toBeInTheDocument();
  });

  it('opens the optimization config page from the hero action', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);

    render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '启动优化' }));

    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/optimization-jobs/new/config?strategy_id=strat-001&source_run_id=bt-9.6802970000&entry_point=run_detail',
      ),
    );
    expect(fakeApi.createOptimizationJob).not.toHaveBeenCalled();
  });

  it('keeps the diagnostics empty state when the run has no chart series', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      chart_series: [],
      monthly_returns: [],
      drawdown_events: [],
      rolling_metrics: [],
      trade_audit_items: [],
      trades_count: 0,
    } satisfies ApiBacktestRunDetail);

    render(<RunDetailPage runId="bt-empty" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(screen.getByText('暂无业绩曲线数据。')).toBeInTheDocument();
    expect(screen.getByText('暂无回撤事件。')).toBeInTheDocument();
  });

  it('uses real trade events instead of audit episode count in the fallback trade KPI', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      analysis: undefined,
      trades_count: 121,
      trades: [
        {
          trade_date: '2026-03-20',
          symbol: 'QQQ',
          action: 'buy',
          price: 580,
          weight_before: 0,
          weight_after: 1,
          segment: 'IS',
          reason: 'buy_and_hold:monthly',
        },
        {
          trade_date: '2026-03-24',
          symbol: 'QQQ',
          action: 'buy',
          price: 585,
          weight_before: 1,
          weight_after: 1,
          segment: 'OOS',
          reason: 'buy_and_hold:monthly',
        },
        {
          trade_date: '2026-03-25',
          symbol: 'QQQ',
          action: 'buy',
          price: 587,
          weight_before: 1,
          weight_after: 1,
          segment: 'OOS',
          reason: 'buy_and_hold:monthly',
        },
      ],
      trade_audit_items: [
        {
          ...auditTwo,
          symbol: 'QQQ',
          segment: 'OOS',
        },
      ],
    });

    render(<RunDetailPage runId="bt-dca" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(document.body.textContent).toContain('训练集1');
    expect(document.body.textContent).toContain('测试集2');
  });

  it('uses the equity curve instead of strategy_return-like metrics in the fallback KPI cards', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      analysis: undefined,
      metrics: {
        total_return: 4.843769,
        sharpe: 0.91,
        max_drawdown: -0.249,
      },
      chart_series: [
        { trade_date: '2024-01-31', equity: 1.0, benchmark: 100.0, drawdown: 0, is_oos: false },
        { trade_date: '2024-02-29', equity: 1.1, benchmark: 110.0, drawdown: -1.2, is_oos: false },
        { trade_date: '2024-03-29', equity: 1.3, benchmark: 150.0, drawdown: -2.6, is_oos: true },
        { trade_date: '2024-04-30', equity: 1.64, benchmark: 200.0, drawdown: -1.8, is_oos: true },
      ],
    } satisfies ApiBacktestRunDetail);

    render(<RunDetailPage runId="bt-dca-fallback" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(document.body.textContent).toContain('+64.0%');
    expect(document.body.textContent).toContain('基准值');
    expect(document.body.textContent).toContain('+100.0%');
    expect(document.body.textContent).toContain('差值: -36.0%');
    expect(document.body.textContent).not.toContain('基准: +484.4% | 差值: -0.0%');
    expect(document.body.textContent).not.toContain('当前累计收益为 +484.4%');
  });
});
