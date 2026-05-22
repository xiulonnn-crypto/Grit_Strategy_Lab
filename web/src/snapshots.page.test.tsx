import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouteProvider } from './lib/appRouteContext';
import { SnapshotsPage } from './pages/snapshots-page';
import type {
  ApiSnapshotOverview,
  ApiSnapshotProviderAttempts,
  ApiSnapshotProviderRegistry,
} from './types';

const fakeApi = vi.hoisted(() => ({
  getSnapshotOverview: vi.fn(),
  getSnapshotProviderRegistry: vi.fn(),
  getSnapshotProviderAttempts: vi.fn(),
  refreshSnapshots: vi.fn(),
  createAssetLeg: vi.fn(),
})) as {
  getSnapshotOverview: ReturnType<typeof vi.fn>;
  getSnapshotProviderRegistry: ReturnType<typeof vi.fn>;
  getSnapshotProviderAttempts: ReturnType<typeof vi.fn>;
  refreshSnapshots: ReturnType<typeof vi.fn>;
  createAssetLeg: ReturnType<typeof vi.fn>;
};

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

function renderSnapshotsPage(tab: 'equity' | 'bond' = 'equity', target?: string): void {
  render(
    <AppRouteProvider
      navigate={(path) => {
        window.location.hash = path;
      }}
      route={{ kind: 'snapshots', tab, target }}
    >
      <SnapshotsPage />
    </AppRouteProvider>,
  );
}

