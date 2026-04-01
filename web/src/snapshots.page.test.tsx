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
  overall_status: 'READY',
  last_refreshed_at: '2026-04-01T07:48:00Z',
  dataset_snapshots: [
    {
      id: 'dataset-corporate-actions',
      name: '公司行为数据',
      status: 'READY',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '刚刚刷新',
      start_date: '1996-01-01',
      end_date: '2026-04-01',
      row_count: 182430,
      source: 'Yahoo',
      fallback_source: 'fallback unavailable',
      blocker: null,
    },
    {
      id: 'dataset-price-bars',
      name: '股票价格数据',
      status: 'READY',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '刚刚刷新',
      start_date: '1996-01-01',
      end_date: '2026-04-01',
      row_count: 4320,
      source: 'Yahoo',
      fallback_source: 'fallback unavailable',
      blocker: null,
    },
  ],
  universe_snapshots: [
    {
      id: 'universe-sp500',
      name: '标普500',
      status: 'READY',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '刚刚刷新',
      window_start: '1996-01-01',
      window_end: '2026-04-01',
      anchor_schedule: '01-01 / 07-01',
      member_count: 500,
      source: 'Yahoo',
      fallback_source: '本地冷备',
      blocker: null,
    },
    {
      id: 'universe-nasdaq100',
      name: '纳指100',
      status: 'READY',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '刚刚刷新',
      window_start: '1996-01-01',
      window_end: '2026-04-01',
      anchor_schedule: '01-01 / 07-01',
      member_count: 100,
      source: 'Yahoo',
      fallback_source: '本地冷备',
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
  blocking_code: null,
  blocking_target: null,
  message: '这里会集中展示价格数据、公司行为和股票池的最新状态。',
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
    expect(screen.getAllByText(/过去30年历史时点成分股/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/最近刷新/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4月1日 下午03:48/).length).toBeGreaterThan(0);
    expect(screen.queryByText('门禁与最近任务')).not.toBeInTheDocument();
    expect(screen.queryByText('覆盖与可用性')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回工作台' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新快照' }));
    await waitFor(() => expect(fakeApi.refreshSnapshots).toHaveBeenCalledTimes(1));
  });

  it('shows a loading state before overview data resolves', () => {
    fakeApi.getSnapshotOverview.mockImplementation(
      () => new Promise<ApiSnapshotOverview>(() => undefined),
    );

    render(<SnapshotsPage />);

    expect(screen.getByText('正在加载快照状态...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新快照' })).toBeDisabled();
  });

  it('shows an error banner when the overview request fails', async () => {
    fakeApi.getSnapshotOverview.mockRejectedValue(new Error('后端返回 500'));

    render(<SnapshotsPage />);

    expect(
      await screen.findByText('加载数据快照失败：后端返回 500'),
    ).toBeInTheDocument();
  });

  it('shows a blocker banner when a snapshot is blocked', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      overall_status: 'BLOCKED',
      blocking_code: 'universe_snapshot_blocked',
      blocking_target: 'universe',
      message: '股票池快照存在阻塞门禁。',
      universe_snapshots: overview.universe_snapshots.map((item) =>
        item.id === 'universe-sp500'
          ? {
              ...item,
              status: 'BLOCKED',
              blocker: {
                code: 'universe_snapshot_blocked',
                message: '标普500 历史时点成员缺失，不能继续正式回测。',
              },
            }
          : item,
      ),
    });

    render(<SnapshotsPage />);

    expect(await screen.findByText('股票池快照存在阻塞门禁。')).toBeInTheDocument();
    expect(
      screen.getByText('标普500 历史时点成员缺失，不能继续正式回测。'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('有阻塞').length).toBeGreaterThan(0);
  });

  it('shows a restart hint instead of unknown labels when the backend still returns the legacy contract', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      status: 'READY',
      latest_job: {
        status: 'READY',
      },
      coverages: [],
    });

    render(<SnapshotsPage />);

    expect(
      await screen.findByText('当前本地后端还在返回旧版快照接口。重启后端服务后，再点“刷新快照”即可看到完整快照。'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('待刷新').length).toBeGreaterThan(0);
    expect(screen.getByText('最近刷新 尚未刷新')).toBeInTheDocument();
  });
});
