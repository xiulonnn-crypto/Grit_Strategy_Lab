import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsIndexPage } from './pages/runs-index-page';
import type { ApiBacktestRunListItem, ApiStrategyListItem } from './types';

type FakeApi = {
  listStrategies: ReturnType<typeof vi.fn>;
  getStrategyDetail: ReturnType<typeof vi.fn>;
  listBacktestRuns: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
  submitBacktestRun: ReturnType<typeof vi.fn>;
  deleteBacktestRun: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  listStrategies: vi.fn(),
  getStrategyDetail: vi.fn(),
  listBacktestRuns: vi.fn(),
  getBacktestRunDetail: vi.fn(),
  submitBacktestRun: vi.fn(),
  deleteBacktestRun: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const strategies: ApiStrategyListItem[] = [
  {
    id: 'str-alpha',
    name: '策略 Alpha',
    description: '多因子动量策略',
    strategy_type: 'MOMENTUM',
    universe_name: 'S&P 500',
    current_parameter_version: 2,
    current_parameter_version_id: 'str-alpha-v2',
    latest_run_id: 'bt-alpha-20y',
    latest_successful_run_id: 'bt-alpha-10y',
    latest_completed_run_summary: {
      run_id: 'bt-alpha-10y',
      parameter_version: 1,
      parameter_version_id: 'str-alpha-v1',
      status: 'COMPLETED',
      total_return: 0.184,
      annualized_return: 0.093,
      sharpe: 1.18,
      max_drawdown: -0.064,
      oos_total_return: 0.041,
      oos_annualized_return: 0.036,
      oos_sharpe: 0.92,
      oos_max_drawdown: -0.028,
      warning_count: 0,
      execution_policy: 'daily_close',
      dataset_snapshot_id: 'ds-price-202604',
      universe_snapshot_id: 'universe-sp500-202604',
      completed_at: '2026-03-31T03:30:00.000Z',
      sparkline_points: [],
    },
  },
  {
    id: 'str-beta',
    name: '策略 Beta',
    description: '质量价值策略',
    strategy_type: 'GENERAL',
    universe_name: 'NASDAQ 100',
    current_parameter_version: 1,
    current_parameter_version_id: 'str-beta-v1',
    latest_run_id: 'bt-beta-10y',
    latest_successful_run_id: 'bt-beta-10y',
  },
];

const runs: ApiBacktestRunListItem[] = [
  {
    id: 'bt-alpha-10y',
    strategy_id: 'str-alpha',
    strategy_name: '策略 Alpha',
    parameter_version_id: 'str-alpha-v1',
    status: 'COMPLETED',
    start_date: '2016-03-31',
    end_date: '2026-03-31',
    created_at: '2026-03-31T03:00:00.000Z',
    updated_at: '2026-03-31T03:30:00.000Z',
    completed_at: '2026-03-31T03:30:00.000Z',
    metrics: { total_return: 0.184, annualized_return: 0.093, sharpe: 1.18, max_drawdown: -0.064 },
    warnings: [],
    preview: {
      effective_start_date: '2016-03-31',
      effective_end_date: '2026-03-31',
      data_segment_type: 'FULL',
      parameter_version_id: 'str-alpha-v1',
    },
    data_segment_type: 'FULL',
    trades_count: 42,
    is_permanent: true,
  },
  {
    id: 'bt-alpha-20y',
    strategy_id: 'str-alpha',
    strategy_name: '策略 Alpha',
    parameter_version_id: 'str-alpha-v2',
    status: 'RUNNING',
    start_date: '2006-03-31',
    end_date: '2026-03-31',
    created_at: '2026-04-01T03:00:00.000Z',
    updated_at: '2026-04-01T03:12:00.000Z',
    completed_at: null,
    metrics: {},
    warnings: ['长周期补齐正在计算'],
    preview: {
      effective_start_date: '2006-03-31',
      effective_end_date: '2026-03-31',
      data_segment_type: 'FULL',
      parameter_version_id: 'str-alpha-v2',
    },
    data_segment_type: 'FULL',
    trades_count: 0,
    is_permanent: true,
  },
  {
    id: 'bt-beta-10y',
    strategy_id: 'str-beta',
    strategy_name: '策略 Beta',
    parameter_version_id: 'str-beta-v1',
    status: 'COMPLETED_WITH_WARNINGS',
    start_date: '2016-03-31',
    end_date: '2026-03-31',
    created_at: '2026-03-30T03:50:00.000Z',
    updated_at: '2026-03-30T04:20:00.000Z',
    completed_at: '2026-03-30T04:20:00.000Z',
    metrics: { total_return: 0.251, annualized_return: 0.114, sharpe: 1.42, max_drawdown: -0.056 },
    warnings: ['收益曲线存在轻微波动'],
    preview: {
      effective_start_date: '2016-03-31',
      effective_end_date: '2026-03-31',
      data_segment_type: 'FULL',
      parameter_version_id: 'str-beta-v1',
    },
    data_segment_type: 'FULL',
    trades_count: 54,
    is_permanent: true,
  },
];

function requireSelector(selector: string): HTMLElement {
  const element = document.querySelector(selector);
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

async function renderRunsPage(): Promise<void> {
  await act(async () => {
    render(<RunsIndexPage />);
  });
}

beforeEach(() => {
  fakeApi.listStrategies.mockResolvedValue(strategies);
  fakeApi.getStrategyDetail.mockImplementation((id: string) => {
    const strategy = strategies.find((item) => item.id === id) ?? strategies[0];
    return Promise.resolve({
      ...strategy,
      parameter_history: [
        {
          version_number: 1,
          parameter_version_id: `${id}-v1`,
          revision: 1,
          created_at: '2026-03-01T00:00:00.000Z',
          change_summary: '初始长期证据参数。',
          decision_note: null,
          parameters: {},
        },
        {
          version_number: 2,
          parameter_version_id: `${id}-v2`,
          revision: 2,
          created_at: '2026-03-20T00:00:00.000Z',
          change_summary: '调低回撤阈值并补齐长周期验证。',
          decision_note: null,
          parameters: {},
        },
      ],
      allowed_actions: ['backtest'],
    });
  });
  fakeApi.listBacktestRuns.mockResolvedValue(runs);
  fakeApi.getBacktestRunDetail.mockImplementation((id: string) => {
    const source = runs.find((run) => run.id === id) ?? runs[0];
    return Promise.resolve({
      id: source.id,
      strategy_id: source.strategy_id,
      strategy_name: source.strategy_name,
      parameter_version_id: source.parameter_version_id,
      status: source.status,
      metrics: source.metrics,
      warnings: source.warnings ?? [],
      created_at: source.created_at,
      updated_at: source.updated_at,
      completed_at: source.completed_at,
      is_permanent: source.is_permanent,
    });
  });
  fakeApi.submitBacktestRun.mockResolvedValue({
    id: 'bt-alpha-30y',
    strategy_id: 'str-alpha',
    status: 'QUEUED',
  });
  fakeApi.deleteBacktestRun.mockResolvedValue({
    id: 'bt-alpha-10y',
    deleted_at: '2026-04-13T08:15:00.000Z',
    deleted_reason: 'manual_delete',
  });
  window.location.hash = '#/runs';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.location.hash = '';
});

describe('runs index page', () => {
  it('renders the approved strategy library shell with heading metrics, toolbar, evidence tree, and smart taskbar', async () => {
    await renderRunsPage();

    const page = requireSelector('[data-page-root="runs-index"], .runs-index-page');
    expect(page).toBeInTheDocument();
    expect(page).toHaveTextContent('回测数据');
    expect(page).toHaveTextContent('回测历史');
    expect(page).toHaveTextContent('按策略与参数版本归档回测证据');
    expect(page).toHaveTextContent('策略组');
    expect(page).toHaveTextContent('永久回测');
    expect(page).toHaveTextContent('待补长周期');

    const strategyLibraryTab = await screen.findByRole('tab', { name: /策略库视图/ });
    expect(strategyLibraryTab).toBeInTheDocument();
    expect(strategyLibraryTab).toHaveClass('is-active');
    expect(screen.getByRole('tab', { name: /最近运行/ })).toBeInTheDocument();

    expect(screen.getByLabelText('搜索策略、版本或 run id')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /仅永久回测/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /显示临时/ })).toBeInTheDocument();

    const taskbar = screen.getByRole('heading', { name: /智能任务栏/ }).closest('.runs-rail-section');
    expect(taskbar).not.toBeNull();
    expect(taskbar).toHaveTextContent(/智能任务栏/);
    expect(taskbar).toHaveTextContent(/批量补齐/);
    expect(taskbar).toHaveTextContent(/补齐长周期/);

    const library = screen.getByLabelText('策略库视图');
    expect(library).toHaveClass('runs-library-panel');
    expect(library).toHaveTextContent('Strategy Library');
    expect(library).toHaveTextContent('策略-版本证据树');
    expect(library).toHaveTextContent('只读证据库');
    expect(library).toHaveTextContent('策略 / 版本 / 运行');
    expect(library).toHaveTextContent('策略 Alpha');
    expect(library).toHaveTextContent('策略 Beta');

    const evidenceTree = requireSelector('.runs-library-panel .runs-tree');
    expect(evidenceTree).toHaveTextContent('2 次回测 / 2 个版本 · 当前版本 v2 · 最佳证据 v1');
    expect(evidenceTree).toHaveTextContent('证据断裂');
    expect(evidenceTree).toHaveTextContent('10Y 已覆盖');
    expect(evidenceTree).toHaveTextContent('最新 bt-alpha-20y');
    expect(evidenceTree).toHaveTextContent('调低回撤阈值并补齐长周期验证。');
    expect(evidenceTree).toHaveTextContent('bt-alpha-20y');
    expect(evidenceTree).toHaveTextContent('20Y · 永久回测 · 2006-03-31 至 2026-03-31');
    expect(evidenceTree).not.toHaveTextContent('str-alpha-v2 ·');
    expect(evidenceTree).not.toHaveTextContent('bt-alpha-10y');

    expect(fakeApi.getBacktestRunDetail).not.toHaveBeenCalled();
  });

  it('shows long-horizon virtual rows for queued and calculating gaps and submits batch backfill', async () => {
    let resolveSubmit: (value: unknown) => void = () => undefined;
    fakeApi.submitBacktestRun.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    await renderRunsPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量补齐/ }));
    });

    await waitFor(() => {
      expect(fakeApi.submitBacktestRun).toHaveBeenCalledWith(
        'str-alpha',
        expect.objectContaining({
          parameter_version_id: 'str-alpha-v2',
          source_run_id: 'bt-alpha-20y',
          is_permanent: true,
        }),
      );
    });
    expect(screen.getAllByText('排队中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('计算中...').length).toBeGreaterThan(0);

    await act(async () => {
      resolveSubmit({
        id: 'bt-alpha-30y',
        strategy_id: 'str-alpha',
        strategy_name: '策略 Alpha',
        parameter_version_id: 'str-alpha-v2',
        status: 'COMPLETED',
        start_date: '1996-03-31',
        end_date: '2026-03-31',
        metrics: { total_return: 0.44, annualized_return: 0.12, sharpe: 1.2, max_drawdown: -0.08 },
        warnings: [],
        is_permanent: true,
      });
      await Promise.resolve();
    });
  });

  it('navigates from strategy-library run rows to the run detail route', async () => {
    await renderRunsPage();

    const library = await screen.findByLabelText('策略库视图');
    const runRow = library.querySelector('.runs-evidence-row--run');
    expect(runRow).not.toBeNull();
    expect(runRow).toHaveTextContent('bt-alpha-20y');
    fireEvent.click(runRow as HTMLElement);

    await waitFor(() => expect(window.location.hash).toBe('#/runs/bt-alpha-20y'));
    expect(fakeApi.getBacktestRunDetail).not.toHaveBeenCalled();
  });

  it('navigates from recent-run rows to the run detail route', async () => {
    await renderRunsPage();

    fireEvent.click(screen.getByRole('tab', { name: /最近运行/ }));
    const recentRuns = await screen.findByLabelText('最近运行');
    expect(recentRuns).toHaveTextContent('最近运行时间线');
    expect(recentRuns).toHaveTextContent('操作');
    expect(within(recentRuns).getAllByRole('button', { name: /^删除$/ }).length).toBeGreaterThan(0);
    expect(recentRuns).toHaveTextContent('bt-alpha-10y');
    expect(recentRuns).toHaveTextContent('bt-beta-10y');

    const betaRow = within(recentRuns).getByText('策略 Beta · str-beta-v1').closest('.runs-recent-row');
    expect(betaRow).not.toBeNull();
    fireEvent.click(betaRow as HTMLElement);

    await waitFor(() => expect(window.location.hash).toBe('#/runs/bt-beta-10y'));
    expect(fakeApi.getBacktestRunDetail).not.toHaveBeenCalled();
  });

  it('keeps the strategy library read-only while preserving historical recent-run operations', async () => {
    await renderRunsPage();

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText(/对比模式/)).toBeNull();
    expect(document.querySelector('.runs-compare-mode, [data-testid="runs-compare-mode"]')).toBeNull();

    const library = screen.getByLabelText('策略库视图');
    expect(within(library).queryByRole('button', { name: /^删除$/ })).toBeNull();
    expect(library).not.toHaveTextContent('操作');

    fireEvent.click(screen.getByRole('tab', { name: /最近运行/ }));
    const recentRuns = await screen.findByLabelText('最近运行');
    expect(recentRuns).toHaveTextContent('操作');

    fireEvent.click(within(recentRuns).getAllByRole('button', { name: /^删除$/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: /删除回测/ });
    expect(dialog).toHaveTextContent('确认删除');
    expect(dialog).toHaveTextContent('记录将从最近运行列表移除');

    fireEvent.click(within(dialog).getByRole('button', { name: /^确认删除$/ }));
    await waitFor(() => {
      expect(fakeApi.deleteBacktestRun).toHaveBeenCalled();
    });
  });
});