function overviewFixture(): ApiSnapshotOverview {
  return {
    overall_status: 'INCOMPLETE',
    last_refreshed_at: '2026-05-20T08:30:00Z',
    blocking_code: 'CORPORATE_ACTIONS_INCOMPLETE',
    blocking_target: 'ds-corporate-actions',
    message: 'Corporate action data is partially available.',
    allowed_actions: ['refresh_snapshots'],
    latest_job: {
      id: 'snap_57ae046824c9',
      status: 'INCOMPLETE',
      updated_at: '2026-05-20T08:30:00Z',
      request: {
        mode: 'repair',
        targets: ['price', 'corporate'],
      },
      summary: {
        refresh_stats: {
          datasets: {
            'ds-price': {
              rows_inserted: 1482,
              landed_symbol_count: 1266,
              source: 'yahoo',
            },
            'ds-corporate-actions': {
              rows_inserted: 1030,
              landed_symbol_count: 1030,
              source: 'mixed_sources',
            },
          },
          bond_fixed_income: {
            bond_fixed_income: {
              rows_inserted: 7,
              source: 'openbb_bond_fixed_income',
            },
          },
        },
      },
      blocking_code: 'CORPORATE_ACTIONS_INCOMPLETE',
    },
    dataset_snapshots: [
      {
        id: 'ds-price',
        name: 'Price Snapshot',
        status: 'INCOMPLETE',
        as_of: '2026-05-20T08:20:00Z',
        freshness_label: 'latest',
        start_date: '1996-01-01',
        end_date: '2026-05-20',
        row_count: 6485875,
        source: 'yahoo',
        fallback_source: 'stooq',
        metadata: {
          covered_symbol_count: 1266,
          total_symbol_count: 1482,
          provider_summary: {
            providers: {
              yahoo: { access_tier: 'public', actions_supported: true },
            },
          },
        },
        blocker: {
          code: 'PRICE_SNAPSHOT_INCOMPLETE',
          message: 'Price snapshot incomplete.',
        },
      },
      {
        id: 'ds-corporate-actions',
        name: 'Corporate Actions',
        status: 'STALE',
        as_of: '2026-05-20T08:20:00Z',
        freshness_label: 'stale',
        start_date: '1996-01-01',
        end_date: '2026-05-20',
        row_count: 96165,
        source: 'mixed_sources',
        fallback_source: 'alpha_vantage',
        metadata: {
          covered_symbol_count: 1030,
          total_symbol_count: 1482,
          provider_summary: {
            providers: {
              tiingo: { access_tier: 'paid_optional', actions_supported: true },
              alpha_vantage: { access_tier: 'free_account', quota_limited: true },
            },
          },
        },
        blocker: {
          code: 'CORPORATE_ACTIONS_INCOMPLETE',
          message: 'Corporate actions incomplete.',
        },
      },
      {
        id: 'ds-fundamentals',
        name: 'Fundamentals',
        status: 'READY',
        as_of: '2026-05-20T08:20:00Z',
        row_count: 140734,
        source: 'sec_edgar',
        fallback_source: null,
        metadata: {
          covered_symbol_count: 940,
          total_symbol_count: 1482,
          effective_covered_symbol_count: 1482,
          effective_total_symbol_count: 1482,
          effective_coverage_pct: 100.0,
          fundamental_gap_policy: {
            raw_covered_symbol_count: 940,
            raw_total_symbol_count: 1482,
            logical_covered_symbol_count: 1482,
            logical_total_symbol_count: 1482,
            logical_coverage_pct: 100.0,
            coverage_gate: 'READY',
          },
        },
        blocker: null,
      },
      {
        id: 'ds-analyst-consensus',
        name: 'Analyst Consensus',
        status: 'READY',
        as_of: '2026-05-20T08:20:00Z',
        row_count: 3855,
        source: 'alpha_vantage',
        fallback_source: null,
        metadata: {
          covered_symbol_count: 729,
          total_symbol_count: 729,
        },
        blocker: null,
      },
      {
        id: 'ds-short-volume',
        name: 'Short Volume',
        status: 'READY',
        as_of: '2026-05-20T08:20:00Z',
        row_count: 2824,
        source: 'finra_short_volume',
        fallback_source: null,
        metadata: {
          covered_symbol_count: 729,
          total_symbol_count: 729,
        },
        blocker: null,
      },
      {
        id: 'ds-macro-rates',
        name: 'Macro Rates',
        status: 'READY',
        as_of: '2026-05-20T08:20:00Z',
        row_count: 1483,
        source: 'fred_macro_series',
        fallback_source: null,
        metadata: {
          covered_symbol_count: 10,
          total_symbol_count: 10,
        },
        blocker: null,
      },
      {
        id: 'ds-option-skew',
        name: 'Option Skew',
        status: 'READY',
        as_of: '2026-05-20T08:20:00Z',
        row_count: 2187,
        source: 'polygon',
        fallback_source: null,
        metadata: {
          covered_symbol_count: 729,
          total_symbol_count: 729,
        },
        blocker: null,
      },
    ],
    data_layer_readiness: [
      {
        layer_id: 'l2_fundamental_data',
        title_cn: 'L2 财务截面',
        status: 'READY',
        summary: '财务字段和发布时点门禁已形成可计算基础，可进入质量与稳健性因子研究。',
        metrics: [
          { label: '覆盖率', value: '100.0%' },
          { label: '可用字段', value: 18 },
          { label: 'PIT 点位', value: 140734 },
        ],
        pit_metrics: [
          { label: '覆盖率', value: '100.0%' },
          { label: '可用字段', value: 18 },
          { label: 'PIT 点位', value: 140734 },
        ],
        gap_policy: {
          raw_covered_symbol_count: 940,
          raw_total_symbol_count: 1482,
          logical_covered_symbol_count: 1482,
          logical_total_symbol_count: 1482,
          logical_coverage_pct: 100.0,
          coverage_gate: 'READY',
        },
      },
    ],
    universe_snapshots: [
      {
        id: 'un-sp500',
        name: 'S&P 500',
        status: 'READY',
        as_of: '2026-05-20T08:20:00Z',
        member_count: 503,
        source: 'sp_global_official_constituent_change',
        fallback_source: 'wikipedia_revision_history',
        metadata: {
          historical_anchor_count: 60,
          anchor_count: 60,
        },
        blocker: null,
      },
    ],
    bond_fixed_income: {
      global_pulse: {
        status: 'READY',
        headline: 'Bond fixed-income snapshots are ready.',
        updated_at: '2026-05-20T08:25:00Z',
        cards: [],
      },
      pillar_groups: [],
      curve_preview: [
        { tenor_label: '3M', yield_pct: 3.69, spread_bps: -26 },
        { tenor_label: '2Y', yield_pct: 3.95, spread_bps: 0 },
        { tenor_label: '10Y', yield_pct: 4.45, spread_bps: 50 },
        { tenor_label: '30Y', yield_pct: 5.02, spread_bps: 107 },
      ],
      audit_matrix: [
        {
          id: 'ust_curve',
          label: 'UST curve completeness',
          owner: 'market-data',
          status: 'PASS',
          cadence_label: 'daily',
          evidence: '7/7 eligible instruments ready',
        },
      ],
      raw_registry: [],
      eligible_sources: [],
      eligible_instruments: [
        {
          id: 'UST_CMT_10Y',
          label: 'UST CMT 10Y',
          instrument_type: 'TREASURY',
          asset_type: 'BOND',
          tenor_label: '10Y',
          source: 'openbb_bond_fixed_income',
          status: 'READY',
          symbol: 'UST10Y',
          ytm_pct: 4.45,
          duration: 8.4,
          convexity: 0.91,
          snapshot_ref: 'bond::UST_CMT_10Y',
          missing_fields: [],
          inferred_fields: {},
          field_status: {},
        },
        {
          id: 'UST_BILL_3M',
          label: 'UST Bill 3M',
          instrument_type: 'TREASURY_BILL',
          asset_type: 'BOND',
          tenor_label: '3M',
          source: 'openbb_bond_fixed_income',
          status: 'READY',
          symbol: 'UST3M',
          ytm_pct: 3.69,
          duration: 0.24,
          snapshot_ref: 'bond::UST_BILL_3M',
          missing_fields: [],
          inferred_fields: {},
          field_status: {},
        },
        {
          id: 'UST_CMT_2Y',
          label: 'UST CMT 2Y',
          instrument_type: 'TREASURY',
          asset_type: 'BOND',
          tenor_label: '2Y',
          source: 'openbb_bond_fixed_income',
          status: 'READY',
          symbol: 'UST2Y',
          ytm_pct: 3.95,
          duration: 1.9,
          snapshot_ref: 'bond::UST_CMT_2Y',
          missing_fields: [],
          inferred_fields: {},
          field_status: {},
        },
        {
          id: 'UST_CMT_30Y',
          label: 'UST CMT 30Y',
          instrument_type: 'TREASURY',
          asset_type: 'BOND',
          tenor_label: '30Y',
          source: 'openbb_bond_fixed_income',
          status: 'READY',
          symbol: 'UST30Y',
          ytm_pct: 5.02,
          duration: 19.7,
          snapshot_ref: 'bond::UST_CMT_30Y',
          missing_fields: [],
          inferred_fields: {},
          field_status: {},
        },
        {
          id: 'TIPS_5Y',
          label: 'TIPS 5Y',
          instrument_type: 'TIPS',
          asset_type: 'BOND',
          tenor_label: '5Y',
          source: 'openbb_bond_fixed_income',
          status: 'READY',
          symbol: 'TIPS5Y',
          real_yield_pct: 1.82,
          duration: 4.7,
          snapshot_ref: 'bond::TIPS_5Y',
          missing_fields: [],
          inferred_fields: {},
          field_status: {},
        },
        {
          id: 'TIPS_10Y',
          label: 'TIPS 10Y',
          instrument_type: 'TIPS',
          asset_type: 'BOND',
          tenor_label: '10Y',
          source: 'openbb_bond_fixed_income',
          status: 'READY',
          symbol: 'TIPS10Y',
          real_yield_pct: 2.1,
          duration: 8.2,
          snapshot_ref: 'bond::TIPS_10Y',
          missing_fields: [],
          inferred_fields: {},
          field_status: {},
        },
        {
          id: 'LQD',
          label: 'LQD ETF',
          instrument_type: 'BOND_ETF',
          asset_type: 'BOND_ETF',
          source: 'openbb_bond_fixed_income',
          status: 'READY',
          symbol: 'LQD',
          sec_yield_30d_pct: 4.83,
          effective_duration: 8.1,
          snapshot_ref: 'bond::LQD',
          missing_fields: [],
          inferred_fields: {},
          field_status: {},
        },
      ],
      scheduler: {
        status: 'READY',
        cadence_label: 'daily',
      },
      selected_source_summary: {
        primary_source: 'openbb_bond_fixed_income',
        selection_reason: 'runtime ready',
      },
      system_diagnostics: {
        memory: {},
        notes: [],
      },
      quality_audit: [
        { status: 'PASS', check: 'curve_complete', evidence: '7/7 instruments' },
      ],
      risk_budget_inputs: [
        { input: 'duration', status: 'READY', coverage: '7/7' },
      ],
      daily_accrual_status: [
        { input: 'accrual', status: 'READY', coverage: '7/7' },
      ],
    },
  };
}

