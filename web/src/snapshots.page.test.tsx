import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouteProvider } from './lib/appRouteContext';
import { normalizeBondFixedIncomeOverview } from './page-sections/snapshots-bond-fixed-income';
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

function renderSnapshotsPage(tab: 'equity' | 'bond' = 'equity'): void {
  render(
    <AppRouteProvider
      navigate={(path) => {
        window.location.hash = path;
      }}
      route={{ kind: 'snapshots', tab }}
    >
      <SnapshotsPage />
    </AppRouteProvider>,
  );
}

const overviewBase: Omit<ApiSnapshotOverview, 'bond_fixed_income'> = {
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
        complete_no_events_symbol_count: 250,
        formal_event_symbol_count: 135,
        missing_symbols: Array.from({ length: 102 }, (_, index) => `MISS${index + 1}`),
        provider_summary: {
          providers: {
            yahoo: {
              access_tier: 'public',
              actions_supported: true,
              probe_complete: true,
              quota_limited: false,
            },
            alpha_vantage: {
              access_tier: 'free_account',
              actions_supported: true,
              probe_complete: true,
              quota_limited: true,
              next_retry_at: '2026-04-02T00:00:00Z',
            },
          },
        },
      },
      blocker: {
        code: 'CORPORATE_ACTIONS_INCOMPLETE',
        message: 'Corporate action data is partially available, but the snapshot is not complete yet.',
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
        provider_summary: {
          providers: {
            yahoo: {
              access_tier: 'public',
              actions_supported: true,
              probe_complete: true,
              quota_limited: false,
            },
          },
        },
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
        official_seed_status: 'missing',
        official_seed_source_count: 0,
        official_seed_missing_anchors: ['1996-01-01', '1996-07-01', '1997-01-01'],
      },
      blocker: {
        code: 'UNIVERSE_HISTORY_INCOMPLETE',
        message: 'Universe history is partially available, but more historical anchors still need to be repaired.',
      },
    },
    {
      id: 'un-ndx100',
      name: '纳指100',
      status: 'READY',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '历史锚点已就绪',
      window_start: '1996-01-01',
      window_end: '2026-04-01',
      anchor_schedule: '01-01 / 07-01',
      member_count: 100,
      source: 'nasdaq_official_annual_changes',
      fallback_source: 'sec_edgar',
      metadata: {
        historical_anchor_count: 61,
        anchor_count: 61,
        official_seed_status: 'complete',
        official_seed_source_count: 4,
        official_seed_missing_anchors: [],
      },
      blocker: null,
    },
  ],
  latest_job: {
    id: 'snap-job-20260401',
    status: 'COMPLETED',
    completed_at: '2026-04-01T07:48:00Z',
    summary: {
      refresh_stats: {
        datasets: {
          'ds-corporate-actions': {
            name: '公司行为数据',
            updated_symbol_count: 7,
            updated_row_count: 49,
            provider_summary: {
              unavailable_providers: ['sec_edgar', 'tiingo'],
              providers: {
                sec_edgar: {
                  reasons: ['SEC_USER_AGENT must include a contact email.'],
                },
                tiingo: {
                  reasons: ['TIINGO_API_TOKEN is not configured.'],
                },
              },
            },
          },
          'ds-price': {
            name: '股票价格数据',
            updated_symbol_count: 7,
            updated_row_count: 49,
            provider_summary: {
              unavailable_providers: ['longbridge'],
              providers: {
                longbridge: {
                  reasons: ['Longbridge credentials are not configured.'],
                },
              },
            },
          },
        },
        universes: {
          'un-sp500': {
            name: '标普500',
            updated_row_count: 4,
          },
          'un-ndx100': {
            name: '纳指100',
            updated_row_count: 2,
          },
        },
      },
    },
    warnings: [],
    errors: [],
  },
  blocking_code: 'CORPORATE_ACTIONS_INCOMPLETE',
  blocking_target: 'ds-corporate-actions',
  message: 'Corporate action data is partially available, but the snapshot is not complete yet.',
  allowed_actions: ['refresh_snapshots'],
};

