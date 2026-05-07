import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeFactorApi = vi.hoisted(() => ({
  listFactors: vi.fn(),
  getFactor: vi.fn(),
  getPitDataOverview: vi.fn(),
  runFactorDiagnostics: vi.fn(),
  previewFactorDiagnostics: vi.fn(),
  getFactorGovernanceOverview: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({ useApiClient: () => fakeFactorApi }));

import FactorModelBuilderPage, {
  type FactorModelCreateResponse,
  type FactorModelOption,
  type FactorModelPreview,
  type FactorModelPreviewPayload,
} from './pages/factor-model-builder-page';
import { FactorDetailPage, FactorLibraryPage } from './pages/factors-page';
import type { ApiFactorDetail, ApiFactorListItem, ApiPitDataOverview } from './types';

function makeReadyPreview(overrides: Partial<FactorModelPreview> = {}): FactorModelPreview {
  return {
    status: 'READY',
    coveragePct: 91.25,
    factorCount: 5,
    readyFactorCount: 5,
    universeSymbolCount: 10,
    turnoverPct: 18.4,
    scoreSpread: 1.37,
    scorePreview: [
      { symbol: 'NVDA', score: 0.92, coveragePct: 100 },
      { symbol: 'MSFT', score: 0.61, coveragePct: 90 },
      { symbol: 'AAPL', score: 0.44, coveragePct: 100 },
      { symbol: 'AMZN', score: 0.12, coveragePct: 90 },
      { symbol: 'META', score: -0.08, coveragePct: 100 },
      { symbol: 'GOOGL', score: -0.21, coveragePct: 90 },
      { symbol: 'TSLA', score: -0.39, coveragePct: 70 },
      { symbol: 'AMD', score: -0.45, coveragePct: 80 },
    ],
    normalizedWeights: [
      { factorId: 's_mom_12m1m_rank', weightPct: 30, normalizedWeightPct: 30, direction: 'HIGH_IS_GOOD' },
      { factorId: 's_val_ep_ltm_raw', weightPct: 20, normalizedWeightPct: 20, direction: 'HIGH_IS_GOOD' },
      { factorId: 's_qlty_fcfy_ttm_raw', weightPct: 20, normalizedWeightPct: 20, direction: 'HIGH_IS_GOOD' },
      { factorId: 's_vol_252d_rank', weightPct: 15, normalizedWeightPct: 15, direction: 'LOW_IS_GOOD' },
      { factorId: 's_size_cur_log', weightPct: 15, normalizedWeightPct: 15, direction: 'LOW_IS_GOOD' },
    ],
    pitBlockers: [],
    neutralizationStatus: {
      enabled: false,
      method: 'industry',
      status: 'DISABLED',
      blockers: [],
    },
    warnings: [],
    ...overrides,
  };
}

function makeFactor(overrides: Partial<ApiFactorListItem> = {}): ApiFactorListItem {
  return {
    id: 's_mom_12m1m_rank',
    name: '12-1月截面动量排名',
    market: 'US',
    universe: 'SP500',
    created_at: '2026-05-01T09:00:00Z',
    updated_at: '2026-05-05T09:00:00Z',
    source: 'SYSTEM_SEED',
    lifecycle_status: 'VERIFIED',
    diagnostic_status: 'COMPLETED',
    ui_state: 'robust',
    ui_state_label: '稳健',
    direction: 'HIGH_IS_BETTER',
    frequency: 'DAILY',
    expression: 'Rank(Return(Close, 252) - Return(Close, 21))',
    descriptor: {
      canonical_id: 's_mom_12m1m_rank',
      source_prefix: 's',
      category: 'mom',
      metric: '12m1m',
      window: '252d',
      operator: 'rank',
      schema_version: '1',
    },
    tags: ['mom'],
    data_requirements: ['adj_close', 'price_history', 'returns'],
    latest_diagnostic_summary: {
      run_id: 'diag_mom_latest',
      status: 'COMPLETED',
      rank_ic: 0.052,
      ir: 0.42,
      coverage: 92.4,
      group_returns: [],
      ic_series: [],
      compliance_trail: { diagnosed_at: '2026-05-05T09:00:00Z' },
    },
    last_diagnostic_run_id: 'diag_mom_latest',
    readiness_blockers: [],
    ic_sparkline: [
      { date: '2026-05-01', value: 0.02 },
      { date: '2026-05-02', value: 0.05 },
    ],
    ic_sparkline_window: '12m',
    gate_fix_target: '#/pit-data',
    ...overrides,
  };
}

function makeFactorDetail(overrides: Partial<ApiFactorDetail> = {}): ApiFactorDetail {
  const base = makeFactor({
    id: 's_alpha_ffblend_cur_rank',
    name: 'Fama-French 风格合成 Alpha',
    diagnostic_status: 'SANDBOX_READY',
    latest_diagnostic_summary: null,
    last_diagnostic_run_id: null,
  }) as ApiFactorDetail;
  return {
    ...base,
    versions: [
      {
        id: 's_alpha_ffblend_cur_rank-v1',
        version: 1,
        expression: base.expression,
        status: 'ACTIVE',
        metadata: {},
        created_at: '2026-05-05T09:00:00Z',
      },
    ],
    correlation_cluster: {
      anchor_factor_id: 's_alpha_ffblend_cur_rank',
      top_n: 0,
      method: 'test',
      nodes: [],
    },
    ...overrides,
  };
}

function makePitOverview(): ApiPitDataOverview {
  return {
    as_of_date: '2026-05-05',
    overall_status: 'READY',
    cleaning_version: 'clean_v1',
    adjusted_price_status: 'READY',
    universe_status: 'READY',
    outlier_cleaning_status: 'READY',
    dataset_snapshot_id: 'ds_test',
    universe_snapshot_id: 'uv_test',
    coverage: {
      covered_symbol_count: 500,
      total_symbol_count: 500,
      coverage_pct: 100,
      price_bar_rows: 1000,
      universe_member_rows: 500,
    },
    verified_diagnostics_enabled: true,
    sandbox_diagnostics_enabled: true,
    factor_diagnostics_enabled: true,
    blocking_items: [],
    sample_securities: [],
    quality_events: [],
    coverage_gap: {
      missing_symbol_count: 0,
      missing_share_pct: 0,
      covered_symbol_count: 500,
      total_symbol_count: 500,
      default_ignored_symbols: [],
      default_ignored_count: 0,
      evidence_source: 'test',
      recommendation: 'none',
      buckets: [],
    },
    diagnostic_windows: {
      verified: { mode: 'VERIFIED', enabled: true, start_date: '2016-01-01', end_date: '2026-05-05', label: '10Y' },
      sandbox: { mode: 'SANDBOX', enabled: true, start_date: '2023-01-01', end_date: '2026-05-05', label: '3Y' },
    },
    gate_fix_target: '#/pit-data',
  };
}

afterEach(() => {
  cleanup();
  fakeFactorApi.listFactors.mockReset();
  fakeFactorApi.getFactor.mockReset();
  fakeFactorApi.getPitDataOverview.mockReset();
  fakeFactorApi.runFactorDiagnostics.mockReset();
  fakeFactorApi.previewFactorDiagnostics.mockReset();
  fakeFactorApi.getFactorGovernanceOverview.mockReset();
  window.location.hash = '';
});

describe('FactorModelBuilderPage', () => {
  it('renders the V1.7 model builder hero, basket, preview, neutralization, and gates', () => {
    render(<FactorModelBuilderPage />);

    expect(document.querySelector('[data-page-root="factor-model-builder"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '多因子策略创建' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '选择因子' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '权重与打分预览' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '策略创建风险' })).toBeInTheDocument();
    expect(screen.getAllByText('12-1月截面动量排名').length).toBeGreaterThan(0);
    expect(screen.getAllByText('滚动市盈率倒数 (LTM)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('自由现金流收益率 (TTM)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('即时对数总市值').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('策略名称')).toHaveValue('多因子核心模型');
    expect(screen.getByRole('button', { name: '启用行业中性化' })).toBeInTheDocument();
    expect(screen.getByLabelText('12-1月截面动量排名权重')).toBeInTheDocument();
    expect(screen.getAllByText('再平衡配置').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('每月')).toBeChecked();
    expect(screen.getByLabelText('每季度')).toBeInTheDocument();
    expect(screen.getByLabelText('每半年')).toBeInTheDocument();
    expect(screen.getByLabelText('每年')).toBeInTheDocument();
    expect(screen.getByLabelText('从不')).toBeInTheDocument();
    expect(screen.getAllByText('GICS · PIT 行业字段')[0]).toBeInTheDocument();
    expect(screen.queryByText('GICS Level 1 · PIT Snapshot · ZScore 后残差化')).not.toBeInTheDocument();
    expect(screen.getByText('基础面 available_at 校验')).toBeInTheDocument();
    expect(screen.getAllByText('多因子策略').length).toBeGreaterThanOrEqual(1);
    const selectPanel = document.querySelector('[aria-labelledby="factor-model-select"]');
    const previewPanel = document.querySelector('[aria-labelledby="factor-model-preview"]');
    const governanceRow = previewPanel?.querySelector('.factor-model-governance-row');
    expect(selectPanel?.textContent).not.toContain('再平衡配置');
    expect(governanceRow).not.toBeNull();
    expect(governanceRow?.children).toHaveLength(2);
    expect(governanceRow?.textContent).toContain('再平衡配置');
    expect(governanceRow?.textContent).toContain('启用行业中性化');
    expect(selectPanel?.querySelector('.factor-weight-control')).toBeNull();
    expect(selectPanel?.textContent).not.toContain('30%');
    expect(previewPanel?.querySelectorAll('.factor-weight-control')).toHaveLength(5);
    expect(previewPanel?.querySelector('.factor-model-weight-row__meta .factor-phase2-chip')).toBeNull();
    expect(screen.getByText('得分分布跨度')).toBeInTheDocument();
    expect(screen.getByText('覆盖稳健，可进入门禁复核。')).toBeInTheDocument();
    expect(screen.getByText('换手温和，成本压力可控。')).toBeInTheDocument();
    expect(screen.getByText('分层偏弱，建议调整权重或方向。')).toBeInTheDocument();
    expect(screen.getByText('等待预览接口返回样本')).toBeInTheDocument();
    expect(screen.getByText('零写入打分样本')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('accepts governance queue factor and weight prefill while staying in draft review mode', () => {
    render(
      <FactorModelBuilderPage
        initialPrefill={{
          source: 'governance_queue',
          factorIds: ['s_mom_12m1m_rank', 's_val_ep_ltm_raw'],
          weights: [20, 30],
          directions: ['HIGH_IS_BETTER', 'HIGH_IS_BETTER'],
          modelName: '自动挖掘因子待审查组合',
        }}
      />,
    );

    expect(screen.getByText('治理队列已代入')).toBeInTheDocument();
    expect(screen.getByText('草稿 / 待审查')).toBeInTheDocument();
    expect(screen.getByLabelText('策略名称')).toHaveValue('自动挖掘因子待审查组合');
    expect((document.querySelector('#factor-weight-s_mom_12m1m_rank') as HTMLInputElement | null)?.value).toBe('20');
    expect((document.querySelector('#factor-weight-s_val_ep_ltm_raw') as HTMLInputElement | null)?.value).toBe('30');
  });

  it('shows category, Rank IC, and IR tags in selector and weight factor cards', () => {
    const liveFactors: FactorModelOption[] = [
      {
        id: 's_mom_12m1m_rank',
        displayName: 'API 动量',
        family: '动量',
        categoryLabel: '动量',
        rankIcLabel: 'Rank IC 0.052',
        irLabel: 'IR 0.42',
        sourceLabel: '系统默认',
        diagnosticStatus: 'READY',
        pitCoveragePct: 100,
        defaultWeight: 100,
        defaultDirection: 'HIGH_IS_GOOD',
      },
    ];

    render(<FactorModelBuilderPage factors={liveFactors} useDefaultFallback={false} />);

    const selectorCard = screen.getByLabelText('选择API 动量').closest('.factor-pick');
    expect(selectorCard).not.toBeNull();
    expect(within(selectorCard as HTMLElement).getByText('类别 动量')).toBeInTheDocument();
    expect(within(selectorCard as HTMLElement).getByText('Rank IC 0.052')).toBeInTheDocument();
    expect(within(selectorCard as HTMLElement).getByText('IR 0.42')).toBeInTheDocument();
    expect(selectorCard?.textContent).not.toContain('高好');
    expect(selectorCard?.textContent).not.toContain('低好');

    const previewPanel = document.querySelector('[aria-labelledby="factor-model-preview"]');
    const weightCard = within(previewPanel as HTMLElement).getByText('API 动量').closest('.factor-model-weight-row');
    expect(weightCard).not.toBeNull();
    const weightTitle = weightCard?.querySelector('.factor-model-weight-row__title');
    expect(weightTitle).not.toBeNull();
    expect(within(weightTitle as HTMLElement).getByText('API 动量')).toBeInTheDocument();
    expect(within(weightTitle as HTMLElement).getByText('s_mom_12m1m_rank')).toHaveClass('factor-id');
    expect(within(weightCard as HTMLElement).getByText('类别 动量')).toBeInTheDocument();
    expect(within(weightCard as HTMLElement).getByText('Rank IC 0.052')).toBeInTheDocument();
    expect(within(weightCard as HTMLElement).getByText('IR 0.42')).toBeInTheDocument();
  });

  it('renders every live selector factor sorted by absolute IR descending', () => {
    const liveFactors: FactorModelOption[] = [
      ['f_low_positive', 'Low positive IR', 0.012, 0.18],
      ['f_high_negative', 'High negative IR', -0.091, -1.12],
      ['f_medium_positive', 'Medium positive IR', 0.052, 0.44],
      ['f_pending', 'Pending IR', null, null],
      ['f_second_negative', 'Second negative IR', -0.075, -0.87],
      ['f_tiny_positive', 'Tiny positive IR', 0.003, 0.05],
      ['f_top_positive', 'Top positive IR', 0.12, 1.35],
    ].map(([id, displayName, rankIc, ir]) => ({
      id: String(id),
      displayName: String(displayName),
      family: 'Test',
      categoryLabel: 'Test',
      rankIc: rankIc === null ? null : Number(rankIc),
      rankIcLabel: rankIc === null ? 'Rank IC 待诊断' : `Rank IC ${Number(rankIc).toFixed(3)}`,
      ir: ir === null ? null : Number(ir),
      irLabel: ir === null ? 'IR 待诊断' : `IR ${Number(ir).toFixed(2)}`,
      sourceLabel: 'API',
      diagnosticStatus: 'READY',
      pitCoveragePct: 100,
      defaultWeight: 0,
      defaultDirection: 'HIGH_IS_GOOD' as const,
    }));

    render(<FactorModelBuilderPage factors={liveFactors} useDefaultFallback={false} />);

    const selectorPanel = document.querySelector('[aria-labelledby="factor-model-select"]');
    expect(selectorPanel?.querySelectorAll('.factor-pick')).toHaveLength(7);
    expect(Array.from(selectorPanel?.querySelectorAll('.factor-pick strong') ?? []).map((node) => node.textContent)).toEqual([
      'Top positive IR',
      'High negative IR',
      'Second negative IR',
      'Medium positive IR',
      'Low positive IR',
      'Tiny positive IR',
      'Pending IR',
    ]);
  });

  it('can render the selector with all factors unchecked by default', () => {
    render(<FactorModelBuilderPage defaultSelectAll={false} />);

    const selectorPanel = document.querySelector('[aria-labelledby="factor-model-select"]');
    expect(Array.from(selectorPanel?.querySelectorAll<HTMLInputElement>('.factor-pick input[type="checkbox"]') ?? []).every((node) => !node.checked)).toBe(true);
    expect(document.querySelector('[aria-labelledby="factor-model-preview"] .factor-model-weight-row')).toBeNull();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('hydrates weights, score samples, and gate status through the injected preview API', async () => {
    const preview = makeReadyPreview();
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(preview);

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    expect(previewFactorModel.mock.calls[0][0]).toMatchObject({
      modelName: '多因子核心模型',
      rebalanceFrequency: 'monthly',
      neutralization: {
        enabled: false,
        taxonomy: 'GICS',
        level: 'Level 1',
        method: 'ZScore 后残差化',
      },
    });
    expect(previewFactorModel.mock.calls[0][0].factors.map((factor) => factor.weightPct)).toEqual([
      30,
      20,
      20,
      15,
      15,
    ]);
    expect(await screen.findByText('91.3%')).toBeInTheDocument();
    expect(screen.getByText('18.4%')).toBeInTheDocument();
    expect(screen.getAllByText('1.37')[0]).toBeInTheDocument();
    expect(screen.getByText('覆盖稳健，可进入门禁复核。')).toBeInTheDocument();
    expect(screen.getByText('换手适中，建议复核成本假设。')).toBeInTheDocument();
    expect(screen.getByText('分层清晰，可继续检查尾部风险。')).toBeInTheDocument();
    expect(screen.getByText('样本 8 个 · 分布跨度 1.37')).toBeInTheDocument();
    expect(screen.getAllByText('通过').length).toBeGreaterThanOrEqual(1);
  });

  it('lets operators choose rebalance frequency before preview and creation', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_quarterly_factor_model' });

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    expect(previewFactorModel.mock.calls[0][0].rebalanceFrequency).toBe('monthly');

    fireEvent.click(screen.getByLabelText('每季度'));

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(2));
    expect(previewFactorModel.mock.calls.at(-1)?.[0].rebalanceFrequency).toBe('quarterly');
    const rebalanceRow = screen
      .getAllByText('再平衡配置')
      .map((node) => node.closest('.audit-row'))
      .find(Boolean);
    expect(rebalanceRow).not.toBeNull();
    expect(within(rebalanceRow as HTMLElement).getByText('每季度')).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('button', { name: '创建可回测策略' })[0]);

    await waitFor(() => expect(createFactorModel).toHaveBeenCalledTimes(1));
    expect(createFactorModel.mock.calls[0][0].rebalanceFrequency).toBe('quarterly');
  });

  it('initializes live factors without design preset weights when the API does not provide suggestions', async () => {
    const liveFactors: FactorModelOption[] = [
      ['s_mom_12m1m_rank', 'API 动量', '动量', 'HIGH_IS_GOOD'],
      ['s_val_ep_ltm_raw', 'API 估值', '估值', 'HIGH_IS_GOOD'],
      ['s_qlty_fcfy_ttm_raw', 'API 质量', '质量', 'HIGH_IS_GOOD'],
      ['s_vol_252d_rank', 'API 低波', '低波', 'LOW_IS_GOOD'],
      ['s_size_cur_log', 'API 规模', '规模', 'LOW_IS_GOOD'],
    ].map(([id, displayName, family, direction]) => ({
      id,
      displayName,
      family,
      sourceLabel: '系统默认',
      diagnosticStatus: 'READY',
      pitCoveragePct: 100,
      defaultWeight: 0,
      defaultDirection: direction as FactorModelOption['defaultDirection'],
    }));
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());

    render(
      <FactorModelBuilderPage
        api={{ previewFactorModel }}
        factors={liveFactors}
        useDefaultFallback={false}
      />,
    );

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText('API 动量').length).toBeGreaterThan(0);
    expect(screen.queryByText('12-1月截面动量排名')).not.toBeInTheDocument();
    expect(previewFactorModel.mock.calls[0][0].factors.map((factor) => factor.weightPct)).toEqual([
      20,
      20,
      20,
      20,
      20,
    ]);
  });

  it('does not render default factor data when the live factor API returns no candidates', () => {
    const previewFactorModel = vi.fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>();

    render(<FactorModelBuilderPage api={{ previewFactorModel }} factors={[]} useDefaultFallback={false} />);

    expect(screen.getByText('因子接口未返回可用因子，当前无法创建策略。')).toBeInTheDocument();
    expect(screen.queryByText('12-1月截面动量排名')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
    expect(previewFactorModel).not.toHaveBeenCalled();
  });

  it('lets selected factor weights be adjusted and sends the new weights to preview', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('12-1月截面动量排名权重'), { target: { value: '25' } });

    const weightRow = screen.getByText('权重合计').closest('.audit-row');
    expect(weightRow).not.toBeNull();
    expect(within(weightRow as HTMLElement).getByText('95%')).toBeInTheDocument();
    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(2));
    expect(previewFactorModel.mock.calls.at(-1)?.[0].factors[0]).toMatchObject({
      factorId: 's_mom_12m1m_rank',
      weightPct: 25,
    });
  });

  it('does not synthesize a strategy when the preview API is wired but the create API is absent', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('shows high-correlation strategy risk without disabling creation', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview({
        strategy_creation_risk: {
          can_create: true,
          warning_count: 1,
          blocked_count: 0,
          warnings: [{
            code: 'HIGH_CORRELATION',
            severity: 'warning',
            label: '高相关提示',
            message: '与同族动量因子相关性偏高，仅作为策略创建风险提示。',
          }],
          hard_blockers: [],
          summary_label: '可创建，存在风险提示',
        },
      }));
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_high_corr_warning' });

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} />);

    expect(await screen.findByText('可创建但需提示：高相关提示。')).toBeInTheDocument();
    expect(screen.getAllByText('风险提示').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('button', { name: '创建可回测策略' })[0]);

    await waitFor(() => expect(createFactorModel).toHaveBeenCalledTimes(1));
  });

  it('shows low-risk PIT admission status without disabling creation', async () => {
    const lowRiskSummary =
      'PIT核心成员价格缺口为 0，209 个非核心缺口市值权重占比 0.00%，实盘准入风险极低。已转为创建提示，允许物化多因子策略。';
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview({
        pitBlockers: ['PRICE_SNAPSHOT_NOT_READY'],
        strategy_creation_risk: {
          can_create: true,
          warning_count: 1,
          blocked_count: 0,
          warnings: [{
            code: 'PRICE_SNAPSHOT_NOT_READY',
            severity: 'warning',
            label: '低风险准入',
            message: 'PIT核心成员价格缺口为 0，209 个非核心缺口市值权重占比 0.00%，实盘准入风险极低。',
          }],
          hard_blockers: [],
          summary_label: '低风险准入',
          summary: lowRiskSummary,
        },
      }));
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_low_risk_gap' });

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} />);

    expect((await screen.findAllByText('低风险准入')).length).toBeGreaterThan(0);
    expect(screen.getByText(lowRiskSummary)).toBeInTheDocument();
    expect(screen.getAllByText('低风险提示').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('button', { name: '创建可回测策略' })[0]);

    await waitFor(() => expect(createFactorModel).toHaveBeenCalledTimes(1));
  });

  it('disables creation when strategy creation risk reports a hard blocker', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview({
        strategy_creation_risk: {
          can_create: false,
          warning_count: 0,
          blocked_count: 1,
          warnings: [],
          hard_blockers: [{
            code: 'UNSAFE_EXPRESSION',
            severity: 'blocker',
            label: 'unsafe expression',
            message: '表达式包含未批准字段，不能进入正式回放。',
          }],
          summary_label: '存在硬阻断',
        },
      }));
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_should_not_create' });

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} />);

    expect(await screen.findByText('不能创建：不安全表达式。')).toBeInTheDocument();
    expect(screen.getAllByText('硬阻断').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
    expect(createFactorModel).not.toHaveBeenCalled();
  });

  it('requires an explicit strategy name before materialization', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_named' });

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());
    fireEvent.change(screen.getByLabelText('策略名称'), { target: { value: '   ' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled());
    expect(screen.getByText('当前阻塞：策略名称未填写。')).toBeInTheDocument();
  });

  it('keeps industry neutralization optional and blocks only when enabled without PIT fields', async () => {
    const blockedPreview = makeReadyPreview({
      status: 'BLOCKED',
      neutralizationStatus: {
        enabled: true,
        method: 'industry',
        status: 'NOT_EXECUTED_MISSING_INDUSTRY_PIT',
        blockers: ['MISSING_INDUSTRY_PIT'],
      },
      warnings: ['行业中性化需要 PIT 行业字段，本次预览仅返回 blocker，不执行残差化。'],
    });
    const readyWithoutNeutralization = makeReadyPreview({
      neutralizationStatus: {
        enabled: false,
        method: 'industry',
        status: 'DISABLED',
        blockers: [],
      },
    });
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockImplementation(async (payload) =>
        payload.neutralization.enabled ? blockedPreview : readyWithoutNeutralization,
      );
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_multifactor_no_neutralization' });

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} />);

    await waitFor(() => expect(previewFactorModel.mock.calls.at(-1)?.[0].neutralization.enabled).toBe(false));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '启用行业中性化' }));

    expect(await screen.findByText('不能创建：行业 PIT 字段缺失。')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '关闭行业中性化' }));

    await waitFor(() => expect(previewFactorModel.mock.calls.at(-1)?.[0].neutralization.enabled).toBe(false));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('button', { name: '创建可回测策略' })[0]);

    await waitFor(() => expect(createFactorModel).toHaveBeenCalledTimes(1));
    expect(createFactorModel.mock.calls[0][0].neutralization.enabled).toBe(false);
    expect(await screen.findByText('已创建多因子策略：strat_multifactor_no_neutralization')).toBeInTheDocument();
  });

  it('ignores stale preview responses after neutralization is toggled', async () => {
    const blockedPreview = makeReadyPreview({
      status: 'BLOCKED',
      neutralizationStatus: {
        enabled: true,
        method: 'industry',
        status: 'NOT_EXECUTED_MISSING_INDUSTRY_PIT',
        blockers: ['MISSING_INDUSTRY_PIT'],
      },
      warnings: ['行业中性化需要 PIT 行业字段，本次预览仅返回 blocker，不执行残差化。'],
    });
    const readyWithoutNeutralization = makeReadyPreview({
      neutralizationStatus: {
        enabled: false,
        method: 'industry',
        status: 'DISABLED',
        blockers: [],
      },
    });
    const resolvers: Array<(preview: FactorModelPreview) => void> = [];
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '启用行业中性化' }));
    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(2));

    resolvers[1](blockedPreview);
    await waitFor(() => expect(screen.getAllByText('阻断').length).toBeGreaterThanOrEqual(1));

    resolvers[0](readyWithoutNeutralization);
    await waitFor(() => expect(screen.getAllByText('阻断').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('不能创建：行业 PIT 字段缺失。')).toBeInTheDocument();
  });

  it('creates a multi-factor strategy and leaves navigation as an integration hook', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());
    const response: FactorModelCreateResponse = {
      strategy_id: 'strat_multifactor_001',
      parameter_version_id: 'pv_multifactor_001',
    };
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue(response);
    const onCreated = vi.fn<(strategyId: string) => void>();

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('策略名称'), { target: { value: '真实 PIT 多因子策略' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());

    fireEvent.click(screen.getAllByRole('button', { name: '创建可回测策略' })[0]);

    await waitFor(() => expect(createFactorModel).toHaveBeenCalledTimes(1));
    expect(createFactorModel.mock.calls[0][0].modelName).toBe('真实 PIT 多因子策略');
    expect(createFactorModel.mock.calls[0][0].factors).toHaveLength(5);
    expect(createFactorModel.mock.calls[0][0].factors.reduce((sum, factor) => sum + factor.weightPct, 0)).toBe(100);
    expect(createFactorModel.mock.calls[0][0].neutralization.enabled).toBe(false);
    expect(onCreated).toHaveBeenCalledWith('strat_multifactor_001');
    expect(await screen.findByText('已创建多因子策略：strat_multifactor_001')).toBeInTheDocument();
  });

  it('blocks materialization when the preview API reports missing industry PIT', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview({
        status: 'BLOCKED',
        neutralizationStatus: {
          enabled: true,
          method: 'industry',
          status: 'NOT_EXECUTED_MISSING_INDUSTRY_PIT',
          blockers: ['MISSING_INDUSTRY_PIT'],
        },
        warnings: ['行业中性化需要 PIT 行业字段，本次预览仅返回 blocker，不执行残差化。'],
      }));

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    const riskBox = await screen.findByText('不能创建：行业 PIT 字段缺失。');
    expect(riskBox.closest('.strategy-risk-module')).not.toBeNull();
    expect(screen.getAllByText('行业 PIT 字段缺失')[0]).toBeInTheDocument();
    expect(screen.getAllByText('阻断').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('keeps creation disabled until selected factor weights add up to 100%', () => {
    render(<FactorModelBuilderPage />);

    fireEvent.click(screen.getByLabelText('选择12-1月截面动量排名'));

    const weightRow = screen.getByText('权重合计').closest('.audit-row');
    expect(weightRow).not.toBeNull();
    expect(within(weightRow as HTMLElement).getByText('70%')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('renders factor library diagnostic state and blocker risk columns with a diagnostic popover', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor(),
        makeFactor({
          id: 's_val_ep_ltm_raw',
          name: '滚动市盈率倒数 (LTM)',
          diagnostic_status: 'COMPLETED',
          ui_state: 'needs_calibration',
          ui_state_label: '待校准',
          descriptor: {
            canonical_id: 's_val_ep_ltm_raw',
            source_prefix: 's',
            category: 'val',
            metric: 'ep_ltm',
            window: 'ltm',
            operator: 'raw',
            schema_version: '1',
          },
          expression: 'Earnings / MarketCap',
          tags: ['val'],
          strategy_creation_risk: {
            can_create: true,
            warning_count: 1,
            blocked_count: 0,
            warnings: [{
              code: 'HIGH_CORRELATION',
              severity: 'warning',
              label: '高相关提示',
              message: '与同族估值因子重叠，仅提示。',
            }],
            hard_blockers: [],
          },
        }),
        makeFactor({
          id: 'm_custom_unsafe',
          name: '人工不可回放字段',
          source: 'MANUAL',
          diagnostic_status: 'BLOCKED_DATA',
          ui_state: 'sandbox',
          ui_state_label: '沙箱',
          descriptor: {
            canonical_id: 'm_custom_unsafe',
            source_prefix: 'm',
            category: 'mom',
            metric: 'custom',
            window: '21d',
            operator: 'rank',
            schema_version: '1',
          },
          expression: 'Rank(current_pe)',
          readiness_blockers: [{ code: 'CURRENT_ONLY_DATA', message: 'current-only 数据不可回放' }],
          strategy_creation_risk: {
            can_create: false,
            warning_count: 0,
            blocked_count: 1,
            warnings: [],
            hard_blockers: [{
              code: 'CURRENT_ONLY_DATA',
              severity: 'blocker',
              label: 'current-only 数据',
              message: 'current-only 数据不可回放',
            }],
          },
        }),
      ],
      summary: { system_seed_count: 2, pit_status: 'READY' },
    });
    fakeFactorApi.getPitDataOverview.mockResolvedValue(makePitOverview());

    render(<FactorLibraryPage />);

    expect(await screen.findByText('诊断状态')).toBeInTheDocument();
    expect(screen.getByText('阻断 / 风险')).toBeInTheDocument();
    expect(screen.getByText('覆盖五类核心风格因子，统一按系统种子治理与诊断。')).toBeInTheDocument();
    expect(screen.queryByText(/SYSTEM_SEED/)).not.toBeInTheDocument();
    expect(fakeFactorApi.getPitDataOverview).not.toHaveBeenCalled();
    expect(screen.queryByRole('columnheader', { name: '状态' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看12-1月截面动量排名诊断摘要' })).toHaveTextContent('稳健');
    expect(screen.getAllByText('风险提示').length).toBeGreaterThan(0);
    expect(screen.getAllByText('硬阻断').length).toBeGreaterThan(0);
    expect(screen.queryByText('资源队列')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看12-1月截面动量排名诊断摘要' }));

    const popover = await screen.findByRole('dialog', { name: '12-1月截面动量排名 最近诊断摘要' });
    expect(within(popover).getByText('最近诊断摘要')).toBeInTheDocument();
    expect(within(popover).getByText('0.052')).toBeInTheDocument();
    expect(within(popover).getByText('92.4%')).toBeInTheDocument();
  });

  it('opens the factor library governance queue modal and routes draft suggestions to the builder', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor(),
        makeFactor({
          id: 'a_mom_auto_rank',
          name: '[Auto-Mined] 动量候选',
          source: 'AUTO_MINED',
          lifecycle_status: 'VERIFIED',
          diagnostic_status: 'COMPLETED',
          expression: 'Rank(Delta(Close, 63))',
        }),
      ],
      summary: { system_seed_count: 1, pit_status: 'READY', governance_queue_count: 2 },
    });
    fakeFactorApi.getFactorGovernanceOverview.mockResolvedValue({
      as_of: '2026-05-06T09:00:00Z',
      queue_count: 2,
      actions: [
        {
          id: 'gq_review_a_mom_auto_rank',
          kind: 'REVIEW',
          label: '复核',
          title: '自动挖掘候选需要复核',
          detail: 'OOS 漂移进入观察区。',
          factor_ids: ['a_mom_auto_rank'],
          severity: 'warning',
        },
        {
          id: 'gq_model_a_mom_auto_rank',
          kind: 'FACTOR_MODEL_SUGGESTION',
          label: '策略创建建议',
          title: '多因子策略草稿建议',
          detail: '建议权重不超过 20%，进入创建页后仍需预检。',
          factor_ids: ['a_mom_auto_rank', 's_mom_12m1m_rank'],
          suggested_weights: [
            { factor_id: 'a_mom_auto_rank', weight_pct: 20, direction: 'HIGH_IS_BETTER' },
            { factor_id: 's_mom_12m1m_rank', weight_pct: 30, direction: 'HIGH_IS_BETTER' },
          ],
          severity: 'info',
          target: {
            route: '#/factor-models/new',
            query: {
              source: 'governance_queue',
              factorIds: 'a_mom_auto_rank,s_mom_12m1m_rank',
              weights: '20,30',
              directions: 'HIGH_IS_BETTER,HIGH_IS_BETTER',
            },
          },
        },
      ],
    });
    render(<FactorLibraryPage />);

    const trigger = (await screen.findByText('治理队列')).closest('button');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger as HTMLButtonElement);

    expect(await screen.findByRole('dialog', { name: '治理队列' })).toBeInTheDocument();
    await waitFor(() => expect(fakeFactorApi.getFactorGovernanceOverview).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('自动挖掘候选需要复核')).toBeInTheDocument();
    expect(screen.getByText('多因子策略草稿建议')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '带入创建页' }));

    await waitFor(() => expect(window.location.hash).toContain('#/factor-models/new'));
    expect(window.location.hash).toContain('source=governance_queue');
    expect(decodeURIComponent(window.location.hash)).toContain('a_mom_auto_rank');
    expect(decodeURIComponent(window.location.hash)).toContain('weights=20,30');
  });

  it('renders no-IC factors as pending instead of showing a synthetic IC curve', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 's_beta_market_252d_raw',
          name: '市场贝塔代理（252日）',
          diagnostic_status: 'READY_TO_DIAGNOSE',
          ui_state: 'needs_calibration',
          ui_state_label: '待校准',
          latest_diagnostic_summary: null,
          last_diagnostic_run_id: null,
          ic_sparkline: [],
          diagnostic_gap_summary: {
            rank_ic: 'Rank IC: 尚未提交诊断',
            coverage: '覆盖: 等待首次诊断',
            next_action: '提交 Verified 诊断',
          },
        }),
      ],
      summary: { system_seed_count: 1, pit_status: 'READY' },
    });

    render(<FactorLibraryPage />);

    expect((await screen.findAllByText('市场贝塔代理（252日）')).length).toBeGreaterThan(0);
    expect(screen.getByText('Rank IC: 尚未提交诊断')).toBeInTheDocument();
    expect(screen.getByText('暂无 IC')).toBeInTheDocument();
    expect(screen.queryByLabelText('IC 累积曲线缩略图')).not.toBeInTheDocument();
  });

  it('labels reference diagnostics without hiding the data lineage', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 's_mom_6m_rank',
          name: '6个月动量排名',
          diagnostic_status: 'SANDBOX_READY',
          ui_state: 'sandbox',
          ui_state_label: '沙箱',
          latest_diagnostic_summary: {
            run_id: 'ref:fdiag_mom_latest',
            factor_id: 's_mom_6m_rank',
            status: 'REFERENCE_ONLY',
            diagnostic_mode: 'SANDBOX',
            rank_ic: 0.052,
            ir: 0.42,
            coverage: 92.4,
            source_factor_id: 's_mom_12m1m_rank',
            source_factor_name: '12-1月截面动量排名',
            data_lineage: {
              kind: 'REFERENCE_DEFAULT_FACTOR',
              label: '参考口径：12-1月截面动量排名',
            },
          },
          last_diagnostic_run_id: null,
          ic_sparkline: [
            { date: '2026-05-01', value: 0.03 },
            { date: '2026-05-02', value: 0.05 },
          ],
          readiness_blockers: [{
            code: 'VERIFIED_PIT_WINDOW_INCOMPLETE',
            message: '完整PIT 门禁尚未通过，当前仅允许 Sandbox 诊断。',
          }],
          strategy_creation_risk: {
            can_create: true,
            warning_count: 1,
            blocked_count: 0,
            warnings: [{
              code: 'VERIFIED_PIT_WINDOW_INCOMPLETE',
              severity: 'warning',
              message: '完整PIT 门禁尚未通过，当前仅允许 Sandbox 诊断。',
            }],
            hard_blockers: [],
          },
        }),
      ],
      summary: { system_seed_count: 1, pit_status: 'BLOCKED' },
    });

    render(<FactorLibraryPage />);

    expect((await screen.findAllByText('6个月动量排名')).length).toBeGreaterThan(0);
    expect(screen.getByText('参考口径')).toBeInTheDocument();
    expect(screen.getByText(/12-1月截面动量排名/)).toBeInTheDocument();
    expect(screen.getByText('Rank IC 0.052')).toBeInTheDocument();
    const diagnosticCell = screen.getByText('参考口径').closest('.factor-diagnostic-cell');
    expect(diagnosticCell?.children[0]).toHaveClass('factor-diagnostic-cell__metrics');
    expect(diagnosticCell?.children[1]).toHaveClass('factor-diagnostic-cell__reference');
    expect(diagnosticCell?.children[2]).toHaveClass('factor-sparkline');
    expect(screen.getByText('风险提示')).toBeInTheDocument();
    expect(screen.queryByText('硬阻断')).not.toBeInTheDocument();
  });

  it('replaces reference diagnostics with read-only real factor preview metrics', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 's_mom_6m_rank',
          name: '6个月动量因子',
          diagnostic_status: 'SANDBOX_READY',
          ui_state: 'sandbox',
          ui_state_label: '沙箱',
          latest_diagnostic_summary: {
            run_id: 'ref:fdiag_mom_latest',
            factor_id: 's_mom_6m_rank',
            status: 'REFERENCE_ONLY',
            diagnostic_mode: 'SANDBOX',
            rank_ic: 0.052,
            ir: 0.42,
            coverage: 92.4,
            source_factor_id: 's_mom_12m1m_rank',
            source_factor_name: '12-1 动量参考因子',
            data_lineage: {
              kind: 'REFERENCE_DEFAULT_FACTOR',
              label: '参考口径：12-1 动量参考因子',
            },
          },
          last_diagnostic_run_id: null,
          ic_sparkline: [
            { date: '2026-05-01', value: 0.03 },
            { date: '2026-05-02', value: 0.05 },
          ],
        }),
      ],
      summary: { system_seed_count: 1, pit_status: 'BLOCKED' },
    });
    const previewPayload = {
      mode: 'BATCH',
      status: 'PREVIEW',
      items: [
        {
          factor_id: 's_mom_6m_rank',
          latest_diagnostic_summary: {
            run_id: 'preview:s_mom_6m_rank',
            factor_id: 's_mom_6m_rank',
            status: 'PREVIEW',
            diagnostic_mode: 'SANDBOX',
            rank_ic: 0.031,
            ir: 0.25,
            coverage: 88.2,
            data_lineage: { kind: 'FACTOR_EXPRESSION_PREVIEW', label: '真实口径：因子表达式即时预览' },
            ic_series: [{ date: '2026-05-01', rank_ic: 0.031 }],
          },
          batch_diagnostic_summary: {
            status: 'PREVIEW',
            rank_ic: 0.031,
            ir: 0.25,
            coverage: 88.2,
          },
        },
      ],
      batch_summary: {
        factor_count: 1,
        robust_count: 0,
        needs_calibration_count: 0,
        decayed_count: 0,
        sandbox_count: 1,
        warning_count: 0,
        blocked_count: 0,
      },
    };
    let resolvePreview!: (payload: typeof previewPayload) => void;
    fakeFactorApi.previewFactorDiagnostics.mockReturnValue(new Promise((resolve) => {
      resolvePreview = resolve;
    }));

    render(<FactorLibraryPage />);

    await waitFor(() => expect(fakeFactorApi.previewFactorDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        batch: true,
        factor_ids: ['s_mom_6m_rank'],
        diagnostic_mode: 'SANDBOX',
      }),
    ));
    expect(screen.queryByText('Rank IC 0.052')).not.toBeInTheDocument();
    expect(document.querySelector('.factor-diagnostic-cell__reference')).toBeNull();
    await act(async () => {
      resolvePreview(previewPayload);
    });
    expect(await screen.findByText('Rank IC 0.031')).toBeInTheDocument();
    expect(document.querySelector('.factor-diagnostic-cell__reference')).toBeNull();
  });

  it('renders factor detail from the light factor response before the PIT overview finishes', async () => {
    fakeFactorApi.getFactor.mockResolvedValue(makeFactorDetail());
    fakeFactorApi.getPitDataOverview.mockReturnValue(new Promise(() => undefined));

    render(<FactorDetailPage factorId="s_alpha_ffblend_cur_rank" />);

    expect(await screen.findByRole('heading', { level: 1, name: /Fama-French 风格合成 Alpha诊断报告/ })).toBeInTheDocument();
    expect(screen.getByText('提交 Sandbox 诊断')).toBeDisabled();
    expect(screen.getByText('审计足迹')).toBeInTheDocument();
    expect(screen.getByText('回溯窗口')).toBeInTheDocument();
    expect(fakeFactorApi.getPitDataOverview).toHaveBeenCalledTimes(1);
  });

  it('keeps the model builder layout as a three-column workstation with stable responsive constraints', () => {
    const css = readFileSync('src/pages/factor-phase2-pages.css', 'utf8');
    const factorsCss = readFileSync('src/pages/factors-page.css', 'utf8');

    expect(css).toMatch(/\.factor-model-builder-page\.factor-phase2-page\s*\{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.factor-model-builder-page\.factor-phase2-page\s*\{[^}]*max-width:\s*1960px;/s);
    expect(css).toMatch(/\.factor-phase2-hero\s*\{[^}]*max-width:\s*1960px;/s);
    expect(css).toMatch(/\.factor-phase2-hero\s*\{[^}]*margin:\s*0;/s);
    expect(css).toMatch(/\.factor-model-builder-page \.factor-phase2-workbench--model\s*\{[^}]*grid-template-columns:\s*minmax\(280px,\s*0\.85fr\)\s*minmax\(0,\s*1\.42fr\)\s*minmax\(320px,\s*0\.78fr\);/s);
    expect(css).toContain('.factor-model-builder-page .factor-pick');
    expect(css).toContain('.factor-model-builder-page .factor-model-name-control');
    expect(css).toContain('.factor-model-builder-page .factor-weight-control');
    expect(css).toContain('.factor-model-builder-page .factor-model-weight-controls');
    expect(css).toContain('.factor-model-builder-page .factor-model-weight-row');
    expect(css).toContain('.factor-model-builder-page .factor-model-weight-row__title');
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-weight-row__title \.factor-id\s*\{[^}]*margin-top:\s*0;[^}]*text-align:\s*right;/s);
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-weight-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-selector-list\s*\{[^}]*max-height:\s*calc\(\(96px \* 5\) \+ \(9\.5px \* 4\)\);[^}]*overflow-y:\s*auto;/s);
    expect(css).toContain('.factor-model-builder-page .factor-model-card-tags');
    expect(css).toContain('.factor-model-builder-page .factor-model-metric-chip--rank-ic');
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-metric-chip\s*\{[^}]*background:\s*#f7f8fa;[^}]*color:\s*#52616d;/s);
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-metric-chip--category,[\s\S]*\.factor-model-builder-page \.factor-model-metric-chip--rank-ic,[\s\S]*\.factor-model-builder-page \.factor-model-metric-chip--ir\s*\{[^}]*background:\s*#f7f8fa;[^}]*color:\s*#52616d;/s);
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-governance-row\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(240px,\s*100%\),\s*1fr\)\);/s);
    expect(css).toContain('.factor-model-builder-page .factor-model-rebalance-control');
    expect(css).toContain('.factor-model-builder-page .score-card small');
    expect(css).toContain('.factor-model-builder-page .neutral-block');
    expect(css).toContain('.factor-model-builder-page .switch--off');
    expect(css).toContain('.factor-model-builder-page .strategy-risk-module');
    expect(css).toContain('overflow-wrap: anywhere;');
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.factor-phase2-metrics,[\s\S]*\.factor-model-factor,[\s\S]*\.factor-model-builder-page \.factor-model-weight-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
    expect(factorsCss).toContain('.factor-diagnostic-popover');
    expect(factorsCss).toContain('.factor-diagnostic-state__button');
    expect(factorsCss).toContain('.factor-gate-pill--warn');
    expect(factorsCss).toContain('.factor-sparkline-empty');
    expect(factorsCss).toContain('.factor-level-cell');
    expect(factorsCss).toContain('.factor-level-badge--s');
    expect(factorsCss).toMatch(/\.factor-table\s*\{[^}]*min-width:\s*1120px;/s);
    expect(factorsCss).toMatch(/\.factor-diagnostic-cell\s*\{[^}]*grid-template-columns:\s*minmax\(134px,\s*1fr\)\s*max-content\s*116px;/s);
    expect(factorsCss).toMatch(/\.factor-diagnostic-state\s*\{[^}]*position:\s*relative;/s);
    expect(factorsCss).toMatch(/\.factor-diagnostic-popover\s*\{[^}]*z-index:\s*80;/s);
    expect(factorsCss).toMatch(/\.factor-diagnostic-popover\s*\{[^}]*top:\s*calc\(100%\s*\+\s*8px\);[^}]*left:\s*0;[^}]*right:\s*auto;/s);
    expect(factorsCss).toMatch(/\.factor-table tbody tr:nth-last-child\(-n\s*\+\s*2\):not\(:first-child\) \.factor-diagnostic-popover\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*calc\(100%\s*\+\s*8px\);/s);
    expect(factorsCss).toMatch(/\.factor-table tbody tr:has\(\.factor-diagnostic-popover\),[\s\S]*\.factor-table tbody tr:has\(\.factor-gap-popover\)\s*\{[\s\S]*z-index:\s*60;/s);
    expect(factorsCss).toMatch(/\.factor-row-actions\s*\{[^}]*display:\s*grid;/s);
    expect(factorsCss).toMatch(/\.factor-table td\s*\{[^}]*vertical-align:\s*middle;/s);
    expect(factorsCss).toMatch(/\.factor-gate-reason\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*\}/s);
    expect(factorsCss).not.toMatch(/\.factor-gate-reason\s*\{[^}]*-webkit-line-clamp:/s);
    expect(factorsCss).toMatch(/\.factor-table tbody tr:last-child \.factor-gap-popover\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*30px;/s);
  });
});
