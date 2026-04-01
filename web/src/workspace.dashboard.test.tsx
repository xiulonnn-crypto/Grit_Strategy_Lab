import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './pages/workspace-page-lane-b';
import { ShellFrameCn } from './shell-frame-cn';
import type { ApiBacktestRunDetail, ApiStrategyDetail, ApiStrategyListItem, ApiWorkspaceOverview } from './types';

type FakeApi = {
  getWorkspaceOverview: ReturnType<typeof vi.fn>;
  listStrategies: ReturnType<typeof vi.fn>;
  getStrategyDetail: ReturnType<typeof vi.fn>;
  listBacktestRuns: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getWorkspaceOverview: vi.fn(),
  listStrategies: vi.fn(),
  getStrategyDetail: vi.fn(),
  listBacktestRuns: vi.fn(),
  getBacktestRunDetail: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const overview: ApiWorkspaceOverview = {
  workspace_name: 'Grit 策略实验室',
  subtitle: '创建、回测和优化的统一工作台。',
  strategy_count: 2,
  active_run_count: 1,
  running_optimization_count: 1,
  latest_strategy_id: 'str-beta',
  latest_backtest_run_id: 'bt-102',
  latest_optimization_job_id: 'opt-201',
  top_momentum_warning: '最新提醒：样本外区间已同步。',
  quick_actions: ['创建策略', '刷新快照'],
};

const strategies: ApiStrategyListItem[] = [
  {
    id: 'str-alpha',
    name: '策略 Alpha',
    strategy_type: 'MOMENTUM',
    universe_name: 'QQQ',
    lifecycle_status: 'ACTIVE',
    latest_successful_run_id: 'bt-101',
    latest_optimization_job_id: 'opt-201',
    current_parameter_version: 3,
    current_parameter_version_id: 'str-alpha-v3',
    created_at: '2026-03-24T00:00:00.000Z',
    updated_at: '2026-03-31T03:00:00.000Z',
    parameters: { lookback_days: 126, top_n: 20 },
  },
  {
    id: 'str-beta',
    name: '策略 Beta',
    strategy_type: 'GRID',
    universe_name: 'SPY',
    lifecycle_status: 'ACTIVE',
    latest_successful_run_id: 'bt-102',
    latest_optimization_job_id: null,
    current_parameter_version: 1,
    current_parameter_version_id: 'str-beta-v1',
    created_at: '2026-03-25T00:00:00.000Z',
    updated_at: '2026-03-31T04:00:00.000Z',
    parameters: { window_size: 50, rebalance: 'weekly' },
  },
];

const strategyDetails: Record<string, ApiStrategyDetail> = {
  'str-alpha': {
    ...strategies[0],
    parameter_history: [
      {
        version_number: 3,
        parameter_version_id: 'str-alpha-v3',
        revision: 1,
        created_at: '2026-03-31T03:00:00.000Z',
        parameters: { lookback_days: 126, top_n: 20 },
      },
    ],
    allowed_actions: ['run_backtest'],
    confirmation_fields: { top_level: [], parameters: [] },
    strategy_type: 'MOMENTUM',
    universe_name: 'QQQ',
    current_parameter_version: 3,
    current_parameter_version_id: 'str-alpha-v3',
    latest_successful_run_id: 'bt-101',
    latest_optimization_job_id: 'opt-201',
    parameters: { lookback_days: 126, top_n: 20 },
  },
  'str-beta': {
    ...strategies[1],
    parameter_history: [
      {
        version_number: 1,
        parameter_version_id: 'str-beta-v1',
        revision: 1,
        created_at: '2026-03-31T04:00:00.000Z',
        parameters: { window_size: 50, rebalance: 'weekly' },
      },
    ],
    allowed_actions: ['run_backtest'],
    confirmation_fields: { top_level: [], parameters: [] },
    strategy_type: 'GRID',
    universe_name: 'SPY',
    current_parameter_version: 1,
    current_parameter_version_id: 'str-beta-v1',
    latest_successful_run_id: 'bt-102',
    latest_optimization_job_id: null,
    parameters: { window_size: 50, rebalance: 'weekly' },
  },
};

const runDetails: Record<string, ApiBacktestRunDetail> = {
  'bt-101': {
    id: 'bt-101',
    strategy_id: 'str-alpha',
    strategy_name: '策略 Alpha',
    status: 'COMPLETED',
    metrics: {
      total_return: 18.4,
      annualized_return: 11.2,
      sharpe: 1.18,
      max_drawdown: -6.4,
      oos_total_return: 5.4,
      oos_sharpe: 0.67,
    },
    warnings: [],
    preview: {
      oos_start_date: '2026-03-24',
      effective_date: '2026-03-24',
      data_segment_type: '样本外',
      metrics: { total_return: 18.4 },
    },
    chart_series: [
      { trade_date: '2026-03-01', equity: 100, benchmark: 100, drawdown: 0, is_oos: false },
      { trade_date: '2026-03-02', equity: 104, benchmark: 101, drawdown: -0.2, is_oos: false },
      { trade_date: '2026-03-03', equity: 108, benchmark: 102, drawdown: -0.4, is_oos: true },
    ],
    monthly_returns: [],
    trade_details: [],
    configuration: { execution_policy: 'T_CLOSE_TO_T1_OPEN' },
    parameter_snapshot: { lookback_days: 126, top_n: 20 },
    snapshot_summary: { dataset_snapshot_id: 'ds-alpha', universe_snapshot_id: 'un-alpha' },
    environment_summary: {},
    relative_metrics: {},
    consistency_score: {},
    risk_metrics: {},
    drawdown_events: [],
    rolling_metrics: [],
    data_segment_type: '样本外',
    parameter_version_id: 'str-alpha-v3',
    request: {},
    oos_start_date: '2026-03-24',
    effective_date: '2026-03-24',
    coverage_ratio: 0.71,
    coverage_days: 252,
    is_permanent: false,
    source_run_id: null,
    trades_count: 42,
    completed_at: '2026-03-31T03:30:00.000Z',
    updated_at: '2026-03-31T03:30:00.000Z',
  },
  'bt-102': {
    id: 'bt-102',
    strategy_id: 'str-beta',
    strategy_name: '策略 Beta',
    status: 'COMPLETED_WITH_WARNINGS',
    metrics: {
      total_return: 25.1,
      annualized_return: 14.4,
      sharpe: 1.42,
      max_drawdown: -5.6,
      oos_total_return: 6.3,
      oos_sharpe: 0.88,
    },
    warnings: ['样本外覆盖率偏低'],
    preview: {
      oos_start_date: '2026-03-25',
      effective_date: '2026-03-25',
      data_segment_type: '样本外',
      metrics: { total_return: 25.1 },
    },
    chart_series: [
      { trade_date: '2026-03-01', equity: 100, benchmark: 100, drawdown: 0, is_oos: false },
      { trade_date: '2026-03-02', equity: 103, benchmark: 101, drawdown: -0.1, is_oos: false },
      { trade_date: '2026-03-03', equity: 109, benchmark: 102, drawdown: -0.3, is_oos: true },
    ],
    monthly_returns: [],
    trade_details: [],
    configuration: { execution_policy: 'T_CLOSE_TO_T1_OPEN' },
    parameter_snapshot: { window_size: 50, rebalance: 'weekly' },
    snapshot_summary: { dataset_snapshot_id: 'ds-beta', universe_snapshot_id: 'un-beta' },
    environment_summary: {},
    relative_metrics: {},
    consistency_score: {},
    risk_metrics: {},
    drawdown_events: [],
    rolling_metrics: [],
    data_segment_type: '样本外',
    parameter_version_id: 'str-beta-v1',
    request: {},
    oos_start_date: '2026-03-25',
    effective_date: '2026-03-25',
    coverage_ratio: 0.82,
    coverage_days: 252,
    is_permanent: true,
    source_run_id: null,
    trades_count: 54,
    completed_at: '2026-03-31T04:20:00.000Z',
    updated_at: '2026-03-31T04:20:00.000Z',
  },
};

beforeEach(() => {
  fakeApi.getWorkspaceOverview.mockResolvedValue(overview);
  fakeApi.listStrategies.mockResolvedValue(strategies);
  fakeApi.getStrategyDetail.mockImplementation(async (id: string) => strategyDetails[id]!);
  fakeApi.listBacktestRuns.mockResolvedValue([
    {
      id: 'bt-101',
      strategy_id: 'str-alpha',
      strategy_name: '策略 Alpha',
      status: 'COMPLETED',
      completed_at: '2026-03-31T03:30:00.000Z',
      created_at: '2026-03-31T03:00:00.000Z',
      updated_at: '2026-03-31T03:30:00.000Z',
      metrics: { total_return: 18.4, sharpe: 1.18, max_drawdown: -6.4 },
      warnings: [],
      preview: { oos_start_date: '2026-03-24', data_segment_type: '样本外' },
      data_segment_type: '样本外',
      is_permanent: false,
    },
    {
      id: 'bt-102',
      strategy_id: 'str-beta',
      strategy_name: '策略 Beta',
      status: 'COMPLETED_WITH_WARNINGS',
      completed_at: '2026-03-31T04:20:00.000Z',
      created_at: '2026-03-31T03:50:00.000Z',
      updated_at: '2026-03-31T04:20:00.000Z',
      metrics: { total_return: 25.1, sharpe: 1.42, max_drawdown: -5.6 },
      warnings: ['样本外覆盖率偏低'],
      preview: { oos_start_date: '2026-03-25', data_segment_type: '样本外' },
      data_segment_type: '样本外',
      is_permanent: true,
    },
  ]);
  fakeApi.getBacktestRunDetail.mockImplementation(async (id: string) => runDetails[id]!);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('workspace dashboard', () => {
  it('renders the renovated workspace layout inside the Chinese shell', async () => {
    let container: HTMLElement | null = null;
    await act(async () => {
      ({ container } = render(
        <ShellFrameCn route={{ kind: 'workspace' }}>
          <WorkspacePage />
        </ShellFrameCn>,
      ));
    });

    expect(container!.querySelector('.page-heading')).toBeNull();
    expect(container!.querySelector('.workspace-page__content')).not.toBeNull();
    expect(container!.querySelectorAll('.workspace-card-grid .workspace-strategy-card')).toHaveLength(2);
    expect(container!.querySelector('.workspace-recent-runs__timeline')).not.toBeNull();

    expect(await screen.findByRole('heading', { name: '工作台健康度', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('当前研究工作台的核心状态与风险提示。')).toBeInTheDocument();
    expect(screen.queryByText('创建、回测和优化的统一工作台。')).not.toBeInTheDocument();

    expect(await screen.findByRole('button', { name: '创建策略' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '数据快照' })).toBeInTheDocument();
    expect((await screen.findAllByRole('heading', { name: '策略看板', level: 3 })).length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: '最近回测', level: 3 })).toBeInTheDocument();
    expect((await screen.findAllByText('策略 Alpha')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('策略 Beta')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('bt-102')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '打开最新策略' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开对比' })).not.toBeInTheDocument();
    expect(screen.getAllByText('样本外收益').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('策略走势').length).toBeGreaterThan(0);
    expect(screen.getByText('执行策略 T_CLOSE_TO_T1_OPEN')).toBeInTheDocument();
    expect(screen.getByText('快照 ds-alpha / un-alpha')).toBeInTheDocument();
    expect(screen.getByText('收益率 +25.1%')).toBeInTheDocument();
    expect(screen.getByText('夏普比率 1.42')).toBeInTheDocument();
    expect(screen.queryByText('查看详情')).not.toBeInTheDocument();
  });
});