import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LegInventoryPage } from './pages/leg-inventory-page';
import type {
  ApiAssetLeg,
  ApiBacktestRunListItem,
  ApiCashLeg,
  ApiLegInventory,
  ApiStrategyListItem,
} from './types';

type FakeApi = {
  getLegInventory?: ReturnType<typeof vi.fn>;
  createAssetLeg?: ReturnType<typeof vi.fn>;
  createCashLeg?: ReturnType<typeof vi.fn>;
  listStrategies?: ReturnType<typeof vi.fn>;
  listBacktestRuns?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getLegInventory: vi.fn(),
  createAssetLeg: vi.fn(),
  createCashLeg: vi.fn(),
  listStrategies: vi.fn(),
  listBacktestRuns: vi.fn(),
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
      { value: 'READY', label: 'Ready', count: 1 },
      { value: 'ACTIVE', label: 'Active', count: 2 },
    ],
    attribute_tags: [
      { value: 'asset', label: 'asset', count: 1 },
      { value: 'cash', label: 'cash', count: 1 },
      { value: 'snapshot:bond-fixed-income', label: 'snapshot:bond-fixed-income', count: 1 },
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
      attribute_tags: ['asset', 'snapshot:bond-fixed-income', 'freeze:snapshot_locked'],
      allowed_actions: ['edit_leg_definition', 'open_composition_workbench'],
      source_ref_id: 'asset-leg-001',
      source_ref_type: 'asset_definition',
      config: {
        symbol: 'UST10Y',
        source_snapshot_id: 'bond-fixed-income',
        source_provider: 'FMP',
        asset_kind: 'BOND',
        freeze_mode: 'snapshot_locked',
        summary: {
          notes: '用于 2026 Q2 季度平衡，已对齐 FMP 官方复权因子。',
          bond_snapshot: {
            id: 'bond-fixed-income',
            label: 'US Treasury 10Y Note',
            source: 'FMP',
            snapshot_date: '2026-04-22',
            snapshot_ref: 'bond-fixed-income',
            ytm_pct: 4.32,
            duration: 8.1,
            updated_at: '2026-04-22T15:00:00Z',
          },
          volatility_pct: 4.5,
        },
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
        buffer_bps: 25,
        cash_rule_kind: 'TARGET_BUFFER',
        yield_source: 'SOFR',
        freeze_mode: 'rule_locked',
        summary: {
          cost_absorption: 'High',
          notes: '季度平滑现金腿，吸收再平衡成本。',
        },
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

const eligibleStrategy: ApiStrategyListItem = {
  id: 'strat-tested-001',
  name: '质量动量策略',
  description: '已完成回测的策略版本。',
  strategy_type: 'MOMENTUM',
  universe_name: 'SP500',
  rebalance_frequency: 'monthly',
  lifecycle_status: 'ACTIVE',
  latest_run_id: 'run-tested-v2',
  latest_successful_run_id: 'run-tested-v2',
  latest_optimization_job_id: null,
  current_parameter_version: 2,
  current_parameter_version_id: 'strat-tested-001-v2',
  dataset_snapshot_id: 'ds-price',
  universe_snapshot_id: 'un-sp500',
  benchmark_symbol: 'SPY',
  created_at: '2026-04-21T01:00:00Z',
  updated_at: '2026-04-21T02:00:00Z',
  latest_completed_run_summary: null,
};

const eligibleRun: ApiBacktestRunListItem = {
  id: 'run-tested-v2',
  strategy_id: 'strat-tested-001',
  strategy_name: '质量动量策略',
  status: 'COMPLETED',
  start_date: '2020-01-01',
  end_date: '2026-04-01',
  created_at: '2026-04-21T01:30:00Z',
  updated_at: '2026-04-21T02:00:00Z',
  completed_at: '2026-04-21T02:00:00Z',
  parameter_version_id: 'strat-tested-001-v2',
  is_permanent: true,
  trades_count: 42,
  metrics: {
    total_return: 18.4,
    cagr: 0.11,
    annualized_return: 0.11,
    annualized_volatility: 0.13,
    sharpe: 1.18,
    max_drawdown: -0.08,
    turnover: 0.2,
    win_rate: 0.57,
  },
};

function makeStrategyFixture(id: string, name: string, version = 1): ApiStrategyListItem {
  return {
    ...eligibleStrategy,
    id,
    name,
    latest_run_id: `run-${id}-v${version}`,
    latest_successful_run_id: `run-${id}-v${version}`,
    current_parameter_version: version,
    current_parameter_version_id: `${id}-v${version}`,
  };
}

function makeRunFixture(
  strategy: ApiStrategyListItem,
  completedAt: string,
  metrics: Partial<ApiBacktestRunListItem['metrics']> = {},
): ApiBacktestRunListItem {
  const parameterVersionId = strategy.current_parameter_version_id ?? `${strategy.id}-v1`;
  return {
    ...eligibleRun,
    id: `run-${strategy.id}-${parameterVersionId}`,
    strategy_id: strategy.id,
    strategy_name: strategy.name,
    parameter_version_id: parameterVersionId,
    created_at: completedAt,
    updated_at: completedAt,
    completed_at: completedAt,
    metrics: {
      ...eligibleRun.metrics!,
      total_return: 0.12,
      annualized_return: 0.08,
      sharpe: 0.82,
      max_drawdown: -0.06,
      ...metrics,
    },
  };
}

beforeEach(() => {
  fakeApi.getLegInventory = vi.fn().mockResolvedValue(inventory);
  fakeApi.createAssetLeg = vi.fn().mockResolvedValue(createdAsset);
  fakeApi.createCashLeg = vi.fn().mockResolvedValue(createdCash);
  fakeApi.listStrategies = vi.fn().mockResolvedValue([]);
  fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([]);
  window.localStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  window.location.hash = '';
});

describe('leg inventory page', () => {
  it('keeps strategy legs out of the default inventory until manually generated', async () => {
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
    expect(screen.queryByText('质量动量策略')).toBeNull();
    expect(screen.getByText('10Y 国债久期腿')).toBeInTheDocument();
    expect(screen.getByText('理由名称 / 标识名称 / ID')).toBeInTheDocument();
    expect(screen.getByText('快照版本 (PIT Date)')).toBeInTheDocument();
    expect(screen.getByText('核心参数 / 来源锚点')).toBeInTheDocument();
    expect(screen.getByText('状态')).toBeInTheDocument();
    expect(screen.queryByText('风险特征 / 状态')).toBeNull();
    expect(screen.getByText(/UST10Y · #/)).toBeInTheDocument();
    expect(screen.getByText('2026-04-22')).toBeInTheDocument();
    expect(screen.getByText('YTM 4.32% | Dur 8.1 | Vol 4.5%')).toBeInTheDocument();
    expect(screen.getByText('Buffer 25 bps | Cost Absorp High')).toBeInTheDocument();
    expect(screen.queryByText('久期对冲')).toBeNull();
    expect(screen.getAllByText('已冻结').length).toBeGreaterThan(0);
    expect(screen.getByText('闲置')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加入工作台' })).toBeNull();
    expect(screen.queryByText('创建策略腿')).toBeNull();

    const assetRow = screen.getByText('10Y 国债久期腿').closest('tr');
    const cashRow = screen.getByText('现金缓冲腿').closest('tr');
    expect(assetRow).not.toBeNull();
    expect(cashRow).not.toBeNull();
    expect(within(assetRow as HTMLTableRowElement).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '详情',
      '编辑',
      '查看来源',
    ]);
    expect(within(cashRow as HTMLTableRowElement).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '详情',
      '编辑',
      '归档',
    ]);

    fireEvent.click(screen.getByRole('button', { name: '▼' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /策略腿/ }));

    const strategyDialog = await screen.findByRole('dialog', { name: '创建策略腿' });
    expect(within(strategyDialog).getByText('身份定义')).toBeInTheDocument();
    expect(within(strategyDialog).getByRole('button', { name: '保存并加入库' })).toBeInTheDocument();
    expect(within(strategyDialog).getByText('当前没有可用于创建策略腿的合格策略版本。')).toBeInTheDocument();
    expect(screen.getByText('10Y 国债久期腿')).toBeInTheDocument();

    fireEvent.click(within(strategyDialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '创建策略腿' })).toBeNull());

    expect(window.location.hash).toBe('');
  });

  it('opens an investment-audit detail drawer from a leg row', async () => {
    render(<LegInventoryPage />);

    fireEvent.click(await screen.findByText('10Y 国债久期腿'));

    const detailDialog = await screen.findByRole('dialog', { name: '腿部详情' });
    expect(within(detailDialog).getByText('来源审计 / Leg Detail')).toBeInTheDocument();
    expect(within(detailDialog).getByText('12 个月收益曲线')).toBeInTheDocument();
    expect(within(detailDialog).getByText('PIT 快照版本')).toBeInTheDocument();
    expect(within(detailDialog).getByText('2026-04-22')).toBeInTheDocument();
    expect(within(detailDialog).getByText('YTM 4.32% | Dur 8.1 | Vol 4.5%')).toBeInTheDocument();
    expect(within(detailDialog).getByText('用于 2026 Q2 季度平衡，已对齐 FMP 官方复权因子。')).toBeInTheDocument();
    expect(within(detailDialog).queryByText('久期对冲')).toBeNull();
    expect(within(detailDialog).queryByRole('button', { name: '加入工作台' })).toBeNull();

    fireEvent.click(within(detailDialog).getByRole('button', { name: '查看来源' }));
    expect(window.location.hash).toBe('#/snapshots?tab=bond&source_snapshot_id=bond-fixed-income');
  });

  it('opens a create-style edit drawer from the list action', async () => {
    render(<LegInventoryPage />);

    const assetRow = (await screen.findByText('10Y 国债久期腿')).closest('tr');
    expect(assetRow).not.toBeNull();
    fireEvent.click(within(assetRow as HTMLTableRowElement).getByRole('button', { name: '编辑' }));

    const editDialog = await screen.findByRole('dialog', { name: '编辑腿部定义' });
    expect(within(editDialog).getByRole('heading', { name: '编辑资产腿' })).toBeInTheDocument();
    expect(within(editDialog).getByLabelText('腿部名称')).toHaveValue('10Y 国债久期腿');
    expect(within(editDialog).getByLabelText('核心参数')).toHaveValue('YTM 4.32% | Dur 8.1 | Vol 4.5%\nFMP');

    fireEvent.click(within(editDialog).getByRole('button', { name: '保存编辑' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑腿部定义' })).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('编辑预览');
  });

  it('saves a completed strategy candidate into the asset library without jumping to the workbench', async () => {
    fakeApi.listStrategies = vi.fn().mockResolvedValue([eligibleStrategy]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([eligibleRun]);

    render(<LegInventoryPage />);

    expect(await screen.findByText('10Y 国债久期腿')).toBeInTheDocument();
    expect(screen.queryByText('质量动量策略')).not.toBeInTheDocument();

    const menuToggle = document.querySelector('.leg-inventory-split__toggle') as HTMLButtonElement | null;
    expect(menuToggle).not.toBeNull();
    fireEvent.click(menuToggle as HTMLButtonElement);
    fireEvent.click(screen.getAllByRole('menuitem')[0]);

    const strategyDialog = await screen.findByRole('dialog');
    expect((await within(strategyDialog).findAllByText(/质量动量策略/)).length).toBeGreaterThan(0);
    expect(within(strategyDialog).queryByText('当前没有可用于创建策略腿的合格策略版本。')).not.toBeInTheDocument();

    const saveButton = strategyDialog.querySelector('.primary-button') as HTMLButtonElement | null;
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton as HTMLButtonElement);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#/legs');
    expect(screen.getByRole('status')).toHaveTextContent('创建策略腿成功');
    expect(screen.getByText(eligibleStrategy.name)).toBeInTheDocument();
    expect(screen.getByText('strategy_leg::strat-tested-001::strat-tested-001-v2')).toBeInTheDocument();
    expect(document.querySelectorAll('.leg-inventory-table tbody tr')).toHaveLength(3);
  });

  it('keeps a saved strategy candidate visible after a page refresh', async () => {
    fakeApi.listStrategies = vi.fn().mockResolvedValue([eligibleStrategy]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([eligibleRun]);

    render(<LegInventoryPage />);

    expect(await screen.findByText('asset-leg-001')).toBeInTheDocument();
    const menuToggle = document.querySelector('.leg-inventory-split__toggle') as HTMLButtonElement | null;
    expect(menuToggle).not.toBeNull();
    fireEvent.click(menuToggle as HTMLButtonElement);
    fireEvent.click(screen.getAllByRole('menuitem')[0]);

    const strategyDialog = await screen.findByRole('dialog');
    const saveButton = strategyDialog.querySelector('.primary-button') as HTMLButtonElement | null;
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton as HTMLButtonElement);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('strategy_leg::strat-tested-001::strat-tested-001-v2')).toBeInTheDocument();

    cleanup();
    render(<LegInventoryPage />);

    expect(await screen.findByText('strategy_leg::strat-tested-001::strat-tested-001-v2')).toBeInTheDocument();
  });

  it('shows the latest completed candidate for every backtested strategy in the strategy-leg drawer', async () => {
    const strategies = [
      makeStrategyFixture('strat-alpha', 'Alpha Core', 3),
      makeStrategyFixture('strat-beta', 'Beta Carry', 2),
      makeStrategyFixture('strat-gamma', 'Gamma Momentum', 4),
      makeStrategyFixture('strat-delta', 'Delta Income', 1),
    ];
    fakeApi.listStrategies = vi.fn().mockResolvedValue(strategies);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      makeRunFixture(strategies[0], '2026-04-21T04:00:00Z'),
      makeRunFixture(strategies[1], '2026-04-21T03:00:00Z'),
      makeRunFixture(strategies[2], '2026-04-21T02:00:00Z'),
      {
        ...makeRunFixture(strategies[2], '2026-04-20T02:00:00Z'),
        id: 'run-strat-gamma-older',
        parameter_version_id: 'strat-gamma-v3',
      },
      makeRunFixture(strategies[3], '2026-04-21T01:00:00Z'),
    ]);

    render(<LegInventoryPage />);

    expect(await screen.findByText('10Y 国债久期腿')).toBeInTheDocument();
    const menuToggle = document.querySelector('.leg-inventory-split__toggle') as HTMLButtonElement | null;
    expect(menuToggle).not.toBeNull();
    fireEvent.click(menuToggle as HTMLButtonElement);
    fireEvent.click(screen.getAllByRole('menuitem')[0]);

    const strategyDialog = await screen.findByRole('dialog');
    const candidateButtons = strategyDialog.querySelectorAll('.leg-inventory-run-item');

    expect(candidateButtons).toHaveLength(4);
    expect(within(strategyDialog).getAllByText(/Alpha Core/).length).toBeGreaterThan(0);
    expect(within(strategyDialog).getAllByText(/Beta Carry/).length).toBeGreaterThan(0);
    expect(within(strategyDialog).getAllByText(/Gamma Momentum/).length).toBeGreaterThan(0);
    expect(within(strategyDialog).getAllByText(/Delta Income/).length).toBeGreaterThan(0);
    expect(within(strategyDialog).queryByText(/strat-gamma-v3/)).not.toBeInTheDocument();
  });

  it('updates the validation summary chart and metrics when choosing another strategy candidate', async () => {
    const alpha = makeStrategyFixture('strat-alpha-chart', 'Alpha Chart', 1);
    const beta = makeStrategyFixture('strat-beta-chart', 'Beta Chart', 1);
    fakeApi.listStrategies = vi.fn().mockResolvedValue([alpha, beta]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      makeRunFixture(alpha, '2026-04-21T02:00:00Z', {
        total_return: 0.08,
        annualized_return: 0.05,
        sharpe: 0.71,
        max_drawdown: -0.04,
      }),
      makeRunFixture(beta, '2026-04-21T01:00:00Z', {
        total_return: 0.32,
        annualized_return: 0.18,
        sharpe: 1.41,
        max_drawdown: -0.12,
      }),
    ]);

    render(<LegInventoryPage />);

    expect(await screen.findByText('10Y 国债久期腿')).toBeInTheDocument();
    const menuToggle = document.querySelector('.leg-inventory-split__toggle') as HTMLButtonElement | null;
    expect(menuToggle).not.toBeNull();
    fireEvent.click(menuToggle as HTMLButtonElement);
    fireEvent.click(screen.getAllByRole('menuitem')[0]);

    const strategyDialog = await screen.findByRole('dialog');
    const strategyLine = strategyDialog.querySelector('polyline[data-series="strategy"]');
    expect(strategyLine).not.toBeNull();
    const firstPoints = strategyLine?.getAttribute('points');
    expect(within(strategyDialog).getByText('+5.0%')).toBeInTheDocument();
    expect(within(strategyDialog).getByText('0.71')).toBeInTheDocument();

    fireEvent.click(within(strategyDialog).getByText(/Beta Chart/));

    await waitFor(() => {
      expect(strategyLine?.getAttribute('points')).not.toBe(firstPoints);
    });
    expect(within(strategyDialog).getByText('+18.0%')).toBeInTheDocument();
    expect(within(strategyDialog).getByText('1.41')).toBeInTheDocument();
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
    expect(css.slice(css.indexOf('.leg-inventory-row__actions {'), css.indexOf('.leg-inventory-row__actions {') + 180)).toContain(
      'grid-template-columns: repeat(2, 88px)',
    );
    expect(css.slice(css.indexOf('.leg-inventory-row__actions .ghost-button {'), css.indexOf('.leg-inventory-row__actions .ghost-button {') + 180)).toContain(
      'width: 88px',
    );
  });

  it('creates an asset leg from the drawer using the landed API contract', async () => {
    fakeApi.getLegInventory = vi
      .fn()
      .mockResolvedValueOnce(inventory)
      .mockResolvedValueOnce({
        ...inventory,
        counts: { ...inventory.counts, all: 3, asset: 2 },
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
        counts: { ...inventory.counts, all: 3, cash: 2 },
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
