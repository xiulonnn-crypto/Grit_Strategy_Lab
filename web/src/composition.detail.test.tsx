import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompositionDetailPage } from './pages/composition-detail-page';
import type { ApiCompositionDetail } from './types';

type FakeApi = {
  getCompositionDetail?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  getCompositionDetail: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

const detail: ApiCompositionDetail = {
  id: 'comp-001',
  name: '全天候研究组合',
  description: '策略腿、债券腿与现金腿共同构成正式组合。',
  status: 'ACTIVE',
  status_label: '运行稳定',
  created_at: '2026-04-20T00:00:00.000Z',
  updated_at: '2026-04-22T00:00:00.000Z',
  benchmark_definition: {
    label: '60/40 参考组合',
    symbol: '60/40',
    source: 'phase1_compose',
  },
  rebalance_frequency: 'quarterly',
  cost_policy: {
    expense_ratio_bps: 18,
    turnover_budget_bps: 12,
    trade_cost_bps: 8,
    notes: '季度维护',
  },
  hero_summary: {
    title: '全天候研究组合',
    subtitle: '正式持有复核页',
    status: 'ACTIVE',
    status_label: '运行稳定',
    benchmark_label: '60/40 参考组合',
    leg_count: 3,
    composition_score: 82,
    updated_at: '2026-04-22T00:00:00.000Z',
  },
  kpis: [
    { key: 'annualized_return', label: '年化收益', value: '9.8%', tone: 'positive', detail: '较基准高 2.1 个百分点。' },
    { key: 'max_drawdown', label: '最大回撤', value: '-8.6%', tone: 'warning', detail: '回撤恢复期 44 个交易日。' },
    { key: 'volatility', label: '波动率', value: '11.4%', tone: 'neutral', detail: '维持在目标风险预算内。' },
    { key: 'cash_buffer', label: '现金缓冲', value: '35 bps', tone: 'positive', detail: '用于吸收调仓损耗。' },
    { key: 'sharpe', label: '夏普比率', value: '1.42', tone: 'positive', detail: '收益风险比优于基准。' },
    { key: 'sortino', label: '索提诺比率', value: '1.78', tone: 'positive', detail: '下行波动控制良好。' },
    { key: 'tracking_spread', label: '超额收益', value: '+2.1%', tone: 'blue', detail: '组合长期保持正超额。' },
  ],
  weight_summary: {
    total_weight_pct: 100,
    target_weight_pct: 100,
    residual_weight_pct: 0,
    locked_weight_pct: 24,
    unlocked_weight_pct: 76,
    within_tolerance: true,
  },
  normalized_legs: [
    {
      id: 'strategy_leg::strat-001::pv-003',
      leg_kind: 'strategy',
      source_ref_id: 'strategy_leg::strat-001::pv-003',
      source_ref_type: 'strategy_projection',
      display_name: '质量动量策略腿',
      weight_pct: 32,
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
      weight_pct: 44,
      weight_locked: true,
      ordering: 1,
      version_label: 'IEF',
      proof_label: 'bond-fixed-income',
      status: 'ACTIVE',
      status_label: '稳定',
      attribute_tags: ['bond'],
      reference_summary: '已被 1 个组合引用',
      config: {},
      allowed_actions: ['open_composition_workbench'],
    },
    {
      id: 'cash-leg-001',
      leg_kind: 'cash',
      source_ref_id: 'cash-leg-001',
      source_ref_type: 'cash_definition',
      display_name: '现金缓冲',
      weight_pct: 24,
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
  returns_preview: [
    { label: '2026-01', cumulative_return_pct: 0, portfolio_return_pct: 0 },
    { label: '2026-02', cumulative_return_pct: 0.018, portfolio_return_pct: 0.018 },
    { label: '2026-03', cumulative_return_pct: 0.031, portfolio_return_pct: 0.013 },
    { label: '2026-04', cumulative_return_pct: 0.052, portfolio_return_pct: 0.021 },
  ],
  benchmark_series: [
    { label: '2026-01', cumulative_return_pct: 0, benchmark_return_pct: 0 },
    { label: '2026-02', cumulative_return_pct: 0.011, benchmark_return_pct: 0.011 },
    { label: '2026-03', cumulative_return_pct: 0.019, benchmark_return_pct: 0.008 },
    { label: '2026-04', cumulative_return_pct: 0.031, benchmark_return_pct: 0.012 },
  ],
  spread_series: [
    { label: '2026-01', spread_pct: 0 },
    { label: '2026-02', spread_pct: 0.007 },
    { label: '2026-03', spread_pct: 0.012 },
    { label: '2026-04', spread_pct: 0.021 },
  ],
  rebalance_markers: [
    { label: '季度再平衡', index: 1 },
    { label: '季度再平衡', index: 3 },
  ],
  correlation_matrix: [
    { x_key: 'strategy_leg::strat-001::pv-003', y_key: 'strategy_leg::strat-001::pv-003', correlation: 1 },
    { x_key: 'strategy_leg::strat-001::pv-003', y_key: 'asset-leg-001', correlation: 0.21 },
    { x_key: 'strategy_leg::strat-001::pv-003', y_key: 'cash-leg-001', correlation: -0.14 },
    { x_key: 'asset-leg-001', y_key: 'strategy_leg::strat-001::pv-003', correlation: 0.21 },
    { x_key: 'asset-leg-001', y_key: 'asset-leg-001', correlation: 1 },
    { x_key: 'asset-leg-001', y_key: 'cash-leg-001', correlation: 0.74 },
    { x_key: 'cash-leg-001', y_key: 'strategy_leg::strat-001::pv-003', correlation: -0.14 },
    { x_key: 'cash-leg-001', y_key: 'asset-leg-001', correlation: 0.74 },
    { x_key: 'cash-leg-001', y_key: 'cash-leg-001', correlation: 1 },
  ],
  risk_contribution_preview: [
    { leg_id: 'strategy_leg::strat-001::pv-003', label: '质量动量策略腿', weight_pct: 32, volatility_pct: 17, contribution_pct: 49 },
    { leg_id: 'asset-leg-001', label: '美国国债 10Y', weight_pct: 44, volatility_pct: 10, contribution_pct: 34 },
    { leg_id: 'cash-leg-001', label: '现金缓冲', weight_pct: 24, volatility_pct: 2, contribution_pct: 17 },
  ],
  maintenance_cost_summary: {
    expense_ratio_bps: 18,
    turnover_budget_bps: 12,
    trade_cost_bps: 8,
    total_estimated_bps: 38,
    notes: ['季度调仓对现金腿的占用约为 12 bps。'],
  },
  scenario_summary: {
    base_case: { label: '基准场景', expected_drawdown_pct: -7.4 },
    stress_case: { label: '2022 加息冲击', expected_drawdown_pct: -11.2 },
    dispersion_note: '债券腿在加息环境下需要与策略腿共同分担波动。',
  },
  source_evidence: [
    {
      id: 'freeze-001',
      leg_id: 'strategy_leg::strat-001::pv-003',
      display_name: '质量动量策略腿',
      freeze_ref_type: 'strategy_projection',
      freeze_ref_id: 'strat-001-v3',
      freeze_hash: 'c0a1f8',
      captured_at: '2026-04-22T00:00:00.000Z',
      snapshot: { run_id: 'bt-101', parameter_version_id: 'pv-003' },
    },
    {
      id: 'freeze-002',
      leg_id: 'asset-leg-001',
      display_name: '美国国债 10Y',
      freeze_ref_type: 'asset_snapshot',
      freeze_ref_id: 'bond-ust-10y',
      freeze_hash: 'b9d02e',
      captured_at: '2026-04-22T00:00:00.000Z',
      snapshot: { snapshot_id: 'bond-ust-10y', ytm_pct: 4.2 },
    },
  ],
  composition_score: {
    score: 82,
    verdict: '结构成立',
    factors: [
      { key: 'diversification', label: '分散度', score: 84, detail: '策略腿与债券腿保持低相关。', tone: 'positive' },
      { key: 'evidence', label: '来源可信度', score: 88, detail: '所有正式来源均已冻结。', tone: 'positive' },
    ],
  },
  latest_activity_label: '2026-04-22 更新',
  deep_link_actions: [
    'open_composition_workbench',
    'open_leg_inventory',
    'inspect_source_evidence',
    'refresh_snapshots',
  ],
};

beforeEach(() => {
  fakeApi.getCompositionDetail = vi.fn().mockResolvedValue(detail);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('composition detail page', () => {
  it('renders the approved preview for the public detail route alias', async () => {
    fakeApi.getCompositionDetail = vi.fn().mockRejectedValue(new Error('Composition not found: detail'));

    await act(async () => {
      render(<CompositionDetailPage compositionId="detail" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '平衡收益组合' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fakeApi.getCompositionDetail).not.toHaveBeenCalledWith('detail');
    expect(screen.getByRole('button', { name: '复制组合' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新平衡' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '编辑组合' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 2, name: '风险与归因' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '相关性矩阵' })).toBeInTheDocument();
    const panelActions = document.querySelector('.composition-detail-approved-panel-actions');
    expect(panelActions).not.toBeNull();
    expect(panelActions?.textContent).toContain('最近 24 个月');
    expect(panelActions?.textContent).toContain('基准：60/40 经典组合');
    const inlineNote = document.querySelector('.composition-detail-approved-detail-toolbar .composition-detail-approved-detail-inline-note');
    expect(inlineNote).not.toBeNull();
    expect(inlineNote?.textContent).toContain(
      '累计收益与超额收益共用同一套时间轴',
    );
    expect(document.querySelectorAll('.composition-detail-approved-analysis-grid > .composition-detail-panel')).toHaveLength(2);
    expect(document.querySelector('.composition-detail-approved-source-line .composition-detail-shield')?.textContent).toBe('盾牌哈希 6F3A');
    expect(screen.getByText('预计组合跌幅约 -11.6%，主要压力集中在策略腿与 ETF 腿同步回撤阶段，10Y 国债与现金腿承担主要缓冲。')).toBeInTheDocument();
    expect(document.querySelectorAll('.composition-detail-approved-leg-link')).toHaveLength(1);
  });

  it('renders the approved detail structure and opens the evidence drawer in place', async () => {
    await act(async () => {
      render(<CompositionDetailPage compositionId="comp-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '全天候研究组合' })).toBeInTheDocument();
    expect(
      document.querySelector('.composition-detail-page[data-route-root="compositions"][data-page-root="composition-detail"]'),
    ).not.toBeNull();

    expect(screen.getByRole('heading', { level: 2, name: '累计收益流' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '风险与归因' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '相关性矩阵' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '编辑组合' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '返回策略资产库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看数据快照' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '超额收益' }));
    expect(screen.getByText('组合相对基准超额收益')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开来源子视图' }));
    expect(await screen.findByRole('heading', { level: 2, name: '质量动量策略腿' })).toBeInTheDocument();
    expect(screen.getByText('来源子视图')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '压力代理' }));
    expect(screen.getByText(/美国国债 10Y \/ 现金缓冲/)).toBeInTheDocument();
  });
});
