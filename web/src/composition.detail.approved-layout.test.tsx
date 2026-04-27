import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompositionDetailPage } from './pages/composition-detail-page';
import type { ApiCompositionDetail } from './types';

type FakeApi = {
  getCompositionDetail?: ReturnType<typeof vi.fn>;
  updateComposition?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getCompositionDetail: vi.fn(),
  updateComposition: vi.fn(),
}));

function getDetailCss(): string {
  return readFileSync('src/components/composition-detail/composition-detail.css', 'utf8');
}

function getCssBlock(css: string, selector: string): string {
  const selectorStart = `${selector} {`;
  let start = css.indexOf(`\n${selectorStart}`);
  if (start >= 0) {
    start += 1;
  } else if (css.startsWith(selectorStart)) {
    start = 0;
  } else {
    return '';
  }
  const end = css.indexOf('\n}', start);
  if (end < 0) {
    return '';
  }
  return css.slice(start, end + 2).replace(/\s+/g, ' ');
}

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const detail: ApiCompositionDetail = {
  id: 'composition-approved-layout',
  name: 'Momentum Treasury Mix',
  description: 'Live runtime detail should reuse the approved composition detail shells.',
  status: 'ACTIVE',
  status_label: 'Active',
  created_at: '2026-04-20T00:00:00.000Z',
  updated_at: '2026-04-22T00:00:00.000Z',
  benchmark_definition: {
    label: '70/30 Benchmark',
    symbol: 'SPY',
    source: 'phase1_compose',
  },
  rebalance_frequency: 'quarterly',
  cost_policy: {
    expense_ratio_bps: 18,
    turnover_budget_bps: 12,
    trade_cost_bps: 8,
    notes: 'Quarterly rebalance budget',
  },
  hero_summary: {
    title: 'Momentum Treasury Mix',
    subtitle: 'Approved layout runtime check',
    status: 'ACTIVE',
    status_label: 'Active',
    benchmark_label: '70/30 Benchmark',
    leg_count: 3,
    composition_score: 82,
    updated_at: '2026-04-22T00:00:00.000Z',
  },
  kpis: [
    { key: 'annualized_return', label: 'Annualized return', value: '9.8%', tone: 'positive', detail: 'Return lead is intact.' },
    { key: 'max_drawdown', label: 'Max drawdown', value: '-8.6%', tone: 'warning', detail: 'Worst drawdown is contained.' },
    { key: 'volatility', label: 'Volatility', value: '11.4%', tone: 'neutral', detail: 'Volatility remains moderate.' },
    { key: 'cash_weight', label: 'Cash weight', value: '24%', tone: 'neutral', detail: 'Cash buffer is active.' },
    { key: 'sharpe', label: 'Sharpe', value: '1.42', tone: 'positive', detail: 'Risk-adjusted return beats the benchmark.' },
    { key: 'sortino', label: 'Sortino', value: '1.78', tone: 'positive', detail: 'Downside efficiency is stronger.' },
  ],
  weight_summary: {
    total_weight_pct: 100,
    target_weight_pct: 100,
    residual_weight_pct: 0,
    locked_weight_pct: 44,
    unlocked_weight_pct: 56,
    within_tolerance: true,
  },
  normalized_legs: [
    {
      id: 'strategy-leg',
      leg_kind: 'strategy',
      source_ref_id: 'strategy-leg',
      source_ref_type: 'strategy_projection',
      display_name: 'Momentum Strategy',
      weight_pct: 32,
      weight_locked: false,
      ordering: 0,
      version_label: 'v3',
      proof_label: 'run-101',
      status: 'READY',
      status_label: 'Ready',
      attribute_tags: ['strategy'],
      reference_summary: 'Latest completed run',
      config: {},
      allowed_actions: ['open_strategy_detail'],
    },
    {
      id: 'bond-leg',
      leg_kind: 'asset',
      source_ref_id: 'bond-leg',
      source_ref_type: 'asset_definition',
      display_name: 'UST 10Y',
      weight_pct: 44,
      weight_locked: true,
      ordering: 1,
      version_label: 'IEF',
      proof_label: 'bond-snapshot',
      status: 'ACTIVE',
      status_label: 'Active',
      attribute_tags: ['bond'],
      reference_summary: 'Locked snapshot source',
      config: {},
      allowed_actions: ['open_composition_workbench'],
    },
    {
      id: 'cash-leg',
      leg_kind: 'cash',
      source_ref_id: 'cash-leg',
      source_ref_type: 'cash_definition',
      display_name: 'Cash Buffer',
      weight_pct: 24,
      weight_locked: false,
      ordering: 2,
      version_label: 'BOXX',
      proof_label: 'cash-proxy',
      status: 'ACTIVE',
      status_label: 'Active',
      attribute_tags: ['cash'],
      reference_summary: 'Cash safety sleeve',
      config: {},
      allowed_actions: ['open_composition_workbench'],
    },
  ],
  returns_preview: [
    { label: '2026-01', date: '2026-01-31', cumulative_return_pct: 0, portfolio_return_pct: 0 },
    { label: '2026-02', date: '2026-02-28', cumulative_return_pct: 1.8, portfolio_return_pct: 1.8 },
    { label: '2026-03', date: '2026-03-31', cumulative_return_pct: 3.1, portfolio_return_pct: 1.3 },
    { label: '2026-04', date: '2026-04-30', cumulative_return_pct: 5.2, portfolio_return_pct: 2.1 },
  ],
  benchmark_series: [
    { label: '2026-01', date: '2026-01-31', cumulative_return_pct: 0, benchmark_return_pct: 0 },
    { label: '2026-02', date: '2026-02-28', cumulative_return_pct: 1.1, benchmark_return_pct: 1.1 },
    { label: '2026-03', date: '2026-03-31', cumulative_return_pct: 1.9, benchmark_return_pct: 0.8 },
    { label: '2026-04', date: '2026-04-30', cumulative_return_pct: 3.1, benchmark_return_pct: 1.2 },
  ],
  spread_series: [
    { label: '2026-01', date: '2026-01-31', spread_pct: 0 },
    { label: '2026-02', date: '2026-02-28', spread_pct: 0.7 },
    { label: '2026-03', date: '2026-03-31', spread_pct: 1.2 },
    { label: '2026-04', date: '2026-04-30', spread_pct: 2.1 },
  ],
  rebalance_markers: [
    { label: 'Q1 rebalance', index: 1 },
    { label: 'Q2 rebalance', index: 3 },
  ],
  correlation_matrix: [
    { x_key: 'strategy-leg', y_key: 'strategy-leg', correlation: 1 },
    { x_key: 'strategy-leg', y_key: 'bond-leg', correlation: 0.21 },
    { x_key: 'strategy-leg', y_key: 'cash-leg', correlation: -0.14 },
    { x_key: 'bond-leg', y_key: 'strategy-leg', correlation: 0.21 },
    { x_key: 'bond-leg', y_key: 'bond-leg', correlation: 1 },
    { x_key: 'bond-leg', y_key: 'cash-leg', correlation: 0.74 },
    { x_key: 'cash-leg', y_key: 'strategy-leg', correlation: -0.14 },
    { x_key: 'cash-leg', y_key: 'bond-leg', correlation: 0.74 },
    { x_key: 'cash-leg', y_key: 'cash-leg', correlation: 1 },
  ],
  risk_contribution_preview: [
    { leg_id: 'strategy-leg', label: 'Momentum Strategy', weight_pct: 32, volatility_pct: 17, contribution_pct: 49 },
    { leg_id: 'bond-leg', label: 'UST 10Y', weight_pct: 44, volatility_pct: 10, contribution_pct: 34 },
    { leg_id: 'cash-leg', label: 'Cash Buffer', weight_pct: 24, volatility_pct: 2, contribution_pct: 17 },
  ],
  maintenance_cost_summary: {
    expense_ratio_bps: 18,
    turnover_budget_bps: 12,
    trade_cost_bps: 8,
    total_estimated_bps: 38,
    notes: ['Quarterly rebalance budget'],
  },
  scenario_summary: {
    base_case: { label: 'Base case', expected_drawdown_pct: -7.4 },
    stress_case: { label: 'Stress case', expected_drawdown_pct: -11.2 },
    dispersion_note: 'Scenario calculations should come from runtime data rather than placeholders.',
  },
  source_evidence: [
    {
      id: 'freeze-001',
      leg_id: 'strategy-leg',
      display_name: 'Momentum Strategy',
      freeze_ref_type: 'strategy_projection',
      freeze_ref_id: 'strategy-leg',
      freeze_hash: 'c0a1f8',
      captured_at: '2026-04-22T00:00:00.000Z',
      snapshot: { run_id: 'run-101' },
    },
  ],
  composition_score: {
    score: 82,
    verdict: 'strong',
    factors: [
      { key: 'diversification', label: 'Diversification', score: 84, detail: 'Diversified mix.', tone: 'positive' },
    ],
  },
  latest_activity_label: 'Updated 2026-04-22',
  deep_link_actions: ['open_composition_workbench'],
};

