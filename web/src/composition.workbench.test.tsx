import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompositionWorkbenchPage } from './pages/composition-workbench-page';
import { AppRouteProvider } from './lib/appRouteContext';
import type {
  ApiCompositionDetail,
  ApiCompositionPreview,
  ApiLegInventory,
} from './types';

type FakeApi = {
  getLegInventory?: ReturnType<typeof vi.fn>;
  previewComposition?: ReturnType<typeof vi.fn>;
  createComposition?: ReturnType<typeof vi.fn>;
  updateComposition?: ReturnType<typeof vi.fn>;
  getCompositionDetail?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getLegInventory: vi.fn(),
  previewComposition: vi.fn(),
  createComposition: vi.fn(),
  updateComposition: vi.fn(),
  getCompositionDetail: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const inventory: ApiLegInventory = {
  counts: { all: 3, strategy: 1, asset: 1, cash: 1 },
  filters: {
    statuses: [
      { value: 'READY', label: 'Ready', count: 2 },
      { value: 'ACTIVE', label: 'Active', count: 1 },
    ],
    attribute_tags: [
      { value: 'low_correlation', label: '低相关', count: 1 },
      { value: 'snapshot:bond_fixed_income', label: '债券快照', count: 1 },
      { value: 'strategy', label: '策略', count: 1 },
    ],
  },
  rows: [
    {
      id: 'strategy_leg::strat-001::pv-003',
      leg_type: 'strategy',
      name: '质量动量策略腿',
      version_label: 'v3',
      proof_label: '回测证明 bt-101',
      reference_count: 2,
      reference_summary: '已被 2 个组合引用',
      status: 'READY',
      status_label: '稳定',
      has_new_version: false,
      is_orphan: false,
      attribute_tags: ['strategy', 'low_correlation'],
      allowed_actions: ['open_strategy_detail', 'open_composition_workbench'],
      source_ref_id: 'strategy_leg::strat-001::pv-003',
      source_ref_type: 'strategy_projection',
      config: {
        strategy_id: 'strat-001',
        parameter_version_id: 'pv-003',
      },
    },
    {
      id: 'asset-leg-001',
      leg_type: 'asset',
      name: '美国国债 10Y',
      version_label: 'IEF',
      proof_label: 'bond-fixed-income',
      reference_count: 1,
      reference_summary: '已被 1 个组合引用',
      status: 'ACTIVE',
      status_label: '稳定',
      has_new_version: false,
      is_orphan: false,
      attribute_tags: ['snapshot:bond_fixed_income'],
      allowed_actions: ['open_composition_workbench'],
      source_ref_id: 'asset-leg-001',
      source_ref_type: 'asset_definition',
      config: {
        asset_kind: 'BOND',
      },
    },
    {
      id: 'cash-leg-001',
      leg_type: 'cash',
      name: '现金缓冲',
      version_label: 'TARGET_BUFFER',
      proof_label: 'phase1_cash_proxy',
      reference_count: 1,
      reference_summary: '已被 1 个组合引用',
      status: 'ACTIVE',
      status_label: '稳定',
      has_new_version: false,
      is_orphan: false,
      attribute_tags: ['cash'],
      allowed_actions: ['open_composition_workbench'],
      source_ref_id: 'cash-leg-001',
      source_ref_type: 'cash_definition',
      config: {
        buffer_bps: 35,
      },
    },
  ],
};

const preview: ApiCompositionPreview = {
  weight_summary: {
    total_weight_pct: 100,
    target_weight_pct: 100,
    residual_weight_pct: 0,
    locked_weight_pct: 0,
    unlocked_weight_pct: 100,
    within_tolerance: true,
  },
  normalized_legs: [
    {
      id: 'strategy_leg::strat-001::pv-003',
      leg_kind: 'strategy',
      source_ref_id: 'strategy_leg::strat-001::pv-003',
      source_ref_type: 'strategy_projection',
      display_name: '质量动量策略腿',
      weight_pct: 50,
      weight_locked: false,
      ordering: 0,
      version_label: 'v3',
      proof_label: '回测证明 bt-101',
      status: 'READY',
      status_label: '稳定',
      attribute_tags: ['strategy', 'low_correlation'],
      reference_summary: '已被 2 个组合引用',
      config: {},
      allowed_actions: ['open_strategy_detail'],
    },
    {
      id: 'asset-leg-001',
      leg_kind: 'asset',
      source_ref_id: 'asset-leg-001',
      source_ref_type: 'asset_definition',
      display_name: '美国国债 10Y',
      weight_pct: 50,
      weight_locked: false,
      ordering: 1,
      version_label: 'IEF',
      proof_label: 'bond-fixed-income',
      status: 'ACTIVE',
      status_label: '稳定',
      attribute_tags: ['snapshot:bond_fixed_income'],
      reference_summary: '已被 1 个组合引用',
      config: {},
      allowed_actions: ['open_composition_workbench'],
    },
  ],
  returns_preview: [
    { label: '2026-01', cumulative_return_pct: 0, portfolio_return_pct: 0 },
    { label: '2026-02', cumulative_return_pct: 0.02, portfolio_return_pct: 0.02 },
    { label: '2026-03', cumulative_return_pct: 0.038, portfolio_return_pct: 0.018 },
    { label: '2026-04', cumulative_return_pct: 0.051, portfolio_return_pct: 0.013 },
  ],
  benchmark_series: [
    { label: '2026-01', cumulative_return_pct: 0, benchmark_return_pct: 0 },
    { label: '2026-02', cumulative_return_pct: 0.011, benchmark_return_pct: 0.011 },
    { label: '2026-03', cumulative_return_pct: 0.023, benchmark_return_pct: 0.012 },
    { label: '2026-04', cumulative_return_pct: 0.031, benchmark_return_pct: 0.008 },
  ],
  spread_series: [
    { label: '2026-01', spread_pct: 0 },
    { label: '2026-02', spread_pct: 0.009 },
    { label: '2026-03', spread_pct: 0.015 },
    { label: '2026-04', spread_pct: 0.02 },
  ],
  correlation_matrix: [
    { x_key: 'strategy_leg::strat-001::pv-003', y_key: 'strategy_leg::strat-001::pv-003', correlation: 1 },
    { x_key: 'strategy_leg::strat-001::pv-003', y_key: 'asset-leg-001', correlation: 0.22 },
    { x_key: 'asset-leg-001', y_key: 'strategy_leg::strat-001::pv-003', correlation: 0.22 },
    { x_key: 'asset-leg-001', y_key: 'asset-leg-001', correlation: 1 },
  ],
  risk_contribution_preview: [
    {
      leg_id: 'strategy_leg::strat-001::pv-003',
      label: '质量动量策略腿',
      weight_pct: 50,
      volatility_pct: 15,
      contribution_pct: 57,
    },
    {
      leg_id: 'asset-leg-001',
      label: '美国国债 10Y',
      weight_pct: 50,
      volatility_pct: 8,
      contribution_pct: 43,
    },
  ],
  maintenance_cost_summary: {
    expense_ratio_bps: 18,
    turnover_budget_bps: 12,
    trade_cost_bps: 8,
    total_estimated_bps: 38,
    notes: ['季度调仓预计增加 12 bps 成本。'],
  },
  rebalance_summary: {
    rebalance_frequency: 'quarterly',
    cadence_label: '季度再平衡',
    checks_per_year: 4,
    operating_tempo_label: '每季度复核一次结构与来源',
  },
  composition_score: {
    score: 82,
    verdict: '结构成立',
    factors: [
      { key: 'diversification', label: '分散度', score: 84, detail: '策略腿与债券腿保持低相关。', tone: 'positive' },
      { key: 'evidence', label: '来源可信度', score: 88, detail: '主要来源均已冻结快照。', tone: 'positive' },
    ],
  },
  warnings: [],
  advisories: ['建议在正式保存前补齐现金腿。'],
};

const existingComposition: ApiCompositionDetail = {
  id: 'comp-001',
  name: '全天候研究组合',
  description: '以策略腿和债券腿构建均衡风险暴露。',
  status: 'ACTIVE',
  status_label: '运行稳定',
  created_at: '2026-04-21T00:00:00.000Z',
  updated_at: '2026-04-22T00:00:00.000Z',
  benchmark_definition: { label: '60/40 参考组合', symbol: '60/40', source: 'phase1_compose' },
  rebalance_frequency: 'quarterly',
  cost_policy: {
    expense_ratio_bps: 18,
    turnover_budget_bps: 12,
    trade_cost_bps: 8,
    notes: '季度维护口径',
  },
  hero_summary: {
    title: '全天候研究组合',
    subtitle: '正式组合',
    status: 'ACTIVE',
    status_label: '运行稳定',
    benchmark_label: '60/40 参考组合',
    leg_count: 2,
    composition_score: 82,
    updated_at: '2026-04-22T00:00:00.000Z',
  },
  kpis: [],
  weight_summary: preview.weight_summary,
  normalized_legs: preview.normalized_legs,
  returns_preview: preview.returns_preview,
  benchmark_series: preview.benchmark_series,
  spread_series: preview.spread_series,
  rebalance_markers: [],
  correlation_matrix: preview.correlation_matrix,
  risk_contribution_preview: preview.risk_contribution_preview,
  maintenance_cost_summary: preview.maintenance_cost_summary,
  scenario_summary: {
    base_case: { label: '基准场景', expected_drawdown_pct: -7.2 },
    stress_case: { label: '2022 加息冲击', expected_drawdown_pct: -11.4 },
  },
  source_evidence: [],
  composition_score: preview.composition_score,
  latest_activity_label: '2026-04-22 更新',
  deep_link_actions: ['open_composition_workbench'],
};

beforeEach(() => {
  fakeApi.getLegInventory = vi.fn().mockResolvedValue(inventory);
  fakeApi.previewComposition = vi.fn().mockResolvedValue(preview);
  fakeApi.createComposition = vi.fn().mockResolvedValue({
    ...existingComposition,
    id: 'comp-new',
    name: '全天候研究组合',
  });
  fakeApi.updateComposition = vi.fn().mockResolvedValue(existingComposition);
  fakeApi.getCompositionDetail = vi.fn().mockResolvedValue(existingComposition);
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.location.hash = '';
});

describe('composition workbench page', () => {
  it('loads the workbench, applies add-leg query, and saves a new composition', async () => {
    window.location.hash = '#/compositions/workbench?add_leg=asset-leg-001';

    await act(async () => {
      render(
        <AppRouteProvider
          navigate={(path) => {
            window.location.hash = path;
          }}
          route={{ kind: 'composition-workbench', addLeg: 'asset-leg-001' }}
        >
          <CompositionWorkbenchPage />
        </AppRouteProvider>,
      );
    });

    expect(await screen.findByRole('heading', { level: 1, name: '组合工作台' })).toBeInTheDocument();
    expect(
      document.querySelector('.composition-workbench-page[data-route-root="compositions"][data-page-root="composition-workbench"]'),
    ).not.toBeNull();

    expect((await screen.findAllByText('美国国债 10Y')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('组合名称'), { target: { value: '全天候研究组合' } });
    fireEvent.click(screen.getByRole('button', { name: '保存组合' }));

    await waitFor(() => expect(fakeApi.createComposition).toHaveBeenCalledTimes(1));
    expect(fakeApi.createComposition).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '全天候研究组合',
        status: 'ACTIVE',
      }),
    );
    await waitFor(() => expect(window.location.hash).toBe('#/compositions/comp-new'));
  });

  it('loads an existing composition and persists updates through the update contract', async () => {
    window.location.hash = '#/compositions/workbench?composition_id=comp-001';

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench', compositionId: 'comp-001' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    expect(await screen.findByDisplayValue('全天候研究组合')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('组合描述'), {
      target: { value: '更新后的说明' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(fakeApi.updateComposition).toHaveBeenCalledTimes(1));
    expect(fakeApi.updateComposition).toHaveBeenCalledWith(
      'comp-001',
      expect.objectContaining({
        description: '更新后的说明',
        status: 'DRAFT',
      }),
    );
  });
});
