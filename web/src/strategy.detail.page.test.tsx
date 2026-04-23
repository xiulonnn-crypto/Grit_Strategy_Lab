import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiStrategyDetail } from './types';

let StrategyDetailPage: typeof import('./pages/strategy-detail-page').StrategyDetailPage;

const HISTORY_OPEN_LABEL = '\u67e5\u770b\u53c2\u6570';
const HISTORY_DETAIL_TITLE = '\u7248\u672c\u53c2\u6570\u660e\u7ec6';
const CLOSE_LABEL = '\u5173\u95ed';

const fakeApi = vi.hoisted(() => ({
  createCreationSession: vi.fn(),
  listBacktestRuns: vi.fn(),
  getStrategyDetail: vi.fn(),
  getBacktestRunDetail: vi.fn(),
})) as {
  createCreationSession: ReturnType<typeof vi.fn>;
  listBacktestRuns: ReturnType<typeof vi.fn>;
  getStrategyDetail: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
};

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const strategy: ApiStrategyDetail = {
  id: 'strat-001',
  name: 'Strategy Alpha',
  description: 'Mean reversion strategy on QQQ.',
  strategy_type: 'MEAN_REVERSION',
  universe_name: 'QQQ',
  benchmark_symbol: 'QQQ',
  rebalance_frequency: 'never',
  lifecycle_status: 'ACTIVE',
  current_parameter_version: 2,
  current_parameter_version_id: 'pv-002',
  latest_successful_run_id: 'run-001',
  latest_run_id: 'run-001',
  latest_optimization_job_id: 'opt-001',
  dataset_snapshot_id: 'ds-001',
  universe_snapshot_id: null,
  created_at: '2026-03-23T08:44:00Z',
  updated_at: '2026-03-27T16:20:00Z',
  parameters: {
    strategy_description: 'Mean reversion strategy on QQQ.',
    trading_logic: 'Buy 5% when RSI(6) < 30 and sell 5% when RSI(6) > 80.',
    benchmark_symbol: 'QQQ',
    observation_timeframe: 'daily',
    weighting_method: 'equal_weight',
    hold_rank_threshold: 120,
    rebalance_anchor_dates: '每年01月第1个交易日；07月第1个交易日',
    bollinger_period: 20,
    rsi_period: 6,
    atr_period: 14,
    take_profit_atr: 1.5,
    stop_loss_atr: 1,
    long_entry_size_pct: 5,
    short_entry_size_pct: 5,
  },
  parameter_history: [
    {
      version_number: 2,
      parameter_version_id: 'pv-002',
      revision: 2,
      created_at: '2026-03-23T08:44:00Z',
      parameters: { bollinger_period: 20, rsi_period: 6 },
      comment: 'Promoted after tuning the current settings.',
    },
    {
      version_number: 1,
      parameter_version_id: 'pv-001',
      revision: 1,
      created_at: '2026-03-20T08:44:00Z',
      parameters: { observation_timeframe: 'daily' },
      comment: 'Initial import.',
    },
  ],
  confirmation_fields: { top_level: [], parameters: [] },
  allowed_actions: ['run_backtest', 'open_optimization', 'edit_parameters'],
};

const recentRuns = [
  {
    id: 'run-001',
    strategy_id: 'strat-001',
    strategy_name: 'Strategy Alpha',
    status: 'COMPLETED',
    start_date: '2025-01-01',
    end_date: '2026-03-27',
    completed_at: '2026-03-27T17:20:00Z',
    parameter_version_id: 'pv-002',
    metrics: {
      total_return: 0.126,
      sharpe: 1.14,
      max_drawdown: -0.082,
    },
  },
  {
    id: 'run-000',
    strategy_id: 'strat-001',
    strategy_name: 'Strategy Alpha',
    status: 'COMPLETED_WITH_WARNINGS',
    start_date: '2024-01-01',
    end_date: '2025-12-31',
    completed_at: '2026-03-20T17:20:00Z',
    parameter_version_id: 'pv-001',
    metrics: {
      total_return: -0.031,
      sharpe: 0.44,
      max_drawdown: -0.11,
    },
  },
] as const;

