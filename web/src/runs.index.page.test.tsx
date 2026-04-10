import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunsIndexPage } from './pages/runs-index-page';
import type { ApiBacktestRunListItem } from './types';

type FakeApi = {
  listBacktestRuns: ReturnType<typeof vi.fn>;
  getBacktestRunDetail: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  listBacktestRuns: vi.fn(),
  getBacktestRunDetail: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const runs: ApiBacktestRunListItem[] = [
  {
    id: 'bt-101',
    strategy_id: 'str-alpha',
    strategy_name: '策略 Alpha',
    status: 'COMPLETED',
    created_at: '2026-03-31T03:00:00.000Z',
    updated_at: '2026-03-31T03:30:00.000Z',
    completed_at: '2026-03-31T03:30:00.000Z',
    metrics: { total_return: 0.184, sharpe: 1.18, max_drawdown: -0.064 },
    warnings: [],
    preview: { oos_start_date: '2026-03-24', data_segment_type: 'FULL' },
    data_segment_type: 'FULL',
    trades_count: 42,
    is_permanent: false,
  },
  {
    id: 'bt-102',
    strategy_id: 'str-beta',
    strategy_name: '策略 Beta',
    status: 'COMPLETED_WITH_WARNINGS',
    created_at: '2026-03-31T03:50:00.000Z',
    updated_at: '2026-03-31T04:20:00.000Z',
    completed_at: '2026-03-31T04:20:00.000Z',
    metrics: { total_return: 0.251, sharpe: 1.42, max_drawdown: -0.056 },
    warnings: ['样本外覆盖不足'],
    preview: { oos_start_date: '2026-03-25', data_segment_type: 'FULL' },
    data_segment_type: 'FULL',
    trades_count: 54,
    is_permanent: true,
  },
];

beforeEach(() => {
  fakeApi.listBacktestRuns.mockResolvedValue(runs);
  fakeApi.getBacktestRunDetail.mockResolvedValue(null);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.location.hash = '';
});

describe('runs index page', () => {
  it('renders the run list from the list endpoint and does not fetch per-run details', async () => {
    await act(async () => {
      render(<RunsIndexPage />);
    });

    expect(await screen.findByRole('heading', { name: '回测列表', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('按最新完成时间排序。')).toBeInTheDocument();

    const runsTable = document.querySelector('.runs-index-table');
    expect(runsTable).not.toBeNull();

    const tableRows = within(runsTable as HTMLElement).getAllByRole('row');
    expect(tableRows[1]).toHaveTextContent('bt-102');
    expect(tableRows[1]).toHaveTextContent('策略 Beta');
    expect(tableRows[1]).toHaveTextContent('永久回测');
    expect(tableRows[1]).toHaveTextContent('有提醒');
    expect(tableRows[1]).toHaveTextContent('+25.1%');
    expect(tableRows[1]).toHaveTextContent('1.42');
    expect(tableRows[1]).toHaveTextContent('-5.6%');

    expect(tableRows[2]).toHaveTextContent('bt-101');
    expect(tableRows[2]).toHaveTextContent('临时回测');
    expect(tableRows[2]).toHaveTextContent('已完成');
    expect(tableRows[2]).toHaveTextContent('+18.4%');

    expect(fakeApi.getBacktestRunDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '策略 Beta' }));
    await waitFor(() => expect(window.location.hash).toBe('#/strategies/str-beta'));

    fireEvent.click(screen.getByRole('button', { name: 'bt-102' }));
    await waitFor(() => expect(window.location.hash).toBe('#/runs/bt-102'));
  });
});
