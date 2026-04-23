import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegInventoryPage } from './pages/leg-inventory-page';
import type { ApiAssetLeg, ApiCashLeg, ApiLegInventory } from './types';

type FakeApi = {
  getLegInventory?: ReturnType<typeof vi.fn>;
  createAssetLeg?: ReturnType<typeof vi.fn>;
  createCashLeg?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getLegInventory: vi.fn(),
  createAssetLeg: vi.fn(),
  createCashLeg: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const inventory: ApiLegInventory = {
  counts: {
    all: 3,
    strategy: 1,
    asset: 1,
    cash: 1,
  },
  filters: {
    statuses: [
      { value: 'READY', label: 'Ready', count: 1 },
      { value: 'ACTIVE', label: 'Active', count: 2 },
    ],
    attribute_tags: [
      { value: 'strategy', label: 'strategy', count: 1 },
      { value: 'asset', label: 'asset', count: 1 },
      { value: 'cash', label: 'cash', count: 1 },
      { value: 'snapshot:bond-fixed-income', label: 'snapshot:bond-fixed-income', count: 1 },
    ],
  },
  rows: [
    {
      id: 'strategy_leg::strat-001::pv-003',
      leg_type: 'strategy',
      name: '质量动量策略',
      version_label: 'v3',
      proof_label: 'Latest eligible run run-101',
      reference_count: 2,
      reference_summary: 'Used in 2 saved compositions',
      status: 'READY',
      status_label: 'Ready',
      has_new_version: false,
      is_orphan: false,
      attribute_tags: ['strategy', 'version:v3', 'rebalance:quarterly'],
      allowed_actions: ['open_strategy_detail', 'open_composition_workbench'],
      source_ref_id: 'strategy_leg::strat-001::pv-003',
      source_ref_type: 'strategy_projection',
      config: {
        strategy_id: 'strat-001',
        parameter_version_id: 'pv-003',
        latest_run_id: 'run-101',
      },
    },
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
      attribute_tags: ['asset', 'snapshot:bond-fixed-income', 'freeze:snapshot_locked'],
      allowed_actions: ['edit_leg_definition', 'open_composition_workbench'],
      source_ref_id: 'asset-leg-001',
      source_ref_type: 'asset_definition',
      config: {
        source_snapshot_id: 'bond-fixed-income',
        asset_kind: 'BOND',
      },
    },
    {
      id: 'cash-leg-001',
      leg_type: 'cash',
      name: '现金缓冲腿',
      version_label: 'TARGET_BUFFER',
      proof_label: 'phase1_cash_proxy',
      reference_count: 0,
      reference_summary: 'Not used in saved compositions yet',
      status: 'ACTIVE',
      status_label: 'Active',
      has_new_version: false,
      is_orphan: false,
      attribute_tags: ['cash', 'freeze:manual'],
      allowed_actions: ['edit_leg_definition', 'open_composition_workbench'],
      source_ref_id: 'cash-leg-001',
      source_ref_type: 'cash_definition',
      config: {
        buffer_bps: 35,
        cash_rule_kind: 'TARGET_BUFFER',
      },
    },
  ],
};

const createdAsset: ApiAssetLeg = {
  id: 'asset-leg-002',
  name: '美债 20Y',
  symbol: 'TLT',
  asset_kind: 'BOND',
  source_snapshot_id: 'bond-fixed-income',
  source_provider: 'snapshot_registry',
  freeze_mode: 'snapshot_locked',
  notes: '久期增强',
  summary: {},
  status: 'ACTIVE',
  eligibility_summary: {},
  attribute_tags: ['asset'],
  allowed_actions: ['edit_leg_definition', 'open_composition_workbench'],
  created_at: '2026-04-21T02:00:00Z',
  updated_at: '2026-04-21T02:00:00Z',
};

const createdCash: ApiCashLeg = {
  id: 'cash-leg-002',
  name: '季度结算缓冲',
  cash_rule_kind: 'SETTLEMENT_BUFFER',
  buffer_bps: 55,
  yield_source: 'phase1_cash_proxy',
  freeze_mode: 'manual',
  notes: '季度调仓备用',
  summary: {},
  status: 'ACTIVE',
  attribute_tags: ['cash'],
  allowed_actions: ['edit_leg_definition', 'open_composition_workbench'],
  created_at: '2026-04-21T03:00:00Z',
  updated_at: '2026-04-21T03:00:00Z',
};

