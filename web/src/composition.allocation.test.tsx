import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CompositionAllocationConfigPage,
  CompositionAllocationResultPage,
} from './pages/composition-allocation-page';

type FakeApi = {
  createCompositionAllocationJob?: ReturnType<typeof vi.fn>;
  getCompositionDetail?: ReturnType<typeof vi.fn>;
  getCompositionAllocationJob?: ReturnType<typeof vi.fn>;
  updateComposition?: ReturnType<typeof vi.fn>;
};

const fakeApi = vi.hoisted<FakeApi>(() => ({
  createCompositionAllocationJob: vi.fn(),
  getCompositionDetail: vi.fn(),
  getCompositionAllocationJob: vi.fn(),
  updateComposition: vi.fn(),
}));

const { navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  useApiClient: () => fakeApi,
}));

vi.mock('./lib/appRouteContext', () => ({
  navigateTo: navigateToMock,
}));

const detail = {
  id: 'comp-001',
  name: '全天候研究组合',
  updated_at: '2026-04-28T00:00:00.000Z',
  benchmark_definition: { label: '60/40 基准' },
  kpis: [
    { key: 'annualized_return', value: 24.8 },
    { key: 'volatility', value: 13.6 },
    { key: 'max_drawdown', value: 12.8 },
    { key: 'sharpe', value: 1.71 },
  ],
  return_quality_summary: { status: 'verified' },
  returns_preview: [
    { date: '2018-10-31', label: '2018-10', net_return_pct: -1, portfolio_return_pct: -0.9 },
    { date: '2018-11-30', label: '2018-11', net_return_pct: -6, portfolio_return_pct: -5.8 },
    { date: '2018-12-31', label: '2018-12', net_return_pct: -7, portfolio_return_pct: -6.9 },
    { date: '2020-02-29', label: '2020-02', net_return_pct: -2, portfolio_return_pct: -1.9 },
    { date: '2020-03-31', label: '2020-03', net_return_pct: -5, portfolio_return_pct: -4.9 },
    { date: '2020-04-30', label: '2020-04', net_return_pct: 3, portfolio_return_pct: 3.1 },
    { date: '2020-05-31', label: '2020-05', net_return_pct: 1, portfolio_return_pct: 1.1 },
    { date: '2022-01-31', label: '2022-01', net_return_pct: -1, portfolio_return_pct: -0.9 },
    { date: '2022-02-28', label: '2022-02', net_return_pct: -3, portfolio_return_pct: -2.8 },
    { date: '2022-03-31', label: '2022-03', net_return_pct: 1, portfolio_return_pct: 1.1 },
    { date: '2022-04-30', label: '2022-04', net_return_pct: -2, portfolio_return_pct: -1.9 },
  ],
  benchmark_series: [
    { date: '2018-10-31', label: '2018-10', benchmark_return_pct: -3 },
    { date: '2018-11-30', label: '2018-11', benchmark_return_pct: -8 },
    { date: '2018-12-31', label: '2018-12', benchmark_return_pct: -10 },
    { date: '2020-02-29', label: '2020-02', benchmark_return_pct: -6 },
    { date: '2020-03-31', label: '2020-03', benchmark_return_pct: -12 },
    { date: '2020-04-30', label: '2020-04', benchmark_return_pct: 5 },
    { date: '2020-05-31', label: '2020-05', benchmark_return_pct: 2 },
    { date: '2022-01-31', label: '2022-01', benchmark_return_pct: -5 },
    { date: '2022-02-28', label: '2022-02', benchmark_return_pct: -8 },
    { date: '2022-03-31', label: '2022-03', benchmark_return_pct: 1 },
    { date: '2022-04-30', label: '2022-04', benchmark_return_pct: -6 },
  ],
  normalized_legs: [
    {
      id: 'alpha-core',
      leg_kind: 'strategy',
      display_name: 'Alpha Core',
      weight_pct: 38,
      weight_locked: false,
    },
    {
      id: 'qqq-grid',
      leg_kind: 'strategy',
      display_name: 'QQQ Grid',
      weight_pct: 22,
      weight_locked: false,
    },
    {
      id: 'tbill',
      leg_kind: 'asset',
      display_name: 'T-Bill',
      weight_pct: 30,
      weight_locked: true,
    },
    {
      id: 'cash',
      leg_kind: 'cash',
      display_name: 'Cash',
      weight_pct: 10,
      weight_locked: true,
    },
  ],
};

