import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './pages/workspace-page-lane-b';
import { ShellFrameCn } from './shell-frame-cn';
import { buildWorkspaceStrategyCards, formatParameterLabel, formatParameterValue } from './lib/workspace-adapters';
import type { ApiOptimizationJobListItem, ApiStrategyDetail, ApiStrategyListItem, ApiWorkspaceOverview } from './types';

type FakeApi = {
  getWorkspaceOverview: ReturnType<typeof vi.fn>;
  listStrategies: ReturnType<typeof vi.fn>;
  getStrategyDetail: ReturnType<typeof vi.fn>;
  listBacktestRuns: ReturnType<typeof vi.fn>;
  listOptimizationJobs: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getWorkspaceOverview: vi.fn(),
  listStrategies: vi.fn(),
  getStrategyDetail: vi.fn(),
  listBacktestRuns: vi.fn(),
  listOptimizationJobs: vi.fn(),
  getBacktestRunDetail: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const overview: ApiWorkspaceOverview = {
  workspace_name: 'Grit \u7b56\u7565\u5b9e\u9a8c\u5ba4',
  subtitle: '\u521b\u5efa\u3001\u56de\u6d4b\u548c\u4f18\u5316\u90fd\u5728\u540c\u4e00\u6761\u4e3b\u94fe\u8def\u91cc\u5b8c\u6210\u3002',
  strategy_count: 2,
  active_run_count: 1,
  running_optimization_count: 1,
  latest_strategy_id: 'str-beta',
  latest_backtest_run_id: 'bt-102',
  latest_optimization_job_id: 'opt-201',
  top_momentum_warning: '\u6837\u672c\u5916\u8868\u73b0\u9700\u8981\u7ee7\u7eed\u89c2\u5bdf\u3002',
  quick_actions: ['\u521b\u5efa\u7b56\u7565', '\u6570\u636e\u5feb\u7167'],
};

const strategies: ApiStrategyListItem[] = [
  {
    id: 'str-alpha',
    name: '\u7b56\u7565 Alpha',
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
    latest_completed_run_summary: {
      run_id: 'bt-101',
      parameter_version: 3,
      parameter_version_id: 'str-alpha-v3',
      status: 'COMPLETED',
      total_return: 0.184,
      annualized_return: 0.112,
      sharpe: 1.18,
      max_drawdown: -0.064,
      oos_total_return: 0.054,
      oos_annualized_return: 0.041,
      oos_sharpe: 0.67,
      oos_max_drawdown: -0.031,
      warning_count: 0,
      execution_policy: 'T_CLOSE_TO_T1_OPEN',
      dataset_snapshot_id: 'ds-alpha',
      universe_snapshot_id: 'un-alpha',
      completed_at: '2026-03-31T03:30:00.000Z',
      sparkline_points: [
        { date: '2026-03-01', equity: 100, is_oos: false },
        { date: '2026-03-02', equity: 104, is_oos: false },
        { date: '2026-03-03', equity: 108, is_oos: true },
      ],
    },
  },
  {
    id: 'str-beta',
    name: '\u7b56\u7565 Beta',
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
    latest_completed_run_summary: {
      run_id: 'bt-102',
      parameter_version: 1,
      parameter_version_id: 'str-beta-v1',
      status: 'COMPLETED_WITH_WARNINGS',
      total_return: 0.251,
      annualized_return: 0.144,
      sharpe: 1.42,
      max_drawdown: -0.056,
      oos_total_return: 0.063,
      oos_annualized_return: 0.052,
      oos_sharpe: 0.88,
      oos_max_drawdown: -0.028,
      warning_count: 1,
      execution_policy: 'T_CLOSE_TO_T1_OPEN',
      dataset_snapshot_id: 'ds-beta',
      universe_snapshot_id: 'un-beta',
      completed_at: '2026-03-31T04:20:00.000Z',
      sparkline_points: [
        { date: '2026-03-01', equity: 100, is_oos: false },
        { date: '2026-03-02', equity: 103, is_oos: false },
        { date: '2026-03-03', equity: 109, is_oos: true },
      ],
    },
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
  },
};

const optimizationJobs: ApiOptimizationJobListItem[] = [
  {
    id: 'opt-201',
    strategy_id: 'str-alpha',
    strategy_name: '策略 Alpha',
    status: 'RUNNING',
    entry_point: 'run_detail',
    validation_mode: 'walk_forward',
    source_run_id: 'bt-101',
    budget_combinations: 24,
    completed_combinations: 10,
    progress_pct: 42,
    current_stage: 'Running trial 11/24',
    latest_update: 'Completed 10/24 trials.',
    estimated_remaining_minutes: 12,
    estimated_completed_at: '2026-03-31T05:22:00.000Z',
    best_candidate_id: null,
    best_candidate_label: '稳定策略中心',
    base_parameter_version_id: 'str-alpha-v3',
    created_at: '2026-03-31T04:40:00.000Z',
    updated_at: '2026-03-31T05:10:00.000Z',
    completed_at: null,
    best_metrics_summary: {
      trial_index: 1,
      label: '稳定策略中心',
      status: 'SUCCEEDED',
      parameter_snapshot: { lookback_days: 126, top_n: 20 },
      metrics: {
        annualized_return: 0.138,
        return_sharpe: 1.21,
        out_of_sample_sharpe: 0.93,
        max_drawdown_pct: -8.4,
        stability: 84,
      },
      score: 1.043,
      error_message: null,
      started_at: '2026-03-31T04:42:00.000Z',
      completed_at: '2026-03-31T04:44:00.000Z',
    },
  },
  {
    id: 'opt-199',
    strategy_id: 'str-beta',
    strategy_name: '策略 Beta',
    status: 'COMPLETED',
    entry_point: 'strategy_detail',
    validation_mode: 'walk_forward',
    source_run_id: 'bt-102',
    budget_combinations: 18,
    completed_combinations: 18,
    progress_pct: 100,
    current_stage: '优化完成',
    latest_update: '优化已完成，当前首选为 稳态晋升候选。',
    estimated_remaining_minutes: 0,
    estimated_completed_at: '2026-03-31T03:10:00.000Z',
    best_candidate_id: 'trial-1',
    best_candidate_label: '稳态晋升候选',
    base_parameter_version_id: 'str-beta-v1',
    created_at: '2026-03-31T02:20:00.000Z',
    updated_at: '2026-03-31T03:10:00.000Z',
    completed_at: '2026-03-31T03:10:00.000Z',
    best_metrics_summary: {
      trial_index: 1,
      label: '稳态晋升候选',
      status: 'SUCCEEDED',
      parameter_snapshot: { window_size: 50, rebalance: 'weekly' },
      metrics: {
        annualized_return: 0.184,
        return_sharpe: 1.34,
        out_of_sample_sharpe: 0.98,
        max_drawdown_pct: -7.2,
        stability: 87,
      },
      score: 1.188,
      error_message: null,
      started_at: '2026-03-31T02:22:00.000Z',
      completed_at: '2026-03-31T02:24:00.000Z',
    },
  },
];

beforeEach(() => {
  fakeApi.getWorkspaceOverview.mockResolvedValue(overview);
  fakeApi.listStrategies.mockResolvedValue(strategies);
  fakeApi.getStrategyDetail.mockImplementation(async (id: string) => strategyDetails[id]!);
  fakeApi.listBacktestRuns.mockResolvedValue([
    {
      id: 'bt-101',
      strategy_id: 'str-alpha',
      strategy_name: '\u7b56\u7565 Alpha',
      parameter_version_id: 'str-alpha-v3',
      status: 'COMPLETED',
      completed_at: '2026-03-31T03:30:00.000Z',
      created_at: '2026-03-31T03:00:00.000Z',
      updated_at: '2026-03-31T03:30:00.000Z',
      metrics: { total_return: 0.184, annualized_return: 0.112, sharpe: 1.18, max_drawdown: -0.064 },
      warnings: [],
      preview: { oos_start_date: '2026-03-24', data_segment_type: 'FULL' },
      data_segment_type: 'FULL',
      is_permanent: false,
    },
    {
      id: 'bt-102',
      strategy_id: 'str-beta',
      strategy_name: '\u7b56\u7565 Beta',
      parameter_version_id: 'str-beta-v1',
      status: 'COMPLETED_WITH_WARNINGS',
      completed_at: '2026-03-31T04:20:00.000Z',
      created_at: '2026-03-31T03:50:00.000Z',
      updated_at: '2026-03-31T04:20:00.000Z',
      metrics: { total_return: 0.251, annualized_return: 0.144, sharpe: 1.42, max_drawdown: -0.056 },
      warnings: ['\u6837\u672c\u5916\u8868\u73b0\u5f31\u5316'],
      preview: { oos_start_date: '2026-03-25', data_segment_type: 'FULL' },
      data_segment_type: 'FULL',
      is_permanent: true,
    },
  ]);
  fakeApi.listOptimizationJobs.mockResolvedValue(optimizationJobs);
  fakeApi.getBacktestRunDetail.mockResolvedValue(null);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('workspace dashboard', () => {
  it('localizes overnight execution metadata and shared parameter labels', () => {
    const overnightStrategy: ApiStrategyListItem = {
      ...strategies[0],
      id: 'str-overnight',
      name: '隔夜QQQ',
      strategy_type: 'GENERAL',
      parameters: {
        strategy_type: 'GENERAL',
        execution_profile: 'overnight_close_to_next_open',
        execution_symbol: 'QQQ',
        entry_price_field: 'close',
        exit_price_field: 'next_open',
        entry_weight_pct: 100,
        exit_weight_pct: 100,
      },
      latest_completed_run_summary: {
        ...strategies[0].latest_completed_run_summary!,
        run_id: 'run-overnight',
        execution_policy: 'D_CLOSE_BUY_D1_OPEN_SELL',
      },
    };

    const [card] = buildWorkspaceStrategyCards([overnightStrategy], {}, {});

    expect(card.metaPrimary).toBe('执行策略 当日收盘买入，下一交易日开盘卖出');
    expect([
      'execution_profile',
      'execution_symbol',
      'entry_price_field',
      'exit_price_field',
      'entry_weight_pct',
      'exit_weight_pct',
    ].map(formatParameterLabel)).toEqual([
      '执行方式',
      '成交标的',
      '买入价格',
      '卖出价格',
      '买入仓位(%)',
      '卖出仓位(%)',
    ]);
    expect(formatParameterValue('overnight_close_to_next_open', 'execution_profile')).toBe(
      '当日收盘买入，下一交易日开盘卖出',
    );
    expect(formatParameterValue('close', 'entry_price_field')).toBe('收盘价');
    expect(formatParameterValue('next_open', 'exit_price_field')).toBe('下一交易日开盘价');
  });

  it('renders workspace cards from strategy summaries without detail fan-out', async () => {
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
    expect(screen.getByText('最近回测优化')).toBeInTheDocument();
    expect(screen.getByText('总览策略规模、活跃回测与优化进度，直达最新任务。')).toBeInTheDocument();
    expect(screen.getByText('按当前参数版本呈现收益走势与策略对比。')).toBeInTheDocument();
    expect(screen.getByText('汇总近 8 条回测与优化记录，按最新进展排序。')).toBeInTheDocument();

    expect((await screen.findAllByText('\u7b56\u7565 Alpha')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('\u7b56\u7565 Beta')).length).toBeGreaterThan(0);
    expect(screen.queryByText('ds-alpha / un-alpha', { exact: false })).toBeNull();
    expect(screen.getByText('最近编辑时间 3月31日 03:00')).toBeInTheDocument();
    expect(screen.getByText('最近编辑时间 3月31日 04:00')).toBeInTheDocument();
    expect(screen.getByText('+14.4%')).toBeInTheDocument();
    expect(screen.getByText('1.42')).toBeInTheDocument();
    expect(container!.textContent).toContain('opt-201');
    expect(container!.textContent).toContain('已完成 10/24 组试验');
    expect(container!.textContent).toContain('预计 12 分钟');
    expect(container!.textContent).toContain('阶段 正在评估第 11/24 组');
    expect(container!.textContent).toContain('策略详情 · 滚动前瞻验证');
    expect(container!.textContent).not.toContain('版本 v');
    expect(container!.textContent).not.toContain('基准版本');
    expect(container!.textContent).not.toContain('ETA');
    expect(container!.textContent).not.toContain('Running trial');
    expect(container!.textContent).not.toContain('Completed 10/24 trials.');
    expect(container!.textContent).not.toContain('Walk Forward');
    expect(container!.textContent).toContain('年化收益率 +18.4%');
    const recentVersionBadges = Array.from(
      container!.querySelectorAll('.workspace-recent-runs__version'),
    ).map((node) => node.textContent?.trim());
    expect(recentVersionBadges).toEqual(expect.arrayContaining(['v3', 'v1']));
    const recentIds = Array.from(container!.querySelectorAll('.workspace-recent-runs__run-id')).map((node) => node.textContent?.trim());
    expect(recentIds[0]).toBe('opt-201');
    expect(fakeApi.getBacktestRunDetail).not.toHaveBeenCalled();
  });

  it('limits the strategy board to the six most recently edited strategies', async () => {
    const editedStrategies: ApiStrategyListItem[] = Array.from({ length: 8 }, (_, index) => {
      const ordinal = index + 1;
      const day = String(ordinal).padStart(2, '0');
      return {
        ...strategies[0],
        id: `str-board-${ordinal}`,
        name: `策略 ${ordinal}`,
        latest_successful_run_id: null,
        latest_run_id: null,
        latest_optimization_job_id: null,
        current_parameter_version: ordinal,
        current_parameter_version_id: `str-board-${ordinal}-v${ordinal}`,
        created_at: `2026-03-${day}T00:00:00.000Z`,
        updated_at: `2026-03-${day}T0${Math.min(ordinal, 9)}:00:00.000Z`,
        parameters: { lookback_days: 100 + ordinal, top_n: 10 + ordinal },
        latest_completed_run_summary: null,
      };
    });

    fakeApi.getWorkspaceOverview.mockResolvedValue({
      ...overview,
      strategy_count: editedStrategies.length,
      latest_strategy_id: null,
      latest_backtest_run_id: null,
      latest_optimization_job_id: null,
    });
    fakeApi.listStrategies.mockResolvedValue(editedStrategies);
    fakeApi.listBacktestRuns.mockResolvedValue([]);
    fakeApi.listOptimizationJobs.mockResolvedValue([]);

    let container: HTMLElement | null = null;
    await act(async () => {
      ({ container } = render(
        <ShellFrameCn route={{ kind: 'workspace' }}>
          <WorkspacePage />
        </ShellFrameCn>,
      ));
    });

    await waitFor(() =>
      expect(
        container!.querySelectorAll('.workspace-card-grid .workspace-strategy-card h4'),
      ).toHaveLength(6),
    );
    const cardTitles = Array.from(
      container!.querySelectorAll('.workspace-card-grid .workspace-strategy-card h4'),
    ).map((node) => node.textContent?.trim());
    expect(cardTitles).toEqual(['策略 8', '策略 7', '策略 6', '策略 5', '策略 4', '策略 3']);
    expect(container!.textContent).not.toContain('策略 2');
    expect(container!.textContent).not.toContain('策略 1');
  });
});
