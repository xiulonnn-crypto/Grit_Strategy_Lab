import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompositionWorkbenchPage } from './pages/composition-workbench-page';
import { AppRouteProvider } from './lib/appRouteContext';
import {
  SAVED_STRATEGY_LEG_EDIT_STORAGE_KEY,
  SAVED_STRATEGY_LEG_STORAGE_KEY,
} from './lib/saved-strategy-leg-inventory';
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
  listStrategies?: ReturnType<typeof vi.fn>;
  listBacktestRuns?: ReturnType<typeof vi.fn>;
};

function getWorkbenchCss(): string {
  return readFileSync('src/components/composition-workbench/composition-workbench.css', 'utf8');
}

function getCssBlock(css: string, selector: string): string {
  const selectorStart = `${selector} {`;
  let start = css.indexOf(`\n${selectorStart}`);
  if (start >= 0) {
    start += 1;
  } else if (css.startsWith(selectorStart)) {
    start = 0;
  }
  if (start < 0) {
    throw new Error(`Missing CSS selector: ${selector}`);
  }
  const end = css.indexOf('\n}', start);
  if (end < 0) {
    throw new Error(`Unclosed CSS selector: ${selector}`);
  }
  return css.slice(start, end + 2).replace(/\s+/g, ' ');
}

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getLegInventory: vi.fn(),
  previewComposition: vi.fn(),
  createComposition: vi.fn(),
  updateComposition: vi.fn(),
  getCompositionDetail: vi.fn(),
  listStrategies: vi.fn(),
  listBacktestRuns: vi.fn(),
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
        strategy_type: 'MOMENTUM',
        annualized_return_pct: 12,
        max_drawdown_pct: 8,
        oos_sharpe: 1.12,
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
        summary: {
          ytm_pct: 4.32,
          duration_years: 8.4,
          volatility_pct: 7.8,
        },
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
        cash_rule_kind: 'TARGET_BUFFER',
        yield_source: 'phase1_cash_proxy',
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
  return_quality_summary: {
    status: 'verified',
    alignment_window_start: '2026-01-31',
    alignment_window_end: '2026-04-30',
    aligned_points: 4,
    missing_points: 0,
    coverage_pct: 100,
    fallback_used: false,
    notes: ['收益流已对齐。'],
  },
  rebalance_events: [
    {
      label: 'Q1 rebalance',
      date: '2026-03-31',
      index: 2,
      turnover_pct: 6.5,
      estimated_cost_bps: 2.4,
      cost_drag_pct: 0.02,
      cash_buffer_pct: 25,
      weight_before: { 'strategy_leg::strat-001::pv-003': 52, 'asset-leg-001': 48 },
      weight_after: { 'strategy_leg::strat-001::pv-003': 50, 'asset-leg-001': 50 },
      notes: ['季度调仓。'],
    },
  ],
  source_integrity: [
    {
      leg_id: 'strategy_leg::strat-001::pv-003',
      display_name: '趋势突破策略腿',
      source_ref_id: 'strategy_leg::strat-001::pv-003',
      freeze_hash: 'hash-strategy-preview',
      signature_status: 'verified',
      drift_status: 'current',
      current_ref_id: 'strategy_leg::strat-001::pv-003',
      alerts: [],
    },
  ],
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

