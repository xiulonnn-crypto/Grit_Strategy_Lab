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
    { key: 'beta_exposure', label: 'Beta 暴露', value: '0.74', tone: 'neutral', detail: '相对基准降低 0.18' },
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
      snapshot: {
        current_ref_id: 'strategy_leg::strat-001::pv-004',
        run_id: 'run-101',
        version_label: 'v1.2',
        period_years: 10,
      },
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

  it('renders the approved hero actions and routes them to edit, backtest, and allocation surfaces', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ })).toBeInTheDocument();
    const editButton = screen.getByRole('button', { name: '修改组合' });
    const backtestButton = screen.getByRole('button', { name: '查看回测' });
    const allocationButton = screen.getByRole('button', { name: '配置实验室' });

    expect(editButton).toHaveClass('primary-button');
    expect(backtestButton).toHaveClass('ghost-button');
    expect(allocationButton).toHaveClass('ghost-button');
    expect(screen.queryByRole('button', { name: '另存为新版本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行再平衡' })).not.toBeInTheDocument();

    fireEvent.click(editButton);
    expect(window.location.hash).toBe('#/compositions/workbench?composition_id=comp-001&intent=rebalance');

    fireEvent.click(backtestButton);
    expect(window.location.hash).toBe('#/compositions/comp-001/backtest-runs/run-101');

    fireEvent.click(allocationButton);
    expect(window.location.hash).toBe('#/compositions/comp-001/allocation-lab');
  });

  it('uses the highest-weight strategy evidence for the hero backtest shortcut on the live composition route', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue({
      ...detail,
      id: 'composition_630718a64821',
      normalized_legs: [
        {
          ...detail.normalized_legs[0],
          id: 'strategy-leg-spy',
          display_name: '标普动量策略腿',
          weight_pct: 30,
          ordering: 0,
          proof_label: 'Latest eligible run run_fb0ed9c25479',
          config: { latest_run_id: 'run_fb0ed9c25479' },
        },
        {
          ...detail.normalized_legs[0],
          id: 'strategy-leg-qqq',
          display_name: 'QQQ 网格策略腿',
          weight_pct: 40,
          ordering: 1,
          proof_label: 'Latest eligible run run_95db6d1d4ba9',
          config: { latest_run_id: 'run_95db6d1d4ba9' },
        },
        ...detail.normalized_legs.slice(1).map((leg, index) => ({
          ...leg,
          ordering: index + 2,
        })),
      ],
    });

    await act(async () => {
      render(<CompositionDetailPage compositionId="composition_630718a64821" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '修改组合' }));
    expect(window.location.hash).toBe(
      '#/compositions/workbench?composition_id=composition_630718a64821&intent=rebalance',
    );

    fireEvent.click(screen.getByRole('button', { name: '查看回测' }));
    expect(window.location.hash).toBe(
      '#/compositions/composition_630718a64821/backtest-runs/run_95db6d1d4ba9',
    );
  });

  it('renders Compose First detail modules and opens the leg detail drawer from source fingerprints', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ })).toBeInTheDocument();
    expect(
      document.querySelector('.composition-detail-page[data-route-root="compositions"][data-page-root="composition-detail"]'),
    ).not.toBeNull();

    expect(screen.getByRole('heading', { level: 2, name: '权益曲线' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '敞口穿透分析' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '风险归因' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '配置版本记录' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '相关性矩阵' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '配置指纹' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '组合回测历史' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '再平衡与成本' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: '深入分析入口' })).not.toBeInTheDocument();
    expect(
      Array.from(document.querySelectorAll('.composition-detail-main-stack h2')).map((node) => node.textContent),
    ).toEqual(['权益曲线', '敞口穿透分析', '风险归因', '配置版本记录', '相关性矩阵']);
    expect(document.querySelectorAll('.composition-detail-kpi-card')).toHaveLength(7);
    expect(document.querySelectorAll('.composition-detail-kpi-card__compare')).toHaveLength(7);
    expect(
      Array.from(document.querySelectorAll('.composition-detail-kpi-card__head span')).map((node) => node.textContent),
    ).toEqual(['α贡献', 'β暴露', '风险贡献偏离', '相关性压力', '净收益', '最大回撤', '收益质量']);
    expect(screen.getAllByText('基准').length).toBeGreaterThan(0);
    expect(screen.getByText('相对基准 +1.4%')).toBeInTheDocument();
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
    expect(sourceRail?.textContent).toContain('有新版本，待更新');
    expect(sourceRail?.textContent).toContain('当前版本偏离冻结指纹。');
    expect(sourceRail?.textContent).not.toContain('Current source version');
    expect(sourceRail?.textContent).not.toContain('来源签名');
    expect(sourceRail?.textContent).not.toContain('签名有效');
    expect(sourceRail?.textContent).not.toContain('版本一致');
    const executionHistory = document.querySelector('[data-ui="composition-execution-history"]');
    expect(executionHistory?.textContent).toContain('组合回测历史');
    expect(executionHistory?.textContent).not.toContain('版本一致');
    expect(executionHistory?.textContent).toContain('10Y / 年化 9.8% / 夏普 1.42');
    expect(executionHistory?.querySelector('a[href="#/compositions/comp-001/backtest-runs/run-101"]')).not.toBeNull();
    expect(executionHistory?.querySelector('a[href="#/compositions/comp-001/backtest-runs/run-101?tab=orders"]')).not.toBeNull();
    expect(document.body.textContent).toContain('维护判断保持并观察');
    expect(document.body.textContent).not.toContain('维护判断strong');

    fireEvent.click(document.querySelectorAll<HTMLButtonElement>('.composition-detail-approved-source-card')[0]);
    const drawer = await screen.findByRole('dialog', { name: '腿部详情' });
    expect(drawer).toHaveClass('leg-inventory-drawer--detail');
    expect(drawer.querySelector('.leg-inventory-detail-grid')).not.toBeNull();
    expect(drawer.querySelector('[data-ui="leg-source-evidence-drawer"]')).not.toBeNull();
  });

  it('renders the command-center chart overlays without a separate excess-return mini chart', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue({
      ...detail,
      returns_preview: detail.returns_preview.map((point, index) =>
        index === 1 ? { ...point, cumulative_return_pct: 0.6 } : point,
      ),
    });

    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    expect(await screen.findByText('组合净值')).toBeInTheDocument();
    expect(screen.queryByText('基于当前收益流预览，含再平衡后的组合路径。')).not.toBeInTheDocument();
    expect(screen.queryByText('基准：60/40 基准')).not.toBeInTheDocument();
    expect(screen.queryByText('累计收益与超额收益共用同一套时间轴')).not.toBeInTheDocument();
    expect(screen.queryByText(/避免首屏只看到单条浅色曲线/)).not.toBeInTheDocument();
    expect(document.querySelector('.composition-detail-approved-mini-chart')).toBeNull();
    expect(document.querySelector('[data-ui="composition-portfolio-line"]')).not.toBeNull();
    expect(document.querySelector('[data-ui="composition-benchmark-line"]')).not.toBeNull();
    expect(document.querySelector('[data-ui="composition-cost-drag-line"]')).not.toBeNull();
    const drawdownArea = document.querySelector('.composition-detail-drawdown-area');
    expect(drawdownArea).not.toBeNull();
    const drawdownYValues = Array.from(drawdownArea?.getAttribute('d')?.matchAll(/(?:M|L) [\d.]+ ([\d.]+)/g) ?? []).map(
      (match) => Number(match[1]),
    );
    const drawdownBaselineY = drawdownYValues[0];
    expect(drawdownBaselineY).toBeGreaterThanOrEqual(280);
    expect(Math.max(...drawdownYValues.slice(1, -1))).toBeGreaterThan(drawdownBaselineY);
    expect(document.querySelectorAll('[data-ui="composition-version-marker"]').length).toBeGreaterThan(0);
    const chartText = document.querySelector<SVGSVGElement>('[data-ui="composition-return-chart"]')?.textContent ?? '';
    expect(chartText).not.toContain('2026-03-31');
    expect(chartText).not.toContain('Q1');
    expect(chartText).not.toContain('Q1 rebalance');
  });

  it('shows approved command center KPIs and keeps net return cost copy in tooltips', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ });
    const alphaCard = document.querySelector<HTMLElement>('[data-kpi-key="alpha_contribution"]');
    expect(alphaCard?.textContent).toContain('α贡献');
    expect(alphaCard?.textContent).not.toContain('阿尔法');
    expect(alphaCard?.querySelector('.composition-detail-kpi-card__core')?.textContent).toContain('+1.4%');
    expect(alphaCard?.querySelector('.composition-detail-kpi-card__core')?.textContent).toContain('相对基准 +1.4%');
    const betaCard = document.querySelector<HTMLElement>('[data-kpi-key="beta_exposure"]');
    expect(betaCard?.textContent).toContain('β暴露');
    expect(betaCard?.textContent).not.toContain('贝塔');
    expect(betaCard?.textContent).toContain('0.74');
    expect(document.querySelector<HTMLElement>('[data-kpi-key="risk_contribution_deviation"]')?.textContent).toContain('风险贡献偏离');
    expect(document.querySelector<HTMLElement>('[data-kpi-key="correlation_stress"]')?.textContent).toContain('相关性压力');
    expect(document.querySelector<HTMLElement>('[data-kpi-key="return_quality"]')?.textContent).toContain('100%');

    const netReturnCard = document.querySelector<HTMLElement>('[data-kpi-key="net_return"]');
    expect(netReturnCard?.textContent).not.toContain('净收益优先读取累计净收益；缺失时回退为预估净年化。');
    expect(screen.getByLabelText('净收益指标说明')).toHaveAttribute(
      'data-tooltip',
      '净收益优先读取累计净收益；缺失时回退为预估净年化。',
    );
    expect(screen.getByLabelText('收益质量指标说明')).toHaveAttribute('data-tooltip', expect.stringContaining('收益质量'));
  });

  it('sorts source signatures by weight while aligning exposure and risk attribution card order', async () => {
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
    const exposureCards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-ui="composition-exposure-drilldown"] .composition-detail-exposure-row'),
    );
    const exposureNames = exposureCards.map((node) => node.querySelector('strong')?.textContent);
    expect(exposureNames).toEqual([
      '动量策略腿',
      '美债 ETF 腿',
      '现金缓冲腿',
    ]);
    expect(riskCards.map((node) => node.querySelector('strong')?.textContent)).toEqual(exposureNames);
    expect(riskCards[0].textContent).toContain('权重 32%');
    expect(riskCards[0].textContent).toContain('收益占比 58.0%');
    expect(riskCards[0].textContent).toContain('风险占比 46.0%');
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
    expect(tooltip?.textContent).toContain('收益节点 2');
    expect(tooltip?.textContent).not.toContain('P2');
    expect(tooltip?.textContent).not.toContain('2026-02-28');
    expect(tooltip?.textContent).toContain('2.00%');
    expect(tooltip?.textContent).toContain('1.40%');
    expect(tooltip?.textContent).toContain('1.93%');

    fireEvent.pointerLeave(chart!);
    await waitFor(() => expect(document.querySelector('[data-ui="composition-return-tooltip"]')).toBeNull());
  });

  it('localizes live English reference summaries and keeps version records scoped to version transitions', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue({
      ...detail,
      normalized_legs: detail.normalized_legs.map((leg, index) => ({
        ...leg,
        reference_summary:
          index === 0
            ? 'Used in 2 saved compositions'
            : index === 1
              ? 'Used in 1 saved composition'
              : 'Not used in saved compositions yet',
      })),
      audit_trail: [
        {
          id: 'audit-live-structure',
          action: 'updated',
          actor: 'system',
          at: '2026-04-22T00:00:00.000Z',
          summary: 'Composition structure, weights, benchmark, or cost policy was patched and revalidated.',
          hash_after: 'hash-structure',
          version_before: 1,
          version_after: 2,
        },
      ],
    });

    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ });
    const exposure = document.querySelector('[data-ui="composition-exposure-drilldown"]');
    expect(exposure?.textContent).toContain('已被 2 个已保存组合引用');
    expect(exposure?.textContent).toContain('已被 1 个已保存组合引用');
    expect(exposure?.textContent).toContain('尚未进入已保存组合');
    expect(exposure?.textContent).not.toContain('Used in');
    expect(exposure?.textContent).not.toContain('Not used');

    const versionHistory = document.querySelector('[data-ui="composition-version-evolution"]');
    expect(versionHistory?.textContent).toContain('v1 -> v2');
    expect(versionHistory?.textContent).toContain('权重变化：');
    expect(versionHistory?.textContent).toContain('再平衡频次：季度再平衡');
    expect(versionHistory?.textContent).toContain('成本规则：38 bps');
    expect(versionHistory?.textContent).not.toContain('Composition structure');
    expect(versionHistory?.textContent).not.toContain('配置、权重、基准与成本规则已复核。');
  });

  it('sorts configuration version records by the post-change version descending', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue({
      ...detail,
      current_composition_version_label: '当前配置版本 v5',
      current_composition_version_number: 5,
      audit_trail: [
        {
          id: 'audit-v2',
          action: 'structure_patch',
          actor: 'system',
          at: '2026-04-20T00:00:00.000Z',
          change_summary: '权重变化：现金缓冲 5%',
          summary: 'Composition structure, weights, benchmark, or cost policy was patched and revalidated.',
          hash_after: 'hash-legacy-91402',
          reason: '建立初始版本记录。',
          version_before: 1,
          version_after: 2,
        },
        {
          id: 'audit-v4',
          action: 'structure_patch',
          actor: 'system',
          at: '2026-04-22T00:00:00.000Z',
          change_summary: '权重变化：策略腿提高 5%',
          summary: 'Composition structure, weights, benchmark, or cost policy was patched and revalidated.',
          hash_after: 'hash-legacy-14012',
          reason: '采用配置实验室建议。',
          version_before: 3,
          version_after: 4,
        },
        {
          id: 'audit-v3',
          action: 'structure_patch',
          actor: 'system',
          at: '2026-04-21T00:00:00.000Z',
          change_summary: '再平衡频次更新',
          summary: 'Composition structure, weights, benchmark, or cost policy was patched and revalidated.',
          hash_after: 'hash-legacy-30383',
          reason: '切换组合维护节奏。',
          version_before: 2,
          version_after: 3,
        },
      ],
    });

    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ });
    const versionCards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-ui="composition-version-evolution"] .composition-detail-compact-timeline__item'),
    );
    expect(versionCards.map((node) => node.dataset.versionAfter)).toEqual(['4', '3', '2']);
    expect(versionCards[0].textContent).toContain('v3 -> v4');
    expect(versionCards[0].textContent).toContain('权重变化：');
    expect(versionCards[0].textContent).toContain('升级理由：采用配置实验室建议。');
  });

  it('uses the API current composition version when legacy structure patches do not carry version numbers', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue({
      ...detail,
      current_composition_version_label: '当前配置版本 v5',
      current_composition_version_number: 5,
      audit_trail: [
        {
          id: 'composition_audit_c01e19b523ae',
          action: 'structure_patch',
          actor: 'system',
          at: '2026-04-28T07:03:39.000Z',
          summary: 'Composition structure, weights, benchmark, or cost policy was patched and revalidated.',
          hash_before: 'f5cb859bfed45c61',
          hash_after: 'a02c2380e1e14012',
        },
        {
          id: 'composition_audit_af5fe42165b3',
          action: 'structure_patch',
          actor: 'system',
          at: '2026-04-27T10:53:02.000Z',
          summary: 'Composition structure, weights, benchmark, or cost policy was patched and revalidated.',
          hash_before: 'c298c76bbd030383',
          hash_after: '60e114956c84f464',
        },
        {
          id: 'composition_audit_2c562c3fb7d1',
          action: 'source_freeze',
          actor: 'system',
          at: '2026-04-27T10:53:02.000Z',
          summary: 'Captured 4 source freeze signatures.',
          hash_after: '60e114956c84f464',
        },
      ],
      source_evidence: detail.source_evidence.map((item) => ({
        ...item,
        snapshot: {
          ...(item.snapshot ?? {}),
          version_label: 'v4',
          freeze_generation: 14012,
          revision: 14012,
        },
      })),
    });

    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ });
    const heroChips = Array.from(document.querySelectorAll<HTMLElement>('.composition-detail-hero__chips .status-chip'))
      .map((node) => node.textContent?.trim())
      .filter(Boolean);
    expect(heroChips[0]).toBe('当前配置版本 v5');
    expect(heroChips.join(' ')).not.toContain('v4');
    expect(heroChips.join(' ')).not.toContain('正式版本');

    const versionCards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-ui="composition-version-evolution"] .composition-detail-compact-timeline__item'),
    );
    expect(versionCards).toHaveLength(1);
    expect(versionCards[0].dataset.versionAfter).toBe('5');
    expect(versionCards[0].textContent).toContain('当前配置版本 v5');
    expect(versionCards[0].textContent).toContain('当前保存配置已生成版本记录');
    expect(versionCards[0].textContent).not.toMatch(/v61|v14012|v30383|v464|v95|v96|v2 -> v3/);
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
    expect(audit?.textContent).toContain('操作日志');
    expect(audit?.textContent).not.toContain('审计轨迹');
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

  it('removes the deep analysis entry from the detail rail', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 1, name: /全天候组合样例/ });
    expect(screen.queryByRole('heading', { level: 2, name: '深入分析入口' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('用下面入口继续追查组合来源、回测、优化与数据快照。');
    expect(document.body.textContent).not.toContain('查策略来源');
    expect(document.body.textContent).not.toContain('查优化记录');
    expect(document.body.textContent).not.toContain('查数据快照');
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