function providerRegistryFixture(): ApiSnapshotProviderRegistry {
  return {
    generated_at: '2026-05-20T08:31:00Z',
    openbb_enabled: false,
    items: [
      {
        provider_id: 'polygon',
        source_name: 'Polygon / Massive',
        access_tier: 'paid',
        credential_requirements: {
          required_env_vars: ['MASSIVE_API_KEY'],
          configured: true,
          missing_env_vars: [],
        },
        target_types: ['option_skew'],
        fallback_order: {},
        latest_attempt: { error: 'unavailable' },
        quota_cooldown: {},
        error_summary: {},
        pit_permission: {},
        enabled: true,
        credential_ready: false,
        usable: false,
        readiness_status: 'invalid_credentials',
      },
      {
        provider_id: 'crsp_us_stock',
        source_name: 'CRSP local stock data',
        access_tier: 'local',
        credential_requirements: {
          required_env_vars: ['CRSP_DATA_PATH'],
          configured: false,
          missing_env_vars: ['CRSP_DATA_PATH'],
        },
        target_types: ['price'],
        fallback_order: {},
        latest_attempt: null,
        quota_cooldown: {},
        error_summary: {},
        pit_permission: {},
        enabled: false,
        credential_ready: false,
        usable: false,
        readiness_status: 'missing_local_path',
      },
      {
        provider_id: 'norgate_us_equities',
        source_name: 'Norgate US Equities',
        access_tier: 'local',
        credential_requirements: {
          required_env_vars: ['NORGATE_DATA_PATH'],
          configured: true,
          configured_env_vars: ['NORGATE_DATA_PATH'],
          missing_env_vars: [],
        },
        target_types: ['price', 'corporate_actions'],
        fallback_order: {},
        latest_attempt: null,
        quota_cooldown: {},
        error_summary: {},
        pit_permission: {},
        enabled: false,
        credential_ready: true,
        usable: false,
        readiness_status: 'disabled',
      },
      {
        provider_id: 'tiingo',
        source_name: 'Tiingo',
        access_tier: 'paid',
        credential_requirements: {
          required_env_vars: ['TIINGO_API_TOKEN'],
          configured: true,
          configured_env_vars: ['TIINGO_API_TOKEN'],
          missing_env_vars: [],
        },
        target_types: ['price', 'corporate_actions'],
        fallback_order: {},
        latest_attempt: { reason: 'rate limit window' },
        quota_cooldown: { cooldown_active: true },
        error_summary: {},
        pit_permission: {},
        enabled: true,
        credential_ready: true,
        usable: false,
        readiness_status: 'cooldown',
      },
      {
        provider_id: 'sec_edgar',
        source_name: 'SEC EDGAR',
        access_tier: 'public',
        credential_requirements: {
          required_env_vars: [],
          configured: true,
          missing_env_vars: [],
        },
        target_types: ['fundamentals'],
        fallback_order: {},
        latest_attempt: null,
        quota_cooldown: {},
        error_summary: {},
        pit_permission: {},
        enabled: true,
        credential_ready: true,
        usable: true,
        readiness_status: 'ready',
      },
    ],
  };
}