beforeEach(() => {
  fakeApi.getLegInventory = vi.fn().mockResolvedValue(inventory);
  fakeApi.createAssetLeg = vi.fn().mockResolvedValue(createdAsset);
  fakeApi.createCashLeg = vi.fn().mockResolvedValue(createdCash);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.location.hash = '';
});

describe('leg inventory page', () => {
  it('keeps strategy legs projection-based and exposes stable route selectors', async () => {
    await act(async () => {
      render(<LegInventoryPage />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '策略资产库' })).toBeInTheDocument();
    expect(
      document.querySelector('.leg-inventory-page[data-route-root="legs"][data-page-root="leg-inventory"]'),
    ).not.toBeNull();
    const toolbarShell = document.querySelector('.leg-inventory-toolbar-shell');
    const tablePanel = document.querySelector('.leg-inventory-table-panel');

    expect(toolbarShell).not.toBeNull();
    expect(toolbarShell?.querySelector('.leg-inventory-panel__header')).toBeNull();
    expect(tablePanel).not.toBeNull();
    expect(
      Boolean(toolbarShell && tablePanel && toolbarShell.compareDocumentPosition(tablePanel) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(document.querySelector('.leg-inventory-task-list')).not.toBeNull();
    expect(document.querySelectorAll('.leg-inventory-task-card')).toHaveLength(3);
    expect(screen.getByText('依赖追踪')).toBeInTheDocument();
    expect(screen.getByText('核心')).toBeInTheDocument();
    expect(screen.getByText('质量动量策略')).toBeInTheDocument();
    expect(screen.getByText('10Y 国债久期腿')).toBeInTheDocument();
    expect(screen.queryByText('创建策略腿')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '▼' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /策略腿/ }));

    const strategyDialog = await screen.findByRole('dialog', { name: '创建策略腿' });
    expect(within(strategyDialog).getByText('身份定义')).toBeInTheDocument();
    expect(within(strategyDialog).getByRole('button', { name: '保存并加入库' })).toBeInTheDocument();
    expect(screen.getByText('10Y 国债久期腿')).toBeInTheDocument();

    fireEvent.click(within(strategyDialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '创建策略腿' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: '查看策略' }));
    await waitFor(() => expect(window.location.hash).toBe('#/strategies/strat-001'));

    fireEvent.click(screen.getAllByRole('button', { name: '加入工作台' })[0]);
    await waitFor(() =>
      expect(window.location.hash).toBe('#/compositions/workbench?add_leg=strategy_leg%3A%3Astrat-001%3A%3Apv-003'),
    );
  });

  it('keeps the approved filter active state from being overridden by base chip styles', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'components/legs/leg-inventory.css'), 'utf8');
    const baseRuleIndex = css.indexOf('.leg-inventory-filter {');
    const activeRuleIndex = css.indexOf('.leg-inventory-filter.leg-inventory-filter--active');

    expect(baseRuleIndex).toBeGreaterThanOrEqual(0);
    expect(activeRuleIndex).toBeGreaterThan(baseRuleIndex);
    expect(css.slice(activeRuleIndex, activeRuleIndex + 220)).toContain('background: #e6f4f1');
    expect(css.slice(css.indexOf('.leg-inventory-task-list {'), css.indexOf('.leg-inventory-task-list {') + 180)).toContain(
      'grid-template-columns: repeat(3',
    );
  });

  it('creates an asset leg from the drawer using the landed API contract', async () => {
    fakeApi.getLegInventory = vi
      .fn()
      .mockResolvedValueOnce(inventory)
      .mockResolvedValueOnce({
        ...inventory,
        counts: { ...inventory.counts, all: 4, asset: 2 },
        rows: [
          ...inventory.rows,
          {
            id: createdAsset.id,
            leg_type: 'asset',
            name: createdAsset.name,
            version_label: createdAsset.symbol,
            proof_label: createdAsset.source_snapshot_id,
            reference_count: 0,
            reference_summary: 'Not used in saved compositions yet',
            status: createdAsset.status,
            status_label: 'Active',
            has_new_version: false,
            is_orphan: false,
            attribute_tags: createdAsset.attribute_tags,
            allowed_actions: createdAsset.allowed_actions,
            source_ref_id: createdAsset.id,
            source_ref_type: 'asset_definition',
            config: {
              source_snapshot_id: createdAsset.source_snapshot_id,
              asset_kind: createdAsset.asset_kind,
            },
          },
        ],
      });

    render(<LegInventoryPage />);

    expect(await screen.findByText('10Y 国债久期腿')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '▼' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /资产腿/ }));
    const dialog = await screen.findByRole('dialog', { name: '创建资产腿' });

    fireEvent.change(within(dialog).getByLabelText('资产腿名称'), { target: { value: '美债 20Y' } });
    fireEvent.change(within(dialog).getByLabelText('标识 / 代码'), { target: { value: 'TLT' } });
    fireEvent.change(within(dialog).getByLabelText('来源快照'), {
      target: { value: 'bond-fixed-income' },
    });
    fireEvent.change(within(dialog).getByLabelText('来源提供方'), {
      target: { value: 'snapshot_registry' },
    });
    fireEvent.change(within(dialog).getByLabelText('入库备注'), {
      target: { value: '久期增强' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: '保存资产腿' }));

    await waitFor(() =>
      expect(fakeApi.createAssetLeg).toHaveBeenCalledWith({
        name: '美债 20Y',
        symbol: 'TLT',
        asset_kind: 'BOND',
        source_snapshot_id: 'bond-fixed-income',
        source_provider: 'snapshot_registry',
        freeze_mode: 'snapshot_locked',
        notes: '久期增强',
      }),
    );
    await waitFor(() => expect(fakeApi.getLegInventory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('美债 20Y')).toBeInTheDocument();
  });

  it('creates a cash leg from the drawer using the landed API contract', async () => {
    fakeApi.getLegInventory = vi
      .fn()
      .mockResolvedValueOnce(inventory)
      .mockResolvedValueOnce({
        ...inventory,
        counts: { ...inventory.counts, all: 4, cash: 2 },
        rows: [
          ...inventory.rows,
          {
            id: createdCash.id,
            leg_type: 'cash',
            name: createdCash.name,
            version_label: createdCash.cash_rule_kind,
            proof_label: createdCash.yield_source,
            reference_count: 0,
            reference_summary: 'Not used in saved compositions yet',
            status: createdCash.status,
            status_label: 'Active',
            has_new_version: false,
            is_orphan: false,
            attribute_tags: createdCash.attribute_tags,
            allowed_actions: createdCash.allowed_actions,
            source_ref_id: createdCash.id,
            source_ref_type: 'cash_definition',
            config: {
              buffer_bps: createdCash.buffer_bps,
              cash_rule_kind: createdCash.cash_rule_kind,
            },
          },
        ],
      });

    render(<LegInventoryPage />);

    expect(await screen.findByText('现金缓冲腿')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '▼' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /现金腿/ }));
    const dialog = await screen.findByRole('dialog', { name: '创建现金腿' });

    fireEvent.change(within(dialog).getByLabelText('现金腿名称'), {
      target: { value: '季度结算缓冲' },
    });
    fireEvent.change(within(dialog).getByLabelText('规则类型'), {
      target: { value: 'SETTLEMENT_BUFFER' },
    });
    fireEvent.change(within(dialog).getByLabelText('缓冲阈值（bps）'), {
      target: { value: '55' },
    });
    fireEvent.change(within(dialog).getByLabelText('维护说明'), {
      target: { value: '季度调仓备用' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: '保存现金腿' }));

    await waitFor(() =>
      expect(fakeApi.createCashLeg).toHaveBeenCalledWith({
        name: '季度结算缓冲',
        cash_rule_kind: 'SETTLEMENT_BUFFER',
        buffer_bps: 55,
        yield_source: 'phase1_cash_proxy',
        freeze_mode: 'manual',
        notes: '季度调仓备用',
      }),
    );
    await waitFor(() => expect(fakeApi.getLegInventory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('季度结算缓冲')).toBeInTheDocument();
  });
});
