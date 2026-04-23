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
  createAssetLeg: vi.fn(),
})) as {
  getSnapshotOverview: ReturnType<typeof vi.fn>;
  refreshSnapshots: ReturnType<typeof vi.fn>;
  createAssetLeg: ReturnType<typeof vi.fn>;
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
  fakeApi.createAssetLeg.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SnapshotsPage', () => {
  it('keeps approved snapshot geometry for equity cards and header rhythm', () => {
    const snapshotsCss = readFileSync('src/pages/snapshots-page.css', 'utf8');
    const readRule = (selector: string): string => {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return snapshotsCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? '';
    };

    expect(readRule('.snapshots-header-card--equity')).toContain('min-height: 182px');
    expect(readRule('.snapshots-equity-view > .panel:first-child')).toContain('min-height: 284px');
    expect(readRule('.snapshots-equity-view .metric-card')).toContain('min-height: 154px');
    expect(readRule('.snapshots-equity-view .bond-core-card')).toContain('min-height: 390px');
    expect(readRule('.snapshots-equity-view .detail-rail .rail-panel:last-child')).toContain('min-height: 365px');
    expect(readRule('.snapshots-equity-view .detail-grid')).toContain('align-items: start');
  });

  it('keeps the bond tab visually attached to the shared snapshots header density', () => {
    const snapshotsCss = readFileSync('src/pages/snapshots-page.css', 'utf8');
    const readRule = (selector: string): string => {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return snapshotsCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? '';
    };

    expect(readRule('.snapshots-bond-view')).not.toMatch(/margin-top:\s*(?:[3-9]\d|[1-9]\d{2,})px/);
    expect(readRule('.snapshots-bond-view')).toContain('gap: 23px');
    expect(readRule('.snapshots-header-card--bond .snapshots-tabs')).toContain('margin-top: 0');
    expect(readRule('.snapshots-header-card--bond .snapshots-chip-row')).toContain('margin-top: 0');
    expect(readRule('.snapshots-header-card--bond .status-chip')).toContain('min-height: 30px');
    expect(readRule('.snapshots-page .snapshots-bond-panel')).toContain('box-shadow: none');
    expect(readRule('.snapshots-bond-workstation-grid')).toContain('grid-template-columns: minmax(0, 1fr) 330px');
    expect(readRule('.snapshots-bond-audit-layout')).toContain('grid-template-columns: minmax(0, 1fr) 330px');
  });

  it('renders the approved equity snapshots layout with runtime overview rows', async () => {
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
    expect(screen.getByText('三位一体工作站')).toBeInTheDocument();
    expect(screen.getByText('原始快照清单')).toBeInTheDocument();
    expect(screen.getByText('数据诊断报告')).toBeInTheDocument();
    expect(screen.getByText('就绪标准')).toBeInTheDocument();
    expect(screen.queryByText('Runtime 快照总览')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '股票/指数' })).toBeInTheDocument();
    const globalView = screen.getByRole('heading', { name: '全局视角' }).closest('section');
    expect(globalView).not.toBeNull();
    expect(within(globalView as HTMLElement).getByText('股票快照')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('指数基准')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('权益篮子')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('异常队列')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('最新刷新（EST）')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('03:48')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getAllByText('50% 就绪')).toHaveLength(2);
    expect(within(globalView as HTMLElement).getByText('0% 可用')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('2 项例外')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).queryByText('覆盖率')).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime 原始快照清单')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('公司行为数据')).toBeInTheDocument();
    expect(screen.getByText('股票价格数据')).toBeInTheDocument();
    expect(screen.getByText('标普500')).toBeInTheDocument();
    expect(screen.getByText('纳指100')).toBeInTheDocument();
    const rawList = screen.getByRole('heading', { name: '原始快照清单' }).closest('section');
    expect(rawList).not.toBeNull();
    expect(within(rawList as HTMLElement).getAllByText('字段').length).toBeGreaterThan(0);
    expect(within(rawList as HTMLElement).getAllByText('调度').length).toBeGreaterThan(0);
    expect(within(rawList as HTMLElement).queryByText('范围')).not.toBeInTheDocument();
    expect(within(rawList as HTMLElement).queryByText('来源')).not.toBeInTheDocument();
    expect(screen.getAllByText('公司行为数据已部分可用，仍有少量公司事件待继续补齐。').length).toBeGreaterThan(0);
    expect(screen.getAllByText('股票池历史成分已部分可用，仍有部分历史锚点待继续补齐。').length).toBeGreaterThan(0);
    expect(screen.queryByText('Corporate action data is partially available, but the snapshot is not complete yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Universe-US-Equity-20260401')).not.toBeInTheDocument();
    expect(screen.queryByText('Benchmarks-Core-20260401')).not.toBeInTheDocument();
    expect(screen.queryByText('Theme-Alpha-Basket-20260401')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '仅看待补' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '仅看待补' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(screen.queryByText('股票价格数据')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByText('股票价格数据')).toBeInTheDocument();

    expect(screen.queryByText('5,120 就绪 / 5,128 总数')).not.toBeInTheDocument();

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
    expect(screen.getAllByText('利率债（UST）').length).toBeGreaterThan(0);
    expect(screen.getByText('影子数据审计矩阵')).toBeInTheDocument();
    expect(screen.getByText('UST 术语说明')).toBeInTheDocument();
    expect(screen.getByText('尚未写入真实 runtime 曲线点；这里保留批准稿位置，但不使用 proxy 或静态曲线兜底。')).toBeInTheDocument();
    expect(document.querySelector('.snapshots-bond-runtime-panel .snapshots-bond-create-rail')).toBeNull();
    expect(document.querySelector('.snapshots-bond-workstation-grid > .snapshots-bond-detail-rail .snapshots-bond-create-rail')).not.toBeNull();
    expect(document.querySelector('.snapshots-bond-audit-grid')).not.toBeNull();
    expect(screen.getByText('快照 ID')).toBeInTheDocument();
    expect(screen.getByText('全价 (Dirty)')).toBeInTheDocument();
    expect(screen.getByText('应计 (Accrued)')).toBeInTheDocument();
    expect(screen.getByText('久期 (Duration)')).toBeInTheDocument();
    expect(screen.getByText('到期收益率 (YTM)')).toBeInTheDocument();
    expect(screen.getByText('操作')).toBeInTheDocument();
    const auditSection = screen.getByRole('heading', { name: '影子数据审计矩阵' }).closest('section');
    expect(auditSection).not.toBeNull();
    expect(within(auditSection as HTMLElement).queryByText('曲线预览')).not.toBeInTheDocument();
    expect(within(auditSection as HTMLElement).queryByText('系统诊断')).not.toBeInTheDocument();
    expect(document.querySelector('.snapshots-bond-audit-panel .snapshots-bond-diagnostic-rail')).toBeNull();
    expect(document.querySelector('.snapshots-bond-audit-layout > .snapshots-bond-detail-rail .snapshots-bond-diagnostic-rail')).not.toBeNull();
    expect(screen.getByRole('heading', { name: '原始快照与调度' })).toBeInTheDocument();
    expect(screen.getByText('资产腿创建')).toBeInTheDocument();
    expect(screen.queryByText('Runtime eligible bond sources')).not.toBeInTheDocument();
    expect(screen.queryByText('No runtime eligible bond sources yet')).not.toBeInTheDocument();
    expect(screen.queryByText('共享快照路由')).not.toBeInTheDocument();
    expect(screen.queryByText('不新增债券专属调度器')).not.toBeInTheDocument();
    expect(screen.queryByText('第一阶段曲线样本')).not.toBeInTheDocument();
    expect(screen.queryByText('?砍銵蛹?唳')).not.toBeInTheDocument();
  });

  it('creates an asset leg from a runtime eligible bond source', async () => {
    const runtimeBondOverview = normalizeBondFixedIncomeOverview(
      {
        ...overview.bond_fixed_income,
        eligible_sources: [
          {
            id: 'bond_fixed_income',
            label: 'Bond Fixed Income',
            source: 'bond_fixed_income',
            status: 'READY',
            access_tier: 'runtime',
            instrument_types: ['treasury'],
            coverage_notes: ['2 eligible for asset-leg creation'],
            updated_at: '2026-04-22T00:00:00Z',
          },
        ],
        eligible_instruments: [
          {
            id: 'bond-fixture-us91282cgk18',
            label: 'US Treasury 10Y Note',
            instrument_type: 'treasury',
            source: 'bond_fixed_income',
            status: 'READY',
            symbol: 'T10Y',
            isin: 'US91282CGK18',
            cusip: '91282CGK1',
            currency: 'USD',
            snapshot_date: '2026-04-22',
            maturity_date: '2036-02-15',
            coupon_rate_pct: 4.125,
            clean_price: 98.25,
            net_price: 98.25,
            dirty_price: 99.02,
            full_price: 99.02,
            accrued_interest: 0.77,
            ytm_pct: 4.32,
            duration: 8.1,
            convexity: 0.82,
            snapshot_ref: 'bond-fixture-us91282cgk18',
            refresh_status: 'READY',
            missing_fields: [],
            inferred_fields: { duration: 'curve_fit' },
            field_status: { duration: 'INFERRED' },
            updated_at: '2026-04-22T00:00:00Z',
          },
          {
            id: 'bond-fixture-us91282cjz59',
            label: 'US Treasury 2Y Note',
            instrument_type: 'treasury',
            source: 'bond_fixed_income',
            status: 'READY',
            symbol: 'T2Y',
            isin: 'US91282CJZ59',
            cusip: '91282CJZ5',
            currency: 'USD',
            snapshot_date: '2026-04-22',
            maturity_date: '2028-04-15',
            coupon_rate_pct: 3.875,
            clean_price: 99.1,
            net_price: 99.1,
            dirty_price: 99.4,
            full_price: 99.4,
            accrued_interest: 0.3,
            ytm_pct: 3.92,
            duration: 1.8,
            convexity: 0.2,
            snapshot_ref: 'bond-fixture-us91282cjz59',
            refresh_status: 'READY',
            missing_fields: [],
            inferred_fields: {},
            field_status: {},
            updated_at: '2026-04-22T00:00:00Z',
          },
        ],
      },
      overviewBase,
    );
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      bond_fixed_income: runtimeBondOverview,
    });
    fakeApi.refreshSnapshots.mockResolvedValue(overview);
    fakeApi.createAssetLeg.mockResolvedValue({
      id: 'asset-leg-bond-001',
      name: 'US Treasury 2Y Note',
      symbol: 'T2Y',
      asset_kind: 'BOND',
      source_snapshot_id: 'bond-fixture-us91282cjz59',
      source_provider: 'bond_fixed_income',
      freeze_mode: 'snapshot_locked',
      notes: null,
      summary: {},
      status: 'ACTIVE',
      eligibility_summary: {},
      attribute_tags: [],
      allowed_actions: [],
      created_at: '2026-04-22T00:00:00Z',
      updated_at: '2026-04-22T00:00:00Z',
    });

    renderSnapshotsPage('bond');

    expect(await screen.findByText('资产腿创建')).toBeInTheDocument();
    expect(screen.getAllByText('US Treasury 10Y Note').length).toBeGreaterThan(0);
    expect(screen.getAllByText('US Treasury 2Y Note').length).toBeGreaterThan(0);
    expect(screen.getByText('入库演进：runtime 字段流')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /US Treasury 2Y Note/ }));

    fireEvent.click(screen.getByRole('button', { name: '创建资产腿' }));

    await waitFor(() =>
      expect(fakeApi.createAssetLeg).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'US Treasury 2Y Note',
          symbol: 'T2Y',
          asset_kind: 'BOND',
          source_snapshot_id: 'bond-fixture-us91282cjz59',
          source_provider: 'bond_fixed_income',
          freeze_mode: 'snapshot_locked',
        }),
      ),
    );
    expect(await screen.findByText('资产腿已创建：US Treasury 2Y Note')).toBeInTheDocument();
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

  it('keeps the approved equity layout visible when a snapshot is blocked', async () => {
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
    expect(screen.getByText('标普500')).toBeInTheDocument();
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

  it('keeps runtime ready chips green in the equity table', async () => {
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

    const priceRow = (await screen.findByText('股票价格数据')).closest('.snapshots-row-card');
    expect(priceRow).not.toBeNull();
    const readyChip = within(priceRow as HTMLElement).getByText('就绪');
    expect(readyChip).toHaveClass('status-chip--success');
    expect(readyChip).not.toHaveClass('status-chip--danger');
  });
});
