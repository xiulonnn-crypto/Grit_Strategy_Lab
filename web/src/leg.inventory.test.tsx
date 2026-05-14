import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegInventoryPage } from './pages/leg-inventory-page';
import {
  SAVED_STRATEGY_LEG_FREEZE_STORAGE_KEY,
  SAVED_STRATEGY_LEG_STORAGE_KEY,
  buildStrategyCandidateRows,
} from './lib/saved-strategy-leg-inventory';
import type { ApiLegInventory, ApiSnapshotOverview } from './types';

type FakeApi = {
  getLegInventory?: ReturnType<typeof vi.fn>;
  updateAssetLeg?: ReturnType<typeof vi.fn>;
  updateCashLeg?: ReturnType<typeof vi.fn>;
  createAssetLeg?: ReturnType<typeof vi.fn>;
  createCashLeg?: ReturnType<typeof vi.fn>;
  listStrategies?: ReturnType<typeof vi.fn>;
  listBacktestRuns?: ReturnType<typeof vi.fn>;
  saveBacktestRun?: ReturnType<typeof vi.fn>;
  listCompositions?: ReturnType<typeof vi.fn>;
  getCompositionDetail?: ReturnType<typeof vi.fn>;
  getSnapshotOverview?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getLegInventory: vi.fn(),
  updateAssetLeg: vi.fn(),
  updateCashLeg: vi.fn(),
  createAssetLeg: vi.fn(),
  createCashLeg: vi.fn(),
  listStrategies: vi.fn(),
  listBacktestRuns: vi.fn(),
  saveBacktestRun: vi.fn(),
  listCompositions: vi.fn(),
  getCompositionDetail: vi.fn(),
  getSnapshotOverview: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const legInventoryCss = readFileSync('./src/components/legs/leg-inventory.css', 'utf8');

const inventory: ApiLegInventory = {
  counts: {
    all: 2,
    strategy: 0,
    asset: 1,
    cash: 1,
  },
  filters: {
    statuses: [
      { value: 'ACTIVE', label: 'Active', count: 2 },
    ],
    attribute_tags: [
      { value: 'asset', label: 'asset', count: 1 },
      { value: 'cash', label: 'cash', count: 1 },
    ],
  },
  rows: [
    {
      id: 'asset-leg-001',
      leg_type: 'asset',
      name: '10Y 国债久期腿',
      version_label: 'IEF',
      proof_label: 'bond-fixed-income',
      reference_count: 1,
      reference_summary: 'Used in 1 saved composition',
      status: 'ACTIVE',
      status_label: 'Active',
      has_new_version: false,
      is_orphan: false,
      attribute_tags: ['asset', 'snapshot:bond-fixed-income'],
      allowed_actions: ['open_composition_workbench'],
      source_ref_id: 'asset-leg-001',
      source_ref_type: 'asset_definition',
      freeze_hash: 'hash-bond-001',
      signature_status: 'verified',
      drift_status: 'current',
      current_ref_id: 'asset-leg-001',
      alerts: [],
      return_quality: {
        leg_id: 'asset-leg-001',
        display_name: '10Y 国债久期腿',
        leg_kind: 'asset',
        source_ref_id: 'asset-leg-001',
        sample_points: 2,
        aligned_points: 2,
        missing_points: 118,
        coverage_pct: 1.67,
        window_start: '2026-04',
        window_end: '2026-05',
        issue_types: ['收益样本不足', '对齐缺口'],
      },
      config: {
        symbol: 'UST10Y',
        source_snapshot_id: 'bond-fixed-income',
        source_provider: 'FMP',
        asset_kind: 'BOND',
        freeze_mode: 'snapshot_locked',
        source_integrity: {
          freeze_hash: 'hash-bond-001',
          signature_status: 'verified',
          drift_status: 'current',
          current_ref_id: 'asset-leg-001',
          alerts: [],
        },
      },
    },
    {
      id: 'cash-leg-001',
      leg_type: 'cash',
      name: '现金缓冲腿',
      version_label: 'PURE_CASH',
      proof_label: 'pure_cash',
      reference_count: 0,
      reference_summary: 'Not used in saved compositions yet',
      status: 'ACTIVE',
      status_label: 'Active',
      has_new_version: false,
      is_orphan: false,
      attribute_tags: ['cash'],
      allowed_actions: ['edit_leg_definition', 'open_composition_workbench'],
      source_ref_id: 'cash-leg-001',
      source_ref_type: 'cash_definition',
      freeze_hash: 'hash-cash-001',
      signature_status: 'verified',
      drift_status: 'current',
      current_ref_id: 'cash-leg-001',
      alerts: [],
      return_quality: {
        leg_id: 'cash-leg-001',
        display_name: '现金缓冲腿',
        leg_kind: 'cash',
        source_ref_id: 'cash-leg-001',
        sample_points: 0,
        aligned_points: 0,
        missing_points: 0,
        coverage_pct: 100,
        window_start: null,
        window_end: null,
        issue_types: [],
      },
      config: {
        cash_rule_kind: 'PURE_CASH',
        buffer_bps: 12,
        yield_source: 'pure_cash',
        freeze_mode: 'manual',
        source_integrity: {
          freeze_hash: 'hash-cash-001',
          signature_status: 'verified',
          drift_status: 'current',
          current_ref_id: 'cash-leg-001',
          alerts: [],
        },
      },
    },
  ],
};

const snapshotOverview = {
  overall_status: 'READY',
  dataset_snapshots: [],
  universe_snapshots: [],
  bond_fixed_income: {
    eligible_instruments: [
      {
        id: 'bond_fixed_income::TIPS_10Y::2026-04-23::us_treasury_xml',
        label: 'US TIPS Real Yield 10Y',
        instrument_type: 'tips_cmt',
        asset_type: 'INDIVIDUAL_BOND',
        source: 'us_treasury_xml',
        status: 'READY',
        symbol: 'TIPS10Y',
        snapshot_ref: 'bond_fixed_income::TIPS_10Y::2026-04-23::us_treasury_xml',
        real_yield_pct: 1.98,
        duration: 8.3,
        missing_fields: [],
        inferred_fields: {},
        field_status: {},
      },
      {
        id: 'bond_fixed_income::UST_30Y::2026-04-23::us_treasury_xml',
        label: 'UST CMT 30Y',
        instrument_type: 'treasury',
        asset_type: 'INDIVIDUAL_BOND',
        source: 'us_treasury_xml',
        status: 'READY',
        symbol: 'UST30Y',
        snapshot_ref: 'bond_fixed_income::UST_30Y::2026-04-23::us_treasury_xml',
        ytm_pct: 4.8,
        duration: 17.8,
        tenor_label: '30Y',
        missing_fields: [],
        inferred_fields: {},
        field_status: {},
      },
      {
        id: 'bond_fixed_income::UST_BILL_3M::2026-04-23::us_treasury_xml',
        label: 'UST T-Bill 13W',
        instrument_type: 'treasury_bill',
        asset_type: 'INDIVIDUAL_BOND',
        source: 'us_treasury_xml',
        status: 'READY',
        symbol: 'USTBILL3M',
        tenor_label: '3M',
        snapshot_ref: 'bond_fixed_income::UST_BILL_3M::2026-04-23::us_treasury_xml',
        discount_rate_pct: 5.18,
        duration: 0.25,
        missing_fields: [],
        inferred_fields: {},
        field_status: {
          accrued_interest: 'WAIVED',
        },
      },
      {
        id: 'bond_fixed_income::TIPS_5Y::2026-04-23::us_treasury_xml',
        label: 'TIPS 5Y',
        instrument_type: 'tips_cmt',
        asset_type: 'INDIVIDUAL_BOND',
        source: 'us_treasury_xml',
        status: 'READY',
        symbol: 'TIPS5Y',
        snapshot_ref: 'bond_fixed_income::TIPS_5Y::2026-04-23::us_treasury_xml',
        real_yield_pct: 1.82,
        duration: 4.7,
        tenor_label: '5Y',
        missing_fields: [],
        inferred_fields: {},
        field_status: {},
      },
    ],
  },
} as unknown as ApiSnapshotOverview;

describe('leg inventory page', () => {
  beforeEach(() => {
    fakeApi.getLegInventory = vi.fn().mockResolvedValue(inventory);
    fakeApi.updateCashLeg = vi.fn().mockResolvedValue({ id: 'cash-leg-001', status: 'ARCHIVED' });
    fakeApi.updateAssetLeg = vi.fn().mockResolvedValue({ id: 'asset-leg-001', status: 'ARCHIVED' });
    fakeApi.createAssetLeg = vi.fn();
    fakeApi.createCashLeg = vi.fn();
    fakeApi.listStrategies = vi.fn().mockResolvedValue([]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([]);
    fakeApi.saveBacktestRun = vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        id,
        is_permanent: true,
        created_at: '2026-04-28T02:00:00Z',
        updated_at: '2026-04-28T02:00:00Z',
        completed_at: '2026-04-28T02:00:00Z',
      }),
    );
    fakeApi.listCompositions = vi.fn().mockResolvedValue([]);
    fakeApi.getCompositionDetail = vi.fn();
    fakeApi.getSnapshotOverview = vi.fn().mockResolvedValue(snapshotOverview);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('keeps source signature details out of the inventory rows', async () => {
    await act(async () => {
      render(<LegInventoryPage />);
    });

    expect(await screen.findByText('asset-leg-001')).toBeInTheDocument();
    expect(fakeApi.listCompositions).not.toHaveBeenCalled();
    expect(fakeApi.getCompositionDetail).not.toHaveBeenCalled();
    expect(screen.getByText('cash-leg-001')).toBeInTheDocument();
    expect(document.querySelector('[data-ui="leg-source-trust-table"]')).not.toBeNull();
    expect(screen.queryByText(/冻结哈希/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hash-bond-001/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hash-cash-001/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-ui="leg-freeze-hash"]').length).toBe(0);
    expect(document.querySelectorAll('[data-ui="leg-drift-status"]').length).toBe(0);
    expect(screen.queryByText(/strategy_leg::/)).not.toBeInTheDocument();
  });

  it('surfaces return sample problems in the source inventory before composition assembly', async () => {
    await act(async () => {
      render(<LegInventoryPage />);
    });

    expect(await screen.findByText('asset-leg-001')).toBeInTheDocument();
    expect(screen.getByText('收益样本不足、对齐缺口')).toBeInTheDocument();
    expect(screen.getByText('样本 2 月 / 缺口 118')).toBeInTheDocument();
    expect(screen.queryByText('现金规则覆盖')).not.toBeInTheDocument();
  });

  it('keeps the inventory table inside the available panel width', async () => {
    await act(async () => {
      render(<LegInventoryPage />);
    });

    const tableShell = await waitFor(() =>
      document.querySelector('[data-ui="leg-source-trust-table"]'),
    );
    const table = tableShell?.querySelector('.leg-inventory-table');

    expect(tableShell).not.toBeNull();
    expect(table).not.toBeNull();
    expect(legInventoryCss).toMatch(
      /\.leg-inventory-table-shell\s*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(legInventoryCss).toMatch(
      /\.leg-inventory-table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/s,
    );
    expect(legInventoryCss).toMatch(
      /\.leg-inventory-table\s+thead\s+th\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
    );
    expect(legInventoryCss).toMatch(
      /\.leg-inventory-table\s+tbody\s+td\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
    );
    expect(legInventoryCss).not.toMatch(
      /\.leg-inventory-table\s*\{[^}]*min-width:\s*1[0-9]{3}px/s,
    );
  });

  it('adds a creation-time column before actions and sorts newest rows first', async () => {
    fakeApi.getLegInventory = vi.fn().mockResolvedValue({
      ...inventory,
      counts: { all: 2, strategy: 0, asset: 1, cash: 1 },
      rows: [
        {
          ...inventory.rows[0],
          id: 'asset-leg-older',
          name: 'Older asset leg',
          source_ref_id: 'asset-leg-older',
          created_at: '2026-04-20T00:00:00Z',
          updated_at: '2026-04-20T00:00:00Z',
        },
        {
          ...inventory.rows[1],
          id: 'cash-leg-newer',
          name: 'Newer cash leg',
          source_ref_id: 'cash-leg-newer',
          created_at: '2026-04-22T00:00:00Z',
          updated_at: '2026-04-22T00:00:00Z',
        },
      ],
    });

    await act(async () => {
      render(<LegInventoryPage />);
    });

    expect(await screen.findAllByText('创建时间')).not.toHaveLength(0);
    const headers = Array.from(document.querySelectorAll('.leg-inventory-table thead th'));
    expect(headers.at(-2)?.textContent).toContain('创建时间');
    expect(headers.at(-1)?.textContent).toContain('操作');

    const tableRows = Array.from(document.querySelectorAll('.leg-inventory-table tbody tr'));
    expect(tableRows).toHaveLength(2);
    expect(tableRows[0].textContent).toContain('cash-leg-newer');
    expect(tableRows[1].textContent).toContain('asset-leg-older');
  });

  it('hydrates saved strategy leg reference counts from the inventory contract', async () => {
    const rowId = 'strategy_leg::strat-tested-001::strat-tested-001-v2';
    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([rowId]));
    fakeApi.getLegInventory = vi.fn().mockResolvedValue({
      ...inventory,
      strategy_reference_counts: {
        [rowId]: 1,
      },
    });
    fakeApi.listStrategies = vi.fn().mockResolvedValue([
      {
        id: 'strat-tested-001',
        name: 'S&P momentum',
        strategy_type: 'MOMENTUM',
        universe_name: 'S&P 500',
        current_parameter_version: 2,
        current_parameter_version_id: 'strat-tested-001-v2',
      },
    ]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      {
        id: 'run-tested-001',
        strategy_id: 'strat-tested-001',
        strategy_name: 'S&P momentum',
        status: 'COMPLETED',
        completed_at: '2026-04-26T10:00:00Z',
        parameter_version_id: 'strat-tested-001-v2',
        metrics: {
          annualized_return: 0.21,
          max_drawdown: -0.12,
          oos_sharpe: 1.4,
        },
      },
    ]);
    fakeApi.listCompositions = vi.fn();
    fakeApi.getCompositionDetail = vi.fn();

    await act(async () => {
      render(<LegInventoryPage />);
    });

    const strategyRow = (await screen.findByText('strat-tested-001 · v2')).closest('tr');
    expect(strategyRow).not.toBeNull();
    expect(fakeApi.listCompositions).not.toHaveBeenCalled();
    expect(fakeApi.getCompositionDetail).not.toHaveBeenCalled();
    const cells = within(strategyRow as HTMLTableRowElement).getAllByRole('cell');
    expect(within(cells[4]).getByText('1')).toBeInTheDocument();
    expect(within(strategyRow as HTMLTableRowElement).queryByText('敶﹝')).toBeNull();
  });

  it('renders saved strategy legs from the local freeze before deferred strategy hydration finishes', async () => {
    const rowId = 'strategy_leg::strat_immediate::strat_immediate-v1';
    let resolveStrategies: ((value: Array<Record<string, unknown>>) => void) | null = null;
    let resolveRuns: ((value: Array<Record<string, unknown>>) => void) | null = null;
    let strategiesResolved = false;
    let runsResolved = false;
    const strategiesPromise = new Promise<Array<Record<string, unknown>>>((resolve) => {
      resolveStrategies = (value) => {
        strategiesResolved = true;
        resolve(value);
      };
    });
    const runsPromise = new Promise<Array<Record<string, unknown>>>((resolve) => {
      resolveRuns = (value) => {
        runsResolved = true;
        resolve(value);
      };
    });
    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([rowId]));
    window.localStorage.setItem(
      SAVED_STRATEGY_LEG_FREEZE_STORAGE_KEY,
      JSON.stringify({
        [rowId]: {
          saved_at: '2026-05-14T09:00:00Z',
          frozen_row: {
            id: rowId,
            leg_type: 'strategy',
            name: 'Immediate Strat-v1',
            version_label: 'v1',
            proof_label: 'run_immediate_v1',
            reference_count: 1,
            reference_summary: 'Used in 1 saved composition',
            status: 'READY',
            status_label: 'Ready',
            has_new_version: false,
            is_orphan: false,
            attribute_tags: ['strategy', 'version:v1'],
            allowed_actions: ['open_strategy_detail', 'open_composition_workbench'],
            source_ref_id: rowId,
            source_ref_type: 'strategy_projection',
            freeze_hash: 'freeze-immediate-v1',
            signature_status: 'verified',
            drift_status: 'current',
            current_ref_id: rowId,
            alerts: [],
            created_at: '2026-05-14T09:00:00Z',
            updated_at: '2026-05-14T09:00:00Z',
            config: {
              strategy_id: 'strat_immediate',
              parameter_version_id: 'strat_immediate-v1',
              parameter_version: 1,
              latest_run_id: 'run_immediate_v1',
              run_id: 'run_immediate_v1',
              is_permanent: true,
              source_integrity: {
                freeze_hash: 'freeze-immediate-v1',
                signature_status: 'verified',
                drift_status: 'current',
                current_ref_id: rowId,
                alerts: [],
              },
            },
          },
        },
      }),
    );
    fakeApi.listStrategies = vi.fn().mockReturnValue(strategiesPromise);
    fakeApi.listBacktestRuns = vi.fn().mockReturnValue(runsPromise);

    render(<LegInventoryPage />);

    expect(await screen.findByText('asset-leg-001')).toBeInTheDocument();
    expect(await screen.findByText('Immediate Strat-v1')).toBeInTheDocument();
    expect(strategiesResolved).toBe(false);
    expect(runsResolved).toBe(false);

    await act(async () => {
      resolveStrategies?.([]);
      resolveRuns?.([]);
      await Promise.all([strategiesPromise, runsPromise]);
    });
  });

  it('keeps saved strategy legs for older parameter versions and marks them as having a new version', async () => {
    const staleRowId = 'strategy_leg::strat_53315d3dd88b::strat_53315d3dd88b-v2';
    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([staleRowId]));
    fakeApi.listStrategies = vi.fn().mockResolvedValue([
      {
        id: 'strat_53315d3dd88b',
        name: 'QQQ Grid',
        strategy_type: 'GRID',
        universe_name: 'QQQ',
        current_parameter_version: 4,
        current_parameter_version_id: 'strat_53315d3dd88b-v4',
        benchmark_symbol: 'QQQ',
      },
    ]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      {
        id: 'run_95db6d1d4ba9',
        strategy_id: 'strat_53315d3dd88b',
        strategy_name: 'QQQ Grid',
        status: 'COMPLETED',
        completed_at: '2026-04-28T02:00:00Z',
        parameter_version_id: 'strat_53315d3dd88b-v4',
        metrics: {
          annualized_return: 0.24,
          max_drawdown: -0.13,
          oos_sharpe: 1.8,
        },
      },
      {
        id: 'run_32b4cce6719a',
        strategy_id: 'strat_53315d3dd88b',
        strategy_name: 'QQQ Grid',
        status: 'COMPLETED',
        completed_at: '2026-04-27T02:00:00Z',
        parameter_version_id: 'strat_53315d3dd88b-v2',
        metrics: {
          annualized_return: 0.168,
          max_drawdown: -0.224,
          oos_sharpe: 1.02,
        },
      },
    ]);

    await act(async () => {
      render(<LegInventoryPage />);
    });

    const strategyRow = (
      await screen.findByText('strat_53315d3dd88b · v2')
    ).closest('tr');
    expect(strategyRow).not.toBeNull();
    expect(within(strategyRow as HTMLTableRowElement).getByText('QQQ Grid-v2')).toBeInTheDocument();
    expect(within(strategyRow as HTMLTableRowElement).queryByText('strat_53315d3dd88b::strat_53315d3dd88b-v2')).toBeNull();
    expect(within(strategyRow as HTMLTableRowElement).getByText('年化 +16.8% | 回撤 -22.4% | 夏普 1.02')).toBeInTheDocument();
    expect(within(strategyRow as HTMLTableRowElement).getByText('有新版本')).toBeInTheDocument();
  });

  it('keeps a saved strategy leg anchored to the frozen source run while surfacing new parameters', async () => {
    const rowId = 'strategy_leg::strat_0be646e45c26::strat_0be646e45c26-v1';
    const sourceIntegrity = {
      leg_id: rowId,
      display_name: '多因子核心模型',
      source_ref_id: rowId,
      freeze_hash: 'frozen-run-c974',
      signature_status: 'verified',
      drift_status: 'current',
      current_ref_id: rowId,
      checked_at: '2026-05-12T11:13:14Z',
      alerts: [],
    };
    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([rowId]));
    window.localStorage.setItem(
      SAVED_STRATEGY_LEG_FREEZE_STORAGE_KEY,
      JSON.stringify({
        [rowId]: {
          saved_at: '2026-05-12T11:14:00Z',
          frozen_row: {
            id: rowId,
            leg_type: 'strategy',
            name: '多因子核心模型-v1',
            version_label: 'v1',
            proof_label: 'run_c974e22597c3',
            reference_count: 1,
            reference_summary: 'Used in 1 saved composition',
            status: 'READY',
            status_label: 'Ready',
            has_new_version: false,
            is_orphan: false,
            attribute_tags: ['strategy', 'multi_factor', 'version:v1'],
            allowed_actions: ['open_strategy_detail', 'open_composition_workbench'],
            source_ref_id: rowId,
            source_ref_type: 'strategy_projection',
            source_integrity: sourceIntegrity,
            freeze_hash: 'frozen-run-c974',
            signature_status: 'verified',
            drift_status: 'current',
            current_ref_id: rowId,
            alerts: [],
            created_at: '2026-05-12T11:14:00Z',
            updated_at: '2026-05-12T11:14:00Z',
            config: {
              strategy_id: 'strat_0be646e45c26',
              parameter_version_id: 'strat_0be646e45c26-v1',
              parameter_version: 1,
              latest_run_id: 'run_c974e22597c3',
              run_id: 'run_c974e22597c3',
              run_completed_at: '2026-05-12T11:13:14Z',
              annualized_return_pct: 17,
              max_drawdown_pct: 11,
              oos_sharpe: 1.25,
              source_integrity: sourceIntegrity,
            },
          },
        },
      }),
    );
    fakeApi.listStrategies = vi.fn().mockResolvedValue([
      {
        id: 'strat_0be646e45c26',
        name: '多因子核心模型',
        strategy_type: 'MULTI_FACTOR',
        universe_name: 'US Equity',
        current_parameter_version: 2,
        current_parameter_version_id: 'strat_0be646e45c26-v2',
      },
    ]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      {
        id: 'run_054d4cee4b1c',
        strategy_id: 'strat_0be646e45c26',
        strategy_name: '多因子核心模型',
        status: 'COMPLETED',
        completed_at: '2026-05-13T09:18:34Z',
        parameter_version_id: 'strat_0be646e45c26-v1',
        metrics: {
          annualized_return: 0.22,
          max_drawdown: -0.09,
          oos_sharpe: 1.6,
        },
      },
      {
        id: 'run_c974e22597c3',
        strategy_id: 'strat_0be646e45c26',
        strategy_name: '多因子核心模型',
        status: 'COMPLETED',
        completed_at: '2026-05-12T11:13:14Z',
        parameter_version_id: 'strat_0be646e45c26-v1',
        metrics: {
          annualized_return: 0.17,
          max_drawdown: -0.11,
          oos_sharpe: 1.25,
        },
      },
    ]);

    await act(async () => {
      render(<LegInventoryPage />);
    });

    const strategyRow = (await screen.findByText('run_c974e22597c3')).closest('tr');
    expect(strategyRow).not.toBeNull();
    expect(strategyRow?.textContent).not.toContain('run_054d4cee4b1c');
    expect(strategyRow?.textContent).toContain('+17.0%');
    expect(strategyRow?.textContent).not.toContain('+22.0%');
    fireEvent.click(strategyRow as HTMLTableRowElement);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('run_c974e22597c3')).toBeInTheDocument();
    expect(within(dialog).queryByText(/run_054d4cee4b1c/)).toBeNull();
    expect(strategyRow?.textContent).toContain('有新版本');
    expect(strategyRow?.textContent).toContain('保存时间');
  });

  it('keeps latest strategy candidates split by backtest period for the same parameter version', () => {
    const rows = buildStrategyCandidateRows(
      [
        {
          id: 'strat_0be646e45c26',
          name: 'Multi factor core model',
          strategy_type: 'MULTI_FACTOR',
          universe_name: 'US Equity',
          current_parameter_version: 1,
          current_parameter_version_id: 'strat_0be646e45c26-v1',
        },
      ],
      [
        {
          id: 'run_c974e22597c3',
          strategy_id: 'strat_0be646e45c26',
          strategy_name: 'Multi factor core model',
          status: 'COMPLETED',
          completed_at: '2026-05-11T09:00:00Z',
          parameter_version_id: 'strat_0be646e45c26-v1',
          start_date: '2016-05-11',
          end_date: '2026-05-11',
          metrics: {
            annualized_return: 0.17,
            max_drawdown: -0.11,
            oos_sharpe: 1.25,
          },
        },
        {
          id: 'run_d7a83285ac8a',
          strategy_id: 'strat_0be646e45c26',
          strategy_name: 'Multi factor core model',
          status: 'COMPLETED',
          completed_at: '2026-05-11T09:13:32Z',
          parameter_version_id: 'strat_0be646e45c26-v1',
          start_date: '2016-05-11',
          end_date: '2026-05-11',
          metrics: {
            annualized_return: 0.19,
            max_drawdown: -0.1,
            oos_sharpe: 1.31,
          },
        },
        {
          id: 'run_5cc47aa661a4',
          strategy_id: 'strat_0be646e45c26',
          strategy_name: 'Multi factor core model',
          status: 'COMPLETED',
          completed_at: '2026-05-11T09:20:52Z',
          parameter_version_id: 'strat_0be646e45c26-v1',
          start_date: '2006-05-11',
          end_date: '2026-05-11',
          metrics: {
            annualized_return: 0.47,
            max_drawdown: -0.76,
            oos_sharpe: 1.28,
          },
        },
      ],
    );

    expect(rows.map((row) => row.source_ref_id)).toEqual(
      expect.arrayContaining([
        'strategy_leg::strat_0be646e45c26-v1::run_d7a83285ac8a',
        'strategy_leg::strat_0be646e45c26-v1::run_5cc47aa661a4',
      ]),
    );
    expect(rows.map((row) => row.source_ref_id)).not.toContain(
      'strategy_leg::strat_0be646e45c26-v1::run_c974e22597c3',
    );

    const tenYearRow = rows.find((row) => row.source_ref_id?.endsWith('run_d7a83285ac8a'));
    const twentyYearRow = rows.find((row) => row.source_ref_id?.endsWith('run_5cc47aa661a4'));
    expect(tenYearRow?.config?.start_date).toBe('2016-05-11');
    expect(tenYearRow?.config?.end_date).toBe('2026-05-11');
    expect(twentyYearRow?.config?.start_date).toBe('2006-05-11');
    expect(twentyYearRow?.config?.end_date).toBe('2026-05-11');
  });

  it('flags same-version same-period refreshed runs as new parameters and copies the matching run', async () => {
    const frozenRowId = 'strategy_leg::strat_0be646e45c26-v1::run_c974e22597c3';
    const latestTenYearRowId = 'strategy_leg::strat_0be646e45c26-v1::run_d7a83285ac8a';
    const latestTwentyYearRowId = 'strategy_leg::strat_0be646e45c26-v1::run_5cc47aa661a4';
    const sourceIntegrity = {
      leg_id: frozenRowId,
      display_name: 'Multi factor core model',
      source_ref_id: frozenRowId,
      freeze_hash: 'frozen-run-c974',
      signature_status: 'verified',
      drift_status: 'current',
      current_ref_id: frozenRowId,
      checked_at: '2026-05-11T09:00:00Z',
      alerts: [],
    };

    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([frozenRowId]));
    window.localStorage.setItem(
      SAVED_STRATEGY_LEG_FREEZE_STORAGE_KEY,
      JSON.stringify({
        [frozenRowId]: {
          saved_at: '2026-05-12T11:14:00Z',
          frozen_row: {
            id: frozenRowId,
            leg_type: 'strategy',
            name: 'Multi factor core model-v1',
            version_label: 'v1',
            proof_label: 'run_c974e22597c3',
            reference_count: 1,
            reference_summary: 'Used in 1 saved composition',
            status: 'READY',
            status_label: 'Ready',
            has_new_version: false,
            has_new_parameters: false,
            is_orphan: false,
            attribute_tags: ['strategy', 'multi_factor', 'version:v1'],
            allowed_actions: ['open_strategy_detail', 'open_composition_workbench'],
            source_ref_id: frozenRowId,
            source_ref_type: 'strategy_projection',
            source_integrity: sourceIntegrity,
            freeze_hash: 'frozen-run-c974',
            signature_status: 'verified',
            drift_status: 'current',
            current_ref_id: frozenRowId,
            alerts: [],
            created_at: '2026-05-12T11:14:00Z',
            updated_at: '2026-05-12T11:14:00Z',
            config: {
              strategy_id: 'strat_0be646e45c26',
              parameter_version_id: 'strat_0be646e45c26-v1',
              parameter_version: 1,
              latest_run_id: 'run_c974e22597c3',
              run_id: 'run_c974e22597c3',
              run_completed_at: '2026-05-11T09:00:00Z',
              annualized_return_pct: 17,
              max_drawdown_pct: 11,
              oos_sharpe: 1.25,
              start_date: '2016-05-11',
              end_date: '2026-05-11',
              effective_date: '2016-06-01',
              oos_start_date: '2024-01-01',
              source_integrity: sourceIntegrity,
            },
          },
        },
      }),
    );
    fakeApi.listStrategies = vi.fn().mockResolvedValue([
      {
        id: 'strat_0be646e45c26',
        name: 'Multi factor core model',
        strategy_type: 'MULTI_FACTOR',
        universe_name: 'US Equity',
        current_parameter_version: 1,
        current_parameter_version_id: 'strat_0be646e45c26-v1',
      },
    ]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      {
        id: 'run_c974e22597c3',
        strategy_id: 'strat_0be646e45c26',
        strategy_name: 'Multi factor core model',
        status: 'COMPLETED',
        completed_at: '2026-05-11T09:00:00Z',
        parameter_version_id: 'strat_0be646e45c26-v1',
        start_date: '2016-05-11',
        end_date: '2026-05-11',
        effective_date: '2016-06-01',
        oos_start_date: '2024-01-01',
        metrics: {
          annualized_return: 0.17,
          max_drawdown: -0.11,
          oos_sharpe: 1.25,
        },
      },
      {
        id: 'run_d7a83285ac8a',
        strategy_id: 'strat_0be646e45c26',
        strategy_name: 'Multi factor core model',
        status: 'COMPLETED',
        completed_at: '2026-05-11T09:13:32Z',
        parameter_version_id: 'strat_0be646e45c26-v1',
        start_date: '2016-05-11',
        end_date: '2026-05-11',
        effective_date: '2016-06-01',
        oos_start_date: '2024-01-01',
        metrics: {
          annualized_return: 0.19,
          max_drawdown: -0.1,
          oos_sharpe: 1.31,
        },
      },
      {
        id: 'run_5cc47aa661a4',
        strategy_id: 'strat_0be646e45c26',
        strategy_name: 'Multi factor core model',
        status: 'COMPLETED',
        completed_at: '2026-05-11T09:20:52Z',
        parameter_version_id: 'strat_0be646e45c26-v1',
        start_date: '2006-05-11',
        end_date: '2026-05-11',
        effective_date: '2006-06-01',
        oos_start_date: '2024-01-01',
        metrics: {
          annualized_return: 0.47,
          max_drawdown: -0.76,
          oos_sharpe: 1.28,
        },
      },
    ]);

    await act(async () => {
      render(<LegInventoryPage />);
    });

    const strategyRow = (await screen.findByText('run_c974e22597c3')).closest('tr');
    expect(strategyRow).not.toBeNull();
    expect(strategyRow?.textContent).toContain('run_c974e22597c3');
    expect(strategyRow?.textContent).not.toContain('run_d7a83285ac8a');
    expect(strategyRow?.textContent).not.toContain('run_5cc47aa661a4');
    expect(strategyRow?.textContent).toContain('有新参数');
    expect(within(strategyRow as HTMLTableRowElement).getByRole('button', { name: '复制新参数' })).toBeInTheDocument();

    fireEvent.click(within(strategyRow as HTMLTableRowElement).getByRole('button', { name: '复制新参数' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('复制新参数')).toBeInTheDocument();
    expect(within(dialog).getByText('strat_0be646e45c26 · v1')).toBeInTheDocument();
    expect(within(dialog).queryByText('run_5cc47aa661a4')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认生成' }));

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(SAVED_STRATEGY_LEG_STORAGE_KEY) ?? '[]')).toEqual(
        expect.arrayContaining([frozenRowId, latestTenYearRowId]),
      ),
    );
    expect(JSON.parse(window.localStorage.getItem(SAVED_STRATEGY_LEG_STORAGE_KEY) ?? '[]')).not.toContain(
      latestTwentyYearRowId,
    );
  });

  it('prefers the referenced frozen strategy source over a newer same-version run after reload', async () => {
    const cachedLatestId = 'strategy_leg::strat_0be646e45c26-v1::run_054d4cee4b1c';
    const frozenId = 'strategy_leg::strat_0be646e45c26-v1::run_5cc47aa661a4';
    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([cachedLatestId]));
    window.localStorage.setItem(
      SAVED_STRATEGY_LEG_FREEZE_STORAGE_KEY,
      JSON.stringify({
        [cachedLatestId]: {
          saved_at: '2026-05-14T08:00:00Z',
          frozen_row: {
            id: cachedLatestId,
            leg_type: 'strategy',
            name: 'Multi factor core model-v1',
            version_label: 'v1',
            proof_label: 'run_054d4cee4b1c',
            reference_count: 0,
            reference_summary: 'Not used in saved compositions yet',
            status: 'READY',
            status_label: 'Ready',
            has_new_version: false,
            is_orphan: false,
            attribute_tags: ['strategy', 'multi_factor', 'version:v1'],
            allowed_actions: ['open_strategy_detail', 'open_composition_workbench'],
            source_ref_id: cachedLatestId,
            source_ref_type: 'strategy_projection',
            signature_status: 'verified',
            drift_status: 'current',
            current_ref_id: cachedLatestId,
            alerts: [],
            config: {
              strategy_id: 'strat_0be646e45c26',
              parameter_version_id: 'strat_0be646e45c26-v1',
              latest_run_id: 'run_054d4cee4b1c',
              run_id: 'run_054d4cee4b1c',
              annualized_return_pct: 6.8,
              max_drawdown_pct: 45.9,
              oos_sharpe: 0.4,
            },
          },
        },
      }),
    );
    fakeApi.getLegInventory = vi.fn().mockResolvedValue({
      ...inventory,
      counts: { all: 2, strategy: 0, asset: 1, cash: 1 },
      strategy_reference_counts: {
        [frozenId]: 1,
      },
      rows: inventory.rows,
    });
    fakeApi.listStrategies = vi.fn().mockResolvedValue([
      {
        id: 'strat_0be646e45c26',
        name: 'Multi factor core model',
        strategy_type: 'MULTI_FACTOR',
        universe_name: 'SP500',
        current_parameter_version: 2,
        current_parameter_version_id: 'strat_0be646e45c26-v2',
      },
    ]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      {
        id: 'run_054d4cee4b1c',
        strategy_id: 'strat_0be646e45c26',
        strategy_name: 'Multi factor core model',
        status: 'COMPLETED',
        completed_at: '2026-05-13T09:18:34Z',
        parameter_version_id: 'strat_0be646e45c26-v1',
        metrics: {
          annualized_return: 0.068034,
          max_drawdown: -0.458657,
          oos_sharpe: 0.4,
        },
      },
      {
        id: 'run_5cc47aa661a4',
        strategy_id: 'strat_0be646e45c26',
        strategy_name: 'Multi factor core model',
        status: 'COMPLETED',
        completed_at: '2026-05-11T09:20:52Z',
        parameter_version_id: 'strat_0be646e45c26-v1',
        is_permanent: true,
        metrics: {
          annualized_return: 0.4699293607230932,
          max_drawdown: -0.7665531387808946,
          oos_sharpe: 1.2772278991104027,
        },
      },
    ]);

    await act(async () => {
      render(<LegInventoryPage />);
    });

    const strategyRow = (await screen.findByText('run_5cc47aa661a4')).closest('tr');
    expect(strategyRow).not.toBeNull();
    expect(strategyRow?.textContent).not.toContain('run_054d4cee4b1c');
    fireEvent.click(strategyRow as HTMLTableRowElement);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(frozenId)).toBeInTheDocument();
    expect(within(dialog).queryByText(cachedLatestId)).toBeNull();
  });

  it('copies a stale saved strategy leg to the latest version after confirmation', async () => {
    const staleRowId = 'strategy_leg::strat_53315d3dd88b::strat_53315d3dd88b-v2';
    const normalizedStaleRowId = 'strategy_leg::strat_53315d3dd88b-v2::run_32b4cce6719a';
    const latestRowId = 'strategy_leg::strat_53315d3dd88b-v4::run_95db6d1d4ba9';
    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([staleRowId]));
    fakeApi.listStrategies = vi.fn().mockResolvedValue([
      {
        id: 'strat_53315d3dd88b',
        name: 'QQQ Grid',
        strategy_type: 'GRID',
        universe_name: 'QQQ',
        current_parameter_version: 4,
        current_parameter_version_id: 'strat_53315d3dd88b-v4',
        benchmark_symbol: 'QQQ',
      },
    ]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      {
        id: 'run_95db6d1d4ba9',
        strategy_id: 'strat_53315d3dd88b',
        strategy_name: 'QQQ Grid',
        status: 'COMPLETED',
        completed_at: '2026-04-28T02:00:00Z',
        parameter_version_id: 'strat_53315d3dd88b-v4',
        metrics: {
          annualized_return: 0.24,
          max_drawdown: -0.13,
          oos_sharpe: 1.8,
        },
      },
      {
        id: 'run_32b4cce6719a',
        strategy_id: 'strat_53315d3dd88b',
        strategy_name: 'QQQ Grid',
        status: 'COMPLETED',
        completed_at: '2026-04-27T02:00:00Z',
        parameter_version_id: 'strat_53315d3dd88b-v2',
        metrics: {
          annualized_return: 0.168,
          max_drawdown: -0.224,
          oos_sharpe: 1.02,
        },
      },
    ]);

    await act(async () => {
      render(<LegInventoryPage />);
    });

    const staleRow = (await screen.findByText('strat_53315d3dd88b · v2')).closest('tr');
    expect(staleRow).not.toBeNull();
    fireEvent.click(within(staleRow as HTMLTableRowElement).getByRole('button', { name: '复制新版本' }));

    const dialog = await screen.findByRole('dialog', { name: '确认复制新版本' });
    expect(
      within(dialog).getByText('检测到底层策略已更新至 v4，是否为此策略腿生成新的版本映射？'),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '确认生成' }));

    await waitFor(() => expect(screen.getByText('strat_53315d3dd88b · v4')).toBeInTheDocument());
    expect(JSON.parse(window.localStorage.getItem(SAVED_STRATEGY_LEG_STORAGE_KEY) ?? '[]')).toEqual(
      expect.arrayContaining([normalizedStaleRowId, latestRowId]),
    );
    expect(screen.queryByRole('button', { name: '复制新版本' })).toBeNull();
  });

  it('opens detail drawer content inside the scrollable detail body', async () => {
    await act(async () => {
      render(<LegInventoryPage />);
    });

    const assetRow = (await screen.findByText('asset-leg-001')).closest('tr');
    expect(assetRow).not.toBeNull();
    fireEvent.click(assetRow as HTMLTableRowElement);

    const dialog = await screen.findByRole('dialog');
    const body = dialog.querySelector('.leg-inventory-drawer__body--detail');
    expect(body).not.toBeNull();
    expect(body?.querySelector('.leg-inventory-detail-grid')).not.toBeNull();
    expect(body?.querySelector('.leg-inventory-drawer__trust')).not.toBeNull();
    expect(body?.querySelector('[data-ui="leg-source-evidence-drawer"]')).not.toBeNull();
    expect(body?.querySelector('.leg-inventory-drawer__foot')).not.toBeNull();
  });

  it('uses runtime bond fixed-income sources when creating a bond asset leg', async () => {
    const { container } = render(<LegInventoryPage />);

    expect(await screen.findByText('asset-leg-001')).toBeInTheDocument();

    const splitToggle = container.querySelector('.leg-inventory-split__toggle');
    expect(splitToggle).not.toBeNull();
    fireEvent.click(splitToggle as HTMLButtonElement);
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getAllByRole('menuitem')[1]);

    const dialog = await screen.findByRole('dialog');
    const sourceStack = dialog.querySelector('.leg-inventory-source-stack');
    expect(sourceStack).toHaveClass('leg-inventory-source-stack--scroll');
    expect(sourceStack?.querySelectorAll('.leg-inventory-source-choice')).toHaveLength(4);
    expect(within(dialog).getByText('美国3个月短期国债 UST T-Bill 13W')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('美国3个月短期国债 UST T-Bill 13W'));
    expect(within(dialog).getByLabelText('腿名称')).toHaveValue('美国3个月短期国债');

    const saveButton = dialog.querySelector('.leg-inventory-drawer__actions .primary-button');
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton as HTMLButtonElement);

    await waitFor(() =>
      expect(fakeApi.createAssetLeg).toHaveBeenCalledWith(
        expect.objectContaining({
          asset_kind: 'BOND',
          source_provider: 'us_treasury_xml',
          source_snapshot_id: 'bond_fixed_income::UST_BILL_3M::2026-04-23::us_treasury_xml',
          name: '美国3个月短期国债',
          symbol: 'USTBILL3M',
        }),
      ),
    );
    expect(fakeApi.createAssetLeg).not.toHaveBeenCalledWith(
      expect.objectContaining({
        source_snapshot_id: 'Bond-UST10Y-EOD-20260421',
      }),
    );
  });

  it('does not expose static equity presets before an equity runtime source contract exists', async () => {
    const { container } = render(<LegInventoryPage />);

    expect(await screen.findByText('asset-leg-001')).toBeInTheDocument();

    const splitToggle = container.querySelector('.leg-inventory-split__toggle');
    expect(splitToggle).not.toBeNull();
    fireEvent.click(splitToggle as HTMLButtonElement);
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getAllByRole('menuitem')[1]);

    const dialog = await screen.findByRole('dialog', { name: '创建资产腿' });
    fireEvent.click(within(dialog).getByRole('tab', { name: '股票' }));

    expect(within(dialog).queryByText('Equity-SPY-Factors-EOD-20260421')).toBeNull();
    expect(within(dialog).queryByText('SPY 宽基贝塔')).toBeNull();
    expect(within(dialog).getByText('权益资产腿尚未接入正式运行时快照源')).toBeInTheDocument();

    const saveButton = dialog.querySelector('.leg-inventory-drawer__actions .primary-button');
    expect(saveButton).not.toBeNull();
    expect(saveButton).toBeDisabled();
    expect(fakeApi.createAssetLeg).not.toHaveBeenCalled();
  });

  it('renders strategy drawer metrics from the latest completed run payload', async () => {
    fakeApi.listStrategies = vi.fn().mockResolvedValue([
      {
        id: 'strat-tested-001',
        name: 'S&P momentum',
        strategy_type: 'MOMENTUM',
        universe_name: 'S&P 500',
        current_parameter_version: 2,
        current_parameter_version_id: 'strat-tested-001-v2',
      },
    ]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      {
        id: 'run-tested-001',
        strategy_id: 'strat-tested-001',
        strategy_name: 'S&P momentum',
        status: 'COMPLETED',
        completed_at: '2026-04-26T10:00:00Z',
        parameter_version_id: 'strat-tested-001-v2',
        metrics: {
          oos_annualized_return: 0.21,
          oos_max_drawdown: -0.12,
          oos_sharpe: 1.4,
        },
      },
    ]);

    await act(async () => {
      render(<LegInventoryPage />);
    });

    expect(await screen.findByText('asset-leg-001')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ 新建腿' }));

    const dialog = await screen.findByRole('dialog', { name: '创建策略腿' });
    const candidateCard = dialog.querySelector('.leg-inventory-run-item--active');
    expect(candidateCard).not.toBeNull();
    expect(within(candidateCard as HTMLElement).getByText('S&P momentum')).toBeInTheDocument();
    expect(within(candidateCard as HTMLElement).getByText('v2')).toBeInTheDocument();
    expect(within(candidateCard as HTMLElement).getByText('MOMENTUM')).toBeInTheDocument();
    expect(within(candidateCard as HTMLElement).getByText('年化 +21.0%')).toBeInTheDocument();
    expect(within(candidateCard as HTMLElement).getByText('最大回撤 -12.0%')).toBeInTheDocument();
    expect(within(candidateCard as HTMLElement).getByText('夏普 1.40')).toBeInTheDocument();
    expect(within(dialog).getAllByText('run-tested-001').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('+21.0%')).toBeInTheDocument();
    expect(within(dialog).getByText('1.40')).toBeInTheDocument();
    expect(within(dialog).getByText('-12.0%')).toBeInTheDocument();
    expect(within(dialog).queryByText(/当前版本将沿用策略回测证明/)).toBeNull();
    expect(within(dialog).queryByText(/保存入库后，清单将显示回测证明/)).toBeNull();

    const rightRail = dialog.querySelector('.leg-inventory-drawer__snapshot');
    const leftForm = dialog.querySelector('.leg-inventory-drawer__form');
    const rightSections = Array.from(rightRail?.querySelectorAll('.leg-inventory-drawer__section') ?? []);
    expect(rightRail).not.toBeNull();
    expect(rightSections).toHaveLength(2);
    expect(within(rightSections[0] as HTMLElement).getByText('验证摘要')).toBeInTheDocument();
    expect(within(rightSections[1] as HTMLElement).getByText('核心参数')).toBeInTheDocument();
    expect(leftForm?.textContent).not.toContain('核心参数');
  });

  it('promotes a temporary source run to permanent when saving a strategy leg freeze', async () => {
    fakeApi.listStrategies = vi.fn().mockResolvedValue([
      {
        id: 'strat-tested-001',
        name: 'S&P momentum',
        strategy_type: 'MOMENTUM',
        universe_name: 'S&P 500',
        current_parameter_version: 2,
        current_parameter_version_id: 'strat-tested-001-v2',
      },
    ]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      {
        id: 'run-tested-001',
        strategy_id: 'strat-tested-001',
        strategy_name: 'S&P momentum',
        status: 'COMPLETED',
        completed_at: '2026-04-26T10:00:00Z',
        updated_at: '2026-04-26T10:00:00Z',
        parameter_version_id: 'strat-tested-001-v2',
        is_permanent: false,
        metrics: {
          oos_annualized_return: 0.21,
          oos_max_drawdown: -0.12,
          oos_sharpe: 1.4,
        },
      },
    ]);
    fakeApi.saveBacktestRun = vi.fn().mockResolvedValue({
      id: 'run-tested-001',
      strategy_id: 'strat-tested-001',
      strategy_name: 'S&P momentum',
      status: 'COMPLETED',
      parameter_version_id: 'strat-tested-001-v2',
      metrics: {
        oos_annualized_return: 0.21,
        oos_max_drawdown: -0.12,
        oos_sharpe: 1.4,
      },
      is_permanent: true,
      created_at: '2026-04-26T09:59:00Z',
      updated_at: '2026-04-26T10:05:00Z',
      completed_at: '2026-04-26T10:00:00Z',
    });

    await act(async () => {
      render(<LegInventoryPage />);
    });

    expect(await screen.findByText('asset-leg-001')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ 新建腿' }));

    const dialog = await screen.findByRole('dialog', { name: '创建策略腿' });
    const saveButton = dialog.querySelector('.leg-inventory-drawer__actions .primary-button');
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton as HTMLButtonElement);

    await waitFor(() => expect(fakeApi.saveBacktestRun).toHaveBeenCalledWith('run-tested-001'));

    const savedIds = JSON.parse(window.localStorage.getItem(SAVED_STRATEGY_LEG_STORAGE_KEY) ?? '[]');
    expect(savedIds).toContain('strategy_leg::strat-tested-001-v2::run-tested-001');

    const savedFreezes = JSON.parse(window.localStorage.getItem(SAVED_STRATEGY_LEG_FREEZE_STORAGE_KEY) ?? '{}');
    expect(savedFreezes['strategy_leg::strat-tested-001-v2::run-tested-001']?.frozen_row?.config?.is_permanent).toBe(true);
    expect(savedFreezes['strategy_leg::strat-tested-001-v2::run-tested-001']?.frozen_row?.config?.run_id).toBe('run-tested-001');
  });

  it('requires confirmation before archiving an inventory leg', async () => {
    await act(async () => {
      render(<LegInventoryPage />);
    });

    const cashRow = (await screen.findByText('cash-leg-001')).closest('tr');
    expect(cashRow).not.toBeNull();

    fireEvent.click(within(cashRow as HTMLTableRowElement).getByRole('button', { name: '归档' }));

    expect(fakeApi.updateCashLeg).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: '确认归档资产腿' });
    expect(within(dialog).getByText('cash-leg-001')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认归档资产腿' })).toBeNull());
    expect(fakeApi.updateCashLeg).not.toHaveBeenCalled();
  });

  it('archives after the confirmation action', async () => {
    await act(async () => {
      render(<LegInventoryPage />);
    });

    const cashRow = (await screen.findByText('cash-leg-001')).closest('tr');
    expect(cashRow).not.toBeNull();

    fireEvent.click(within(cashRow as HTMLTableRowElement).getByRole('button', { name: '归档' }));
    const dialog = await screen.findByRole('dialog', { name: '确认归档资产腿' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认归档' }));

    await waitFor(() => expect(fakeApi.updateCashLeg).toHaveBeenCalledWith('cash-leg-001', { status: 'ARCHIVED' }));
  });
});
