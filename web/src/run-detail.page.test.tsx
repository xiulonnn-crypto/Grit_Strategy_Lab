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
  getBacktestTradeAudit: vi.fn(),
  getBacktestRunTrades: vi.fn(),
  createOptimizationJob: vi.fn(),
})) as {
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
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
  metrics: { total_return: 232.3, sharpe: 0.85, max_drawdown: -24.9 },
  chart_series: [
    { trade_date: '2024-03-21', equity: 100, benchmark: 100, drawdown: 0, is_oos: false },
    { trade_date: '2025-03-24', equity: 170.3, benchmark: 132.1, drawdown: -8.2, is_oos: false },
    { trade_date: '2026-03-24', equity: 232.3, benchmark: 142.4, drawdown: -24.9, is_oos: true },
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
  },
  data_segment_type: 'FULL',
  parameter_version_id: 'v2',
  oos_start_date: '2024-03-21',
  is_permanent: true,
  trades_count: 222,
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
      pnl_contribution: -1.4,
      segment: 'OOS',
    },
  ],
  page: 1,
  page_size: 12,
  total: 2,
  total_pages: 1,
};

beforeEach(() => {
  fakeApi.getBacktestRunDetail.mockReset();
  fakeApi.getBacktestTradeAudit.mockReset();
  fakeApi.getBacktestRunTrades.mockReset();
  fakeApi.createOptimizationJob.mockReset();
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
  window.location.hash = '';
});

describe('RunDetailPage', () => {
  it('renders diagnostics by default and expands trades and evidence on demand', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);
    fakeApi.getBacktestRunTrades.mockResolvedValue(trades);
    fakeApi.getBacktestTradeAudit.mockImplementation(async (_runId: string, tradeId: string) =>
      tradeId === 'trade-001' ? auditOne : auditTwo,
    );

    render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '风险诊断' })).not.toBeInTheDocument();
    expect(screen.getByText('主绩效曲线')).toBeInTheDocument();
    expect(screen.getAllByText('+232.3%').length).toBeGreaterThan(0);
    expect(screen.getByText('点击展开查看成交明细。')).toBeInTheDocument();
    expect(screen.getByText('点击展开查看证据轨迹。')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '展开' })[0]);
    expect(await screen.findByText('真实 /backtest-runs/bt-9.6802970000/trades')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: '成交区段' })).toBeInTheDocument();
    expect(screen.getAllByText('QQQ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(await screen.findByText('QQQ 证据卡')).toBeInTheDocument();
    expect(screen.getByText('数据快照摘要')).toBeInTheDocument();
    expect(screen.getByText('参数快照')).toBeInTheDocument();
    expect(screen.getByText('环境摘要')).toBeInTheDocument();
  });

  it('supports copy and rerun actions from the hero', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);

    render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '复制配置' }));
    await waitFor(() =>
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('"run_id": "bt-9.6802970000"'),
      ),
    );
    expect(await screen.findByText('已复制配置 JSON。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重跑回测' }));
    await waitFor(() =>
      expect(window.location.hash).toBe('#/strategies/strat-001/backtest-runs/new?source_run_id=bt-9.6802970000'),
    );
  });

  it('creates an optimization job from the hero action', async () => {
    fakeApi.getBacktestRunDetail.mockResolvedValue(detail);

    render(<RunDetailPage runId="bt-9.6802970000" />);

    expect(await screen.findByText('美股质量动量')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '启动优化' }));

    await waitFor(() => expect(fakeApi.createOptimizationJob).toHaveBeenCalledWith('strat-001'));
    await waitFor(() => expect(window.location.hash).toBe('#/optimization-jobs/opt-001'));
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
    expect(screen.getByText('暂无主绩效曲线数据。')).toBeInTheDocument();
    expect(screen.getByText('暂无回撤事件。')).toBeInTheDocument();
  });
});