const allocationJob = {
  id: 'alloc-001',
  job_id: 'alloc-001',
  composition_id: 'comp-001',
  status: 'COMPLETED',
  created_at: '2026-04-28T00:00:00.000Z',
  completed_at: '2026-04-28T00:00:00.000Z',
  request: {},
  summary: { candidate_count: 4, quality_label: 'heuristic_from_composition_detail_preview' },
  candidates: [
    {
      id: 'current',
      label: 'Current',
      rank: 1,
      weights: { 'alpha-core': 38, 'qqq-grid': 22, tbill: 30, cash: 10 },
      metrics: { annualized_return: 24.8, volatility: 13.6, sharpe: 1.71, max_drawdown: 12.8, estimated_turnover_pct: 0 },
      thesis: 'Current saved allocation.',
      quality_label: 'heuristic_from_composition_detail_preview',
      evidence_label: 'Derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills.',
      constraint_violations: [],
      allowed_actions: [],
    },
    {
      id: 'benchmark',
      label: '60/40 基准',
      rank: 2,
      weights: { 'alpha-core': 38, 'qqq-grid': 22, tbill: 30, cash: 10 },
      metrics: { annualized_return: 8.7, volatility: 10.4, sharpe: 0.92, max_drawdown: 18.6, estimated_turnover_pct: 0 },
      thesis: 'Benchmark reference portfolio for comparison only.',
      quality_label: 'heuristic_from_composition_detail_preview',
      evidence_label: 'Derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills.',
      constraint_violations: [],
      allowed_actions: [],
    },
    {
      id: 'min_vol',
      label: 'Min Vol preview',
      rank: 3,
      weights: { 'alpha-core': 33, 'qqq-grid': 22, tbill: 30, cash: 15 },
      metrics: { annualized_return: 24.7, volatility: 13.2, sharpe: 1.74, max_drawdown: 12.4, estimated_turnover_pct: 5 },
      thesis: 'Shifts a small sleeve budget away from the highest risk contribution.',
      quality_label: 'heuristic_from_composition_detail_preview',
      evidence_label: 'Derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills.',
      constraint_violations: [],
      allowed_actions: ['promote_candidate'],
    },
    {
      id: 'risk_parity',
      label: 'Risk Parity preview',
      rank: 4,
      weights: { 'alpha-core': 24, 'qqq-grid': 31, tbill: 35, cash: 10 },
      metrics: { annualized_return: 24.8, volatility: 13.4, sharpe: 1.79, max_drawdown: 12.65, estimated_turnover_pct: 20 },
      thesis: 'Approximates equal risk contribution from inverse realized volatility while honoring allocation constraints.',
      quality_label: 'heuristic_from_composition_detail_preview',
      evidence_label: 'Derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills.',
      constraint_violations: [],
      allowed_actions: ['promote_candidate'],
    },
    {
      id: 'max_sharpe',
      label: 'Max Sharpe preview',
      rank: 5,
      weights: { 'alpha-core': 43, 'qqq-grid': 22, tbill: 30, cash: 5 },
      metrics: { annualized_return: 25.0, volatility: 14.0, sharpe: 1.79, max_drawdown: 13.35, estimated_turnover_pct: 5 },
      thesis: 'Shifts a small sleeve budget toward the highest return contribution.',
      quality_label: 'heuristic_from_composition_detail_preview',
      evidence_label: 'Derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills.',
      constraint_violations: [],
      allowed_actions: ['promote_candidate'],
    },
  ],
  frontier_points: [
    { id: 'current', label: 'Current', return_pct: 24.8, risk_pct: 13.6, sharpe: 1.71 },
    { id: 'benchmark', label: '60/40 基准', return_pct: 8.7, risk_pct: 10.4, sharpe: 0.92 },
    { id: 'min_vol', label: 'Min Vol preview', return_pct: 24.7, risk_pct: 13.2, sharpe: 1.74 },
    { id: 'risk_parity', label: 'Risk Parity preview', return_pct: 24.8, risk_pct: 13.4, sharpe: 1.79 },
    { id: 'max_sharpe', label: 'Max Sharpe preview', return_pct: 25.0, risk_pct: 14.0, sharpe: 1.79 },
  ],
  residual_budget: {},
  covariance_preview: [],
  return_quality_summary: {},
  source_integrity: [],
  audit_trail: [],
  evidence: {},
  warnings: [],
};

