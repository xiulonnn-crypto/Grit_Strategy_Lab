import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotsPage } from './pages/snapshots-page';
import type { ApiSnapshotOverview } from './types';

const fakeApi = vi.hoisted(() => ({
  getSnapshotOverview: vi.fn(),
  refreshSnapshots: vi.fn(),
})) as {
  getSnapshotOverview: ReturnType<typeof vi.fn>;
  refreshSnapshots: ReturnType<typeof vi.fn>;
};

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const overview: ApiSnapshotOverview = {
  overall_status: 'INCOMPLETE',
  last_refreshed_at: '2026-04-01T07:48:00Z',
  dataset_snapshots: [
    {
      id: 'ds-corporate-actions',
      name: '公司行为数据',
      status: 'INCOMPLETE',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '刚刚刷新',
      start_date: '1996-01-01',
      end_date: '2026-04-01',
      row_count: 182430,
      source: 'tiingo',
      fallback_source: 'alpha_vantage',
      metadata: {
        covered_symbol_count: 385,
        total_symbol_count: 487,
      },
      blocker: {
        code: 'CORPORATE_ACTIONS_INCOMPLETE',
        message: '公司行为数据部分可用，正式回测仍会受限。',
      },
    },
    {
      id: 'ds-price',
      name: '股票价格数据',
      status: 'READY',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '刚刚刷新',
      start_date: '1996-01-01',
      end_date: '2026-04-01',
      row_count: 4320,
      source: 'yahoo',
      fallback_source: 'sec_edgar',
      metadata: {
        covered_symbol_count: 402,
        total_symbol_count: 487,
      },
      blocker: null,
    },
  ],
  universe_snapshots: [
    {
      id: 'un-sp500',
      name: '标普500',
      status: 'INCOMPLETE',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '历史锚点补齐中 (38/61)',
      window_start: '1996-01-01',
      window_end: '2026-04-01',
      anchor_schedule: '01-01 / 07-01',
      member_count: 500,
      source: 'official_announcement',
      fallback_source: 'wikipedia_revision_history',
      metadata: {
        historical_anchor_count: 38,
        anchor_count: 61,
      },
      blocker: {
        code: 'UNIVERSE_HISTORY_INCOMPLETE',
        message: '股票池历史成分仍在补齐，当前还不能视为完整的点时成分快照。',
      },
    },
    {
      id: 'un-ndx100',
      name: '纳指100',
      status: 'READY',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '历史锚点已刷新',
      window_start: '1996-01-01',
      window_end: '2026-04-01',
      anchor_schedule: '01-01 / 07-01',
      member_count: 100,
      source: 'nasdaq_official_annual_changes',
      fallback_source: 'sec_edgar',
      metadata: {
        historical_anchor_count: 61,
        anchor_count: 61,
      },
      blocker: null,
    },
  ],
  latest_job: {
    id: 'snap-job-20260401',
    status: 'COMPLETED',
    completed_at: '2026-04-01T07:48:00Z',
    warnings: [],
    errors: [],
  },
  blocking_code: 'CORPORATE_ACTIONS_INCOMPLETE',
  blocking_target: 'ds-corporate-actions',
  message: '当前已有可用数据，但还不是完整正式快照。',
  allowed_actions: ['refresh_snapshots'],
};

beforeEach(() => {
  fakeApi.getSnapshotOverview.mockReset();
  fakeApi.refreshSnapshots.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SnapshotsPage', () => {
  it('renders the new snapshots layout with dataset and universe sections', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue(overview);
    fakeApi.refreshSnapshots.mockResolvedValue({
      ...overview,
      last_refreshed_at: '2026-04-01T10:00:00Z',
      latest_job: {
        ...overview.latest_job,
        status: 'RUNNING',
        request: { mode: 'incremental' },
      },
    });

    render(<SnapshotsPage />);

    expect(await screen.findByRole('heading', { level: 1, name: '快照总览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新快照' })).toBeInTheDocument();
    expect(screen.getAllByText('数据集快照').length).toBeGreaterThan(0);
    expect(screen.getAllByText('股票池快照').length).toBeGreaterThan(0);
    expect(screen.getByText('公司行为数据')).toBeInTheDocument();
    expect(screen.getByText('股票价格数据')).toBeInTheDocument();
    expect(screen.getByText('标普500')).toBeInTheDocument();
    expect(screen.getByText('纳指100')).toBeInTheDocument();
    expect(screen.getByText(/Tiingo \/ Alpha Vantage/)).toBeInTheDocument();
    expect(screen.getByText(/Yahoo Finance \/ SEC EDGAR/)).toBeInTheDocument();
    expect(screen.getByText('385/487')).toBeInTheDocument();
    expect(screen.getByText('402/487')).toBeInTheDocument();
    expect(screen.getByText('38/61')).toBeInTheDocument();
    expect(screen.getByText('61/61')).toBeInTheDocument();
    expect(screen.getAllByText('19960101至20260401').length).toBeGreaterThan(1);
    expect(screen.getByText(/官方公告 \/ Wikipedia 历史修订/)).toBeInTheDocument();
    expect(screen.getAllByText(/过去 30 年历史时点成分股/).length).toBeGreaterThan(0);
    expect(screen.queryByText('这里会告诉你公司行为和价格数据是不是已经准备好。')).not.toBeInTheDocument();
    expect(
      screen.queryByText('这里会告诉你股票池是不是已经准备好。当前先显示历史锚点快照，完整历史成分仍会继续补齐。'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('部分可用')).not.toBeInTheDocument();
    expect(screen.queryByText('返回工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('修复入口')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新快照' }));
    await waitFor(() =>
      expect(fakeApi.refreshSnapshots).toHaveBeenCalledWith({
        mode: 'repair',
        targets: ['price', 'corporate', 'universes'],
        reason: 'manual-refresh-latest-and-repair',
      }),
    );
  });

  it('shows a loading state before overview data resolves', () => {
    fakeApi.getSnapshotOverview.mockImplementation(
      () => new Promise<ApiSnapshotOverview>(() => undefined),
    );

    render(<SnapshotsPage />);

    expect(screen.getAllByText('正在加载快照概览...').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '刷新快照' })).toBeDisabled();
  });

  it('shows an error banner when the overview request fails', async () => {
    fakeApi.getSnapshotOverview.mockRejectedValue(new Error('后端返回 500'));

    render(<SnapshotsPage />);

    expect(await screen.findByText('加载数据快照失败：后端返回 500')).toBeInTheDocument();
  });

  it('shows a blocker banner when a snapshot is blocked', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      overall_status: 'BLOCKED',
      blocking_code: 'UNIVERSE_HISTORY_INCOMPLETE',
      blocking_target: 'un-sp500',
      message: '股票池历史数据部分可用，当前不能提交正式回测。',
    });

    render(<SnapshotsPage />);

    expect(await screen.findByText('股票池历史数据部分可用，当前不能提交正式回测。')).toBeInTheDocument();
    expect(screen.getByText('股票池历史数据部分可用')).toBeInTheDocument();
    expect(screen.getAllByText('有阻塞').length).toBeGreaterThan(0);
  });

  it('shows a restart hint when the backend still returns the legacy contract', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      status: 'READY',
      latest_job: {
        status: 'READY',
      },
      coverages: [],
    });

    render(<SnapshotsPage />);

    expect(
      await screen.findByText(
        '当前本地后端还在返回旧版快照接口。重启后端服务后，再点“刷新快照”即可看到完整快照。',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('待刷新').length).toBeGreaterThan(0);
    expect(screen.getByText('最近刷新 待显示')).toBeInTheDocument();
  });
});
