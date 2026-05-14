import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  resumeBacktestRun: vi.fn(),
  createOptimizationJob: vi.fn(),
})) as {
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
  saveBacktestRun: ReturnType<typeof vi.fn>;
  getBacktestTradeAudit: ReturnType<typeof vi.fn>;
  getBacktestRunTrades: ReturnType<typeof vi.fn>;
  resumeBacktestRun: ReturnType<typeof vi.fn>;
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
    start_date: '2016-03-24',
    end_date: '2026-03-24',
    execution_policy: 'T_CLOSE_TO_T1_OPEN',
  },
  configuration: {
    hold_rank_threshold: 20,
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
  start_date: '2016-03-24',
  end_date: '2026-03-24',
  effective_date: '2017-06-23',
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
        footer_items: [
          { label: '基准值', value: '+142.4%' },
          { label: '训练集', value: '+70.3%' },
          { label: '测试集', value: '+95.1%' },
        ],
        insight_text: '收益仍显著跑赢基准，建议继续检查 Beta 暴露。',
        insight_tone: 'positive',
        state: 'healthy',
      },
      {
        key: 'annualized_return',
        label: '年化收益率',
        primary_text: '+28.4%',
        trend_direction: 'up',
        trend_text: '↑ 12.1% vs 基准',
        compare_text: '基准: +16.3% | 最新252日滚动: +17.1% | 滚动基准: +11.6%',
        footer_items: [
          { label: '基准值', value: '+16.3%' },
          { label: '最新252日滚动', value: '+17.1%' },
          { label: '滚动基准', value: '+11.6%' },
        ],
        insight_text: '年化收益率仍领先基准，但最近 252 日滚动收益放缓，需继续确认近期斜率是否还能延续。',
        insight_tone: 'warning',
        state: 'watch',
      },
      {
        key: 'sharpe',
        label: '夏普比率',
        primary_text: '0.85',
        trend_direction: 'up',
        trend_text: '↑ 0.23',
        compare_text: '基准: 0.62 | 差值: +0.23',
        footer_items: [
          { label: '基准值', value: '0.62' },
          { label: '训练集', value: '0.91' },
          { label: '测试集', value: '0.81' },
        ],
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
        footer_items: [
          { label: '基准值', value: '-29.7%' },
          { label: '训练集', value: '-14.3%' },
          { label: '测试集', value: '-24.9%' },
        ],
        insight_text: '回撤仍偏深，建议复核止损与仓位节奏。',
        insight_tone: 'warning',
        state: 'watch',
      },
      {
        key: 'trade_count',
        label: '交易数',
        primary_text: '222',
        trend_direction: 'down',
        trend_text: '测试集 1 笔',
        compare_text: '训练集 1 | 测试集 1',
        footer_items: [
          { label: '训练集', value: '1' },
          { label: '测试集', value: '1' },
        ],
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
      trade_id: 'trade-003',
      symbol: 'MSFT',
      segment: 'IS',
      opened_at: '2026-03-22T09:30:00Z',
      closed_at: '2026-03-22T16:00:00Z',
      pnl_pct: 6.8,
      max_favorable_excursion_pct: 7.4,
      max_adverse_excursion_pct: -0.9,
      slippage_cost_pct: 0.12,
      commentary: '收益扩张明显，回撤控制仍在容忍区间内。',
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

const auditThree: ApiBacktestRunTradeAudit = {
  ...auditOne,
  trade_id: 'trade-003',
  symbol: 'MSFT',
  opened_at: '2026-03-22T09:30:00Z',
  closed_at: '2026-03-22T16:00:00Z',
  pnl_pct: 6.8,
  commentary: '收益扩张明显，回撤控制仍在容忍区间内。',
  chart_band: {
    start_date: '2026-03-22T09:30:00Z',
    end_date: '2026-03-22T16:00:00Z',
    color: 'green',
    pnl_pct: 6.8,
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
      contribution_multiplier: 0.8,
      valuation_percentile_10y: 78.4,
      valuation_bucket: '70-90',
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
  fakeApi.resumeBacktestRun.mockReset();
  fakeApi.createOptimizationJob.mockReset();
  fakeApi.saveBacktestRun.mockResolvedValue({
    ...detail,
    is_permanent: true,
  });
  fakeApi.resumeBacktestRun.mockResolvedValue({
    ...detail,
    status: 'RUNNING',
  });
  fakeApi.createOptimizationJob.mockResolvedValue({ id: 'opt-001' });
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
  vi.useRealTimers();
  window.location.hash = '';
});

describe('RunDetailPage', () => {
  it('renders diagnostics by default and switches between trades, evidence, and properties tabs', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);
    fakeApi.getBacktestRunTrades.mockResolvedValue(trades);
    fakeApi.getBacktestTradeAudit.mockImplementation(async (_runId: string, tradeId: string) => {
      if (tradeId === 'trade-001') {
        return auditOne;
      }
      if (tradeId === 'trade-002') {
        return auditTwo;
      }
      return auditThree;
    });

    const { container } = render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(fakeApi.getBacktestRunDetail).toHaveBeenNthCalledWith(1, 'bt-9.6802970000', { view: 'initial' });
    expect(screen.getByText('业绩曲线')).toBeInTheDocument();
    const curveCard = container.querySelector('.run-detail-curve-card--overview');
    expect(curveCard?.textContent).not.toContain('测试集仍为正收益，但回撤修复仍需观察。');
    expect(screen.getByText('v2', { selector: '.run-detail-hero__tag--version' })).toBeInTheDocument();
    expect(screen.queryByText(/参数版本/, { selector: '.run-detail-hero__tag' })).not.toBeInTheDocument();
    expect(screen.queryByText(/测试集起点/, { selector: '.run-detail-hero__tag' })).not.toBeInTheDocument();
    expect(screen.queryByText(/回测区间/, { selector: '.run-detail-hero__tag' })).not.toBeInTheDocument();
    expect(screen.queryByText(/来源/, { selector: '.run-detail-hero__tag' })).not.toBeInTheDocument();
    expect(screen.getAllByText('+232.3%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('基准值').length).toBeGreaterThan(0);
    expect(screen.getAllByText('训练集').length).toBeGreaterThan(0);
    expect(screen.getAllByText('测试集').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '总收益 指标说明' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '年化收益率 指标说明' })).toBeInTheDocument();
    const annualizedCard = screen.getByText('年化收益率').closest('.run-detail-kpi-card');
    const annualizedCompare = annualizedCard?.querySelector('.run-detail-kpi-card__compare');
    expect(annualizedCompare?.textContent).toContain('基准值');
    expect(annualizedCompare?.textContent).toContain('最新252日滚动');
    expect(annualizedCompare?.textContent).toContain('滚动基准');
    const tradeCountCard = screen.getByText('交易数').closest('.run-detail-kpi-card');
    const tradeCountCompare = tradeCountCard?.querySelector('.run-detail-kpi-card__compare');
    expect(tradeCountCompare?.textContent).not.toContain('基准值');
    expect(tradeCountCompare?.textContent).toContain('训练集');
    expect(tradeCountCompare?.textContent).toContain('测试集');
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
    expect(await screen.findByText('MSFT 证据卡')).toBeInTheDocument();
    await waitFor(() =>
      expect(fakeApi.getBacktestTradeAudit).toHaveBeenCalledWith('bt-9.6802970000', 'trade-003'),
    );
    expect(screen.getByDisplayValue('收益倒序')).toBeInTheDocument();
    expect(screen.queryByText('配置与环境快照')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '配置' }));
    const executionWindowCard = await screen.findByText('执行窗口');
    const executionWindow = executionWindowCard.closest('.run-detail-property-card');
    expect(executionWindow).not.toBeNull();
    expect(within(executionWindow as HTMLElement).getByText('请求开始')).toBeInTheDocument();
    expect(within(executionWindow as HTMLElement).getByText('2016-03-24')).toBeInTheDocument();
    expect(within(executionWindow as HTMLElement).getByText('信号生效起点')).toBeInTheDocument();
    expect(within(executionWindow as HTMLElement).getByText('2017-06-23')).toBeInTheDocument();
    expect(within(executionWindow as HTMLElement).getByText('首笔订单')).toBeInTheDocument();
    expect(within(executionWindow as HTMLElement).getByText('2026-03-22')).toBeInTheDocument();
    expect(within(executionWindow as HTMLElement).getByText('T日收盘信号，T+1开盘成交')).toBeInTheDocument();
    expect(await screen.findByText('基准标的')).toBeInTheDocument();
    expect(screen.getByText('SPY')).toBeInTheDocument();
    expect(screen.getByText('再平衡')).toBeInTheDocument();
    expect(screen.getByText('每月')).toBeInTheDocument();
    expect(screen.getByText('策略类型')).toBeInTheDocument();
    expect(screen.getByText('质量动量')).toBeInTheDocument();
    expect(screen.getByText('保留排名阈值')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getAllByText('参数快照').length).toBeGreaterThan(0);
    expect(screen.getAllByText('数据快照摘要').length).toBeGreaterThan(0);
    expect(screen.getAllByText('环境摘要').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AAPL, AMZN, MSFT, NVDA, META, GOOGL, TSLA, AVGO, BRK-B, JPM ...').length).toBeGreaterThan(0);
  });

  it('renders the multi-factor attribution tab and decision rail items when attribution is present', async () => {
    const multiFactorDetail: ApiBacktestRunDetail = {
      ...detail,
      parameter_snapshot: {
        strategy_type: 'MULTI_FACTOR',
        factor_ids: ['s_mom_12m1m_rank', 's_val_ep_ltm_raw'],
      },
      multi_factor_attribution: {
        summary: {
          attribution_source: 'estimated',
          factor_count: 2,
          top_factor: 's_mom_12m1m_rank',
          coverage_pct: 93.4,
        },
        factor_contributions: [
          {
            factor_id: 's_mom_12m1m_rank',
            name: 's_mom_12m1m_rank',
            family: 'momentum',
            direction: 'HIGH_IS_BETTER',
            normalized_weight: 0.6,
            contribution_pct: 18.2,
            source: 'estimated',
          },
          {
            factor_id: 's_val_ep_ltm_raw',
            name: 's_val_ep_ltm_raw',
            family: 'value',
            direction: 'HIGH_IS_BETTER',
            normalized_weight: 0.4,
            contribution_pct: 8.4,
            source: 'estimated',
          },
        ],
        industry_exposures: [
          { industry: '信息技术', exposure_pct: 28, source: 'estimated' },
          { industry: '金融', exposure_pct: 12, source: 'estimated' },
        ],
        coverage: {
          coverage_pct: 93.4,
          factor_count: 2,
          ready_factor_count: 2,
        },
        neutralization_status: {
          enabled: false,
          method: 'industry',
          execution_status: 'DISABLED',
        },
        attribution_source: 'estimated',
        warnings: ['当前归因基于因子权重估算。'],
      },
      analysis: {
        subtitle: detail.analysis!.subtitle,
        kpi_cards: detail.analysis!.kpi_cards,
        decision_rail: {
          ...detail.analysis!.decision_rail,
          items: [
            ...(detail.analysis!.decision_rail?.items ?? []),
            {
              key: 'factor_attribution',
              title: '因子归因',
              body: '动量因子贡献最高。',
              tone: 'positive',
            },
            {
              key: 'industry_exposure',
              title: '行业暴露',
              body: '行业暴露处于估算观察状态。',
              tone: 'neutral',
            },
          ],
        },
      },
    };
    fakeApi.getBacktestRunDetail.mockResolvedValue(multiFactorDetail);

    render(<RunDetailPage runId="bt-mf-001" />);

    expect(await screen.findByRole('tab', { name: '因子归因' })).toBeInTheDocument();
    expect(screen.getByText('动量因子贡献最高。')).toBeInTheDocument();
    expect(screen.getByText('行业暴露处于估算观察状态。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '因子归因' }));

    expect(screen.getByText('归因来源')).toBeInTheDocument();
    expect(screen.getAllByText('估算归因').length).toBeGreaterThan(0);
    expect(screen.queryByText('estimated')).not.toBeInTheDocument();
    const barWidths = Array.from(
      document.querySelectorAll<HTMLElement>('.run-detail-factor-attribution__bar-track span'),
    ).map((bar) => bar.style.width);
    expect(new Set(barWidths).size).toBeGreaterThan(1);
    expect(screen.getByText('12-1月截面动量排名')).toBeInTheDocument();
    expect(screen.getByText('滚动市盈率倒数 (LTM)')).toBeInTheDocument();
    expect(screen.queryByText('s_mom_12m1m_rank')).not.toBeInTheDocument();
    expect(screen.getByText('信息技术')).toBeInTheDocument();
    expect(screen.getByText('当前归因基于因子权重估算。')).toBeInTheDocument();
  });

  it('renders valuation execution context on trade rows when present', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);
    fakeApi.getBacktestRunTrades.mockResolvedValue(trades);

    render(<RunDetailPage runId="bt-warning" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '交易' }));
    expect(await screen.findByText('Multiplier 0.80x | 10Y percentile 78.4 | Bucket 70-90')).toBeInTheDocument();
  });

  it('localizes asset allocation properties and suppresses routine normalization warnings', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      status: 'COMPLETED_WITH_WARNINGS',
      warnings: ['Allocation weights were normalized to 100%.'],
      parameter_snapshot: {
        strategy_name: '美股标普纳指平衡策略',
        strategy_description: '多资产风险预算、目标权重、再平衡与成本',
        strategy_type: 'ASSET_ALLOCATION',
        benchmark_symbol: 'SPY',
        capital: 100000,
        allocation_assets: [
          { symbol: 'SPY', display_name: 'S&P 500 ETF', asset_class: 'Equity' },
          { symbol: 'QQQ', display_name: 'Nasdaq 100 ETF', asset_class: 'Growth Equity' },
        ],
        allocation_weight__SPY_pct: 35,
        allocation_weight__QQQ_pct: 25,
        investment_mode: 'all_in',
        rebalance_enabled: true,
        rebalance_frequency: 'quarterly',
        rebalance_threshold_pct: 5,
        cost_model_enabled: true,
        fee_bps: 1.5,
        slippage_bps: 2.5,
        expense_ratio_bps: 8,
      },
      snapshot_summary: {
        status: 'READY',
        dataset_snapshot_id: 'ds-price',
        supporting_dataset_snapshot_id: 'ds-corporate-actions',
        valuation_dataset_snapshot_id: null,
        symbol_count: 2,
        row_count: 5028,
        benchmark_trade_days: 2514,
        coverage_days: 2514,
        blocking: false,
        message: 'Price snapshot is still incomplete. The run can proceed using the currently available symbols.',
        price_dataset_status: 'INCOMPLETE',
        corporate_actions_status: 'INCOMPLETE',
        valuation_dataset_status: 'NOT_REQUIRED',
        universe_status: 'NOT_REQUIRED',
        latest_trade_date: '2026-03-24',
      },
    } satisfies ApiBacktestRunDetail);

    render(<RunDetailPage runId="bt-asset-allocation-properties" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(screen.queryByText('Allocation weights were normalized to 100%.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '配置' }));

    expect(await screen.findByText('配置标的')).toBeInTheDocument();
    expect(screen.getByText('SPY（S&P 500 ETF，权益）, QQQ（Nasdaq 100 ETF，成长权益）')).toBeInTheDocument();
    expect(screen.getByText('SPY 目标权重(%)')).toBeInTheDocument();
    expect(screen.getByText('投资方式')).toBeInTheDocument();
    expect(screen.getByText('一次性建仓')).toBeInTheDocument();
    expect(screen.getByText('再平衡开关')).toBeInTheDocument();
    expect(screen.getByText('成本模拟开关')).toBeInTheDocument();
    expect(screen.getByText('估值数据状态')).toBeInTheDocument();
    expect(screen.getAllByText('无需').length).toBeGreaterThan(0);
    expect(screen.getByText('价格快照仍未完整，但可基于当前可用标的继续运行回测。')).toBeInTheDocument();

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toContain('allocation_weight__SPY_pct');
    expect(bodyText).not.toContain('"display_name"');
    expect(bodyText).not.toContain('investment_mode');
    expect(bodyText).not.toContain('price_dataset_status');
    expect(bodyText).not.toContain('valuation_dataset_status');
    expect(bodyText).not.toContain('NOT_REQUIRED');
  });

  it('lazy-loads context only when evidence or properties needs it', async () => {
    const initialDetail = structuredClone(detail) as ApiBacktestRunDetail & Record<string, unknown>;
    delete initialDetail.request;
    delete initialDetail.preview;
    delete initialDetail.environment_summary;
    delete initialDetail.snapshot_summary;
    delete initialDetail.trade_audit_items;

    fakeApi.getBacktestRunDetail
      .mockResolvedValueOnce(initialDetail as ApiBacktestRunDetail)
      .mockResolvedValueOnce(detail);
    fakeApi.getBacktestTradeAudit.mockResolvedValue(auditThree);

    render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(fakeApi.getBacktestRunDetail).toHaveBeenNthCalledWith(1, 'bt-9.6802970000', { view: 'initial' });
    expect(fakeApi.getBacktestTradeAudit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '证据' }));

    await waitFor(() =>
      expect(fakeApi.getBacktestRunDetail).toHaveBeenNthCalledWith(2, 'bt-9.6802970000', { view: 'context' }),
    );
    expect(await screen.findByText('MSFT 证据卡')).toBeInTheDocument();
    await waitFor(() =>
      expect(fakeApi.getBacktestTradeAudit).toHaveBeenCalledWith('bt-9.6802970000', 'trade-003'),
    );

    fireEvent.click(screen.getByRole('tab', { name: '配置' }));

    expect(await screen.findByText('基准标的')).toBeInTheDocument();
    expect(fakeApi.getBacktestRunDetail).toHaveBeenCalledTimes(2);
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

  it('polls running runs until the detail page refreshes to the completed state', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval').mockImplementation(((
      handler: TimerHandler,
    ) => {
      queueMicrotask(() => {
        if (typeof handler === 'function') {
          handler();
        }
      });
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    }) as unknown as typeof window.setInterval);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => {});
    fakeApi.getBacktestRunDetail
      .mockResolvedValueOnce({
        ...detail,
        status: 'RUNNING',
        metrics: {},
        chart_series: [],
        rolling_metrics: [],
        monthly_returns: [],
        drawdown_events: [],
        trades_count: 0,
        analysis: {
          subtitle: '回测正在执行，页面会自动刷新；你可以先查看已锁定的区间与配置。',
          kpi_cards: [],
          decision_rail: {
            score: 0,
            label: '回测状态',
            items: [
              {
                key: 'execution_state',
                title: '执行状态',
                body: '回测已提交，后台正在生成业绩曲线、指标与交易明细。',
                tone: 'neutral',
              },
            ],
          },
        },
      } satisfies ApiBacktestRunDetail)
      .mockResolvedValueOnce(detail);

    try {
      render(<RunDetailPage runId="bt-running" />);

      expect(await screen.findByText('已完成')).toBeInTheDocument();
      expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(0);
      await waitFor(() => expect(fakeApi.getBacktestRunDetail).toHaveBeenCalledTimes(2));
      expect(screen.getByText('测试集仍为正收益，但回撤修复仍需观察。')).toBeInTheDocument();
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
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

  it('translates interrupted runs and resumes them from the hero action', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue({
      ...detail,
      id: 'bt-interrupted',
      status: 'INTERRUPTED',
      resume_ready: true,
      interrupted_reason: '服务重启',
      analysis: undefined,
    } satisfies ApiBacktestRunDetail);
    fakeApi.resumeBacktestRun.mockResolvedValue({
      ...detail,
      id: 'bt-interrupted',
      status: 'RUNNING',
      resume_ready: false,
      interrupted_reason: null,
      latest_update: '已继续回测，正在从断点恢复。',
    } satisfies ApiBacktestRunDetail);

    render(<RunDetailPage runId="bt-interrupted" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(screen.getByText('已中断')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续回测' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '继续回测' }));

    await waitFor(() =>
      expect(fakeApi.resumeBacktestRun).toHaveBeenCalledWith(
        'bt-interrupted',
        expect.stringMatching(/^resume-backtest-bt-interrupted-/),
      ),
    );
    expect(await screen.findByText('已继续回测，正在从断点恢复。')).toBeInTheDocument();
    expect(screen.getByText('进行中')).toBeInTheDocument();
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

    const dialog = await screen.findByRole('dialog', { name: '保存回测' });
    expect(within(dialog).getByText('确认后该回测会转为永久回测，不再按临时回测自动清理。')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认' }));

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
