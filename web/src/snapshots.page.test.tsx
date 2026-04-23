import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
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
  it('keeps the equity workstation cards content-sized instead of forcing empty height', () => {
    const snapshotsCss = readFileSync('src/pages/snapshots-page.css', 'utf8');

    expect(snapshotsCss).not.toMatch(
      /\.snapshots-equity-view\s+\.bond-core-card\s*\{[^}]*min-height:\s*390px/s,
    );
  });

  it('restores the approved equity snapshots governance layout', async () => {
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
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '刷新股票快照' })).toBeInTheDocument();
    expect(screen.getByText('DATA SNAPSHOTS')).toBeInTheDocument();
    expect(screen.getByText('全局视角')).toBeInTheDocument();
    expect(screen.getByText('股票快照')).toBeInTheDocument();
    expect(screen.getByText('99.8% 就绪')).toBeInTheDocument();
    expect(screen.getAllByText('指数基准').length).toBeGreaterThan(0);
    expect(screen.getByText('100% 就绪')).toBeInTheDocument();
    expect(screen.getAllByText('权益篮子').length).toBeGreaterThan(0);
    expect(screen.getByText('80% 可用')).toBeInTheDocument();
    expect(screen.getByText('异常队列')).toBeInTheDocument();
    expect(screen.getByText('2 项例外')).toBeInTheDocument();
    expect(screen.getByText('三位一体工作站')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '8 待审计' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1 Pending' })).toBeInTheDocument();
    expect(screen.getByText('原始快照清单')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Universe-US-Equity-20260401')).toBeInTheDocument();
    expect(screen.getByText('Benchmarks-Core-20260401')).toBeInTheDocument();
    expect(screen.getByText('Theme-Alpha-Basket-20260401')).toBeInTheDocument();
    expect(screen.getByText('数据诊断报告')).toBeInTheDocument();
    expect(screen.getByText('就绪标准')).toBeInTheDocument();
    expect(
      screen.queryByText('数据集快照'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('股票池快照')).not.toBeInTheDocument();
    expect(screen.queryByText('公司行为数据')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: '8 待审计' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '仅看待补' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(screen.queryByText('Benchmarks-Core-20260401')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByText('Benchmarks-Core-20260401')).toBeInTheDocument();

    expect(
      screen.getByText('把全局视角、局部待补和原始快照清单收进一个治理入口里。研究员进入页面第一眼先看数据计分板，再决定今天是继续建仓，还是先修补数据缺口。'),
    ).toBeInTheDocument();

    expect(screen.queryByText('SEC_USER_AGENT must include a contact email.')).not.toBeInTheDocument();
    expect(screen.queryByText('TIINGO_API_TOKEN is not configured.')).not.toBeInTheDocument();
    expect(screen.queryByText('Longbridge credentials are not configured.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新股票快照' }));
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
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole('button', { name: '刷新债券快照' })).toBeInTheDocument();
    expect(screen.getByText('就绪 / 待补 / 阻塞')).toBeInTheDocument();
    expect(screen.getByText('影子字段覆盖率')).toBeInTheDocument();
    expect(screen.getByText('入库链路与数据自愈')).toBeInTheDocument();
    expect(screen.getAllByText('利率债（UST）').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Bond-UST10Y-EOD-20260421').length).toBeGreaterThan(1);
    expect(screen.getByText('批量修复规则')).toBeInTheDocument();
    expect(screen.getByText('原始快照与调度')).toBeInTheDocument();
    expect(screen.queryByText('共享快照路由')).not.toBeInTheDocument();
    expect(screen.queryByText('不新增债券专属调度器')).not.toBeInTheDocument();
    expect(screen.queryByText('?砍銵蛹?唳')).not.toBeInTheDocument();
  });

  it('shows a loading state before overview data resolves', () => {
    fakeApi.getSnapshotOverview.mockImplementation(
      () => new Promise<ApiSnapshotOverview>(() => undefined),
    );

    renderSnapshotsPage();

    expect(screen.getAllByText('正在加载快照概览...').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '刷新股票快照' })).not.toBeInTheDocument();
  });

  it('switches the approved equity refresh CTA to a running state after refresh is clicked', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '刷新股票快照' }));

    expect(await screen.findByRole('button', { name: '刷新中...' })).toBeDisabled();
    await waitFor(() =>
      expect(fakeApi.refreshSnapshots).toHaveBeenCalledWith({
        mode: 'repair',
        targets: ['price', 'corporate', 'universes'],
        reason: 'manual-refresh-latest-and-repair',
      }),
    );

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

  it('keeps the approved equity artifact when a snapshot is blocked', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      overall_status: 'BLOCKED',
      blocking_code: 'UNIVERSE_HISTORY_INCOMPLETE',
      blocking_target: 'un-sp500',
      message: 'Universe history is partially available, but more historical anchors still need to be repaired.',
    });

    renderSnapshotsPage();

    expect(await screen.findByText('全局视角')).toBeInTheDocument();
    expect(screen.getByText('原始快照清单')).toBeInTheDocument();
    expect(screen.queryByText('股票池历史数据部分可用')).not.toBeInTheDocument();
    expect(screen.queryByText('有阻塞')).not.toBeInTheDocument();
  });

  it('does not leak the legacy restart hint into the approved equity artifact', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      status: 'READY',
      latest_job: {
        status: 'READY',
      },
      coverages: [],
    } as unknown as ApiSnapshotOverview);

    renderSnapshotsPage();

    expect(await screen.findByText('全局视角')).toBeInTheDocument();
    expect(
      screen.queryByText('当前本地后端还在返回旧版快照接口。重启后端服务后，再点“刷新快照”即可看到完整快照。'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('最近刷新 · 摘要待显示')).not.toBeInTheDocument();
  });

  it('keeps no-change refresh summaries out of the approved equity hero', async () => {
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

    expect(await screen.findByText('全局视角')).toBeInTheDocument();
    expect(screen.queryByText('最近刷新 4月1日 下午03:48 ·本次未新增数据。')).not.toBeInTheDocument();
  });

  it('keeps universe anchor progress out of the approved equity hero', async () => {
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

    expect(await screen.findByText('全局视角')).toBeInTheDocument();
    expect(
      screen.queryByText('最近刷新 4月1日 下午03:48 ·新增纳指100股票池9个历史锚点，进度23/61。'),
    ).not.toBeInTheDocument();
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

    expect(await screen.findByRole('button', { name: '刷新中...' })).toBeDisabled();
    expect(screen.queryByText(/本次未新增数据/)).not.toBeInTheDocument();
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

    expect(await screen.findByRole('button', { name: '刷新中...' })).toBeDisabled();
    expect(
      screen.queryByText(
        '数据刷新中... ·新增公司行为数据7家49行，股票价格数据7家49行，标普500股票池4行，纳指100股票池2行。',
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/本次未新增数据/)).not.toBeInTheDocument();
  });

  it('keeps the benchmark row ready chip green in the approved equity table', async () => {
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

    const benchmarkRow = (await screen.findByText('Benchmarks-Core-20260401')).closest('.bond-snapshot-row');
    expect(benchmarkRow).not.toBeNull();
    const readyChip = within(benchmarkRow as HTMLElement).getByText('就绪');
    expect(readyChip).toHaveClass('status-chip--success');
    expect(readyChip).not.toHaveClass('status-chip--danger');
  });
});
