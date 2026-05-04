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
        benchmark_etf_coverage: {
          ready_count: 2,
          total_count: 2,
          missing_symbols: [],
          symbols: [
            { symbol: 'SPY', status: 'READY', start_date: '1996-01-02', end_date: '2026-04-01', trade_days: 7600 },
            { symbol: 'QQQ', status: 'READY', start_date: '1999-03-10', end_date: '2026-04-01', trade_days: 6800 },
          ],
        },
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
    {
      id: 'ds-index-valuations',
      name: 'Index Valuations',
      status: 'READY',
      as_of: '2026-04-01T07:48:00Z',
      freshness_label: '按月更新',
      start_date: '2014-01-01',
      end_date: '2026-04-01',
      row_count: 145,
      source: 'trendonify',
      fallback_source: 'worldperatio',
      metadata: {
        proxy_keys: ['nasdaq100'],
        observation_frequency: 'monthly',
        latest_date: '2026-04-01',
        latest_pe_ttm: 29.4,
        latest_percentile_10y: 82.6,
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
          'ds-index-valuations': {
            name: 'Index Valuations',
            updated_symbol_count: 1,
            updated_row_count: 145,
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

function buildSevenBondRowsOverview(): ApiSnapshotOverview {
  const refreshedAt = '2026-04-23T21:00:00Z';
  const instruments = [
    {
      id: 'bond-ust-cmt-2y',
      label: 'UST CMT 2Y',
      instrument_type: 'bond',
      asset_type: 'UST',
      tenor_label: '2Y',
      audit_profile: 'UST_CMT_2Y',
      source: 'bond_fixed_income',
      status: 'WATCH',
      symbol: 'UST2Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 1.0,
      duration: 1.9,
      effective_duration: 1.9,
      snapshot_ref: 'bond-ust-cmt-2y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { ytm_pct: 'READY' },
      audit_alerts: ['UST_CMT_2Y/10Y spread 365 bps is outside the -100..300 bps audit band.'],
      audit_notes: ['UST_CMT_2Y/10Y spread 365 bps; audit band -100..300 bps.'],
      updated_at: refreshedAt,
    },
    {
      id: 'bond-ust-cmt-10y',
      label: 'UST CMT 10Y',
      instrument_type: 'bond',
      asset_type: 'UST',
      tenor_label: '10Y',
      audit_profile: 'UST_CMT_10Y',
      source: 'bond_fixed_income',
      status: 'WATCH',
      symbol: 'UST10Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 4.65,
      duration: 8.3,
      effective_duration: 8.3,
      snapshot_ref: 'bond-ust-cmt-10y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { ytm_pct: 'READY' },
      audit_alerts: ['UST_CMT_2Y/10Y spread 365 bps is outside the -100..300 bps audit band.'],
      audit_notes: ['UST_CMT_2Y/10Y spread 365 bps; audit band -100..300 bps.'],
      updated_at: refreshedAt,
    },
    {
      id: 'bond-ust-cmt-30y',
      label: 'UST CMT 30Y',
      instrument_type: 'bond',
      asset_type: 'UST',
      tenor_label: '30Y',
      audit_profile: 'UST_CMT_30Y',
      source: 'bond_fixed_income',
      status: 'READY',
      symbol: 'UST30Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 4.8,
      duration: 17.8,
      effective_duration: 17.8,
      snapshot_ref: 'bond-ust-cmt-30y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { ytm_pct: 'READY' },
      audit_alerts: [],
      audit_notes: [],
      updated_at: refreshedAt,
    },
    {
      id: 'bond-ust-bill-13w',
      label: 'UST T-Bill 13W',
      instrument_type: 't_bill',
      asset_type: 'T_BILL',
      tenor_label: '13W',
      audit_profile: 'UST_BILL_3M',
      source: 'bond_fixed_income',
      status: 'READY',
      symbol: 'TBILL13W',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      maturity_date: '2026-07-23',
      clean_price: 98.75,
      net_price: 98.75,
      dirty_price: 98.75,
      full_price: 98.75,
      accrued_interest: null,
      discount_rate_pct: 5.18,
      ytm_pct: 5.21,
      duration: 0.24,
      effective_duration: 0.24,
      snapshot_ref: 'bond-ust-bill-13w',
      refresh_status: 'READY',
      missing_fields: ['accrued_interest'],
      inferred_fields: {},
      field_status: { accrued_interest: 'WAIVED', discount_rate_pct: 'READY' },
      audit_alerts: [],
      audit_notes: ['Accrued interest is waived for the UST_BILL_3M audit profile.'],
      updated_at: refreshedAt,
    },
    {
      id: 'bond-tips-5y',
      label: 'TIPS 5Y',
      instrument_type: 'tips',
      asset_type: 'TIPS',
      tenor_label: '5Y',
      audit_profile: 'TIPS',
      source: 'bond_fixed_income',
      status: 'READY',
      symbol: 'TIPS5Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 3.94,
      real_yield_pct: 1.82,
      inflation_factor: 1.0312,
      breakeven_inflation_bps: 212,
      duration: 4.7,
      effective_duration: 4.7,
      snapshot_ref: 'bond-tips-5y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { real_yield_pct: 'READY', breakeven_inflation_bps: 'READY' },
      audit_alerts: [],
      audit_notes: [],
      updated_at: refreshedAt,
    },
    {
      id: 'bond-tips-10y',
      label: 'TIPS 10Y',
      instrument_type: 'tips',
      asset_type: 'TIPS',
      tenor_label: '10Y',
      audit_profile: 'TIPS',
      source: 'bond_fixed_income',
      status: 'READY',
      symbol: 'TIPS10Y',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      ytm_pct: 4.05,
      real_yield_pct: 2.03,
      inflation_factor: 1.0425,
      breakeven_inflation_bps: 262,
      duration: 7.9,
      effective_duration: 7.9,
      snapshot_ref: 'bond-tips-10y',
      refresh_status: 'READY',
      missing_fields: [],
      inferred_fields: {},
      field_status: { real_yield_pct: 'READY', breakeven_inflation_bps: 'READY' },
      audit_alerts: [],
      audit_notes: [],
      updated_at: refreshedAt,
    },
    {
      id: 'bond-lqd-watch',
      label: 'LQD Investment Grade ETF',
      instrument_type: 'etf',
      asset_type: 'BOND_ETF',
      tenor_label: 'ETF',
      audit_profile: 'LQD',
      source: 'bond_fixed_income',
      status: 'WATCH',
      symbol: 'LQD',
      currency: 'USD',
      snapshot_date: '2026-04-23',
      sec_yield_30d_pct: 4.73,
      credit_quality: 'A-',
      tracking_error_bps: null,
      tracking_status: 'WATCH',
      snapshot_ref: 'bond-lqd-watch',
      refresh_status: 'READY',
      missing_fields: ['tracking_error_bps'],
      inferred_fields: {},
      field_status: { tracking_error_bps: 'MISSING' },
      audit_alerts: ['Published tracking_error_bps is required for BOND_ETF readiness.'],
      audit_notes: ['Official tracking-error evidence pending.'],
      updated_at: refreshedAt,
    },
  ];
  return {
    ...overview,
    bond_fixed_income: normalizeBondFixedIncomeOverview(
      {
        ...overview.bond_fixed_income,
        raw_registry: instruments.map((instrument) => ({
          id: instrument.id,
          label: instrument.label,
          status: instrument.status,
          source: instrument.source,
          snapshot_ref: instrument.snapshot_ref,
          updated_at: refreshedAt,
          notes: instrument.audit_notes,
        })),
        eligible_instruments: instruments,
      },
      overviewBase,
    ),
  };
}

function buildReadySevenBondRowsOverview(): ApiSnapshotOverview {
  const snapshot = buildSevenBondRowsOverview();
  const nextBond = normalizeBondFixedIncomeOverview(
    {
      ...snapshot.bond_fixed_income,
      global_pulse: {
        ...snapshot.bond_fixed_income.global_pulse,
        status: 'READY',
        cards: snapshot.bond_fixed_income.global_pulse.cards.map((card) => ({
          ...card,
          status: 'READY',
          value:
            card.id === 'dataset_coverage'
              ? '7/7 ready'
              : card.id === 'eligible_bond_sources'
                ? '7/7 eligible'
                : card.value,
        })),
      },
      eligible_instruments: snapshot.bond_fixed_income.eligible_instruments.map((instrument) => ({
        ...instrument,
        status: 'READY',
        clean_price: instrument.clean_price ?? 100,
        net_price: instrument.net_price ?? 100,
        dirty_price: instrument.dirty_price ?? 100,
        full_price: instrument.full_price ?? 100,
        accrued_interest: instrument.accrued_interest ?? 0,
        ytm_pct: instrument.ytm_pct ?? instrument.sec_yield_30d_pct ?? 5.1,
        duration: instrument.duration ?? instrument.effective_duration ?? 1,
        effective_duration: instrument.effective_duration ?? instrument.duration ?? 1,
        convexity: instrument.convexity ?? 0,
        tracking_error_bps: instrument.symbol === 'LQD' ? 164 : instrument.tracking_error_bps,
        tracking_error_source: instrument.symbol === 'LQD' ? 'MARKETS_INSIDER' : instrument.tracking_error_source,
        tracking_status: instrument.symbol === 'LQD' ? 'READY' : instrument.tracking_status,
        missing_fields: [],
        inferred_fields: {
          ...instrument.inferred_fields,
          full_price: instrument.full_price == null ? 'runtime_proxy' : undefined,
          accrued_interest: instrument.accrued_interest == null ? 'runtime_proxy' : undefined,
          duration: instrument.duration == null ? 'curve_proxy' : instrument.inferred_fields.duration,
        },
        field_status: {
          ...instrument.field_status,
          full_price: instrument.full_price == null ? 'INFERRED' : instrument.field_status.full_price,
          accrued_interest:
            instrument.field_status.accrued_interest === 'WAIVED'
              ? 'WAIVED'
              : instrument.accrued_interest == null
                ? 'INFERRED'
                : instrument.field_status.accrued_interest,
          duration: instrument.duration == null ? 'INFERRED' : instrument.field_status.duration,
          ytm_pct: instrument.ytm_pct == null ? 'INFERRED' : (instrument.field_status.ytm_pct ?? 'READY'),
        },
        audit_alerts: [],
        audit_notes: [],
      })),
    },
    overviewBase,
  );
  return {
    ...snapshot,
    bond_fixed_income: nextBond,
  };
}

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

    expect(readRule('.snapshots-page')).toContain('--snapshots-global-dashboard-min-height: 248px');
    expect(readRule('.snapshots-page')).toContain(
      'font-family: Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif',
    );
    expect(readRule('.snapshots-page.snapshots-page--equity')).toContain('gap: 16px');
    expect(readRule('.snapshots-header-card--standard')).toContain('min-height: auto');
    expect(readRule('.snapshots-header-card--standard')).not.toMatch(/min-height:\s*(?:1[5-9]\d|[2-9]\d{2,})px/);
    expect(readRule('.snapshots-header-card--standard .snapshots-tabs')).toContain('margin-top: 12px');
    expect(readRule('.snapshots-header-card--standard .snapshots-header__body')).toContain('white-space: normal');
    expect(readRule('.snapshots-workstation-header')).toContain('min-height: 64px');
    expect(readRule('.snapshots-workstation-title-row')).toContain('display: flex');
    expect(readRule('.snapshots-equity-view')).toContain('gap: 16px');
    expect(readRule('.snapshots-equity-view > .panel:first-child')).not.toMatch(/min-height:\s*(?:2[4-9]\d|[3-9]\d{2,})px/);
    expect(readRule('.snapshots-equity-view > .panel.snapshots-equity-overview')).toContain(
      'min-height: var(--snapshots-global-dashboard-min-height)',
    );
    expect(readRule('.snapshots-equity-view .metric-card')).not.toMatch(/min-height:\s*(?:1[4-9]\d|[2-9]\d{2,})px/);
    expect(readRule('.snapshots-equity-view .bond-core-card')).not.toMatch(/min-height:\s*(?:3[0-9]\d|[4-9]\d{2,})px/);
    expect(readRule('.snapshots-equity-view .detail-rail .rail-panel:last-child')).not.toMatch(/min-height:\s*(?:3[0-9]\d|[4-9]\d{2,})px/);
    expect(readRule('.snapshots-equity-view .snapshots-bond-source-stack')).toContain('gap: 8px');
    expect(readRule('.snapshots-equity-view .snapshots-bond-evidence-card')).toContain('padding: 10px 11px');
    expect(readRule('.snapshots-equity-view .detail-grid')).toContain('align-items: start');
    expect(readRule('.snapshots-equity-view .snapshots-equity-left-stack')).toContain('gap: 16px');
    expect(readRule('.snapshots-equity-view .snapshots-equity-right-stack')).toContain('gap: 16px');
  });

  it('keeps the bond tab visually attached to the shared snapshots header density', () => {
    const snapshotsCss = readFileSync('src/pages/snapshots-page.css', 'utf8');
    const readRule = (selector: string): string => {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return snapshotsCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? '';
    };

    expect(readRule('.snapshots-page')).toContain('--snapshots-global-dashboard-min-height: 248px');
    expect(readRule('.snapshots-bond-view')).not.toMatch(/margin-top:\s*(?:[3-9]\d|[1-9]\d{2,})px/);
    expect(readRule('.snapshots-bond-view')).toContain('gap: 23px');
    expect(readRule('.snapshots-page.snapshots-page--bond')).toContain('gap: 16px');
    expect(readRule('.snapshots-header-card--standard .snapshots-tabs')).toContain('margin-top: 12px');
    expect(readRule('.snapshots-bond-health-panel')).toContain(
      'min-height: var(--snapshots-global-dashboard-min-height)',
    );
    expect(readRule('.snapshots-bond-health-panel')).toContain('padding: 14px 18px');
    expect(readRule('.snapshots-page .snapshots-bond-panel')).toContain('box-shadow: none');
    expect(readRule('.snapshots-bond-workstation-grid')).toContain('grid-template-columns: minmax(0, 1fr) 330px');
    expect(readRule('.snapshots-bond-audit-layout')).toContain('grid-template-columns: minmax(0, 1fr) 330px');
    expect(readRule('.snapshots-bond-source-stack--scroll')).toContain('overflow-y: auto');
    expect(readRule('.snapshots-bond-source-stack--scroll')).toMatch(/max-height:\s*\d+px/);
  });

  it('renders the approved equity snapshots layout with runtime overview rows', async () => {
    const equityOverview: ApiSnapshotOverview = {
      ...overview,
      dataset_snapshots: [
        { ...overview.dataset_snapshots[0], source: 'mixed_sources' },
        ...overview.dataset_snapshots.slice(1),
      ],
    };
    fakeApi.getSnapshotOverview.mockResolvedValue(equityOverview);
    fakeApi.refreshSnapshots.mockResolvedValue({
      ...equityOverview,
      last_refreshed_at: '2026-04-01T10:00:00Z',
      latest_job: {
        ...equityOverview.latest_job,
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
    expect(screen.getByText('统一管理股票、指数与固定收益数据快照的覆盖率、刷新状态和入库资格，让研究员在建仓、回测和组合配置前先确认市场数据证据链。')).toBeInTheDocument();
    expect(screen.getByText('健康仪表盘')).toBeInTheDocument();
    expect(screen.getByText('三位一体工作站')).toBeInTheDocument();
    expect(screen.queryByText('股票 / 指数 / 篮子')).not.toBeInTheDocument();
    expect(screen.getByText('原始快照清单')).toBeInTheDocument();
    expect(screen.getByText('数据诊断报告')).toBeInTheDocument();
    expect(screen.getByText('就绪标准')).toBeInTheDocument();
    expect(screen.getByText('787/974 就绪')).toBeInTheDocument();
    expect(screen.queryByText('Runtime 快照总览')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '股票/指数' })).toBeInTheDocument();
    const globalView = screen.getByRole('heading', { name: '健康仪表盘' }).closest('section');
    expect(globalView).not.toBeNull();
    expect(within(globalView as HTMLElement).getByText('股票快照')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('指数与基准')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('权益篮子')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('异常队列')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('最新刷新（EST）')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('03:48')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('80.8% 覆盖')).toBeInTheDocument();
    expect(
      within(globalView as HTMLElement).getByText('787/974 个 symbol 已覆盖，按公司行为数据与股票价格数据合并计算。'),
    ).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('100% 就绪')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('100% 可用')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).getByText('2 项例外')).toBeInTheDocument();
    expect(screen.queryByText(/runtime/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/overview/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mixed_sources/i)).not.toBeInTheDocument();
    expect(screen.getByText('来源 多来源汇总')).toBeInTheDocument();
    expect(within(globalView as HTMLElement).queryByText('覆盖率')).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime 原始快照清单')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('公司行为数据')).toBeInTheDocument();
    expect(screen.getByText('股票价格数据')).toBeInTheDocument();
    expect(screen.getByText('标普500')).toBeInTheDocument();
    expect(screen.getByText('纳指100')).toBeInTheDocument();
    const workstation = screen.getByRole('heading', { name: '三位一体工作站' }).closest('section');
    const rawList = screen.getByRole('heading', { name: '原始快照清单' }).closest('section');
    const leftStack = document.querySelector('.snapshots-equity-left-stack');
    expect(workstation?.querySelector('.snapshots-workstation-header')).not.toBeNull();
    expect(workstation?.querySelector('.snapshots-workstation-title-row')).not.toBeNull();
    expect(leftStack).not.toBeNull();
    expect(leftStack).toContainElement(workstation);
    expect(leftStack).toContainElement(rawList);
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
        targets: ['price', 'corporate', 'valuations', 'universes'],
        reason: 'manual-refresh-latest-and-repair',
      }),
    );
  });

  it('counts the S&P 500 and Nasdaq constituent lists as equity basket readiness', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      dataset_snapshots: overview.dataset_snapshots.map((item) => ({
        ...item,
        status: item.id === 'ds-price' ? 'INCOMPLETE' : item.status,
      })),
      universe_snapshots: overview.universe_snapshots.map((item) => ({
        ...item,
        status: item.id === 'un-ndx100' ? 'INCOMPLETE' : item.status,
        blocker:
          item.id === 'un-ndx100'
            ? {
                code: 'UNIVERSE_HISTORY_INCOMPLETE',
                message: 'Universe history is partially available, but more historical anchors still need to be repaired.',
              }
            : item.blocker,
      })),
    });

    renderSnapshotsPage();

    await screen.findByRole('button', { name: /刷新/ });
    const basketMetric = screen
      .getAllByText('权益篮子')
      .map((node) => node.closest('.metric-card'))
      .find((node): node is HTMLElement => node instanceof HTMLElement);
    if (!basketMetric) {
      throw new Error('权益篮子 metric card was not rendered');
    }
    expect(within(basketMetric).getByText('100% 可用')).toBeInTheDocument();
    expect(within(basketMetric).getByText(/2\/2/)).toBeInTheDocument();

    const basketCoreCard = Array.from(document.querySelectorAll('.bond-core-card')).find((node) =>
      node.textContent?.includes('权益篮子'),
    );
    expect(basketCoreCard).toBeDefined();
    expect(basketCoreCard?.textContent).toContain('2 就绪');
    expect(basketCoreCard?.textContent).toContain('2 总数');
    expect(basketCoreCard?.querySelector('.status-chip--success')).not.toBeNull();
  });

  it('uses latest refresh delta stats in the equity refresh card instead of totals', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue(overview);

    renderSnapshotsPage();

    await screen.findByRole('button', { name: /刷新/ });
    const refreshMetric = screen
      .getAllByText(/最新刷新/)
      .map((node) => node.closest('.metric-card'))
      .find((node): node is HTMLElement => node instanceof HTMLElement);
    expect(refreshMetric).toBeDefined();
    expect(refreshMetric?.textContent).toContain('本次新增');
    expect(refreshMetric?.textContent).toContain('股票价格数据 49 行');
    expect(refreshMetric?.textContent).toContain('公司行为数据 49 行');
    expect(refreshMetric?.textContent).not.toContain('数据行');
    expect(refreshMetric?.textContent).not.toContain('成分');
  });

  it('uses benchmark ETF price history coverage for index and benchmark readiness', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue({
      ...overview,
      dataset_snapshots: overview.dataset_snapshots.map((item) =>
        item.id === 'ds-price'
          ? {
              ...item,
              status: 'INCOMPLETE',
              metadata: {
                ...item.metadata,
                benchmark_etf_coverage: {
                  ready_count: 2,
                  total_count: 2,
                  symbols: [
                    { symbol: 'SPY', status: 'READY', start_date: '1996-01-02', end_date: '2026-04-01', trade_days: 7600 },
                    { symbol: 'QQQ', status: 'READY', start_date: '1999-03-10', end_date: '2026-04-01', trade_days: 6800 },
                  ],
                },
              },
            }
          : item,
      ),
      universe_snapshots: overview.universe_snapshots.map((item) => ({
        ...item,
        status: 'INCOMPLETE',
      })),
    });

    renderSnapshotsPage();

    await screen.findByRole('button', { name: /刷新/ });
    const benchmarkMetric = screen
      .getAllByText('指数与基准')
      .map((node) => node.closest('.metric-card'))
      .find((node): node is HTMLElement => node instanceof HTMLElement);
    if (!benchmarkMetric) {
      throw new Error('指数与基准 metric card was not rendered');
    }
    expect(within(benchmarkMetric).getByText('100% 就绪')).toBeInTheDocument();
    expect(within(benchmarkMetric).getByText(/2\/2 个基准ETF历史数据完备/)).toBeInTheDocument();

    const benchmarkCoreCard = Array.from(document.querySelectorAll('.bond-core-card')).find((node) =>
      node.textContent?.includes('指数与基准'),
    );
    expect(benchmarkCoreCard).toBeDefined();
    expect(benchmarkCoreCard?.textContent).toContain('2 就绪');
    expect(benchmarkCoreCard?.textContent).toContain('2 总数');
    expect(benchmarkCoreCard?.querySelector('.status-chip--success')).not.toBeNull();
  });

  it('localizes OpenBB provider ids on the snapshot surface', async () => {
    const openbbOverview: ApiSnapshotOverview = {
      ...overview,
      dataset_snapshots: [
        {
          ...overview.dataset_snapshots[1],
          source: 'openbb_yfinance',
          fallback_source: 'openbb_tiingo',
          metadata: {
            ...overview.dataset_snapshots[1].metadata,
            provider_summary: {
              providers: {
                openbb_tiingo: {
                  access_tier: 'free_account',
                  quota_limited: true,
                  next_retry_at: '2026-04-02T00:00:00Z',
                },
              },
            },
          },
        },
        ...overview.dataset_snapshots
          .filter((item) => item.id !== 'ds-price')
          .map((item) => (item.id === 'ds-corporate-actions' ? { ...item, source: 'openbb_tiingo' } : item)),
      ],
      universe_snapshots: [
        {
          ...overview.universe_snapshots[0],
          source: 'openbb_index_constituents',
          metadata: {
            ...overview.universe_snapshots[0].metadata,
            openbb_current_constituent_check: {
              provider: 'openbb_index_constituents',
              status: 'succeeded',
              auxiliary_only: true,
            },
          },
        },
        ...overview.universe_snapshots.slice(1),
      ],
    };
    fakeApi.getSnapshotOverview.mockResolvedValue(openbbOverview);

    renderSnapshotsPage();

    expect(await screen.findByText('来源 OpenBB Yahoo 行情')).toBeInTheDocument();
    expect(screen.getByText('来源 OpenBB Tiingo 行情')).toBeInTheDocument();
    expect(screen.getByText('来源 OpenBB 当前成分校验')).toBeInTheDocument();
    expect(screen.queryByText(/openbb_yfinance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/openbb_tiingo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/openbb_index_constituents/i)).not.toBeInTheDocument();
  });

  it('renders the valuation dataset row inside the equity snapshots list', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue(overview);
    fakeApi.refreshSnapshots.mockResolvedValue(overview);

    renderSnapshotsPage();

    expect(await screen.findByText('Index Valuations')).toBeInTheDocument();
  });

  it('restores the bond snapshots tab', async () => {
    fakeApi.getSnapshotOverview.mockResolvedValue(overview);
    fakeApi.refreshSnapshots.mockResolvedValue(overview);

    renderSnapshotsPage('bond');

    expect(await screen.findByRole('heading', { level: 1, name: '数据快照' })).toBeInTheDocument();
    expect(screen.getByText('统一管理股票、指数与固定收益数据快照的覆盖率、刷新状态和入库资格，让研究员在建仓、回测和组合配置前先确认市场数据证据链。')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole('button', { name: '刷新债券快照' })).toBeInTheDocument();
    expect(screen.queryByText('资产腿合法来源')).not.toBeInTheDocument();
    expect(screen.queryByText('日终刷新 (EOD)')).not.toBeInTheDocument();
    expect(screen.queryByText('到期收益率（YTM） / 久期 / 凸性')).not.toBeInTheDocument();
    expect(screen.queryByText('净价 / 全价 / 应计')).not.toBeInTheDocument();
    expect(screen.getByText('健康仪表盘')).toBeInTheDocument();
    expect(screen.getByText('就绪 / 待补 / 阻塞')).toBeInTheDocument();
    expect(screen.getByText('影子字段覆盖率')).toBeInTheDocument();
    expect(screen.getByText('入库链路')).toBeInTheDocument();
    expect(screen.queryByText('入库链路与数据自愈')).not.toBeInTheDocument();
    expect(screen.queryByText('自愈进行中')).not.toBeInTheDocument();
    expect(screen.queryByText('UST 4/4 就绪')).not.toBeInTheDocument();
    expect(screen.queryByText('TIPS 2/2 就绪')).not.toBeInTheDocument();
    expect(screen.queryByText('IG 0/1 就绪')).not.toBeInTheDocument();
    expect(screen.getAllByText('利率债（UST）').length).toBeGreaterThan(0);
    expect(screen.getByText('影子数据审计矩阵')).toBeInTheDocument();
    expect(screen.getByText('UST 术语说明')).toBeInTheDocument();
    expect(screen.getByText('尚未写入真实运行时曲线点；这里保留批准稿位置，但不使用代理或静态曲线兜底。')).toBeInTheDocument();
    expect(document.querySelector('.snapshots-bond-runtime-panel .snapshots-bond-create-rail')).toBeNull();
    expect(document.querySelector('.snapshots-bond-workstation-grid > .snapshots-bond-detail-rail .snapshots-bond-create-rail')).not.toBeNull();
    expect(document.querySelector('[data-ui="asset-leg-eligibility-rail"]')).not.toBeNull();
    const workstation = screen.getByRole('heading', { name: '三位一体工作站' }).closest('section');
    expect(workstation?.querySelector('.snapshots-workstation-header')).not.toBeNull();
    expect(workstation?.querySelector('.snapshots-workstation-title-row')).not.toBeNull();
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
    expect(document.querySelector('.snapshots-bond-detail-stack > .snapshots-bond-diagnostic-panel')).toBeNull();
    expect(document.querySelector('.snapshots-bond-audit-layout > .snapshots-bond-detail-rail .snapshots-bond-diagnostic-rail')).toBeNull();
    expect(document.querySelector('[data-ui="bond-quality-audit-matrix"]')).not.toBeNull();
    expect(document.querySelector('[data-ui="bond-repair-rules"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: '原始快照与调度' })).toBeInTheDocument();
    expect(document.querySelector('.snapshots-bond-curve-axis')).toBeNull();
    expect(screen.getByText('资产腿创建')).toBeInTheDocument();
    expect(screen.queryByText('Runtime eligible bond sources')).not.toBeInTheDocument();
    expect(screen.queryByText('No runtime eligible bond sources yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/Runtime fixed-income snapshot row/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Only runtime fixed-income snapshot rows are eligible asset-leg sources/i)).not.toBeInTheDocument();
    expect(screen.queryByText('共享快照路由')).not.toBeInTheDocument();
    expect(screen.queryByText('不新增债券专属调度器')).not.toBeInTheDocument();
    expect(screen.queryByText('第一阶段曲线样本')).not.toBeInTheDocument();
    expect(screen.queryByText('?砍銵蛹?唳')).not.toBeInTheDocument();
  });

  it('aligns the bond health bar and field coverage with ready runtime fields', async () => {
    const readyOverview = buildReadySevenBondRowsOverview();
    fakeApi.getSnapshotOverview.mockResolvedValue(readyOverview);
    fakeApi.refreshSnapshots.mockResolvedValue(readyOverview);

    renderSnapshotsPage('bond');

    expect(await screen.findByText('就绪 7')).toBeInTheDocument();
    expect(screen.getByText('待补 0')).toBeInTheDocument();
    expect(screen.getByText('阻塞 0')).toBeInTheDocument();
    expect(screen.getByText('100% 已覆盖')).toBeInTheDocument();
    expect(screen.getByText('28/28 关键字段可用')).toBeInTheDocument();
    expect(screen.getByText('推算/豁免字段计入可用；只有缺失或待复核才影响资产腿和组合。')).toBeInTheDocument();
    expect(screen.getByText('全局异常队列')).toBeInTheDocument();
    expect(screen.getByText('无债券异常')).toBeInTheDocument();
    const globalAnomalyCard = screen.getByText('全局异常队列').closest('article');
    expect(globalAnomalyCard).not.toBeNull();
    expect(within(globalAnomalyCard as HTMLElement).queryByText('公司行为数据部分可用')).not.toBeInTheDocument();
    expect(within(globalAnomalyCard as HTMLElement).queryByText('股票池历史数据部分可用')).not.toBeInTheDocument();

    const pulseSegments = Array.from(document.querySelectorAll('.snapshots-bond-pulse-bar span')) as HTMLElement[];
    expect(pulseSegments).toHaveLength(3);
    expect(pulseSegments[0].style.width).toBe('100%');
    expect(pulseSegments[1].style.width).toBe('0%');
    expect(pulseSegments[2].style.width).toBe('0%');

    const auditSection = screen.getByRole('heading', { name: '影子数据审计矩阵' }).closest('section');
    expect(auditSection).not.toBeNull();
    expect(within(auditSection as HTMLElement).queryByText('推算')).not.toBeInTheDocument();
    expect(within(auditSection as HTMLElement).queryByText('已推算')).not.toBeInTheDocument();
    expect(within(auditSection as HTMLElement).queryByText('可用')).not.toBeInTheDocument();
    expect(within(auditSection as HTMLElement).getAllByText('√')).toHaveLength(28);
    fireEvent.click(within(auditSection as HTMLElement).getByRole('button', { name: '展开质量审计' }));
    expect(within(auditSection as HTMLElement).getAllByText('通过').length).toBeGreaterThan(0);
    expect(within(auditSection as HTMLElement).getAllByText('价格一致性 通过 · 风险字段 完整').length).toBeGreaterThan(0);
    expect(within(auditSection as HTMLElement).queryByText('PASS')).not.toBeInTheDocument();
    expect(within(auditSection as HTMLElement).queryByText('Repair missing or inferred fixed-income fields')).not.toBeInTheDocument();
    expect(within(auditSection as HTMLElement).queryByText('修复目标 bond')).not.toBeInTheDocument();

    fireEvent.click(within(auditSection as HTMLElement).getByRole('button', { name: '一键修复全部问题' }));
    await waitFor(() =>
      expect(fakeApi.refreshSnapshots).toHaveBeenCalledWith({
        mode: 'full',
        targets: ['price', 'corporate', 'valuations', 'universes', 'bond'],
        reason: 'manual-refresh-bond-complete',
      }),
    );
  });

  it('collapses healthy bond detail modules and only shows actionable diagnostics at the top', async () => {
    const readyOverview = buildReadySevenBondRowsOverview();
    const overviewWithHealthyMemory: ApiSnapshotOverview = {
      ...readyOverview,
      bond_fixed_income: normalizeBondFixedIncomeOverview(
        {
          ...readyOverview.bond_fixed_income,
          system_diagnostics: {
            ...readyOverview.bond_fixed_income.system_diagnostics,
            memory: {
              total_physical_bytes: 34_000_000_000,
              available_physical_bytes: 19_000_000_000,
              system_memory_ratio: 0.41,
              process_working_set_bytes: 0,
            },
            notes: [
              'Shared snapshot blockers stay visible as diagnostics, but the current bond runtime contract is the asset-leg gate.',
              'Only runtime fixed-income snapshot rows are eligible asset-leg sources.',
            ],
          },
        },
        overviewBase,
      ),
    };
    fakeApi.getSnapshotOverview.mockResolvedValue(overviewWithHealthyMemory);
    fakeApi.refreshSnapshots.mockResolvedValue(overviewWithHealthyMemory);

    renderSnapshotsPage('bond');

    await screen.findByText('健康仪表盘');
    const detailStack = document.querySelector('.snapshots-bond-detail-stack');
    const auditLayout = document.querySelector('.snapshots-bond-audit-layout');
    expect(detailStack).not.toBeNull();
    expect(auditLayout).not.toBeNull();
    expect(screen.queryByText('系统诊断')).not.toBeInTheDocument();
    expect(screen.queryByText('运行时内存护栏')).not.toBeInTheDocument();
    expect(screen.queryByText(/专家建议/)).not.toBeInTheDocument();
    expect(screen.queryByText('公司行为数据部分可用')).not.toBeInTheDocument();

    const qualitySection = document.querySelector('[data-ui="bond-quality-audit-matrix"]');
    const repairSection = document.querySelector('[data-ui="bond-repair-rules"]');
    const registrySection = document.querySelector('[data-ui="bond-raw-registry"]');
    expect(qualitySection).toHaveAttribute('data-collapsed', 'true');
    expect(repairSection).toHaveAttribute('data-collapsed', 'true');
    expect(registrySection).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByText('价格一致性 通过 · 风险字段 完整')).not.toBeInTheDocument();
    expect(screen.queryByText('执行规则')).not.toBeInTheDocument();
    expect(screen.queryByText('当前没有异常债券行')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开质量审计' }));
    expect(qualitySection).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getAllByText('价格一致性 通过 · 风险字段 完整').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '展开一键修复规则' }));
    expect(repairSection).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getAllByText('执行规则').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '展开原始快照与调度' }));
    expect(registrySection).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByText('当前没有异常债券行')).toBeInTheDocument();
  });

  it('normalizes the seven-row bond contract and blocks the LQD WATCH row', async () => {
    const sevenRowOverview = buildSevenBondRowsOverview();
    fakeApi.getSnapshotOverview.mockResolvedValue(sevenRowOverview);
    fakeApi.refreshSnapshots.mockResolvedValue(sevenRowOverview);

    const instruments = sevenRowOverview.bond_fixed_income.eligible_instruments;
    expect(instruments).toHaveLength(7);
    expect(instruments.find((item) => item.id === 'bond-ust-bill-13w')).toMatchObject({
      asset_type: 'T_BILL',
      tenor_label: '13W',
      audit_profile: 'UST_BILL_3M',
      discount_rate_pct: 5.18,
      effective_duration: 0.24,
      field_status: expect.objectContaining({ accrued_interest: 'WAIVED' }),
    });
    expect(instruments.find((item) => item.id === 'bond-tips-10y')).toMatchObject({
      asset_type: 'TIPS',
      real_yield_pct: 2.03,
      inflation_factor: 1.0425,
      breakeven_inflation_bps: 262,
    });
    expect(instruments.find((item) => item.id === 'bond-lqd-watch')).toMatchObject({
      asset_type: 'BOND_ETF',
      sec_yield_30d_pct: 4.73,
      credit_quality: 'A-',
      tracking_error_bps: null,
      tracking_status: 'WATCH',
      status: 'WATCH',
    });

    renderSnapshotsPage('bond');

    expect((await screen.findAllByText('UST T-Bill 13W')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('TIPS 10Y').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LQD Investment Grade ETF').length).toBeGreaterThan(0);
    const scrollStack = document.querySelector('.snapshots-bond-source-stack--scroll');
    expect(scrollStack).not.toBeNull();
    expect(scrollStack?.querySelectorAll('.snapshots-bond-source-choice')).toHaveLength(4);
    const visibleLabels = Array.from(scrollStack?.querySelectorAll('.snapshots-bond-source-choice strong') ?? []).map(
      (node) => node.textContent?.trim(),
    );
    expect(visibleLabels).toEqual(['UST T-Bill 13W', 'UST CMT 2Y', 'UST CMT 10Y', 'UST CMT 30Y']);
    expect(document.querySelector('.snapshots-bond-progress-inline')).toBeNull();
    const anomalyButton = screen.getByRole('button', { name: /3 项待处理/ });
    expect(anomalyButton).toHaveAttribute('aria-controls', 'bond-system-diagnostics');
    fireEvent.click(anomalyButton);
    const diagnosticPanel = screen.getByRole('heading', { name: '系统诊断' }).closest('section');
    expect(diagnosticPanel).not.toBeNull();
    expect(within(diagnosticPanel as HTMLElement).getByText('UST CMT 2Y')).toBeInTheDocument();
    expect(within(diagnosticPanel as HTMLElement).getByText('UST CMT 10Y')).toBeInTheDocument();
    expect(within(diagnosticPanel as HTMLElement).getByText('LQD Investment Grade ETF')).toBeInTheDocument();
    expect(within(diagnosticPanel as HTMLElement).queryByText('公司行为数据部分可用')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /抗通胀债（TIPS）/ }));
    expect(scrollStack?.querySelectorAll('.snapshots-bond-source-choice')).toHaveLength(2);
    expect(screen.getAllByText('TIPS 10Y').length).toBeGreaterThan(0);
    expect(document.querySelector('.snapshots-bond-progress-inline')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /投资级信用债（IG）/ }));
    expect(scrollStack?.querySelectorAll('.snapshots-bond-source-choice')).toHaveLength(1);

    const lqdButton = screen.getByRole('button', { name: /LQD Investment Grade ETF/ });
    expect(lqdButton).toBeDisabled();
    expect(fakeApi.createAssetLeg).not.toHaveBeenCalled();
  });

  it('uses system curve diagnosis copy instead of manual audit handoff', async () => {
    const readyOverview = buildReadySevenBondRowsOverview();
    const overviewWithCurve: ApiSnapshotOverview = {
      ...readyOverview,
      bond_fixed_income: normalizeBondFixedIncomeOverview(
        {
          ...readyOverview.bond_fixed_income,
          curve_preview: [
            { tenor_label: '3M', yield_pct: 5.2, spread_bps: 0 },
            { tenor_label: '2Y', yield_pct: 4.4, spread_bps: -80 },
            { tenor_label: '10Y', yield_pct: 4.5, spread_bps: -70 },
            { tenor_label: '30Y', yield_pct: 4.7, spread_bps: -50 },
          ],
        },
        overviewBase,
      ),
    };
    fakeApi.getSnapshotOverview.mockResolvedValue(overviewWithCurve);

    renderSnapshotsPage('bond');

    expect(await screen.findByText('曲线预览')).toBeInTheDocument();
    expect(screen.queryByText('曲线异常偏移：建议去审计矩阵复核长端应计与 10Y 估值点。')).not.toBeInTheDocument();
    const diagnosis = screen.getByText('曲线校验通过：系统已核对 10Y-2Y 利差与长端应计，当前无需人工复核。');
    expect(diagnosis).toBeInTheDocument();
    expect(diagnosis).toHaveClass('snapshots-bond-curve-anomaly--neutral');
  });

  it('shows only anomalous bond registry rows and wires refresh to the complete repair job', async () => {
    const sevenRowOverview = buildSevenBondRowsOverview();
    fakeApi.getSnapshotOverview.mockResolvedValue(sevenRowOverview);
    fakeApi.refreshSnapshots.mockResolvedValue(sevenRowOverview);

    renderSnapshotsPage('bond');

    const registrySection = (await screen.findByRole('heading', { name: '原始快照与调度' })).closest('section');
    expect(registrySection).not.toBeNull();
    expect(within(registrySection as HTMLElement).queryAllByRole('radio')).toHaveLength(0);
    expect(within(registrySection as HTMLElement).getByText('3 条异常行')).toBeInTheDocument();
    expect(within(registrySection as HTMLElement).getByText('UST CMT 2Y')).toBeInTheDocument();
    expect(within(registrySection as HTMLElement).getByText('UST CMT 10Y')).toBeInTheDocument();
    expect(within(registrySection as HTMLElement).getByText('LQD Investment Grade ETF')).toBeInTheDocument();
    expect(within(registrySection as HTMLElement).queryByText('UST CMT 30Y')).not.toBeInTheDocument();

    const refreshButton = within(registrySection as HTMLElement).getByRole('button', { name: '重刷 3 个异常行' });
    fireEvent.click(refreshButton);

    await waitFor(() =>
      expect(fakeApi.refreshSnapshots).toHaveBeenCalledWith({
        mode: 'full',
        targets: ['price', 'corporate', 'valuations', 'universes', 'bond'],
        reason: 'manual-refresh-bond-complete',
      }),
    );
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
    expect(document.querySelector('[data-ui="daily-accrual-status"]')).not.toBeNull();
    expect(document.querySelector('[data-ui="risk-budget-precheck"]')).not.toBeNull();
    expect(screen.getByText('入库演进：运行时字段流')).toBeInTheDocument();

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
        targets: ['price', 'corporate', 'valuations', 'universes'],
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

    expect(await screen.findByText('健康仪表盘')).toBeInTheDocument();
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

    expect(await screen.findByText('健康仪表盘')).toBeInTheDocument();
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

    expect(await screen.findByText('健康仪表盘')).toBeInTheDocument();
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

    expect(await screen.findByText('健康仪表盘')).toBeInTheDocument();
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
