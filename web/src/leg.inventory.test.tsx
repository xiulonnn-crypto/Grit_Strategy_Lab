import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegInventoryPage } from './pages/leg-inventory-page';
import { SAVED_STRATEGY_LEG_STORAGE_KEY } from './lib/saved-strategy-leg-inventory';
import type { ApiLegInventory, ApiSnapshotOverview } from './types';

type FakeApi = {
  getLegInventory?: ReturnType<typeof vi.fn>;
  updateAssetLeg?: ReturnType<typeof vi.fn>;
  updateCashLeg?: ReturnType<typeof vi.fn>;
  createAssetLeg?: ReturnType<typeof vi.fn>;
  createCashLeg?: ReturnType<typeof vi.fn>;
  listStrategies?: ReturnType<typeof vi.fn>;
  listBacktestRuns?: ReturnType<typeof vi.fn>;
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
  listCompositions: vi.fn(),
  getCompositionDetail: vi.fn(),
  getSnapshotOverview: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

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
    expect(screen.getByText('cash-leg-001')).toBeInTheDocument();
    expect(document.querySelector('[data-ui="leg-source-trust-table"]')).not.toBeNull();
    expect(screen.queryByText(/冻结哈希/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hash-bond-001/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hash-cash-001/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-ui="leg-freeze-hash"]').length).toBe(0);
    expect(document.querySelectorAll('[data-ui="leg-drift-status"]').length).toBe(0);
    expect(screen.queryByText(/strategy_leg::/)).not.toBeInTheDocument();
  });

  it('hydrates saved strategy leg reference counts from active compositions', async () => {
    const rowId = 'strategy_leg::strat-tested-001::strat-tested-001-v2';
    window.localStorage.setItem(SAVED_STRATEGY_LEG_STORAGE_KEY, JSON.stringify([rowId]));
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
    fakeApi.listCompositions = vi.fn().mockResolvedValue([
      { id: 'composition-tested-001', status: 'ACTIVE' },
    ]);
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue({
      id: 'composition-tested-001',
      status: 'ACTIVE',
      normalized_legs: [
        {
          leg_kind: 'strategy',
          source_ref_id: rowId,
        },
      ],
    });

    await act(async () => {
      render(<LegInventoryPage />);
    });

    const strategyRow = (await screen.findByText('strat-tested-001::strat-tested-001-v2')).closest('tr');
    expect(strategyRow).not.toBeNull();
    const cells = within(strategyRow as HTMLTableRowElement).getAllByRole('cell');
    expect(within(cells[4]).getByText('1')).toBeInTheDocument();
    expect(within(strategyRow as HTMLTableRowElement).queryByText('敶﹝')).toBeNull();
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