describe('Composition allocation split UI', () => {
  beforeEach(() => {
    fakeApi.createCompositionAllocationJob = vi.fn().mockResolvedValue({
      id: 'alloc-001',
      job_id: 'alloc-001',
      composition_id: 'comp-001',
      status: 'COMPLETED',
      created_at: '2026-04-28T00:00:00.000Z',
      request: {},
      summary: {},
      candidates: [],
      frontier_points: [],
      residual_budget: {},
      covariance_preview: [],
      return_quality_summary: {},
      source_integrity: [],
      audit_trail: [],
      evidence: {},
      warnings: [],
    });
    fakeApi.getCompositionDetail = vi.fn().mockResolvedValue(detail);
    fakeApi.getCompositionAllocationJob = vi.fn().mockResolvedValue(allocationJob);
    fakeApi.updateComposition = vi.fn().mockResolvedValue({ id: 'comp-001' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the config split page with intent navigation, risk controls, chips, and progressive expert settings', async () => {
    await act(async () => {
      render(<CompositionAllocationConfigPage compositionId="comp-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '组合优化实验室' })).toBeInTheDocument();
    expect(fakeApi.getCompositionDetail).toHaveBeenCalledWith('comp-001');
    expect(screen.getByRole('button', { name: /波动最小/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /均衡 风险平价/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /收益最大/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /专家模式/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '目标波动率' })).toHaveValue('8');
    expect(screen.getByRole('button', { name: '10年' })).toHaveClass('is-active');
    expect(screen.getByRole('button', { name: '中 18%' })).toHaveClass('is-active');
    expect(screen.getByRole('button', { name: /现金 10%/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /代理数据门禁开启/ })).toBeInTheDocument();
    expect(screen.getByText('剩余 60% 权重可优化')).toBeInTheDocument();
    expect(screen.getByLabelText('协方差热力图')).toBeInTheDocument();
    expect(screen.queryByLabelText('均值方差模型')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: '目标波动率' }), { target: { value: '9' } });
    expect(screen.getByText('9% ± 2%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /专家模式/ }));
    expect(screen.getByLabelText('均值方差模型')).toBeInTheDocument();
    expect(screen.getByLabelText('协方差模型')).toBeInTheDocument();
    expect(screen.getByLabelText('半衰期')).toBeInTheDocument();
    expect(screen.getByText('基于历史填充预期年化收益')).toBeInTheDocument();
  });

  it('creates an allocation job and navigates to the generated candidate result', async () => {
    await act(async () => {
      render(<CompositionAllocationConfigPage compositionId="comp-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '组合优化实验室' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始生成候选方案' }));

    await waitFor(() => {
      expect(fakeApi.createCompositionAllocationJob).toHaveBeenCalledWith(
        'comp-001',
        expect.objectContaining({
          intent: 'min_vol',
          target_volatility_pct: 8,
          volatility_band_pct: 2,
          lookback_window: '10y',
          history_window_years: 10,
          max_turnover_bucket: 'medium',
          max_turnover_pct: 18,
        }),
      );
    });
    expect(navigateToMock).toHaveBeenCalledWith('/compositions/comp-001/allocation-jobs/alloc-001');
  });

  it('renders asset bounds as sliders, numeric inputs, and lock controls', async () => {
    await act(async () => {
      render(<CompositionAllocationConfigPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 2, name: '资产微调' });
    expect(screen.getByRole('columnheader', { name: '资产腿' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '当前权重' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '权重下限' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '权重上限' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '锁定状态' })).toBeInTheDocument();
    expect(document.querySelector('[data-ui="allocation-constraint-popover"]')).toBeNull();
    const adjustmentRows = Array.from(document.querySelectorAll('.composition-allocation-table tbody tr')).map((row) =>
      row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
    expect(adjustmentRows.slice(0, 4).map((row) => row.match(/^(阿尔法核心策略|美国3个月短期国债|QQQ 网格策略|现金安全垫)/)?.[1])).toEqual([
      '阿尔法核心策略',
      '美国3个月短期国债',
      'QQQ 网格策略',
      '现金安全垫',
    ]);

    const alphaMinSlider = screen.getByRole('slider', { name: '阿尔法核心策略 权重下限滑块' });
    const alphaMinInput = screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' });
    const alphaMaxSlider = screen.getByRole('slider', { name: '阿尔法核心策略 权重上限滑块' });
    const alphaMaxInput = screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重上限输入' });
    expect(alphaMinSlider).toHaveAttribute('max', '100');
    expect(alphaMaxSlider).toHaveAttribute('min', '0');
    expect(alphaMinSlider).toHaveValue('17');
    expect(alphaMinInput).toHaveValue(17);
    expect(alphaMaxSlider).toHaveValue('51');
    expect(alphaMaxInput).toHaveValue(51);

    fireEvent.change(alphaMinInput, { target: { value: '55' } });
    expect(alphaMinSlider).toHaveValue('55');
    expect(alphaMaxInput).toHaveValue(51);
    fireEvent.blur(alphaMinInput);
    expect(alphaMaxInput).toHaveValue(55);

    fireEvent.change(alphaMaxInput, { target: { value: '20' } });
    expect(alphaMaxSlider).toHaveValue('20');
    expect(alphaMinInput).toHaveValue(55);
    fireEvent.blur(alphaMaxInput);
    expect(alphaMinInput).toHaveValue(20);

    fireEvent.change(alphaMinInput, { target: { value: '25' } });
    fireEvent.blur(alphaMinInput);
    fireEvent.change(alphaMaxInput, { target: { value: '25' } });
    fireEvent.blur(alphaMaxInput);
    await waitFor(() => {
      expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' })).toHaveValue(25);
      expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重上限输入' })).toHaveValue(25);
    });
    fireEvent.click(screen.getByRole('button', { name: '锁定 阿尔法核心策略' }));
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' })).toHaveValue(25);
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重上限输入' })).toHaveValue(25);

    fireEvent.click(screen.getByRole('button', { name: '解锁 阿尔法核心策略' }));
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' })).not.toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' })).toHaveValue(17);
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重上限输入' })).toHaveValue(51);

    const unlockedAlphaMinInput = screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' });
    fireEvent.change(unlockedAlphaMinInput, { target: { value: '21' } });
    fireEvent.blur(unlockedAlphaMinInput);
    const unlockedAlphaMaxInput = screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重上限输入' });
    fireEvent.change(unlockedAlphaMaxInput, { target: { value: '49' } });
    fireEvent.blur(unlockedAlphaMaxInput);
    fireEvent.click(screen.getByRole('button', { name: '锁定 阿尔法核心策略' }));
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' })).toHaveValue(38);
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重上限输入' })).toHaveValue(38);

    fireEvent.click(screen.getByRole('button', { name: '解锁 阿尔法核心策略' }));
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' })).not.toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重下限输入' })).toHaveValue(17);
    expect(screen.getByRole('spinbutton', { name: '阿尔法核心策略 权重上限输入' })).toHaveValue(51);

    fireEvent.click(screen.getByRole('button', { name: '解锁 现金安全垫' }));
    const cashMinInput = screen.getByRole('spinbutton', { name: '现金安全垫 权重下限输入' });
    const cashMaxInput = screen.getByRole('spinbutton', { name: '现金安全垫 权重上限输入' });
    fireEvent.change(cashMinInput, { target: { value: '2' } });
    fireEvent.blur(cashMinInput);
    fireEvent.change(cashMaxInput, { target: { value: '2' } });
    fireEvent.blur(cashMaxInput);
    fireEvent.click(screen.getByRole('button', { name: '锁定 现金安全垫' }));
    expect(screen.getByRole('spinbutton', { name: '现金安全垫 权重下限输入' })).toHaveValue(2);
    expect(screen.getByRole('spinbutton', { name: '现金安全垫 权重上限输入' })).toHaveValue(2);
    const cashRow = screen.getByRole('row', { name: /现金安全垫/ });
    expect(within(cashRow).getByText('10%')).toBeInTheDocument();
    expect(within(cashRow).getByText('固定 2%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '现金 2% · 点击修改' })).toBeInTheDocument();
  });

  it('responds to precheck chips and submits edited bound and lock constraints', async () => {
    await act(async () => {
      render(<CompositionAllocationConfigPage compositionId="comp-001" />);
    });

    await screen.findByRole('heading', { level: 2, name: '3. 约束预检' });
    expect(document.querySelector('[data-ui="allocation-precheck-feedback"]')).toBeNull();

    const cashChip = screen.getByRole('button', { name: '现金 10% · 点击修改' });
    fireEvent.click(cashChip);
    expect(cashChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('已选约束标签：现金权重')).toBeInTheDocument();
    expect(document.querySelector('[data-ui="allocation-precheck-feedback"]')).not.toBeNull();
    expect(screen.getByRole('spinbutton', { name: '现金安全垫 权重下限输入' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '解锁 美国3个月短期国债' }));
    const tbillMinInput = screen.getByRole('spinbutton', { name: '美国3个月短期国债 权重下限输入' });
    const tbillMaxSlider = screen.getByRole('slider', { name: '美国3个月短期国债 权重上限滑块' });
    expect(tbillMinInput).not.toBeDisabled();
    expect(tbillMinInput).toHaveValue(14);
    expect(screen.getByRole('spinbutton', { name: '美国3个月短期国债 权重上限输入' })).toHaveValue(41);

    fireEvent.change(tbillMinInput, { target: { value: '16' } });
    fireEvent.change(tbillMaxSlider, { target: { value: '42' } });

    fireEvent.click(screen.getByRole('button', { name: '开始生成候选方案' }));

    await waitFor(() => {
      const payload = fakeApi.createCompositionAllocationJob?.mock.calls[0]?.[1];
      expect(payload?.constraints.legs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'tbill',
            locked: false,
            min_weight_pct: 16,
            max_weight_pct: 42,
          }),
        ]),
      );
    });
  });

  it('renders the v5 selector result page and promotes the selected candidate through the confirmation dialog', async () => {
    await act(async () => {
      render(<CompositionAllocationResultPage compositionId="comp-001" jobId="alloc-001" />);
    });

    expect(await screen.findByRole('heading', { level: 1, name: '组合优化结果' })).toBeInTheDocument();
    await waitFor(() => {
      expect(fakeApi.getCompositionAllocationJob).toHaveBeenCalledWith('comp-001', 'alloc-001');
    });
    expect(screen.queryByText('目标对齐')).not.toBeInTheDocument();
    expect(document.querySelector('[data-ui="allocation-delta-summary"]')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: '有效前沿 · 迁移向量' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '相对表现 · 提议方案 / 当前组合 - 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '极端行情压力测试' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '候选选择器 · 多维度选拔赛' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '执行决策' })).toBeInTheDocument();
    expect(screen.getByText('上方不可达到')).toBeInTheDocument();
    expect(document.querySelector('.composition-allocation-frontier__unreachable')).not.toBeNull();
    expect(document.querySelector('.composition-allocation-frontier__curve-line')).not.toBeNull();

    const selector = document.querySelector<HTMLElement>('[data-ui="allocation-candidate-selector"]');
    expect(selector).not.toBeNull();
    const resultsGrid = document.querySelector<HTMLElement>('.composition-allocation-results-grid');
    const decisionCard = document.querySelector<HTMLElement>('[data-ui="allocation-decision-card"]');
    const stressPanel = document.querySelector<HTMLElement>('[data-ui="allocation-stress-test"]');
    expect(resultsGrid).not.toBeNull();
    expect(decisionCard).not.toBeNull();
    expect(stressPanel).not.toBeNull();
    expect(selector!.compareDocumentPosition(resultsGrid!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(resultsGrid!.children[0]).toHaveClass('composition-allocation-evidence-stack');
    expect(resultsGrid!.children[1]).toHaveAttribute('data-ui', 'allocation-decision-card');
    expect(resultsGrid!.querySelector('[data-ui="allocation-stress-test"]')).toBeNull();
    expect(stressPanel!.parentElement).toHaveAttribute('data-page-root', 'composition-allocation-result');
    const rows = within(selector!).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(/^年化收益率/);

    expect(within(selector!).getByText('基准组合')).toBeInTheDocument();
    expect(within(selector!).getByText('60/40 基准')).toBeInTheDocument();
    expect(within(selector!).queryByText('无决策动作')).not.toBeInTheDocument();
    expect(within(selector!).queryByText('仅作对照')).not.toBeInTheDocument();
    expect(rows.at(-1)).toHaveTextContent('决策动作查看方案查看方案查看方案');
    const drawdownDelta = within(selector!).getByText('改善 0.4pt');
    expect(drawdownDelta.closest('.composition-allocation-selector-value')).toHaveClass(
      'composition-allocation-selector-value--good',
    );
    expect(drawdownDelta.closest('td')).toHaveClass('composition-allocation-selector-cell--good');

    const displayButton = within(selector!).getByRole('button', { name: '选择目标' });
    expect(displayButton).toHaveAttribute('aria-expanded', 'false');
    expect(within(selector!).queryByRole('menu', { name: '目标选择' })).not.toBeInTheDocument();
    fireEvent.click(displayButton);
    expect(displayButton).toHaveAttribute('aria-expanded', 'true');
    const objectiveMenu = within(selector!).getByRole('menu', { name: '目标选择' });
    expect(objectiveMenu).toBeInTheDocument();
    expect(within(objectiveMenu).queryByText('1')).not.toBeInTheDocument();
    expect(within(selector!).getByRole('menuitemradio', { name: /最小波动/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(selector!).getByRole('menuitemradio', { name: /风险平价/ })).toBeInTheDocument();
    expect(within(selector!).getByRole('menuitemradio', { name: /最大夏普/ })).toBeInTheDocument();
    fireEvent.click(displayButton);
    expect(displayButton).toHaveAttribute('aria-expanded', 'false');
    expect(rows[1]).toHaveTextContent('24.8%');
    expect(within(selector!).getAllByRole('button', { name: '查看方案' })).toHaveLength(3);

    const worstStressCard = within(stressPanel!).getByText('历史最差三个月 (实际窗口)').closest('article');
    expect(worstStressCard).not.toBeNull();
    expect(within(worstStressCard!).getByText('-13.45%')).toBeInTheDocument();

    const covidStressCard = within(stressPanel!).getByText('2020 疫情冲击 (实际窗口)').closest('article');
    expect(covidStressCard).not.toBeNull();
    expect(within(covidStressCard!).getByText('-6.90%')).toBeInTheDocument();
    expect(within(covidStressCard!).getByText('-17.28%')).toBeInTheDocument();
    expect(within(covidStressCard!).getByText('+0.1pt')).toBeInTheDocument();
    expect(within(covidStressCard!).getByText('+0.1pt').closest('div')).toHaveClass(
      'composition-allocation-stress-kpi--good',
    );
    expect(covidStressCard!.querySelector('.composition-allocation-stress-track__candidate')).toHaveClass(
      'composition-allocation-stress-track__candidate--good',
    );
    const rateShockCard = within(stressPanel!).getByText('2022 紧缩熊市 (实际窗口)').closest('article');
    expect(rateShockCard).not.toBeNull();
    expect(within(rateShockCard!).getByText('-4.95%')).toBeInTheDocument();
    expect(within(rateShockCard!).getByText('-17.02%')).toBeInTheDocument();
    expect(within(rateShockCard!).queryByText('-34.90%')).not.toBeInTheDocument();
    expect(within(stressPanel!).getAllByText('当前与基准来自组合真实收益窗口；候选按运行时候选峰值回撤比例投影。')).toHaveLength(3);

    fireEvent.click(within(selector!).getAllByRole('button', { name: '查看方案' })[0]);
    expect(screen.getAllByText('最小波动预览').length).toBeGreaterThan(0);
    expect(screen.getByText(/已符合最小波动意图/)).toBeInTheDocument();

    fireEvent.click(within(selector!).getByRole('button', { name: '选择目标' }));
    fireEvent.click(within(selector!).getByRole('menuitemradio', { name: /风险平价/ }));
    expect(screen.getAllByText('风险平价预览').length).toBeGreaterThan(0);
    const riskParitySnapshot = document.querySelector<HTMLElement>('[data-ui="frontier-weight-snapshot"]');
    expect(riskParitySnapshot).toHaveTextContent('风险平价预览');
    expect(riskParitySnapshot).toHaveTextContent('24.0%');
    expect(riskParitySnapshot).toHaveTextContent('31.0%');
    expect(riskParitySnapshot).toHaveTextContent('35.0%');
    expect(riskParitySnapshot).not.toHaveTextContent(/25\.0%.*25\.0%.*25\.0%.*25\.0%/);
    expect(within(selector!).getAllByRole('button', { name: '查看方案' })).toHaveLength(3);

    fireEvent.click(within(selector!).getByRole('button', { name: '选择目标' }));
    fireEvent.click(within(selector!).getByRole('menuitemradio', { name: /最大夏普/ }));
    const benchmarkPoint = screen.getByRole('button', { name: '基准组合前沿点' });
    const maxSharpePoint = screen.getByRole('button', { name: '最大夏普预览前沿点' });
    expect(benchmarkPoint).not.toHaveClass('is-selected');
    expect(benchmarkPoint).not.toHaveClass('is-current-hover');
    expect(maxSharpePoint).toHaveClass('is-selected');
    expect(maxSharpePoint).toHaveClass('is-current-hover');
    expect(document.querySelector('.composition-allocation-frontier__legend')).toHaveTextContent('红色空心点 基准组合');
    expect(document.querySelector('[data-ui="frontier-weight-snapshot"]')).toHaveTextContent('最大夏普预览');

    const audit = document.querySelector<HTMLElement>('[data-ui="allocation-audit"]');
    expect(audit).not.toBeNull();
    expect(within(audit!).queryByRole('button', { name: '查看完整审计日志' })).not.toBeInTheDocument();
    expect(audit!.querySelector('#allocation-audit-log')).toBeNull();

    const pageText = document.querySelector('[data-page-root="composition-allocation-result"]')?.textContent ?? '';
    expect(pageText).toContain('当前组合收益 24.8%');
    expect(pageText).not.toContain('唯一入口位于执行决策卡');
    expect(pageText).not.toContain('收益 10.9%');
    expect(pageText).not.toMatch(
      /Min Vol|Current|Risk Parity|Max Sharpe|Benchmark|查看详情|另存为实验|一键晋升 v1\.3/,
    );

    fireEvent.click(screen.getByRole('button', { name: '一键晋升版本' }));
    expect(screen.getByRole('dialog', { name: '确认晋升版本' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认晋升' }));

    expect(screen.getByRole('button', { name: '确认晋升' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '升级理由' }), {
      target: { value: '采用配置实验室候选，降低组合风险暴露。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认晋升' }));

    await waitFor(() => {
      expect(fakeApi.updateComposition).toHaveBeenCalledWith(
        'comp-001',
        expect.objectContaining({
          legs: expect.arrayContaining([
            expect.objectContaining({
              display_name: '阿尔法核心策略',
              leg_kind: 'strategy',
              source_ref_id: 'alpha-core',
              weight_pct: expect.any(Number),
            }),
          ]),
          version_reason: '采用配置实验室候选，降低组合风险暴露。',
          version_source: 'allocation_promotion',
          version_candidate_id: expect.any(String),
          version_candidate_label: expect.any(String),
        }),
      );
    });
    expect(await screen.findByText(/已提交版本晋升：最大夏普预览/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看详情' })).not.toBeInTheDocument();
  });

  it('keeps the benchmark as the only red hollow point on the frontier', () => {
    const css = readFileSync(join(process.cwd(), 'src/pages/composition-allocation-page.css'), 'utf8');
    const benchmarkRule = css.match(/\.composition-allocation-frontier__point--benchmark\s*\{[^}]+\}/)?.[0] ?? '';
    const maxSharpeRules = Array.from(
      css.matchAll(/[^{}]*\.composition-allocation-frontier__point--max-sharpe[^{}]*\{[^}]+\}/g),
    )
      .map((match) => match[0])
      .join('\n');
    const dimmedRule = css.match(/\.composition-allocation-frontier__point\.is-dimmed\s*\{[^}]+\}/)?.[0] ?? '';

    expect(benchmarkRule).toContain('#c45c4f');
    expect(maxSharpeRules).not.toMatch(/#c45c4f|#b86813/i);
    expect(dimmedRule).toContain('#64748b');
  });
});
