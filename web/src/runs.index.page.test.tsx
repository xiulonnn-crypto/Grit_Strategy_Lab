import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsIndexPage } from './pages/runs-index-page';
import type { ApiBacktestRunDetail, ApiBacktestRunListItem } from './types';

type FakeApi = {
  listBacktestRuns: ReturnType<typeof vi.fn>;
  listStrategies: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  listBacktestRuns: vi.fn(),
  listStrategies: vi.fn(),
  getBacktestRunDetail: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const runs: ApiBacktestRunListItem[] = [
  {
    id: 'bt-101',
    strategy_id: 'str-alpha',
    status: 'COMPLETED',
    created_at: '2026-03-31T03:00:00.000Z',
    updated_at: '2026-03-31T03:30:00.000Z',
    completed_at: '2026-03-31T03:30:00.000Z',
    metrics: { total_return: 18.4, sharpe: 1.18, max_drawdown: -6.4 },
    warnings: [],
    preview: { oos_start_date: '2026-03-24', data_segment_type: '样本外' },
    data_segment_type: '样本外',
    trades_count: 42,
  },
  {
    id: 'bt-102',
    strategy_id: 'str-beta',
    status: 'COMPLETED_WITH_WARNINGS',
    created_at: '2026-03-31T03:50:00.000Z',
    updated_at: '2026-03-31T04:20:00.000Z',
    completed_at: '2026-03-31T04:20:00.000Z',
    metrics: { total_return: 25.1, sharpe: 1.42, max_drawdown: -5.6 },
    warnings: ['样本外覆盖率偏低'],
    preview: { oos_start_date: '2026-03-25', data_segment_type: '样本外' },
    data_segment_type: '样本外',
    trades_count: 54,
  },
];

const strategies = [
  { id: 'str-alpha', name: '策略 Alpha' },
  { id: 'str-beta', name: '策略 Beta' },
];

const details: Record<string, ApiBacktestRunDetail> = {
  'bt-101': {
    id: 'bt-101',
    strategy_id: 'str-alpha',
    strategy_name: '策略 Alpha',
    status: 'COMPLETED',
    metrics: { total_return: 18.4, annualized_return: 11.2, sharpe: 1.18, max_drawdown: -6.4 },
    warnings: [],
    preview: { oos_start_date: '2026-03-24', effective_date: '2026-03-24', data_segment_type: '样本外' },
    chart_series: [],
    monthly_returns: [],
    trade_details: [],
    configuration: {},
    parameter_snapshot: {},
    snapshot_summary: {},
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
  },
  'bt-102': {
    id: 'bt-102',
    strategy_id: 'str-beta',
    strategy_name: '策略 Beta',
    status: 'COMPLETED_WITH_WARNINGS',
    metrics: { total_return: 25.1, annualized_return: 14.4, sharpe: 1.42, max_drawdown: -5.6 },
    warnings: ['样本外覆盖率偏低'],
    preview: { oos_start_date: '2026-03-25', effective_date: '2026-03-25', data_segment_type: '样本外' },
    chart_series: [],
    monthly_returns: [],
    trade_details: [],
    configuration: {},
    parameter_snapshot: {},
    snapshot_summary: {},
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
    is_permanent: false,
    source_run_id: null,
    trades_count: 54,
  },
};

beforeEach(() => {
  fakeApi.listBacktestRuns.mockResolvedValue(runs);
  fakeApi.listStrategies.mockResolvedValue(strategies);
  fakeApi.getBacktestRunDetail.mockImplementation(async (id: string) => details[id]!);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('runs index page', () => {
  it('renders a Chinese run list and navigates from the run id and strategy name links', async () => {
    await act(async () => {
      render(<RunsIndexPage />);
    });

    expect(await screen.findByRole('heading', { name: '回测列表', level: 2 })).toBeInTheDocument();
    expect(await screen.findByText('回测号')).toBeInTheDocument();
    expect(screen.getByText('类型')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建策略' })).not.toBeInTheDocument();
    expect(screen.queryByText('点击一行直接进入运行详情。')).not.toBeInTheDocument();
    expect(screen.queryByText('样本外')).not.toBeInTheDocument();

    const tableRows = screen.getAllByRole('row');
    expect(tableRows[1]).toHaveTextContent('bt-102');
    expect(tableRows[1]).toHaveTextContent('策略 Beta');
    expect(tableRows[1]).toHaveTextContent('临时回测');
    expect(tableRows[1]).toHaveTextContent('有提醒');
    expect(tableRows[1]).toHaveTextContent('25.1%');
    expect(tableRows[1]).toHaveTextContent('1.42');

    fireEvent.click(screen.getByRole('button', { name: '策略 Beta' }));
    await waitFor(() => expect(window.location.hash).toBe('#/strategies/str-beta'));

    fireEvent.click(screen.getByRole('button', { name: 'bt-102' }));
    await waitFor(() => expect(window.location.hash).toBe('#/runs/bt-102'));
  });
});

