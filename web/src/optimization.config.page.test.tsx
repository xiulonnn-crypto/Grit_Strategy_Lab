import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiBacktestRunDetail, ApiStrategyDetail } from './types';

let OptimizationConfigPage: typeof import('./pages/optimization-lab-page').OptimizationConfigPage;

const fakeApi = vi.hoisted(() => ({
  createOptimizationJob: vi.fn(),
  getBacktestRunDetail: vi.fn(),
  getStrategyDetail: vi.fn(),
})) as {
  createOptimizationJob: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
  getStrategyDetail: ReturnType<typeof vi.fn>;
};

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const strategyDetail: ApiStrategyDetail = {
  id: 'strat-mean-001',
  name: 'QQQ均值回归策略',
  description: '使用布林带、RSI 和仓位规则执行均值回归。',
  strategy_type: 'MEAN_REVERSION',
  universe_name: 'QQQ',
  benchmark_symbol: 'QQQ',
  rebalance_frequency: 'never',
  lifecycle_status: 'ACTIVE',
  latest_run_id: 'run-seed',
  latest_successful_run_id: 'run-seed',
  latest_optimization_job_id: null,
  current_parameter_version: 2,
  current_parameter_version_id: 'strat-mean-001-v2',
  dataset_snapshot_id: 'ds-price',
  universe_snapshot_id: null,
  created_at: '2026-04-10T08:00:00Z',
  updated_at: '2026-04-10T09:00:00Z',
  parameters: {
    strategy_name: 'QQQ均值回归策略',
    strategy_description: '使用布林带、RSI 和仓位规则执行均值回归。',
    benchmark_symbol: 'QQQ',
    observation_timeframe: 'daily',
    trading_logic: '跌破下轨且 RSI 超卖时买入，突破上轨且 RSI 超买时卖出。',
    bollinger_period: 20,
    rsi_period: 6,
    rsi_buy_threshold: 30,
    rsi_sell_threshold: 80,
    atr_period: 14,
    take_profit_atr: 1.5,
    stop_loss_atr: 1,
    long_entry_size_pct: 5,
    short_entry_size_pct: 5,
  },
  parameter_history: [],
  confirmation_fields: {
    top_level: [
      { key: 'strategy_type', label: '策略类型', value: 'MEAN_REVERSION', source: 'user_input' },
      { key: 'universe_name', label: '股票池', value: 'QQQ', source: 'user_input' },
      { key: 'rebalance_frequency', label: '再平衡频次', value: 'never', source: 'system_default' },
    ],
    parameters: [
      { key: 'strategy_name', label: '策略名称', value: 'QQQ均值回归策略', source: 'user_input' },
      { key: 'strategy_description', label: '策略描述', value: '使用布林带、RSI 和仓位规则执行均值回归。', source: 'system_inference' },
      { key: 'benchmark_symbol', label: '基准', value: 'QQQ', source: 'system_inference' },
      { key: 'observation_timeframe', label: '观察周期', value: 'daily', source: 'user_input' },
      { key: 'trading_logic', label: '交易逻辑', value: '跌破下轨且 RSI 超卖时买入，突破上轨且 RSI 超买时卖出。', source: 'system_inference' },
      { key: 'bollinger_period', label: '布林带周期', value: 20, source: 'user_input' },
      { key: 'rsi_period', label: 'RSI周期', value: 6, source: 'user_input' },
      { key: 'rsi_buy_threshold', label: 'RSI超卖阈值', value: 30, source: 'user_input' },
      { key: 'rsi_sell_threshold', label: 'RSI超买阈值', value: 80, source: 'user_input' },
      { key: 'atr_period', label: 'ATR周期', value: 14, source: 'user_input' },
      { key: 'take_profit_atr', label: '止盈倍数(ATR)', value: 1.5, source: 'user_input' },
      { key: 'stop_loss_atr', label: '止损倍数(ATR)', value: 1, source: 'user_input' },
      { key: 'long_entry_size_pct', label: '买入仓位(%)', value: 5, source: 'user_input' },
      { key: 'short_entry_size_pct', label: '卖出仓位(%)', value: 5, source: 'user_input' },
    ],
  },
  allowed_actions: ['open_optimization'],
};

const sourceRunDetail: ApiBacktestRunDetail = {
  id: 'run-seed',
  strategy_id: 'strat-mean-001',
  status: 'COMPLETED',
  parameter_snapshot: {
    ...strategyDetail.parameters,
    long_entry_size_pct: 10,
    short_entry_size_pct: 10,
  },
};

beforeEach(async () => {
  vi.resetModules();
  fakeApi.createOptimizationJob.mockReset();
  fakeApi.getBacktestRunDetail.mockReset();
  fakeApi.getStrategyDetail.mockReset();
  fakeApi.createOptimizationJob.mockResolvedValue({ id: 'opt-001' });
  fakeApi.getStrategyDetail.mockResolvedValue(strategyDetail);
  fakeApi.getBacktestRunDetail.mockResolvedValue(sourceRunDetail);
  ({ OptimizationConfigPage } = await import('./pages/optimization-lab-page'));
});

afterEach(() => {
  cleanup();
});

describe('OptimizationConfigPage', () => {
  it('renders selection-rule parameters with Chinese labels and without the summary sidebar', async () => {
    render(<OptimizationConfigPage strategyId="strat-mean-001" sourceRunId="run-seed" entryPoint="run_detail" />);

    expect(await screen.findByRole('heading', { level: 1, name: 'QQQ均值回归策略' })).toBeInTheDocument();
    expect(screen.getByText('观察周期')).toBeInTheDocument();
    expect(screen.getByText('布林带周期')).toBeInTheDocument();
    expect(screen.getByText('RSI周期')).toBeInTheDocument();
    expect(screen.queryByText('策略名称')).not.toBeInTheDocument();
    expect(screen.queryByText('策略描述')).not.toBeInTheDocument();
    expect(screen.queryByText('本轮设置')).not.toBeInTheDocument();
    expect(document.querySelector('.optimization-lab-panel--sidebar')).toBeNull();

    const entrySizeRow = screen.getByText('买入仓位(%)').closest('tr');
    expect(entrySizeRow).not.toBeNull();
    expect(entrySizeRow?.children[1]?.textContent).toBe('10');
  });
});