const overview: ApiSnapshotOverview = {
  ...overviewBase,
  bond_fixed_income: normalizeBondFixedIncomeOverview(null, overviewBase),
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

    renderSnapshotsPage();

    expect(await screen.findByRole('heading', { level: 1, name: '数据快照' })).toBeInTheDocument();
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
    expect(screen.getByText('Formal events: 135 | Probe-complete, no events: 250')).toBeInTheDocument();
    expect(screen.getByText('Still missing formal coverage for 102 symbols.')).toBeInTheDocument();
    expect(
      screen.getByText('Free-source cooldown: Alpha Vantage (free account) retry after 2026-04-02'),
    ).toBeInTheDocument();
    expect(screen.getByText('Official seeds: complete (4 sources)')).toBeInTheDocument();
    expect(
      screen.getByText('Official seeds: missing'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Missing anchors: 1996-01-01, 1996-07-01, 1997-01-01'),
    ).toBeInTheDocument();
    for (const readyChip of screen.getAllByText(/^\u5c31\u7eea$/)) {
      expect(readyChip).toHaveClass('snapshots-status-chip--ready');
    }
    expect(screen.getAllByText('19960101至20260401').length).toBeGreaterThan(1);
    expect(screen.getByText(/官方公告 \/ Wikipedia 历史修订/)).toBeInTheDocument();
    expect(screen.getAllByText(/过去 30 年历史时点成分股/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        '最近刷新 4月1日 下午03:48 ·新增公司行为数据7家49行，股票价格数据7家49行，标普500股票池4行，纳指100股票池2行。',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('这里会告诉你公司行为和价格数据是不是已经准备好。'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        '这里会告诉你股票池是不是已经准备好。当前先显示历史锚点快照，完整历史成分仍会继续补齐。',
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('返回工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('修复入口')).not.toBeInTheDocument();
    expect(screen.queryByText('部分可用')).not.toBeInTheDocument();
    expect(screen.getAllByText('公司行为数据已部分可用，仍有少量公司事件待继续补齐。').length).toBeGreaterThan(0);

    expect(screen.queryByText('SEC_USER_AGENT must include a contact email.')).not.toBeInTheDocument();
    expect(screen.queryByText('TIINGO_API_TOKEN is not configured.')).not.toBeInTheDocument();
    expect(screen.queryByText('Longbridge credentials are not configured.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新快照' }));
    await waitFor(() =>
      expect(fakeApi.refreshSnapshots).toHaveBeenCalledWith({
        mode: 'repair',
        targets: ['price', 'corporate', 'universes'],
        reason: 'manual-refresh-latest-and-repair',
      }),
    );
  });

  it('restores the bond snapshots tab', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue(overview);
    fakeApi.refreshSnapshots.mockResolvedValue(overview);

    renderSnapshotsPage('bond');

    expect(await screen.findByRole('heading', { level: 1, name: '数据快照' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs.length).toBeGreaterThan(2);
    expect(screen.queryByText('?砍銵蛹?唳')).not.toBeInTheDocument();
  });

  it('shows a loading state before overview data resolves', () => {
    fakeApi.getSnapshotOverview.mockImplementation(
      () => new Promise<ApiSnapshotOverview>(() => undefined),
    );

    renderSnapshotsPage();

    expect(screen.getAllByText('正在加载快照概览...').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '刷新快照' })).toBeDisabled();
  });

  it('switches to a running summary immediately after refresh is clicked', async () => {
    let resolveRefresh: ((value: ApiSnapshotOverview) => void) | null = null;
    fakeApi.getSnapshotOverview.mockResolvedValue(overview);
    fakeApi.refreshSnapshots.mockImplementation(
      () =>
        new Promise<ApiSnapshotOverview>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    renderSnapshotsPage();

    expect(await screen.findByRole('heading', { level: 1, name: '数据快照' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新快照' }));

    expect(await screen.findByText('数据刷新中...')).toBeInTheDocument();

    await act(async () => {
      resolveRefresh?.({
        ...overview,
        overall_status: 'RUNNING',
        latest_job: {
          ...overview.latest_job,
          status: 'RUNNING',
          completed_at: null,
          request: { mode: 'repair' },
        },
      });
    });
  });

  it('shows an error banner when the overview request fails', async () => {
    fakeApi.getSnapshotOverview.mockRejectedValue(new Error('模拟接口 500'));

    renderSnapshotsPage();

    expect(await screen.findByText('加载数据快照失败：模拟接口 500')).toBeInTheDocument();
  });

  it('shows a blocker banner when a snapshot is blocked', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      overall_status: 'BLOCKED',
      blocking_code: 'UNIVERSE_HISTORY_INCOMPLETE',
      blocking_target: 'un-sp500',
      message: 'Universe history is partially available, but more historical anchors still need to be repaired.',
    });

    renderSnapshotsPage();

    expect(
      await screen.findAllByText('股票池历史成分已部分可用，仍有部分历史锚点待继续补齐。'),
    ).toHaveLength(2);
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
    } as unknown as ApiSnapshotOverview);

    renderSnapshotsPage();

    expect(
      await screen.findByText(
        '当前本地后端还在返回旧版快照接口。重启后端服务后，再点“刷新快照”即可看到完整快照。',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('待刷新').length).toBeGreaterThan(0);
    expect(screen.getByText('最近刷新 · 摘要待显示')).toBeInTheDocument();
  });

  it('shows a no-change summary when the latest refresh has no additions', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      latest_job: {
        ...overview.latest_job,
        summary: {
          refresh_stats: {
            datasets: {
              'ds-corporate-actions': {
                name: '公司行为数据',
                updated_symbol_count: 0,
                updated_row_count: 0,
              },
              'ds-price': {
                name: '股票价格数据',
                updated_symbol_count: 0,
                updated_row_count: 0,
              },
            },
            universes: {
              'un-sp500': {
                name: '标普500',
                updated_row_count: 0,
              },
              'un-ndx100': {
                name: '纳指100',
                updated_row_count: 0,
              },
            },
          },
        },
      },
    });

    renderSnapshotsPage();

    expect(await screen.findByText('最近刷新 4月1日 下午03:48 ·本次未新增数据。')).toBeInTheDocument();
  });

  it('shows universe anchor progress when stock-pool history improves without changing membership rows', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      latest_job: {
        ...overview.latest_job,
        status: 'COMPLETED',
        summary: {
          refresh_stats: {
            datasets: {
              'ds-corporate-actions': {
                name: '公司行为数据',
                updated_symbol_count: 0,
                updated_row_count: 0,
              },
              'ds-price': {
                name: '股票价格数据',
                updated_symbol_count: 0,
                updated_row_count: 0,
              },
            },
            universes: {
              'un-sp500': {
                name: '标普500',
                updated_row_count: 0,
                historical_anchor_delta: 0,
                historical_anchor_count: 38,
                anchor_count: 61,
              },
              'un-ndx100': {
                name: '纳指100',
                updated_row_count: 0,
                historical_anchor_delta: 9,
                historical_anchor_count: 23,
                anchor_count: 61,
              },
            },
          },
        },
      },
    });

    renderSnapshotsPage();

    expect(
      await screen.findByText('最近刷新 4月1日 下午03:48 ·新增纳指100股票池9个历史锚点，进度23/61。'),
    ).toBeInTheDocument();
  });

  it('does not show a no-change summary while refresh is still running', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      overall_status: 'RUNNING',
      latest_job: {
        ...overview.latest_job,
        status: 'RUNNING',
        completed_at: null,
        summary: {
          refresh_stats: {
            datasets: {
              'ds-corporate-actions': {
                name: '公司行为数据',
                updated_symbol_count: 0,
                updated_row_count: 0,
              },
              'ds-price': {
                name: '股票价格数据',
                updated_symbol_count: 0,
                updated_row_count: 0,
              },
            },
            universes: {
              'un-sp500': {
                name: '标普500',
                updated_row_count: 0,
              },
              'un-ndx100': {
                name: '纳指100',
                updated_row_count: 0,
              },
            },
          },
        },
      },
    });

    renderSnapshotsPage();

    expect(await screen.findByText('数据刷新中...')).toBeInTheDocument();
    expect(screen.queryByText(/本次未新增数据/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新中...' })).toBeDisabled();
  });

  it('shows incremental additions while refresh is still running once partial stats are available', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      overall_status: 'RUNNING',
      latest_job: {
        ...overview.latest_job,
        status: 'RUNNING',
        completed_at: null,
      },
    });

    renderSnapshotsPage();

    expect(
      await screen.findByText(
        '数据刷新中... ·新增公司行为数据7家49行，股票价格数据7家49行，标普500股票池4行，纳指100股票池2行。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/本次未新增数据/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新中...' })).toBeDisabled();
  });

  it('keeps ready chips green when a snapshot carries non-blocking blocker metadata', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      universe_snapshots: [
        {
          ...overview.universe_snapshots[0],
          status: 'READY',
          blocker: {},
        },
        overview.universe_snapshots[1],
      ],
    });

    renderSnapshotsPage();

    const sp500Card = (await screen.findByText('标普500')).closest('.snapshots-row-card');
    expect(sp500Card).not.toBeNull();
    const readyChip = within(sp500Card as HTMLElement).getByText('就绪');
    expect(readyChip).toHaveClass('snapshots-status-chip--ready');
    expect(readyChip).not.toHaveClass('status-chip--danger');
  });
});