(detail.risk_contribution_preview[0] as ApiCompositionDetail['risk_contribution_preview'][number] & { return_contribution_pct?: number }).return_contribution_pct = 6.1;
(detail.risk_contribution_preview[1] as ApiCompositionDetail['risk_contribution_preview'][number] & { return_contribution_pct?: number }).return_contribution_pct = 2.7;
(detail.risk_contribution_preview[2] as ApiCompositionDetail['risk_contribution_preview'][number] & { return_contribution_pct?: number }).return_contribution_pct = 1;
(
  detail.scenario_summary as ApiCompositionDetail['scenario_summary'] & {
    cases?: Array<Record<string, unknown>>;
  }
).cases = [
  { key: 'crash', label: 'Historical crash replay', expected_drawdown_pct: -11.6, body: 'Scenario card one', tone: 'warning', tag: 'Stress 7.5 months' },
  { key: 'pandemic', label: 'Pandemic replay', expected_drawdown_pct: -8.2, body: 'Scenario card two', tone: 'accent', tag: 'Stress 4.2 months' },
  { key: 'rates', label: 'Rates shock replay', expected_drawdown_pct: -6.4, body: 'Scenario card three', tone: 'danger', tag: 'Correlation stress' },
];

beforeEach(() => {
  fakeApi.getCompositionDetail = vi.fn().mockResolvedValue(detail);
  fakeApi.updateComposition = vi.fn().mockResolvedValue(detail);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('composition detail approved runtime layout', () => {
  it('keeps the runtime detail page bound to the Compose First approved detail contract', () => {
    const css = getDetailCss();
    const approvedLayout = getCssBlock(css, '.composition-detail-approved-layout');
    const mainStack = getCssBlock(css, '.composition-detail-main-stack');
    const approvedHero = getCssBlock(css, '.composition-detail-approved .composition-detail-hero');
    const approvedKpiGrid = getCssBlock(css, '.composition-detail-approved .composition-detail-kpi-grid');
    const approvedKpiCard = getCssBlock(css, '.composition-detail-approved .composition-detail-kpi-card');

    expect(approvedLayout).toContain('display: grid;');
    expect(approvedLayout).toContain('grid-template-columns: minmax(0, 1.78fr) 330px;');
    expect(approvedLayout).toContain('gap: 16px;');
    expect(approvedLayout).toContain('align-items: start;');
    expect(mainStack).toContain('display: grid;');
    expect(mainStack).toContain('gap: 16px;');
    expect(approvedHero).toContain('border-radius: 24px;');
    expect(approvedHero).not.toContain('background: transparent;');
    expect(approvedKpiGrid).toContain('grid-template-columns: repeat(7, minmax(0, 1fr));');
    expect(approvedKpiCard).toContain('border-radius: 16px;');
    expect(css).toContain('.composition-detail-approved-bottom-tabs {\n  justify-content: flex-start;');
  });

  it('keeps source-signature rail text wrapped within the approved right column', () => {
    const css = getDetailCss();
    const sourceCard = getCssBlock(css, '.composition-detail-approved-source-card');
    const sourceLineSpan = getCssBlock(css, '.composition-detail-approved-source-line > span');
    const shield = getCssBlock(css, '.composition-detail-approved .composition-detail-shield');

    expect(sourceCard).toContain('min-width: 0;');
    expect(sourceCard).toContain('overflow: hidden;');
    expect(sourceLineSpan).toContain('min-width: 0;');
    expect(sourceLineSpan).toContain('overflow-wrap: anywhere;');
    expect(shield).toContain('max-width: 100%;');
    expect(shield).toContain('white-space: normal;');
  });

  it('reuses the approved shells for the runtime detail view', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="composition-approved-layout" />);
    });

    await screen.findByRole('heading', { level: 1, name: 'Momentum Treasury Mix' });
    expect(document.querySelector('.composition-detail-approved-chart')).not.toBeNull();
    expect(document.querySelectorAll('.composition-detail-kpi-card')).toHaveLength(7);
    expect(document.querySelectorAll('.composition-detail-approved-analysis-grid > .composition-detail-panel')).toHaveLength(2);
    expect(document.querySelectorAll('.composition-detail-approved-snapshot-card')).toHaveLength(3);
    expect(document.querySelector('.composition-detail-approved-heatmap')).not.toBeNull();
    expect(document.querySelectorAll('.composition-detail-approved-scenario-card')).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 2, name: '来源签名' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '再平衡与成本' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '深入分析入口' })).toBeInTheDocument();
  });
});