beforeEach(() => {
  vi.resetModules();
  fakeApi.createCreationSession.mockReset();
  fakeApi.listBacktestRuns.mockReset();
  fakeApi.getStrategyDetail.mockReset();
  fakeApi.getBacktestRunDetail.mockReset();
  fakeApi.createCreationSession.mockResolvedValue({ id: 'cs-revision-001' });
  fakeApi.listBacktestRuns.mockResolvedValue(recentRuns);
  fakeApi.getStrategyDetail.mockResolvedValue(strategy);
  fakeApi.getBacktestRunDetail.mockResolvedValue(recentRuns[0]);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('StrategyDetailPage', () => {
  it('renders the detail layout, opens a revision session, shows recent runs on a timeline, and opens the latest optimization result', async () => {
    ({ StrategyDetailPage } = await import('./pages/strategy-detail-page'));
    const { container } = render(<StrategyDetailPage strategyId="strat-001" />);

    await waitFor(() => expect(fakeApi.getStrategyDetail).toHaveBeenCalledWith('strat-001'));
    expect(container.querySelector('.strategy-detail-page')).not.toBeNull();
    expect(container.querySelector('.strategy-detail-history-table')).not.toBeNull();
    expect(container.querySelector('.strategy-detail-parameter-card--logic')).not.toBeNull();
    expect(container.querySelector('.workspace-recent-runs__timeline')).not.toBeNull();
    expect(container.querySelector('.strategy-detail-hero__meta')).toBeNull();
    const summary = container.querySelector('.strategy-detail-hero__summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('QQQ');
    expect(summary?.textContent).toContain('RSI(6)');
    expect(summary?.textContent).toContain('5%');
    expect(screen.getByText('权重方式')).toBeInTheDocument();
    expect(screen.getByText('等权')).toBeInTheDocument();
    expect(screen.getByText('保留排名阈值')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.queryByText('120%')).not.toBeInTheDocument();
    expect(screen.getByText('调仓锚点')).toBeInTheDocument();
    expect(screen.getByText('调优当前设置后晋升为正式版本。')).toBeInTheDocument();
    expect(screen.getByText('初始导入。')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '修订' })).not.toBeInTheDocument();
    expect(screen.getAllByText('pv-002').length).toBeGreaterThan(0);
    expect(screen.getAllByText('pv-001').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '返回工作台' })).not.toBeInTheDocument();

    const historyButtons = await screen.findAllByRole('button', { name: HISTORY_OPEN_LABEL });
    fireEvent.click(historyButtons[1]);

    const dialog = await screen.findByRole('dialog', { name: HISTORY_DETAIL_TITLE });
    expect(dialog.textContent).toContain('pv-001');
    expect(dialog.textContent).not.toContain('pv-002');

    fireEvent.click(within(dialog).getByRole('button', { name: CLOSE_LABEL }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: HISTORY_DETAIL_TITLE })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '运行回测' }));
    await waitFor(() => expect(window.location.hash).toBe('#/strategies/strat-001/backtest-runs/new'));

    fireEvent.click(screen.getByRole('button', { name: '修改策略' }));
    await waitFor(() =>
      expect(fakeApi.createCreationSession).toHaveBeenCalledWith({
        strategy_type: 'MEAN_REVERSION',
        mode: 'REVISION',
        base_strategy_id: 'strat-001',
        base_parameter_version_id: 'pv-002',
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#/creation/sessions/cs-revision-001'));

    fireEvent.click(screen.getByRole('button', { name: '打开优化' }));
    await waitFor(() => expect(window.location.hash).toBe('#/optimization-jobs/opt-001'));
  });

  it('opens the config step when no latest optimization job exists', async () => {
    ({ StrategyDetailPage } = await import('./pages/strategy-detail-page'));
    fakeApi.getStrategyDetail.mockResolvedValue({
      ...strategy,
      latest_optimization_job_id: null,
    });

    const { container } = render(<StrategyDetailPage strategyId="strat-001" />);
    await waitFor(() => expect(container.querySelector('.strategy-detail-page')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '打开优化' }));
    await waitFor(() =>
      expect(window.location.hash).toBe('#/optimization-jobs/new/config?strategy_id=strat-001&entry_point=strategy_detail'),
    );
  });
});