describe('composition workbench page', () => {
  it('locks the approved source scroll and save dock CSS geometry contract', () => {
    const css = getWorkbenchCss();
    const sourcePanel = getCssBlock(css, '.composition-workbench-source-panel');
    const sourceScroll = getCssBlock(css, '.composition-workbench-source-scroll--four-cards');
    const sourceCard = getCssBlock(css, '.composition-workbench-source-card');
    const addedSourceCard = getCssBlock(css, '.composition-workbench-source-card.is-added');
    const addedSourceButton = getCssBlock(css, '.composition-workbench-add-button.is-added');
    const saveDockOrder = getCssBlock(css, '.composition-workbench-summary-rail > .composition-workbench-save-dock');
    const saveDock = getCssBlock(css, '.composition-workbench-save-dock');
    const saveDockModuleBottom = getCssBlock(css, '.composition-workbench-save-dock--module-bottom');

    expect(sourcePanel).toContain('--composition-source-card-height: 176px;');
    expect(sourcePanel).toContain('--composition-source-card-gap: 8px;');
    expect(sourcePanel).toContain('grid-template-rows: auto auto auto auto;');
    expect(sourceScroll).toContain(
      'height: calc((var(--composition-source-card-height) * 4) + (var(--composition-source-card-gap) * 3));',
    );
    expect(sourceScroll).toContain(
      'max-height: calc((var(--composition-source-card-height) * 4) + (var(--composition-source-card-gap) * 3));',
    );
    expect(sourceCard).toContain('min-height: var(--composition-source-card-height);');
    expect(sourceCard).toContain('gap: 6px;');
    expect(sourceCard).toContain('padding: 10px 12px;');
    expect(addedSourceCard).toContain('background: #f8f9fa;');
    expect(addedSourceButton).toContain('color: #6a7280;');

    expect(saveDockOrder).toContain('order: 20;');
    expect(saveDock).toContain('position: sticky;');
    expect(saveDock).toContain('bottom: 18px;');
    expect(saveDock).toContain('margin-top: auto;');
    expect(saveDockModuleBottom).toContain('align-self: end;');
  });

  it('hydrates the bare workbench with a compose-first starter draft', async () => {
    window.location.hash = '#/compositions/workbench';

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: '组合工作台' })).toBeInTheDocument();

    await waitFor(() => expect(fakeApi.previewComposition).toHaveBeenCalledTimes(1));
    expect(fakeApi.previewComposition).toHaveBeenCalledWith(
      expect.objectContaining({
        legs: [
          expect.objectContaining({
            leg_kind: 'strategy',
            source_ref_id: 'strategy_leg::strat-001::pv-003',
            weight_pct: 40,
          }),
          expect.objectContaining({
            leg_kind: 'asset',
            source_ref_id: 'asset-leg-001',
            weight_pct: 35,
          }),
          expect.objectContaining({
            leg_kind: 'cash',
            source_ref_id: 'cash-leg-001',
            weight_pct: 25,
          }),
        ],
      }),
    );
    expect(await screen.findByText('来源 3 / 3 可用')).toBeInTheDocument();
  });

  it('renders the approved score radar and return preview drawdown affordances', async () => {
    window.location.hash = '#/compositions/workbench';
    fakeApi.previewComposition = vi.fn().mockResolvedValue({
      ...preview,
      returns_preview: [
        { label: '2026-01', cumulative_return_pct: 0, portfolio_return_pct: 0 },
        { label: '2026-02', cumulative_return_pct: 0.04, portfolio_return_pct: 0.04 },
        { label: '2026-03', cumulative_return_pct: 0.018, portfolio_return_pct: -0.022 },
        { label: '2026-04', cumulative_return_pct: 0.055, portfolio_return_pct: 0.037 },
      ],
      normalized_legs: [
        ...preview.normalized_legs,
        {
          id: 'cash-leg-001',
          leg_kind: 'cash',
          source_ref_id: 'cash-leg-001',
          source_ref_type: 'cash_definition',
          display_name: '现金缓冲',
          weight_pct: 25,
          weight_locked: false,
          ordering: 2,
          version_label: 'TARGET_BUFFER',
          proof_label: 'phase1_cash_proxy',
          status: 'ACTIVE',
          status_label: '稳定',
          attribute_tags: ['cash'],
          reference_summary: '已被 1 个组合引用',
          config: {},
          allowed_actions: ['open_composition_workbench'],
        },
      ],
      correlation_matrix: [
        { x_key: 'strategy_leg::strat-001::pv-003', y_key: 'strategy_leg::strat-001::pv-003', correlation: 1 },
        { x_key: 'strategy_leg::strat-001::pv-003', y_key: 'asset-leg-001', correlation: 0.74 },
        { x_key: 'strategy_leg::strat-001::pv-003', y_key: 'cash-leg-001', correlation: -0.08 },
        { x_key: 'asset-leg-001', y_key: 'strategy_leg::strat-001::pv-003', correlation: 0.74 },
        { x_key: 'asset-leg-001', y_key: 'asset-leg-001', correlation: 1 },
        { x_key: 'asset-leg-001', y_key: 'cash-leg-001', correlation: 0.22 },
        { x_key: 'cash-leg-001', y_key: 'strategy_leg::strat-001::pv-003', correlation: -0.08 },
        { x_key: 'cash-leg-001', y_key: 'asset-leg-001', correlation: 0.22 },
        { x_key: 'cash-leg-001', y_key: 'cash-leg-001', correlation: 1 },
      ],
    });

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    expect(await screen.findByText('评分拆解')).toBeInTheDocument();
    expect(document.querySelector('.composition-workbench-score-card')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-score-ring')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-radar-card')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-source-panel')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-source-scroll')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-source-scroll--four-cards')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-rebalance-card')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-rebalance-options')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-summary-lines')).not.toBeNull();
    await waitFor(() => {
      expect(document.querySelector('[data-ui="return-quality-summary"]')).not.toBeNull();
      expect(document.querySelector('[data-ui="net-return-breakdown"]')).not.toBeNull();
      expect(document.querySelector('[data-ui="rebalance-events-preview"]')).not.toBeNull();
      expect(document.querySelector('[data-ui="source-integrity"]')).not.toBeNull();
    });
    expect(document.querySelector('.composition-workbench-trust-panel')).toBeNull();
    expect(document.querySelector('.composition-workbench-rebalance-events')).toBeNull();
    expect(document.querySelector('.composition-workbench-source-integrity')).toBeNull();
    expect(document.querySelector('[data-ui="return-quality-summary"]')?.textContent).toContain('100%');
    expect(document.querySelector('[aria-label="收益流说明"]')).toHaveAttribute('data-tooltip', expect.stringContaining('收益序列'));
    expect(document.querySelector('[aria-label="协方差矩阵说明"]')).toHaveAttribute('data-tooltip', expect.stringContaining('风险贡献'));
    expect(document.querySelector('[aria-label="调仓事件说明"]')).toHaveAttribute('data-tooltip', expect.stringContaining('权重调整点'));
    expect(document.querySelector('[aria-label="收益质量说明"]')).toHaveAttribute('data-tooltip', expect.stringContaining('时间窗口'));
    expect(document.querySelector('[aria-label="净收益预估说明"]')).toHaveAttribute('data-tooltip', expect.stringContaining('现金缓冲'));
    expect(document.querySelector('[aria-label="来源签名说明"]')).toHaveAttribute('data-tooltip', expect.stringContaining('冻结哈希'));
    expect(document.querySelector('[aria-label="净收益拆解说明"]')).toHaveAttribute('data-tooltip', expect.stringContaining('毛收益'));
    expect(screen.getByText(/换手 6.5%/)).toBeInTheDocument();
    expect(document.querySelectorAll('.composition-workbench-summary-line').length).toBeGreaterThanOrEqual(4);
    expect(document.querySelector('.composition-workbench-warning-list')).not.toBeNull();
    expect(document.querySelectorAll('.composition-workbench-warning-item').length).toBe(2);
    expect(document.querySelector('.composition-workbench-warning-list')?.textContent).not.toContain('来源可信度');
    expect(document.querySelector('.composition-workbench-warning-list')?.textContent).not.toContain('当前预计维护成本');
    expect(screen.getByText('来源签名')).toBeInTheDocument();
    expect(screen.getByText('维护判断')).toBeInTheDocument();
    expect(document.querySelector('.composition-workbench-allocation-legend')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-structure-summary')).toBeNull();
    expect(document.querySelector('.composition-workbench-score-card__chips')?.textContent).not.toContain('相关性提醒');
    expect(document.querySelector('.composition-workbench-hero__chips--tight')?.textContent).not.toContain('相关性提醒');
    await waitFor(() => expect(document.querySelector('.composition-workbench-correlation-cell--self')).not.toBeNull());
    expect(document.querySelector('.composition-workbench-correlation-cell--hot')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-correlation-cell--negative')).not.toBeNull();
    expect(await screen.findByText('3 个月')).toBeInTheDocument();
    expect(screen.getByText('12 个月')).toBeInTheDocument();
    expect(screen.getByText('24 个月')).toBeInTheDocument();
    expect(screen.getByText('回撤阴影')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.composition-workbench-drawdown-area')).not.toBeNull());
    expect(document.querySelector('.composition-workbench-save-dock--module-bottom')).not.toBeNull();
  });

  it('removes the purple referenced and locked pills while keeping plain lock state copy', async () => {
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

    await screen.findByText('锁定权重');
    expect(screen.queryByText('已被引用')).not.toBeInTheDocument();
    expect(screen.queryByText('已锁定')).not.toBeInTheDocument();
  });

  it('renders cash source cards with the approved title-feature-intro-tag structure', async () => {
    window.location.hash = '#/compositions/workbench?add_leg=cash-leg-001';
    fakeApi.getLegInventory = vi.fn().mockResolvedValue({
      ...inventory,
      rows: inventory.rows.map((row) =>
        row.id === 'cash-leg-001'
          ? {
              ...row,
              name: 'Phase 1.1 Live Smoke Cash Leg',
              version_label: 'TARGET_BUFFER',
              proof_label: 'phase1_live_smoke_cash',
              attribute_tags: ['cash', 'target_buffer', 'freeze:manual', 'yield:phase1_live_smoke_cash', 'notes'],
              config: {
                cash_rule_kind: 'TARGET_BUFFER',
                buffer_bps: 25,
                freeze_mode: 'manual',
              },
            }
          : row,
      ),
    });

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench', addLeg: 'cash-leg-001' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    const title = await screen.findByText('现金缓冲规则');
    const card = title.closest('.composition-workbench-source-card') as HTMLElement | null;

    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('季度规则')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('维护缓冲中')).toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByText(
        /^现金缓冲中 \d+(?:\.\d+)?% · 用于再平衡成本吸收和换手控制。当前在组合中作为维护安全垫。$/,
      ),
    ).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('来源规则：目标缓冲')).toBeInTheDocument();
    expect(within(card as HTMLElement).queryByText('成本吸收')).not.toBeInTheDocument();
    expect(within(card as HTMLElement).queryByText('季度组合约束')).not.toBeInTheDocument();
    expect(within(card as HTMLElement).queryByText('Phase 1 线上烟测现金')).not.toBeInTheDocument();

    const childStructure = Array.from(card?.children ?? []).map((child) =>
      child.tagName === 'P' ? 'P' : child.className,
    );
    expect(childStructure[0]).toContain('composition-workbench-source-card__top');
    expect(childStructure[1]).toContain('composition-workbench-source-card__chips');
    expect(childStructure[2]).toBe('P');
    expect(childStructure[3]).toContain('composition-workbench-source-card__tags');
  });

  it('renders source library metric tags instead of raw inventory attributes', async () => {
    window.location.hash = '#/compositions/workbench';
    fakeApi.getLegInventory = vi.fn().mockResolvedValue({
      ...inventory,
      rows: inventory.rows.map((row) =>
        row.leg_type === 'strategy'
          ? {
              ...row,
              attribute_tags: ['strategy', 'momentum', 'universe:标普500成分股'],
            }
          : row,
      ),
    });

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    expect(await screen.findByText('类型：动量')).toBeInTheDocument();
    expect(screen.getByText('年化收益 12.0%')).toBeInTheDocument();
    expect(screen.getByText('最大回撤 8.0%')).toBeInTheDocument();
    expect(screen.getByText('夏普 1.12')).toBeInTheDocument();
    expect(screen.getByText('类型：债券')).toBeInTheDocument();
    expect(screen.getByText('YTM 4.32%')).toBeInTheDocument();
    expect(screen.getByText('久期 8.4年')).toBeInTheDocument();
    expect(screen.getByText('波动 7.8%')).toBeInTheDocument();
    expect(screen.getByText('来源规则：目标缓冲 / phase1_cash_proxy')).toBeInTheDocument();
    expect(screen.queryByText('universe:标普500成分股')).not.toBeInTheDocument();
  });

  it('uses one shared return axis for portfolio and benchmark lines', async () => {
    window.location.hash = '#/compositions/workbench';
    fakeApi.previewComposition = vi.fn().mockResolvedValue({
      ...preview,
      returns_preview: [
        { label: '2026-01', cumulative_return_pct: 0, portfolio_return_pct: 0 },
        { label: '2026-02', cumulative_return_pct: 10, portfolio_return_pct: 10 },
        { label: '2026-03', cumulative_return_pct: 20, portfolio_return_pct: 10 },
      ],
      benchmark_series: [
        { label: '2026-01', cumulative_return_pct: 0, benchmark_return_pct: 0 },
        { label: '2026-02', cumulative_return_pct: 1, benchmark_return_pct: 1 },
        { label: '2026-03', cumulative_return_pct: 2, benchmark_return_pct: 1 },
      ],
    });

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    await waitFor(() => expect(document.querySelector('.composition-workbench-returns-path')).not.toBeNull());
    const returnsPath = document.querySelector('.composition-workbench-returns-path')?.getAttribute('d') ?? '';
    const benchmarkPath = document.querySelector('.composition-workbench-benchmark-path')?.getAttribute('d') ?? '';
    const returnsSegments = returnsPath.trim().split(/\s+/);
    const benchmarkSegments = benchmarkPath.trim().split(/\s+/);
    const returnsLastY = Number(returnsSegments[returnsSegments.length - 1]);
    const benchmarkLastY = Number(benchmarkSegments[benchmarkSegments.length - 1]);

    expect(Number.isFinite(returnsLastY)).toBe(true);
    expect(Number.isFinite(benchmarkLastY)).toBe(true);
    expect(benchmarkLastY).toBeGreaterThan(returnsLastY);
  });

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
    expect(screen.getAllByRole('button', { name: '已加入' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('当前选中')).not.toBeInTheDocument();
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
    expect(await screen.findByText('来源 2 / 3 可用')).toBeInTheDocument();
    expect(screen.getByText('待保存')).toBeInTheDocument();
    expect(screen.queryByText('编辑组合 comp-001')).not.toBeInTheDocument();
    expect(screen.queryByText('主动推荐')).not.toBeInTheDocument();
    expect(screen.queryByText('常用标签')).not.toBeInTheDocument();

    const summaryRail = document.querySelector('.composition-workbench-summary-rail');
    const railConfigFields = Array.from(summaryRail?.children ?? []).filter((element) =>
      element.classList.contains('composition-workbench-config-field'),
    );
    expect(railConfigFields).toHaveLength(0);
    expect(document.querySelector('.composition-workbench-config-panel')).not.toBeNull();

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

  it('hydrates only saved strategy legs into the workbench source library', async () => {
    window.location.hash = '#/compositions/workbench';
    fakeApi.getLegInventory = vi.fn().mockResolvedValue({
      counts: { all: 2, strategy: 0, asset: 1, cash: 1 },
      filters: {
        statuses: [{ value: 'ACTIVE', label: 'Active', count: 2 }],
        attribute_tags: [],
      },
      rows: inventory.rows.filter((row) => row.leg_type !== 'strategy'),
    });
    window.localStorage.setItem(
      SAVED_STRATEGY_LEG_STORAGE_KEY,
      JSON.stringify(['strategy_leg::strat-saved::pv-010']),
    );
    window.localStorage.setItem(
      SAVED_STRATEGY_LEG_EDIT_STORAGE_KEY,
      JSON.stringify({
        'strategy_leg::strat-saved::pv-010': {
          name: '已保存策略腿',
          freeze_mode: 'snapshot_locked',
          notes: 'saved from leg inventory',
          summary: {},
        },
      }),
    );
    fakeApi.listStrategies = vi.fn().mockResolvedValue([
      {
        id: 'strat-saved',
        name: '已保存策略来源',
        strategy_type: 'MEAN_REVERSION',
        universe_name: 'US Equity',
        rebalance_frequency: 'quarterly',
        current_parameter_version: 10,
        current_parameter_version_id: 'pv-010',
        benchmark_symbol: 'SPY',
      },
      {
        id: 'strat-unsaved',
        name: '未保存策略来源',
        strategy_type: 'MOMENTUM',
        universe_name: 'US Equity',
        rebalance_frequency: 'monthly',
        current_parameter_version: 5,
        current_parameter_version_id: 'pv-005',
        benchmark_symbol: 'QQQ',
      },
    ]);
    fakeApi.listBacktestRuns = vi.fn().mockResolvedValue([
      {
        id: 'bt-saved-010',
        strategy_id: 'strat-saved',
        strategy_name: '已保存策略来源',
        status: 'COMPLETED',
        parameter_version_id: 'pv-010',
        completed_at: '2026-04-23T00:00:00.000Z',
        metrics: {
          annualized_return: 0.12,
          max_drawdown: -0.08,
          oos_sharpe: 1.12,
        },
      },
      {
        id: 'bt-unsaved-005',
        strategy_id: 'strat-unsaved',
        strategy_name: '未保存策略来源',
        status: 'COMPLETED',
        parameter_version_id: 'pv-005',
        completed_at: '2026-04-22T00:00:00.000Z',
        metrics: {
          annualized_return: 0.09,
          max_drawdown: -0.06,
          oos_sharpe: 0.92,
        },
      },
    ]);

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    expect(await screen.findByText('已保存策略腿')).toBeInTheDocument();
    expect(screen.queryByText('未保存策略来源')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fakeApi.previewComposition).toHaveBeenCalledWith(
        expect.objectContaining({
          legs: expect.arrayContaining([
            expect.objectContaining({
              leg_kind: 'strategy',
              source_ref_id: 'strategy_leg::strat-saved::pv-010',
            }),
          ]),
        }),
      ),
    );
  });

  it('does not render fabricated score breakdown values before legs are selected', async () => {
    window.location.hash = '#/compositions/workbench';
    fakeApi.getLegInventory = vi.fn().mockResolvedValue({
      counts: { all: 0, strategy: 0, asset: 0, cash: 0 },
      filters: { statuses: [], attribute_tags: [] },
      rows: [],
    });

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    expect(await screen.findByText('加入至少一条腿后生成评分拆解。')).toBeInTheDocument();
    expect(document.querySelector('.composition-workbench-radar-card')).toBeNull();
    expect(fakeApi.previewComposition).not.toHaveBeenCalled();
  });

  it('keeps cash-only monotonic return previews free of drawdown shading', async () => {
    window.location.hash = '#/compositions/workbench';
    fakeApi.getLegInventory = vi.fn().mockResolvedValue({
      counts: { all: 1, strategy: 0, asset: 0, cash: 1 },
      filters: {
        statuses: [{ value: 'ACTIVE', label: 'Active', count: 1 }],
        attribute_tags: [{ value: 'cash', label: 'cash', count: 1 }],
      },
      rows: inventory.rows.filter((row) => row.leg_type === 'cash'),
    });
    fakeApi.previewComposition = vi.fn().mockResolvedValue({
      ...preview,
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
          id: 'cash-leg-001',
          leg_kind: 'cash',
          source_ref_id: 'cash-leg-001',
          source_ref_type: 'cash_definition',
          display_name: '现金缓冲',
          weight_pct: 100,
          weight_locked: false,
          ordering: 0,
          version_label: 'TARGET_BUFFER',
          proof_label: 'phase1_cash_proxy',
          status: 'ACTIVE',
          status_label: '稳定',
          attribute_tags: ['cash'],
          reference_summary: '已被 1 个组合引用',
          config: {},
          allowed_actions: ['open_composition_workbench'],
        },
      ],
      returns_preview: [
        { label: '2026-01', cumulative_return_pct: 0, portfolio_return_pct: 0 },
        { label: '2026-02', cumulative_return_pct: 0.001, portfolio_return_pct: 0.001 },
        { label: '2026-03', cumulative_return_pct: 0.002, portfolio_return_pct: 0.001 },
        { label: '2026-04', cumulative_return_pct: 0.003, portfolio_return_pct: 0.001 },
      ],
    });

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    expect(await screen.findByText('当前收益路径暂无显著回撤阴影')).toBeInTheDocument();
    await waitFor(() => expect(fakeApi.previewComposition).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.composition-workbench-drawdown-area')).toBeNull();
  });

  it('links monthly rebalancing to elevated maintenance cost styling', async () => {
    window.location.hash = '#/compositions/workbench';

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    await waitFor(() => expect(fakeApi.previewComposition).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '月度' }));

    await waitFor(() => expect(screen.getAllByText(/维护成本 46 bps/).length).toBeGreaterThan(0));
    expect(document.querySelector('.composition-workbench-score-footnote--danger')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-summary-line--danger')).not.toBeNull();
  });

  it('raises residual weight when the structure is not balanced', async () => {
    window.location.hash = '#/compositions/workbench';
    fakeApi.previewComposition = vi.fn().mockResolvedValue({
      ...preview,
      weight_summary: {
        ...preview.weight_summary,
        total_weight_pct: 91.5,
        residual_weight_pct: 8.5,
        within_tolerance: false,
      },
    });

    render(
      <AppRouteProvider
        navigate={(path) => {
          window.location.hash = path;
        }}
        route={{ kind: 'composition-workbench' }}
      >
        <CompositionWorkbenchPage />
      </AppRouteProvider>,
    );

    expect(await screen.findByText('残余 8.5%')).toBeInTheDocument();
    expect(document.querySelector('.composition-workbench-chip--priority')).not.toBeNull();
    expect(document.querySelector('.composition-workbench-summary-line--danger')).not.toBeNull();
  });
});