function providerAttemptsFixture(): ApiSnapshotProviderAttempts {
  return {
    generated_at: '2026-05-20T08:31:00Z',
    latest_job_id: 'snap_57ae046824c9',
    items: [
      {
        attempt_id: 'attempt-tiingo',
        provider_id: 'tiingo',
        target_type: 'corporate_actions',
        snapshot_kind: 'dataset',
        snapshot_id: 'ds-corporate-actions',
        job_id: 'snap_57ae046824c9',
        status: 'SKIPPED',
        access_tier: 'paid',
        attempted_at: '2026-05-20T08:29:00Z',
        next_retry_at: '2026-05-20T09:29:00Z',
        quota_limited: true,
        cooldown_active: true,
        reason: 'rate limit window',
        error: null,
        landed_row_count: 0,
        landed_symbol_count: 0,
        auxiliary_only: false,
        pit_effect: {},
      },
    ],
  };
}

beforeEach(() => {
  fakeApi.getSnapshotOverview.mockResolvedValue(overviewFixture());
  fakeApi.getSnapshotProviderRegistry.mockResolvedValue(providerRegistryFixture());
  fakeApi.getSnapshotProviderAttempts.mockResolvedValue(providerAttemptsFixture());
  fakeApi.refreshSnapshots.mockImplementation(async () => overviewFixture());
  fakeApi.createAssetLeg.mockResolvedValue({ id: 'asset-leg-ust10y', name: 'UST CMT 10Y' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SnapshotsPage operations console', () => {
  it('renders a single main console without the legacy bond tab', async () => {
    renderSnapshotsPage();

    expect(await screen.findByTestId('snapshots-ops-console')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('heading', { name: '数据快照治理台' })).toBeTruthy();
    expect(screen.getByText('L1-L4 数据层健康')).toBeTruthy();
    expect(screen.getByText('当前下钻')).toBeTruthy();
  });

  it('renders the first screen without waiting for provider diagnostics', async () => {
    fakeApi.getSnapshotProviderRegistry.mockImplementation(() => new Promise(() => {}));
    fakeApi.getSnapshotProviderAttempts.mockImplementation(() => new Promise(() => {}));

    renderSnapshotsPage();

    expect(await screen.findByTestId('snapshots-ops-console')).toBeTruthy();
    expect(fakeApi.getSnapshotOverview).toHaveBeenCalledTimes(1);
    expect(fakeApi.getSnapshotProviderRegistry).toHaveBeenCalledTimes(1);
    expect(fakeApi.getSnapshotProviderAttempts).toHaveBeenCalledTimes(1);
  });

  it('keeps the pending queue before the drilldown row', async () => {
    renderSnapshotsPage();

    const queue = await screen.findByTestId('snapshots-pending-queue');
    const drilldown = screen.getByTestId('snapshots-drilldown-row');

    expect(queue.compareDocumentPosition(drilldown) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(within(queue).getAllByText(/公司行为|Corporate/).length).toBeGreaterThan(0);
  });

  it('maps health card status to evidence or drilldown anchors', async () => {
    renderSnapshotsPage();

    await screen.findByText('L1-L4 数据层健康');
    const healthCards = Array.from(document.querySelectorAll('.snapshots-ops-health-card')) as HTMLElement[];
    expect(healthCards).toHaveLength(4);

    const l1Card = healthCards.find((card) => within(card).queryByRole('heading', { name: 'L1 基础行情' }));
    const l2Card = healthCards.find((card) => within(card).queryByRole('heading', { name: 'L2 财务截面' }));
    const l3Card = healthCards.find((card) => within(card).queryByRole('heading', { name: 'L3 分析师与情绪' }));
    const l4Card = healthCards.find((card) => within(card).queryByRole('heading', { name: 'L4 宏观与衍生品' }));
    expect(l1Card).toBeTruthy();
    expect(l2Card).toBeTruthy();
    expect(l3Card).toBeTruthy();
    expect(l4Card).toBeTruthy();

    expect(screen.getByText('1 层部分可用')).toBeTruthy();
    expect(within(l1Card as HTMLElement).getByText(/股票 .* · 债券/)).toBeTruthy();
    expect(within(l1Card as HTMLElement).queryByText(/公司行动 .* ·/)).toBeNull();
    expect(within(l2Card as HTMLElement).getByText('已就绪')).toHaveClass('snapshots-ops-status--ready');
    expect(within(l2Card as HTMLElement).getByText('100.0%')).toBeTruthy();
    expect(within(l2Card as HTMLElement).queryByText(/940\s*\/\s*1482/)).toBeNull();
    expect(within(l3Card as HTMLElement).getByText('3 / 3')).toBeTruthy();
    expect(l1Card as HTMLElement).toHaveClass('snapshots-ops-health-card--warning');
    expect(l1Card as HTMLElement).toHaveClass('snapshots-ops-health-card--primary');
    expect(l2Card as HTMLElement).toHaveClass('snapshots-ops-health-card--ready');
    expect(l4Card as HTMLElement).toHaveClass('snapshots-ops-health-card--ready');
    expect(within(l4Card as HTMLElement).getByText('已就绪')).toHaveClass('snapshots-ops-status--ready');

    fireEvent.click(within(l2Card as HTMLElement).getByRole('button', { name: '查看观察项' }));
    const fundamentalLedgerRow = screen.getByText(/ds-fundamentals/).closest('tr');
    expect(fundamentalLedgerRow).toHaveAttribute('data-layer-id', 'l2');
    expect(fundamentalLedgerRow).toHaveClass('snapshots-ops-ledger-row--highlight');
    expect(within(fundamentalLedgerRow as HTMLElement).getByText(/100.0%/)).toBeTruthy();
    expect(within(fundamentalLedgerRow as HTMLElement).queryByText(/940\s*\/\s*1482/)).toBeNull();

    fireEvent.click(within(l3Card as HTMLElement).getByRole('button', { name: '查看证据' }));
    const sentimentLedgerRow = screen.getByText(/ds-analyst-consensus/).closest('tr');
    expect(sentimentLedgerRow).toHaveAttribute('data-layer-id', 'l3');

    fireEvent.click(within(l4Card as HTMLElement).getByRole('button', { name: '查看证据' }));
    const macroLedgerRow = screen.getByText(/ds-macro-rates/).closest('tr');
    expect(macroLedgerRow).toHaveAttribute('data-layer-id', 'l4');
    await waitFor(() => expect(macroLedgerRow).toHaveClass('snapshots-ops-ledger-row--highlight'));
    const drilldown = screen.getByTestId('snapshots-drilldown-row');
    expect(document.getElementById('snapshot-layer-l4')).toBeNull();
    expect(document.getElementById('snapshot-layer-l2')).toBeNull();
    expect(document.getElementById('snapshot-layer-l3')).toBeNull();
    expect(document.getElementById('snapshot-source-ds-macro-rates')).toBeNull();
    expect(document.getElementById('snapshot-source-ds-option-skew')).toBeNull();

    fireEvent.click(within(l1Card as HTMLElement).getByRole('button', { name: '下钻缺口' }));
    await waitFor(() =>
      expect(document.getElementById('snapshot-source-ds-price')).toHaveClass('snapshots-ops-drill-card--highlight'),
    );
    expect(within(drilldown).getByRole('heading', { name: 'L1 基础行情 · 价格历史' })).toBeTruthy();
    expect(within(document.getElementById('snapshot-source-ds-price') as HTMLElement).getByText(/缺 216 个标的/)).toBeTruthy();
    expect(within(document.getElementById('snapshot-source-ds-corporate-actions') as HTMLElement).getByText(/缺 452 个标的/)).toBeTruthy();
  });

  it('renders the bond compatibility URL as the same console and highlights bond evidence', async () => {
    renderSnapshotsPage('bond');

    expect(await screen.findByTestId('snapshots-ops-console')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('美国国债曲线')).toBeTruthy();
    expect(screen.getAllByText(/7\/7 可建腿/).length).toBeGreaterThanOrEqual(2);
  });

  it('gives every ledger row evidence and anomalous rows drilldown actions', async () => {
    renderSnapshotsPage();

    await screen.findByText('原始快照清单');
    expect(screen.getAllByRole('button', { name: '证据' }).length).toBeGreaterThanOrEqual(7);
    expect(screen.getAllByRole('button', { name: '下钻' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /修复/ }).length).toBeGreaterThan(0);
  });

  it('opens bond evidence with curve, eligible instruments and audit fields', async () => {
    renderSnapshotsPage();

    await screen.findByText('原始快照清单');
    const bondRow = screen.getByText(/bond_fixed_income::UST_CURVE/).closest('tr');
    expect(bondRow).toBeTruthy();
    fireEvent.click(within(bondRow as HTMLElement).getByRole('button', { name: '证据' }));

    expect(await screen.findByRole('dialog', { name: '快照证据详情' })).toBeTruthy();
    expect(screen.getByText('UST CMT 10Y')).toBeTruthy();
    expect(screen.getByText('4.45%')).toBeTruthy();
    expect(screen.getByText(/7\/7 instruments/)).toBeTruthy();
    expect(screen.getAllByText(/duration|accrual/).length).toBeGreaterThanOrEqual(2);
  });

  it('shows refresh log coverage, this-run ingestion and source by L1-L4', async () => {
    renderSnapshotsPage();

    fireEvent.click(await screen.findByRole('button', { name: '查看刷新日志' }));

    const dialog = await screen.findByRole('dialog', { name: '刷新日志' });
    expect(within(dialog).getByText(/snap_57ae046824c9/)).toBeTruthy();
    expect(within(dialog).getByText('L1 基础行情')).toBeTruthy();
    expect(within(dialog).getByText('L2 财务截面')).toBeTruthy();
    expect(within(dialog).getByText('L3 分析师与情绪')).toBeTruthy();
    expect(within(dialog).getByText('L4 宏观与衍生品')).toBeTruthy();
    expect(within(dialog).getByText(/价格新增 1,482 行数据/)).toBeTruthy();
    expect(within(dialog).getByText(/公司行为新增 1,030 行数据/)).toBeTruthy();
    expect(within(dialog).getByText(/债券新增 7 行数据/)).toBeTruthy();
    expect(within(dialog).queryByText(/覆盖 1,030 标的/)).toBeNull();
    expect(within(dialog).getByText(/混合来源|OpenBB 债券基础行情/)).toBeTruthy();
  });

  it('maps provider registry states to concrete credential actions', async () => {
    renderSnapshotsPage();

    await screen.findByText('凭据与本机配置');
    expect(screen.getByText('MASSIVE_API_KEY')).toBeTruthy();
    expect(screen.getByRole('button', { name: '更换 key' })).toBeTruthy();
    expect(screen.getAllByText('CRSP_DATA_PATH').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '配置路径' }).length).toBeGreaterThan(0);
    const norgateRow = screen.getByTestId('credential-row-norgate');
    expect(within(norgateRow).getByText('已配置')).toHaveClass('snapshots-ops-status--ready');
    expect(within(norgateRow).getByText('已配置，导入未接入')).toHaveClass('snapshots-ops-status--warning');
    expect(screen.getByText('TIINGO_API_TOKEN')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '查看窗口' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '查看来源' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('IEX_TOKEN / IEX_CLOUD_TOKEN')).toBeNull();
    expect(screen.queryByTestId('credential-row-iex')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: '查看窗口' })[0]);
    expect(screen.getByTestId('credential-row-tiingo')).toHaveClass('snapshots-ops-credential-row--active');
    expect(screen.getByTestId('credential-selected-detail')).toHaveTextContent('当前选择');
    expect(screen.getByTestId('credential-selected-detail')).toHaveTextContent('TIINGO_API_TOKEN');

    fireEvent.click(screen.getAllByRole('button', { name: '配置路径' })[0]);

    expect(screen.getByTestId('credential-row-crsp')).toHaveClass('snapshots-ops-credential-row--active');
    expect(screen.getByText(/\$env:CRSP_DATA_PATH/)).toBeTruthy();
    expect(screen.getByText(/QuickStart-Grit\.ps1 -ForceRestart/)).toBeTruthy();
    expect(screen.getByText(/snapshot provider credentials updated/)).toBeTruthy();

    fireEvent.click(within(norgateRow).getByRole('button'));
    expect(screen.getByTestId('credential-row-norgate')).toHaveClass('snapshots-ops-credential-row--active');
    expect(screen.getByText(/\$env:NORGATE_DATA_PATH="C:\\path\\to\\data"/)).toBeTruthy();
    expect(screen.getByText(/QuickStart-Grit\.local\.ps1/)).toBeTruthy();
    expect(screen.getByTestId('credential-selected-detail')).toHaveTextContent('当前刷新链路尚未接入 Norgate 导入器');

    fireEvent.click(screen.getByRole('button', { name: '复制命令' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /已复制|请手动复制/ })).toBeTruthy());
  });

  it('submits the merged repair refresh including bond as L1 base market data', async () => {
    renderSnapshotsPage();

    await screen.findByTestId('snapshots-ops-console');
    fireEvent.click(screen.getAllByRole('button', { name: '刷新基础行情' })[0]);

    await waitFor(() => expect(fakeApi.refreshSnapshots).toHaveBeenCalled());
    expect(fakeApi.refreshSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'repair',
        reason: 'manual-refresh-snapshots-console',
        targets: expect.arrayContaining(['price', 'corporate', 'bond']),
      }),
    );
  });
});
