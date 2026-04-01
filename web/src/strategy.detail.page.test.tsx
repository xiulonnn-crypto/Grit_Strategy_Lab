import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyDetailPage } from './pages/strategy-detail-page';
import type { ApiStrategyDetail } from './types';

const fakeApi = vi.hoisted(() => ({
  getStrategyDetail: vi.fn(),
  getBacktestRunDetail: vi.fn(),
})) as {
  getStrategyDetail: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
};

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const strategy: ApiStrategyDetail = {
  id: 'strat-001',
  name: '美股质量动量',
  strategy_type: 'MOMENTUM',
  universe_name: '美股大盘股',
  benchmark_symbol: 'SPY',
  rebalance_frequency: '每周',
  lifecycle_status: 'ACTIVE',
  current_parameter_version: 2,
  current_parameter_version_id: 'pv-002',
  latest_successful_run_id: null,
  latest_run_id: null,
  latest_optimization_job_id: 'opt-001',
  dataset_snapshot_id: 'ds-001',
  universe_snapshot_id: 'un-001',
  created_at: '2026-03-23T08:44:00Z',
  updated_at: '2026-03-27T16:20:00Z',
  parameters: { lookback_days: 126, max_weight: 0.08 },
  parameter_history: [
    {
      version_number: 2,
      parameter_version_id: 'pv-002',
      revision: 2,
      created_at: '2026-03-23T08:44:00Z',
      parameters: { lookback_days: 126, max_weight: 0.08 },
      comment: '加入质量过滤与单一持仓权重上限。',
    },
  ],
  confirmation_fields: { top_level: [], parameters: [] },
  allowed_actions: ['backtest', 'optimize'],
};

beforeEach(() => {
  fakeApi.getStrategyDetail.mockReset();
  fakeApi.getBacktestRunDetail.mockReset();
  fakeApi.getStrategyDetail.mockResolvedValue(strategy);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('StrategyDetailPage', () => {
  it('renders the strategy overview and routes the primary actions', async () => {
    render(<StrategyDetailPage strategyId="strat-001" />);

    expect(await screen.findByText('当前参数版本')).toBeInTheDocument();
    expect((await screen.findAllByText('美股质量动量')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('pv-002').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: '运行回测' })[0]);
    await waitFor(() => expect(window.location.hash).toBe('#/strategies/strat-001/backtest-runs/new'));

    fireEvent.click(screen.getAllByRole('button', { name: '打开优化' })[0]);
    await waitFor(() => expect(window.location.hash).toBe('#/optimization-jobs/opt-001'));
  });
});
