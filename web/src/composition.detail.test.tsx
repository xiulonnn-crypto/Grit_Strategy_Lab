import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const detail: ApiCompositionDetail = {
  id: 'comp-001',
  name: '全天候组合样例',
  description: '组合详情页测试夹具，覆盖来源冻结、收益质量和风险归因模块。',
  status: 'ACTIVE',
  status_label: '已启用',
  created_at: '2026-04-20T00:00:00.000Z',
  updated_at: '2026-04-22T00:00:00.000Z',
  benchmark_definition: { label: '60/40 基准', symbol: '60/40', source: 'phase1_compose' },
  rebalance_frequency: 'quarterly',
  cost_policy: {
    expense_ratio_bps: 18,
    turnover_budget_bps: 12,
    trade_cost_bps: 8,
    notes: '季度调仓，成本按固定假设测算',
  },
  hero_summary: {
    title: '全天候组合样例',
    subtitle: '已保存组合，覆盖真实来源冻结与风险检查。',
    status: 'ACTIVE',
    status_label: '已启用',
    benchmark_label: '60/40 基准',
    leg_count: 3,
    composition_score: 82,
    updated_at: '2026-04-22T00:00:00.000Z',
  },
  kpis: [
    { key: 'annualized_return', label: '年化收益', value: '9.8%', tone: 'positive', detail: '较基准高 2.1 个百分点' },
    { key: 'max_drawdown', label: '最大回撤', value: '-8.6%', tone: 'warning', detail: '控制在目标阈值内' },
    { key: 'volatility', label: '波动率', value: '11.4%', tone: 'neutral', detail: '符合组合风险预算' },
    { key: 'sharpe', label: 'Sharpe', value: '1.42', tone: 'positive', detail: '风险调整后回报良好' },
    { key: 'sortino', label: 'Sortino', value: '1.78', tone: 'positive', detail: '下行风险收益比稳定' },
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
      id: 'strategy-leg-001',
      leg_kind: 'strategy',
      source_ref_id: 'strategy_leg::strat-001::pv-003',
      source_ref_type: 'strategy_projection',
      display_name: '动量策略腿',
      weight_pct: 32,
      weight_locked: false,
      ordering: 0,
      version_label: 'v3',
      proof_label: 'bt-101',
      status: 'READY',
      status_label: '可用',
      attribute_tags: ['strategy'],
      reference_summary: '来源于最新完成回测',
      config: {},
      allowed_actions: ['open_strategy_detail'],
    },
    {
      id: 'asset-leg-001',
      leg_kind: 'asset',
      source_ref_id: 'asset-leg-001',
      source_ref_type: 'asset_definition',
      display_name: '美债 ETF 腿',
      weight_pct: 44,
      weight_locked: true,
      ordering: 1,
      version_label: 'IEF',
      proof_label: 'bond-fixed-income',
      status: 'ACTIVE',
      status_label: '可用',
      attribute_tags: ['bond'],
      reference_summary: '债券快照定义',
      config: {},
      allowed_actions: ['open_composition_workbench'],
    },
    {
      id: 'cash-leg-001',
      leg_kind: 'cash',
      source_ref_id: 'cash-leg-001',
      source_ref_type: 'cash_definition',
      display_name: '现金缓冲腿',
      weight_pct: 24,
      weight_locked: false,
      ordering: 2,
      version_label: 'TARGET_BUFFER',
      proof_label: 'cash-rule',
      status: 'ACTIVE',
      status_label: '可用',
      attribute_tags: ['cash'],
      reference_summary: '现金规则',
      config: {},
      allowed_actions: ['open_composition_workbench'],
    },
  ],
  returns_preview: [
    {
      label: 'P1',
      date: '2026-01-31',
      portfolio_return_pct: 1.2,
      cumulative_return_pct: 1.2,
      gross_return_pct: 1.2,
      net_return_pct: 1.16,
      maintenance_cost_drag_pct: 0.01,
      slippage_drag_pct: 0.01,
      cash_buffer_drag_pct: 0.01,
      rebalance_cost_drag_pct: 0.01,
      total_cost_drag_pct: 0.04,
      cumulative_net_return_pct: 1.16,
    },
    {
      label: 'P2',
      date: '2026-02-28',
      portfolio_return_pct: 0.8,
      cumulative_return_pct: 2.0,
      gross_return_pct: 0.8,
      net_return_pct: 0.76,
      maintenance_cost_drag_pct: 0.01,
      slippage_drag_pct: 0.01,
      cash_buffer_drag_pct: 0.01,
      rebalance_cost_drag_pct: 0.01,
      total_cost_drag_pct: 0.04,
      cumulative_net_return_pct: 1.93,
    },
    {
      label: 'P3',
      date: '2026-03-31',
      portfolio_return_pct: 1.5,
      cumulative_return_pct: 3.5,
      gross_return_pct: 1.5,
      net_return_pct: 1.46,
      maintenance_cost_drag_pct: 0.01,
      slippage_drag_pct: 0.01,
      cash_buffer_drag_pct: 0.01,
      rebalance_cost_drag_pct: 0.01,
      total_cost_drag_pct: 0.04,
      cumulative_net_return_pct: 3.42,
    },
  ],
  benchmark_series: [
    { label: 'P1', date: '2026-01-31', benchmark_return_pct: 0.9, cumulative_return_pct: 0.9 },
    { label: 'P2', date: '2026-02-28', benchmark_return_pct: 0.5, cumulative_return_pct: 1.4 },
    { label: 'P3', date: '2026-03-31', benchmark_return_pct: 0.7, cumulative_return_pct: 2.1 },
  ],
  spread_series: [
    { label: 'P1', date: '2026-01-31', spread_pct: 0.3 },
    { label: 'P2', date: '2026-02-28', spread_pct: 0.6 },
    { label: 'P3', date: '2026-03-31', spread_pct: 1.4 },
  ],
  rebalance_markers: [{ label: 'Q1', date: '2026-03-31', index: 2 }],
  correlation_matrix: [
    { x_key: 'strategy-leg-001', y_key: 'strategy-leg-001', correlation: 1 },
    { x_key: 'strategy-leg-001', y_key: 'asset-leg-001', correlation: 0.18 },
    { x_key: 'asset-leg-001', y_key: 'asset-leg-001', correlation: 1 },
  ],
  risk_contribution_preview: [
    {
      leg_id: 'strategy-leg-001',
      label: '动量策略腿',
      weight_pct: 32,
      volatility_pct: 14,
      contribution_pct: 46,
      return_contribution_pct: 58,
      marginal_contribution_pct: 1.8,
      budget_usage_pct: 82,
    },
    {
      leg_id: 'asset-leg-001',
      label: '美债 ETF 腿',
      weight_pct: 44,
      volatility_pct: 8,
      contribution_pct: 34,
      return_contribution_pct: 25,
      marginal_contribution_pct: 0.9,
      budget_usage_pct: 61,
      duration_contribution_years: 3.1,
      convexity_contribution: 0.4,
    },
    {
      leg_id: 'cash-leg-001',
      label: '现金缓冲腿',
      weight_pct: 24,
      volatility_pct: 1,
      contribution_pct: 20,
      return_contribution_pct: 17,
      marginal_contribution_pct: 0.1,
      budget_usage_pct: 12,
    },
  ],
  maintenance_cost_summary: {
    expense_ratio_bps: 18,
    turnover_budget_bps: 12,
    trade_cost_bps: 8,
    total_estimated_bps: 38,
    notes: ['成本预算处于安全区间'],
  },
  return_quality_summary: {
    status: 'verified',
    alignment_window_start: '2026-01-31',
    alignment_window_end: '2026-03-31',
    aligned_points: 3,
    missing_points: 0,
    coverage_pct: 100,
    fallback_used: false,
    notes: ['收益流与基准序列完全对齐'],
  },
  rebalance_events: [
    {
      label: 'Q1 rebalance',
      date: '2026-03-31',
      index: 2,
      turnover_pct: 7.5,
      estimated_cost_bps: 3.2,
      cost_drag_pct: 0.03,
      cash_buffer_pct: 24,
      weight_before: { 'strategy-leg-001': 34, 'asset-leg-001': 42, 'cash-leg-001': 24 },
      weight_after: { 'strategy-leg-001': 32, 'asset-leg-001': 44, 'cash-leg-001': 24 },
      notes: ['季度调仓完成'],
    },
  ],
  scenario_summary: {
    base_case: { label: 'base', result: 'stable' },
    stress_case: { label: 'stress', result: 'watch' },
    cases: [
      { key: 'growth', label: '增长情景', body: '债券腿对冲权益波动。', tag: 'defensive', tone: 'positive' },
      { key: 'rates', label: '利率抬升', body: '需要关注久期暴露。', tag: 'watch', tone: 'warning' },
      { key: 'cash', label: '现金缓冲', body: '维持组合应急流动性。', tag: 'neutral', tone: 'neutral' },
    ],
    dispersion_note: '不同情景下组合表现差异可控。',
  },
  source_evidence: [
    {
      id: 'freeze-001',
      leg_id: 'strategy-leg-001',
      display_name: '动量策略腿',
      freeze_ref_type: 'strategy_projection',
      freeze_ref_id: 'strategy_leg::strat-001::pv-003',
      freeze_hash: 'hash-strategy-001',
      captured_at: '2026-04-22T00:00:00.000Z',
      snapshot: { current_ref_id: 'strategy_leg::strat-001::pv-004' },
      signature_status: 'verified',
      drift_status: 'drifted',
      current_ref_id: 'strategy_leg::strat-001::pv-004',
      alerts: ['来源版本已漂移，建议重新检查。'],
    },
  ],
  source_integrity: [
    {
      leg_id: 'strategy-leg-001',
      display_name: '动量策略腿',
      source_ref_id: 'strategy_leg::strat-001::pv-003',
      freeze_hash: 'hash-strategy-001',
      signature_status: 'verified',
      drift_status: 'drifted',
      current_ref_id: 'strategy_leg::strat-001::pv-004',
      checked_at: '2026-04-22T00:00:00.000Z',
      alerts: ['来源版本已漂移，建议重新检查。'],
    },
    {
      leg_id: 'asset-leg-001',
      display_name: '美债 ETF 腿',
      source_ref_id: 'asset-leg-001',
      freeze_hash: 'hash-bond-001',
      signature_status: 'verified',
      drift_status: 'current',
      current_ref_id: 'asset-leg-001',
      checked_at: '2026-04-22T00:00:00.000Z',
      alerts: [],
    },
  ],
  audit_trail: [
    {
      id: 'audit-001',
      action: 'created',
      actor: 'system',
      at: '2026-04-20T00:00:00.000Z',
      summary: '组合已创建。',
      hash_after: 'hash-created',
    },
    {
      id: 'audit-002',
      action: 'source_drift_checked',
      actor: 'system',
      at: '2026-04-22T00:00:00.000Z',
      summary: '已检查最新来源版本。',
      hash_before: 'hash-created',
      hash_after: 'hash-created',
    },
  ],
  composition_score: {
    score: 82,
    verdict: '良好',
    factors: [
      { key: 'return_quality', label: '收益质量', score: 92, detail: '收益流覆盖完整', tone: 'positive' },
      { key: 'source_signature', label: '来源签名', score: 88, detail: '冻结签名有效', tone: 'positive' },
    ],
  },
  latest_activity_label: '2026-04-22 更新',
  deep_link_actions: ['open_composition_workbench', 'open_leg_inventory'],
};

describe('CompositionDetailPage', () => {
  beforeEach(() => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue(detail);
    fakeApi.updateComposition = vi.fn().mockResolvedValue({ ...detail, status: 'ARCHIVED', status_label: '已归档' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loads a saved composition detail through the API', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ })).toBeInTheDocument();
    expect(fakeApi.getCompositionDetail).toHaveBeenCalledWith('comp-001');
  });

  it('renders Compose First detail modules and opens the frozen evidence drawer', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ })).toBeInTheDocument();
    expect(
      document.querySelector('.composition-detail-page[data-route-root="compositions"][data-page-root="composition-detail"]'),
    ).not.toBeNull();

    expect(screen.getByRole('heading', { level: 2, name: '累计收益流' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '风险与归因' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '相关性矩阵' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '情景分析' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '来源签名' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '再平衡与成本' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '深入分析入口' })).toBeInTheDocument();
    expect(document.querySelectorAll('.composition-detail-kpi-card')).toHaveLength(7);
    expect(document.querySelectorAll('.composition-detail-kpi-card__compare')).toHaveLength(7);
    expect(
      Array.from(document.querySelectorAll('.composition-detail-kpi-card__head span')).map((node) => node.textContent),
    ).toEqual(['总收益', '年化', '预估净年化', '波动', '最大回撤', '夏普比率', '索提诺比率']);
    expect(screen.getAllByText('基准').length).toBeGreaterThan(0);
    expect(screen.getByText('超额 +1.4%')).toBeInTheDocument();
    expect(screen.getByText('总损耗')).toBeInTheDocument();
    expect(screen.getByText('恢复时长')).toBeInTheDocument();
    expect(screen.queryByText('现金占比')).not.toBeInTheDocument();
    expect(screen.queryByText('差值')).not.toBeInTheDocument();
    expect(screen.queryByText('对齐')).not.toBeInTheDocument();
    expect(screen.queryByText(/收益对齐 100%/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-ui="source-signature-rail"]')).not.toBeNull();
    expect(document.querySelector('[data-ui="source-drift-alert"]')).not.toBeNull();
    expect(document.querySelector('[data-ui="composition-audit-trail"]')).not.toBeNull();
    expect(document.querySelector('[data-ui="risk-contribution-explanation"]')).not.toBeNull();
    const sourceRail = document.querySelector('[data-ui="source-signature-rail"]');
    expect(sourceRail?.textContent).toContain('动量策略腿');
    expect(sourceRail?.textContent).toContain('策略腿');
    expect(sourceRail?.textContent).toContain('版本漂移');
    expect(sourceRail?.textContent).not.toContain('签名有效');

    fireEvent.click(document.querySelectorAll<HTMLButtonElement>('.composition-detail-evidence-card')[0]);
    await waitFor(() => expect(document.querySelector('.composition-detail-drawer')).not.toBeNull());
  });

  it('keeps total return copy compact and renders chart overlays without a separate excess-return mini chart', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue({
      ...detail,
      returns_preview: detail.returns_preview.map((point, index) =>
        index === 1 ? { ...point, cumulative_return_pct: 0.6 } : point,
      ),
    });

    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    expect(await screen.findByText('含再平衡路径。')).toBeInTheDocument();
    expect(screen.queryByText('基于当前收益流预览，含再平衡后的组合路径。')).not.toBeInTheDocument();
    expect(screen.queryByText('基准：60/40 基准')).not.toBeInTheDocument();
    expect(screen.queryByText('累计收益与超额收益共用同一套时间轴')).not.toBeInTheDocument();
    expect(document.querySelector('.composition-detail-approved-mini-chart')).toBeNull();
    const drawdownArea = document.querySelector('.composition-detail-drawdown-area');
    expect(drawdownArea).not.toBeNull();
    const drawdownYValues = Array.from(drawdownArea?.getAttribute('d')?.matchAll(/(?:M|L) [\d.]+ ([\d.]+)/g) ?? []).map(
      (match) => Number(match[1]),
    );
    const drawdownBaselineY = drawdownYValues[0];
    expect(Math.max(...drawdownYValues.slice(1, -1))).toBeGreaterThan(drawdownBaselineY);
    expect(document.querySelectorAll('[data-ui="composition-rebalance-marker"]').length).toBeGreaterThan(0);
  });

  it('shows benchmark deltas beside each primary KPI and moves net annualized cost copy into tooltips', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ });
    const totalReturnCard = document.querySelector<HTMLElement>('[data-kpi-key="total_return"]');
    expect(totalReturnCard).not.toBeNull();
    expect(totalReturnCard?.querySelector('.composition-detail-kpi-card__core')?.textContent).toContain('+3.5%');
    expect(totalReturnCard?.querySelector('.composition-detail-kpi-card__core')?.textContent).toContain('超额 +1.4%');
    expect(totalReturnCard?.querySelectorAll('.composition-detail-kpi-card__compare-item').length).toBe(1);
    expect(totalReturnCard?.querySelector('.composition-detail-kpi-card__compare')?.textContent).toContain('基准');
    expect(totalReturnCard?.querySelector('.composition-detail-kpi-card__compare')?.textContent).not.toContain('超额');

    ['annualized_return', 'net_annualized_return', 'volatility', 'max_drawdown', 'sharpe', 'sortino'].forEach((key) => {
      const card = document.querySelector<HTMLElement>(`[data-kpi-key="${key}"]`);
      expect(card?.querySelector('.composition-detail-kpi-card__trend')?.textContent).toContain('较基准');
    });

    const netAnnualizedCard = document.querySelector<HTMLElement>('[data-kpi-key="net_annualized_return"]');
    expect(netAnnualizedCard?.textContent).not.toContain('毛年化扣除滑点、现金缓冲、维护成本和调仓损耗。');
    expect(screen.getByLabelText('预估净年化指标说明')).toHaveAttribute(
      'data-tooltip',
      '毛年化扣除滑点、现金缓冲、维护成本和调仓损耗。',
    );
    expect(screen.getByLabelText('波动指标说明')).toHaveAttribute('data-tooltip', expect.stringContaining('年化波动'));
    expect(screen.getByLabelText('夏普比率指标说明')).toHaveAttribute('data-tooltip', expect.stringContaining('风险调整'));
    expect(screen.getByLabelText('索提诺比率指标说明')).toHaveAttribute('data-tooltip', expect.stringContaining('下行波动'));
  });

  it('sorts source signatures and risk attribution by weight, then labels the correlation matrix axes without pair choices', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue({
      ...detail,
      source_evidence: [
        {
          id: 'freeze-cash',
          leg_id: 'cash-leg-001',
          display_name: '现金缓冲腿',
          freeze_ref_type: 'cash_definition',
          freeze_ref_id: 'cash-leg-001',
          freeze_hash: 'hash-cash',
          captured_at: '2026-04-22T00:00:00.000Z',
          snapshot: { leg_kind: 'cash', weight_pct: 24 },
          signature_status: 'verified',
          drift_status: 'current',
          current_ref_id: 'cash-leg-001',
          alerts: [],
        },
        {
          id: 'freeze-strategy',
          leg_id: 'strategy-leg-001',
          display_name: '动量策略腿',
          freeze_ref_type: 'strategy_projection',
          freeze_ref_id: 'strategy_leg::strat-001::pv-003',
          freeze_hash: 'hash-strategy',
          captured_at: '2026-04-22T00:00:00.000Z',
          snapshot: { leg_kind: 'strategy', weight_pct: 32 },
          signature_status: 'verified',
          drift_status: 'current',
          current_ref_id: 'strategy_leg::strat-001::pv-003',
          alerts: [],
        },
        {
          id: 'freeze-asset',
          leg_id: 'asset-leg-001',
          display_name: '美债 ETF 腿',
          freeze_ref_type: 'asset_definition',
          freeze_ref_id: 'asset-leg-001',
          freeze_hash: 'hash-asset',
          captured_at: '2026-04-22T00:00:00.000Z',
          snapshot: { leg_kind: 'asset', weight_pct: 44 },
          signature_status: 'verified',
          drift_status: 'current',
          current_ref_id: 'asset-leg-001',
          alerts: [],
        },
      ],
      risk_contribution_preview: [
        detail.risk_contribution_preview[2],
        detail.risk_contribution_preview[0],
        detail.risk_contribution_preview[1],
      ],
      correlation_matrix: [
        { x_key: 'strategy-leg-001', y_key: 'strategy-leg-001', correlation: 1 },
        { x_key: 'strategy-leg-001', y_key: 'asset-leg-001', correlation: 0.18 },
        { x_key: 'strategy-leg-001', y_key: 'cash-leg-001', correlation: -0.08 },
        { x_key: 'asset-leg-001', y_key: 'strategy-leg-001', correlation: 0.18 },
        { x_key: 'asset-leg-001', y_key: 'asset-leg-001', correlation: 1 },
        { x_key: 'asset-leg-001', y_key: 'cash-leg-001', correlation: 0.22 },
        { x_key: 'cash-leg-001', y_key: 'strategy-leg-001', correlation: -0.08 },
        { x_key: 'cash-leg-001', y_key: 'asset-leg-001', correlation: 0.22 },
        { x_key: 'cash-leg-001', y_key: 'cash-leg-001', correlation: 1 },
      ],
    });

    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ });
    const sourceNames = Array.from(
      document.querySelectorAll<HTMLElement>('[data-ui="source-signature-rail"] .composition-detail-approved-source-card strong'),
    ).map((node) => node.textContent);
    expect(sourceNames).toEqual(['美债 ETF 腿', '动量策略腿', '现金缓冲腿']);

    const riskCards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-ui="risk-contribution-explanation"] .composition-detail-approved-snapshot-card'),
    );
    expect(riskCards.map((node) => node.querySelector('strong')?.textContent)).toEqual([
      '美债 ETF 腿',
      '动量策略腿',
      '现金缓冲腿',
    ]);
    expect(riskCards[0].textContent).toContain('权重 44%');
    expect(riskCards[0].textContent).toContain('收益占比 25.0%');
    expect(riskCards[0].textContent).toContain('风险占比 34.0%');
    expect(riskCards[0].textContent).not.toContain('收益贡献');
    expect(riskCards[0].textContent).not.toContain('波动');

    expect(document.querySelectorAll('[data-ui="composition-correlation-pair"]').length).toBe(0);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('.composition-detail-correlation-axis--column')).map(
        (node) => node.textContent,
      ),
    ).toEqual(['动量策略腿', '美债 ETF 腿', '现金缓冲腿']);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('.composition-detail-correlation-axis--row')).map(
        (node) => node.textContent,
      ),
    ).toEqual(['动量策略腿', '美债 ETF 腿', '现金缓冲腿']);
  });

  it('shows a return data tooltip when hovering the cumulative return chart', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    const chart = await waitFor(() => document.querySelector<SVGSVGElement>('[data-ui="composition-return-chart"]'));
    expect(chart).not.toBeNull();
    Object.defineProperty(chart, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 1000,
        height: 320,
        right: 1000,
        bottom: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerMove(chart!, { clientX: 500, clientY: 160 });

    const tooltip = await waitFor(() => document.querySelector('[data-ui="composition-return-tooltip"]'));
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toContain('P2');
    expect(tooltip?.textContent).toContain('2.00%');
    expect(tooltip?.textContent).toContain('1.40%');

    fireEvent.pointerLeave(chart!);
    await waitFor(() => expect(document.querySelector('[data-ui="composition-return-tooltip"]')).toBeNull());
  });

  it('localizes audit trail actions, actors, and summaries for live composition events', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue({
      ...detail,
      audit_trail: [
        {
          id: 'audit-live-created',
          action: 'created',
          actor: 'system',
          at: '2026-04-20T00:00:00.000Z',
          summary: 'Composition record created with normalized legs and cost policy.',
          hash_after: 'hash-created',
        },
        {
          id: 'audit-live-rebalance',
          action: 'rebalance_check',
          actor: 'system',
          at: '2026-04-21T00:00:00.000Z',
          summary: 'Simulated 8 rebalance events without mutating frozen sources.',
          hash_after: 'hash-rebalance',
        },
        {
          id: 'audit-live-status',
          action: 'status',
          actor: 'system',
          at: '2026-04-22T00:00:00.000Z',
          summary: 'Composition status is ACTIVE; drift warnings remain advisory.',
          hash_after: 'hash-status',
        },
      ],
    });

    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    const audit = await waitFor(() => document.querySelector('[data-ui="composition-audit-trail"]'));
    expect(audit?.textContent).toContain('创建组合');
    expect(audit?.textContent).toContain('再平衡检查');
    expect(audit?.textContent).toContain('状态检查');
    expect(audit?.textContent).toContain('系统');
    expect(audit?.textContent).toContain('组合记录已创建，腿结构与成本规则已归一化。');
    expect(audit?.textContent).toContain('已模拟 8 次再平衡事件，未改写冻结来源。');
    expect(audit?.textContent).toContain('组合状态为运行中；漂移提示仅作提醒。');
    expect(audit?.textContent).not.toContain('system');
    expect(audit?.textContent).not.toContain('Composition record created');
    expect(audit?.textContent).not.toContain('Simulated 8 rebalance events');
    expect(audit?.textContent).not.toContain('Composition status is ACTIVE');
  });

  it('keeps the deep analysis entry as clear direct actions', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    const heading = await screen.findByRole('heading', { level: 2, name: '深入分析入口' });
    const panel = heading.closest('section');
    expect(panel?.textContent).toContain('用下面入口继续追查组合来源、回测、优化与数据快照。');
    expect(panel?.textContent).toContain('查策略来源');
    expect(panel?.textContent).toContain('查回测记录');
    expect(panel?.textContent).toContain('查优化记录');
    expect(panel?.textContent).toContain('查数据快照');
    expect(panel?.textContent).not.toContain('侧边宽抽屉');
    expect(panel?.textContent).not.toContain('收益流 / 回撤 / 样本外（OOS）');
  });

  it('shows API errors without falling back to approved preview', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockRejectedValue(new Error('Composition not found'));

    await act(async () => {
      render(<CompositionDetailPage compositionId="missing" />);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Composition not found');
    expect(fakeApi.getCompositionDetail).toHaveBeenCalledWith('missing');
  });
});
