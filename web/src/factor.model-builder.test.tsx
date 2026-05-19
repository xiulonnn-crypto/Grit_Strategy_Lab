import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeFactorApi = vi.hoisted(() => ({
  listFactors: vi.fn(),
  getFactor: vi.fn(),
  getPitDataOverview: vi.fn(),
  getF1Catalog: vi.fn(),
  runFactorDiagnostics: vi.fn(),
  previewFactorDiagnostics: vi.fn(),
  previewFactorModel: vi.fn(),
  createFactorModel: vi.fn(),
  getFactorGovernanceOverview: vi.fn(),
  executeFactorGovernanceAction: vi.fn(),
}));

vi.mock('./lib/demoStoreContext', () => ({
  ApiClientProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useApiClient: () => fakeFactorApi,
}));

import FactorModelBuilderPage, {
  type FactorModelCreateResponse,
  type FactorModelOption,
  type FactorModelPreview,
  type FactorModelPreviewPayload,
} from './pages/factor-model-builder-page';
import { loadFactorModelOptions } from './app-runtime-cn';
import { FactorDetailPage, FactorLibraryPage } from './pages/factors-page';
import type { ApiFactorDetail, ApiFactorDiagnosticSummary, ApiFactorListItem, ApiPitDataOverview } from './types';

function renderLegacyFactorLibraryPage(): void {
  window.location.hash = '#/factors?layer=all';
  render(<FactorLibraryPage />);
}

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
      ir: 0.72,
      coverage: 92.4,
      group_returns: [
        { group: 'Q1', mean_return: 0.052, sample_count: 120 },
        { group: 'Q2', mean_return: 0.031, sample_count: 120 },
        { group: 'Q3', mean_return: 0.012, sample_count: 120 },
        { group: 'Q4', mean_return: -0.004, sample_count: 120 },
        { group: 'Q5', mean_return: -0.019, sample_count: 120 },
      ],
      ic_series: [],
      compliance_trail: { diagnosed_at: '2026-05-05T09:00:00Z' },
    },
    last_diagnostic_run_id: 'diag_mom_latest',
    readiness_blockers: [],
    ic_sparkline: [
      { date: '2026-05-01', value: 0.02 },
      { date: '2026-05-02', value: 0.05 },
      { date: '2026-05-03', value: -0.01 },
    ],
    ic_sparkline_window: '12m',
    tier_level: 'F2',
    tier_label: 'F2 改造',
    tier_projection: { key: 'F2', label: 'F2 改造', description: '单因子改造结果' },
    lifecycle: 'online',
    lifecycle_label: '线上',
    lifecycle_projection: { key: 'online', label: '线上', description: '通过校验并可用于线上策略' },
    factor_level: 'A',
    factor_level_label: 'A优秀',
    factor_level_projection: { key: 'A', label: 'A优秀', description: '稳定观察，允许进入组合候选' },
    op_status: {
      lights: [
        { code: 'W', key: 'winsorize', label: '去极值', active: true, status: 'done' },
        { code: 'N', key: 'neutralize', label: '中性化', active: false, status: 'missing' },
        { code: 'Z', key: 'zscore', label: '标准化', active: false, status: 'missing' },
        { code: 'T', key: 'tsrank', label: '时序排名', active: true, status: 'done' },
      ],
      completed: ['W', 'T'],
      missing: ['N', 'Z'],
      summary: 'W 去极值 / T 时序排名',
    },
    lineage_summary: {
      has_lineage: true,
      parent_count: 1,
      parent_ids: ['Close'],
      root_source: 'Close',
      relation_types: ['DERIVED_FROM'],
    },
    quality_view: {
      rank_ic: 0.052,
      ir: 0.72,
      coverage: 92.4,
      decay_days: 21,
      decay_label: '21日',
      sparkline: [
        { date: '2026-05-01', value: 0.02 },
        { date: '2026-05-02', value: 0.05 },
        { date: '2026-05-03', value: -0.01 },
      ],
      sparkline_window: '12m',
    },
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

function makeFactorDiagnosticSummary(overrides: Partial<ApiFactorDiagnosticSummary> = {}): ApiFactorDiagnosticSummary {
  return {
    ...makeFactor().latest_diagnostic_summary!,
    run_id: 'diag_alpha_latest',
    factor_id: 's_alpha_ffblend_cur_rank',
    diagnostic_mode: 'VERIFIED',
    dataset_snapshot_id: 'ds_test',
    universe_snapshot_id: 'uv_test',
    cleaning_version: 'clean_v1',
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
  vi.useRealTimers();
  cleanup();
  fakeFactorApi.listFactors.mockReset();
  fakeFactorApi.getFactor.mockReset();
  fakeFactorApi.getPitDataOverview.mockReset();
  fakeFactorApi.getF1Catalog.mockReset();
  fakeFactorApi.runFactorDiagnostics.mockReset();
  fakeFactorApi.previewFactorDiagnostics.mockReset();
  fakeFactorApi.previewFactorModel.mockReset();
  fakeFactorApi.createFactorModel.mockReset();
  fakeFactorApi.getFactorGovernanceOverview.mockReset();
  fakeFactorApi.executeFactorGovernanceAction.mockReset();
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
    expect(screen.getByLabelText('持仓数量')).toHaveValue(10);
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
    expect(governanceRow?.children).toHaveLength(3);
    expect(governanceRow?.textContent).toContain('再平衡配置');
    expect(governanceRow?.textContent).toContain('持仓数量');
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

  it('accepts governance task factor and weight prefill while staying in draft review mode', () => {
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

    expect(screen.getByText('治理任务已代入')).toBeInTheDocument();
    expect(screen.getByText('草稿 / 待审查')).toBeInTheDocument();
    expect(screen.getByLabelText('策略名称')).toHaveValue('自动挖掘因子待审查组合');
    expect((document.querySelector('#factor-weight-s_mom_12m1m_rank') as HTMLInputElement | null)?.value).toBe('20');
    expect((document.querySelector('#factor-weight-s_val_ep_ltm_raw') as HTMLInputElement | null)?.value).toBe('30');
  });

  it('shows category, factor level, Rank IC, and IR tags in selector and weight factor cards', () => {
    const liveFactors: FactorModelOption[] = [
      {
        id: 's_mom_12m1m_rank',
        displayName: 'API 动量',
        family: '动量',
        categoryLabel: '动量',
        rankIc: 0.052,
        rankIcLabel: 'Rank IC 0.052',
        ir: 0.42,
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
    expect(within(selectorCard as HTMLElement).getByText('动量')).toBeInTheDocument();
    expect(within(selectorCard as HTMLElement).getByText('因子级别 C微弱')).toBeInTheDocument();
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
    expect(within(weightCard as HTMLElement).getByText('动量')).toBeInTheDocument();
    expect(within(weightCard as HTMLElement).getByText('因子级别 C微弱')).toBeInTheDocument();
    expect(within(weightCard as HTMLElement).getByText('Rank IC 0.052')).toBeInTheDocument();
    expect(within(weightCard as HTMLElement).getByText('IR 0.42')).toBeInTheDocument();
  });

  it('limits selector candidates to online factors whose diagnosis is not invalid', () => {
    const liveFactors: FactorModelOption[] = [
      {
        id: 'online_ready',
        displayName: 'Online ready factor',
        family: 'Momentum',
        rankIc: 0.04,
        ir: 1.3,
        sourceLabel: '线上因子',
        diagnosticStatus: 'COMPLETED',
        lifecycleStatus: 'VERIFIED',
        uiState: 'robust',
        isOnline: true,
        pitCoveragePct: 100,
        defaultWeight: 100,
        defaultDirection: 'HIGH_IS_GOOD',
      },
      {
        id: 'offline_factor',
        displayName: 'Offline factor',
        family: 'Value',
        sourceLabel: '已下线',
        diagnosticStatus: 'COMPLETED',
        lifecycleStatus: 'DEPRECATED',
        isOnline: false,
        pitCoveragePct: 100,
        defaultWeight: 0,
        defaultDirection: 'HIGH_IS_GOOD',
      },
      {
        id: 'failed_factor',
        displayName: 'Failed factor',
        family: 'Quality',
        sourceLabel: '线上因子',
        diagnosticStatus: 'FAILED',
        lifecycleStatus: 'VERIFIED',
        isOnline: true,
        pitCoveragePct: 100,
        defaultWeight: 0,
        defaultDirection: 'HIGH_IS_GOOD',
      },
      {
        id: 'decayed_factor',
        displayName: 'Decayed factor',
        family: 'Risk',
        sourceLabel: '线上因子',
        diagnosticStatus: 'COMPLETED',
        lifecycleStatus: 'VERIFIED',
        uiState: 'decayed',
        isOnline: true,
        pitCoveragePct: 100,
        defaultWeight: 0,
        defaultDirection: 'LOW_IS_GOOD',
      },
    ];

    render(<FactorModelBuilderPage factors={liveFactors} useDefaultFallback={false} />);

    const selectorPanel = document.querySelector('[aria-labelledby="factor-model-select"]');
    expect(selectorPanel?.querySelectorAll('.factor-pick')).toHaveLength(1);
    expect(within(selectorPanel as HTMLElement).getByText('Online ready factor')).toBeInTheDocument();
    expect(screen.queryByText('Offline factor')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed factor')).not.toBeInTheDocument();
    expect(screen.queryByText('Decayed factor')).not.toBeInTheDocument();
  });

  it('hydrates model selector candidates with sandbox preview metrics before mapping options', async () => {
    const missingMetrics = makeFactor({
      id: 's_mom_6m_rank',
      name: '6m momentum',
      diagnostic_status: 'SANDBOX_READY',
      ui_state: 'sandbox',
      latest_diagnostic_summary: null,
      last_diagnostic_run_id: null,
      batch_diagnostic_summary: { status: 'NO_DIAGNOSTIC' },
    });
    const previewDecayed = makeFactor({
      id: 'preview_decayed',
      name: 'Preview decayed',
      diagnostic_status: 'SANDBOX_READY',
      ui_state: 'sandbox',
      latest_diagnostic_summary: null,
      last_diagnostic_run_id: null,
      batch_diagnostic_summary: { status: 'NO_DIAGNOSTIC' },
    });
    const stillMetricless = makeFactor({
      id: 'metricless_manual',
      name: 'Metricless manual',
      diagnostic_status: 'SANDBOX_READY',
      ui_state: 'sandbox',
      latest_diagnostic_summary: null,
      last_diagnostic_run_id: null,
      batch_diagnostic_summary: { status: 'NO_DIAGNOSTIC' },
    });
    const failed = makeFactor({
      id: 'failed_factor',
      name: 'Failed factor',
      diagnostic_status: 'FAILED',
      ui_state: 'sandbox',
      latest_diagnostic_summary: null,
      last_diagnostic_run_id: null,
    });
    const api = {
      listFactors: vi.fn().mockResolvedValue({
        items: [missingMetrics, previewDecayed, stillMetricless, failed],
        summary: {},
      }),
      previewFactorDiagnostics: vi.fn().mockResolvedValue({
        mode: 'BATCH',
        status: 'PREVIEW',
        items: [
          {
            factor_id: 's_mom_6m_rank',
            ui_state: 'sandbox',
            ui_state_label: '沙箱',
            diagnostic_status: 'SANDBOX_READY',
            latest_diagnostic_summary: {
              status: 'PREVIEW',
              diagnostic_mode: 'SANDBOX',
              rank_ic: 0.0283,
              ir: 1.1787,
              coverage: 98.99,
            },
            batch_diagnostic_summary: {
              status: 'PREVIEW',
              rank_ic: 0.0283,
              ir: 1.1787,
              coverage: 98.99,
            },
          },
          {
            factor_id: 'preview_decayed',
            ui_state: 'decayed',
            ui_state_label: '失效',
            diagnostic_status: 'SANDBOX_READY',
            latest_diagnostic_summary: {
              status: 'PREVIEW',
              diagnostic_mode: 'SANDBOX',
              rank_ic: 0.004,
              ir: 0.1,
            },
          },
          {
            factor_id: 'metricless_manual',
            ui_state: 'sandbox',
            diagnostic_status: 'SANDBOX_READY',
            latest_diagnostic_summary: {
              status: 'PREVIEW',
              diagnostic_mode: 'SANDBOX',
              rank_ic: null,
              ir: null,
            },
          },
        ],
      }),
    } as unknown as Parameters<typeof loadFactorModelOptions>[0];

    const options = await loadFactorModelOptions(api);

    expect(api.listFactors).toHaveBeenCalledWith({ lifecycle: 'online' });
    expect(api.previewFactorDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      batch: true,
      diagnostic_mode: 'SANDBOX',
      factor_ids: ['s_mom_6m_rank', 'preview_decayed', 'metricless_manual'],
      include: ['ic', 'ir', 'groups', 'turnover', 'correlation', 'blockers'],
    }));
    expect(options.map((factor) => factor.id)).toEqual(['s_mom_6m_rank']);
    expect(options[0]).toMatchObject({
      rankIc: 0.0283,
      rankIcLabel: 'Rank IC 0.028',
      ir: 1.1787,
      irLabel: 'IR 1.18',
      uiState: 'sandbox',
    });
  });

  it('falls back to single-factor previews when the batch metrics preview fails', async () => {
    const first = makeFactor({
      id: 's_mom_6m_rank',
      name: '6m momentum',
      diagnostic_status: 'SANDBOX_READY',
      ui_state: 'sandbox',
      latest_diagnostic_summary: null,
      last_diagnostic_run_id: null,
      batch_diagnostic_summary: { status: 'NO_DIAGNOSTIC' },
    });
    const second = makeFactor({
      id: 's_beta_market_252d_raw',
      name: 'Market beta',
      diagnostic_status: 'SANDBOX_READY',
      ui_state: 'sandbox',
      latest_diagnostic_summary: null,
      last_diagnostic_run_id: null,
      batch_diagnostic_summary: { status: 'NO_DIAGNOSTIC' },
    });
    const previewFactorDiagnostics = vi
      .fn()
      .mockRejectedValueOnce(new Error('batch preview unavailable'))
      .mockResolvedValueOnce({
        mode: 'BATCH',
        status: 'PREVIEW',
        items: [
          {
            factor_id: 's_mom_6m_rank',
            ui_state: 'sandbox',
            latest_diagnostic_summary: { status: 'PREVIEW', rank_ic: 0.0283, ir: 1.1787 },
          },
        ],
      })
      .mockResolvedValueOnce({
        mode: 'BATCH',
        status: 'PREVIEW',
        items: [
          {
            factor_id: 's_beta_market_252d_raw',
            ui_state: 'sandbox',
            latest_diagnostic_summary: { status: 'PREVIEW', rank_ic: 0.1114, ir: 1.7363 },
          },
        ],
      });
    const api = {
      listFactors: vi.fn().mockResolvedValue({ items: [first, second], summary: {} }),
      previewFactorDiagnostics,
    } as unknown as Parameters<typeof loadFactorModelOptions>[0];

    const options = await loadFactorModelOptions(api);

    expect(previewFactorDiagnostics).toHaveBeenCalledTimes(3);
    expect(previewFactorDiagnostics.mock.calls[0][0].factor_ids).toEqual([
      's_mom_6m_rank',
      's_beta_market_252d_raw',
    ]);
    expect(previewFactorDiagnostics.mock.calls[1][0].factor_ids).toEqual(['s_mom_6m_rank']);
    expect(previewFactorDiagnostics.mock.calls[2][0].factor_ids).toEqual(['s_beta_market_252d_raw']);
    expect(options.map((factor) => factor.id)).toEqual(['s_mom_6m_rank', 's_beta_market_252d_raw']);
    expect(options.map((factor) => factor.irLabel)).toEqual(['IR 1.18', 'IR 1.74']);
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
      topN: 10,
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

  it('runs the composite factor strategy flow with one locked 100 percent factor and sector cap refill', async () => {
    const diagnosticSummary = {
      status: 'COMPLETED',
      rank_ic: 0.061,
      ir: 1.34,
      coverage: 0.92,
      weak_sectors: [{ group: 'Utilities', mean_return: -0.018 }],
    };
    const sectorCapForecast = {
      cut_weight_pct: 11.4,
      residual_cash_pct: 0.6,
      invested_pct: 99.4,
      cap_redistribution_mode: 'cash',
    };
    const costForecast = { average_slippage_bps: 6.8 };
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview({
        factorCount: 1,
        readyFactorCount: 1,
        normalizedWeights: [
          {
            factorId: 's_mom_12m1m_rank',
            weightPct: 100,
            normalizedWeightPct: 100,
            direction: 'HIGH_IS_GOOD',
          },
        ],
        diagnosticSummary,
        sectorCapForecast,
        costForecast,
        strategyCreationRisk: {
          can_create: true,
          warning_count: 0,
          blocked_count: 0,
          warnings: [],
          hard_blockers: [],
          eligibility: { completed_ops: ['W', 'N', 'Z', 'T'], missing_ops: [] },
          diagnostic_summary: diagnosticSummary,
          sector_cap_forecast: sectorCapForecast,
          cost_forecast: costForecast,
        },
      }));
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_composite_factor' });
    const compositeFactors: FactorModelOption[] = [{
      id: 's_mom_12m1m_rank',
      displayName: '12-1月截面动量排名',
      family: '动量',
      categoryLabel: '动量',
      sourceLabel: '自动挖掘',
      diagnosticStatus: 'COMPLETED',
      market: 'US',
      tierLevel: 'F3',
      factorLevel: 'S',
      opCompleted: ['W', 'N', 'Z', 'T'],
      pitCoveragePct: 100,
      defaultWeight: 100,
      defaultDirection: 'HIGH_IS_GOOD',
      rankIc: 0.061,
      ir: 1.34,
      rankIcLabel: 'Rank IC 0.061',
      irLabel: 'IR 1.34',
      isOnline: true,
    }];

    render(
      <FactorModelBuilderPage
        api={{ previewFactorModel, createFactorModel }}
        factors={compositeFactors}
        initialPrefill={{
          source: 'factor_library',
          strategyType: 'COMPOSITE_FACTOR',
          factorIds: ['s_mom_12m1m_rank'],
          weights: [100],
          directions: ['HIGH_IS_BETTER'],
          modelName: 'Composite factor strategy',
        }}
      />,
    );

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalled());
    expect(document.querySelector('.factor-model-builder-page--composite')).not.toBeNull();
    expect(document.querySelectorAll('.check-row label')).toHaveLength(4);
    expect(document.querySelectorAll('.control-grid--four input, .control-grid--four select').length).toBeGreaterThanOrEqual(8);

    const initialPayload = previewFactorModel.mock.calls.at(-1)?.[0];
    expect(initialPayload).toMatchObject({
      strategyType: 'COMPOSITE_FACTOR',
      topN: 50,
      universeFilter: {
        minAdvUsd: 5_000_000,
        advWindow: '20D',
        excludeOtcPink: true,
      },
      weightMapping: {
        method: 'equal_top_k',
        sectorCapPct: 20,
        capRedistributionMode: 'cash',
      },
    });
    expect(initialPayload?.factors).toHaveLength(1);
    expect(initialPayload?.factors[0]).toMatchObject({ factorId: 's_mom_12m1m_rank', weightPct: 100 });

    const refillButtons = document.querySelectorAll<HTMLButtonElement>('.allocation-switch button');
    expect(refillButtons).toHaveLength(2);
    fireEvent.click(refillButtons[1]);

    await waitFor(() =>
      expect(previewFactorModel.mock.calls.at(-1)?.[0].weightMapping?.capRedistributionMode).toBe('proportional_refill'),
    );
    const submit = document.querySelector<HTMLButtonElement>('.factor-model-submit');
    expect(submit).not.toBeNull();
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit as HTMLButtonElement);

    await waitFor(() => expect(createFactorModel).toHaveBeenCalledTimes(1));
    expect(createFactorModel.mock.calls[0][0].strategyType).toBe('COMPOSITE_FACTOR');
    expect(createFactorModel.mock.calls[0][0].weightMapping?.capRedistributionMode).toBe('proportional_refill');
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

  it('lets operators configure Top N before preview and creation', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_top_n_factor_model' });

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    expect(previewFactorModel.mock.calls[0][0].topN).toBe(10);

    fireEvent.change(screen.getByLabelText('持仓数量'), { target: { value: '12' } });

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(2));
    expect(previewFactorModel.mock.calls.at(-1)?.[0].topN).toBe(12);

    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('button', { name: '创建可回测策略' })[0]);

    await waitFor(() => expect(createFactorModel).toHaveBeenCalledTimes(1));
    expect(createFactorModel.mock.calls[0][0].topN).toBe(12);
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
      'PIT核心成员价格缺口为 0，10Y因子准入状态 REPAIR；209 个10年窗口补证标的与 209 个Full Ready归档缺口进入修复队列，已转为创建提示，允许物化多因子策略。';
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
            message: 'PIT核心成员价格缺口为 0，10Y因子准入状态 REPAIR；209 个10年窗口补证标的与 209 个Full Ready归档缺口进入修复队列。',
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
    expect(createFactorModel.mock.calls[0][0].topN).toBe(10);
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

  it('renders the phase-one F1/F2/F3 factor library contract', async () => {
    window.location.hash = '#/factors?layer=all';
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 's_size_mcap_cur_raw',
          name: '总市值原值',
          descriptor: {
            canonical_id: 's_size_mcap_cur_raw',
            source_prefix: 's',
            category: 'size',
            metric: 'mcap',
            window: 'cur',
            operator: 'raw',
            schema_version: '1',
          },
          expression: 'MarketCap',
          tier_level: 'F1',
          tier_label: 'F1 原始',
          tier_projection: { key: 'F1', label: 'F1 原始', description: '直接映射 API 或数据库原始字段' },
          factor_level: 'B',
          factor_level_label: 'B合格',
          lifecycle: 'online',
          lifecycle_label: '线上',
          lineage_summary: {
            has_lineage: true,
            parent_count: 1,
            parent_ids: ['MarketCap'],
            root_source: 'MarketCap',
            relation_types: ['DIRECT_SOURCE'],
          },
          op_status: {
            lights: [
              { code: 'W', key: 'winsorize', label: '去极值', active: false, status: 'missing' },
              { code: 'N', key: 'neutralize', label: '中性化', active: false, status: 'missing' },
              { code: 'Z', key: 'zscore', label: '标准化', active: false, status: 'missing' },
              { code: 'T', key: 'tsrank', label: '时序排名', active: false, status: 'missing' },
            ],
            completed: [],
            missing: ['W', 'N', 'Z', 'T'],
            summary: '原始字段',
          },
        }),
        makeFactor({
          id: 's_price_adjclose_cur_raw',
          name: '复权收盘价',
          descriptor: {
            canonical_id: 's_price_adjclose_cur_raw',
            source_prefix: 's',
            category: 'price',
            metric: 'adjclose',
            window: 'cur',
            operator: 'raw',
            schema_version: '1',
          },
          expression: 'Close',
          tier_level: 'F1',
          tier_label: 'F1 原始',
          tier_projection: { key: 'F1', label: 'F1 原始', description: '源数据 API 或数据库原始字段' },
          factor_family: '价格',
          tags: ['price'],
          factor_level: 'B',
          factor_level_label: 'B合格',
          lifecycle: 'online',
          lifecycle_label: '线上',
          lineage_summary: {
            has_lineage: true,
            parent_count: 1,
            parent_ids: ['Close'],
            root_source: 'Close',
            relation_types: ['DIRECT_SOURCE'],
          },
        }),
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
          factor_level: 'C',
          factor_level_label: 'C微弱',
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
          id: 's_alpha_ffblend_cur_rank',
          name: 'Fama-French 风格合成 Alpha',
          source: 'SYSTEM_SEED',
          diagnostic_status: 'READY_TO_DIAGNOSE',
          ui_state: 'sandbox',
          ui_state_label: '沙箱',
          descriptor: {
            canonical_id: 's_alpha_ffblend_cur_rank',
            source_prefix: 's',
            category: 'alpha',
            metric: 'ffblend',
            window: 'cur',
            operator: 'rank',
            schema_version: '1',
          },
          expression: 'FFBlend(Momentum252, ValueEP, QualityROE, Size)',
          tier_level: 'F3',
          tier_label: 'F3 组合',
          tier_projection: { key: 'F3', label: 'F3 组合', description: '多因子融合后的最终信号' },
          lifecycle: 'sandbox',
          lifecycle_label: '沙箱',
          factor_level: 'C',
          factor_level_label: 'C微弱',
          lineage_summary: {
            has_lineage: true,
            parent_count: 4,
            parent_ids: ['s_mom_12m1m_rank', 's_val_ep_ltm_raw', 's_qlty_roe_ltm_raw', 's_size_cur_log'],
            root_source: 's_mom_12m1m_rank',
            relation_types: ['COMPOSED_FROM'],
          },
        }),
      ],
      summary: {
        system_seed_count: 5,
        pit_status: 'READY',
        online_count: 4,
        lifecycle_sandbox_count: 1,
        to_be_verified_count: 0,
        archived_count: 0,
        f1_count: 2,
        f2_count: 2,
        f3_count: 1,
      },
    });
    fakeFactorApi.getPitDataOverview.mockResolvedValue(makePitOverview());
    fakeFactorApi.getF1Catalog.mockResolvedValue({
      snapshot: {
        id: 'f1_catalog_snapshot_test',
        snapshot_id: 'f1_catalog_snapshot_test',
        run_id: 'pit_preprocessing_test',
        as_of_date: '2026-05-19',
        generated_at: '2026-05-19T08:00:00Z',
        field_count: 2,
        callable_count: 1,
        blocked_count: 1,
        timing_gap_count: 0,
        summary: { ic_ir_gate: 'NOT_APPLIED' },
      },
      summary: {
        item_count: 2,
        callable_count: 1,
        blocked_count: 1,
        timing_gap_count: 0,
        ic_ir_gate: 'NOT_APPLIED',
        admission_policy: 'PIT_COVERAGE_TIMING_BLOCKER_ONLY',
      },
      items: [
        {
          factor_id: 'f1_market_cap',
          name: '总市值原值',
          category: '规模',
          pit_layer: 'L1',
          source_refs: { dataset_snapshot_id: 'ds-price', source: 'runtime_price' },
          coverage_ratio: 0.88,
          available_symbol_count: 88,
          total_symbol_count: 100,
          missing_symbols: ['MSFT'],
          missing_symbol_count: 1,
          publish_date_rule: '交易日收盘生成',
          available_at_rule: 'T 日收盘后',
          missing_policy: '缺失 L1 输出 NaN',
          blocker_code: 'DATA_SOURCE_BLOCKED',
          admission_state: 'DATA_SOURCE_BLOCKED',
          future_leakage_risk: 'REVIEW_REQUIRED',
          last_updated_at: '2026-05-19T08:00:00Z',
          metadata: {},
        },
        {
          factor_id: 'f1_price_close',
          name: '复权收盘价',
          category: '价格',
          pit_layer: 'L1',
          source_refs: { dataset_snapshot_id: 'ds-price', source: 'runtime_price' },
          coverage_ratio: 1,
          available_symbol_count: 100,
          total_symbol_count: 100,
          missing_symbols: [],
          missing_symbol_count: 0,
          publish_date_rule: '交易日收盘生成',
          available_at_rule: 'T 日收盘后',
          missing_policy: '不足历史输出 NaN',
          blocker_code: null,
          admission_state: 'READY',
          future_leakage_risk: 'LOW',
          last_updated_at: '2026-05-19T08:00:00Z',
          metadata: {},
        },
      ],
    });

    renderLegacyFactorLibraryPage();

    expect(await screen.findByRole('columnheader', { name: /因子基本信息/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /所属库/ })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /血缘溯源/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /算子状态灯/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /质量指标/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /因子级别/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /生命周期/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /创建时间/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /操作/ })).toBeInTheDocument();
    const headerTexts = within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent ?? '');
    expect(headerTexts.findIndex((text) => text.includes('创建时间'))).toBeLessThan(
      headerTexts.findIndex((text) => text.includes('操作')),
    );
    expect(screen.getByLabelText('因子级别名词解释')).toBeInTheDocument();
    expect(screen.queryByText('导出审计台账')).not.toBeInTheDocument();
    expect(screen.queryByText('分组收益单调性')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('处理算子')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('相关性筛选')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('状态筛选')).not.toBeInTheDocument();
    expect(screen.queryByText(/SYSTEM_SEED/)).not.toBeInTheDocument();
    expect(fakeFactorApi.getPitDataOverview).not.toHaveBeenCalled();

    expect(document.querySelector('.factor-layer-tabs')).toBeNull();
    const tierFilter = screen.getByLabelText('所属库筛选');
    const lifecycleFilter = screen.getByLabelText('因子生命周期视图');
    const familyFilter = screen.getByLabelText('因子族多选');
    const libraryFamilyRow = screen.getByLabelText('因子族与所属库筛选');
    const lifecycleLevelRow = screen.getByLabelText('因子级别与生命周期筛选');
    expect(within(familyFilter).getByRole('button', { name: '全部因子族' })).toHaveClass('is-active');
    expect(libraryFamilyRow).toContainElement(tierFilter);
    expect(libraryFamilyRow).toContainElement(familyFilter);
    expect(lifecycleLevelRow).toContainElement(lifecycleFilter);
    expect(libraryFamilyRow.firstElementChild).toBe(familyFilter);
    expect(libraryFamilyRow.lastElementChild).toBe(tierFilter);
    expect(libraryFamilyRow.querySelector('select')).toBeNull();
    expect(within(tierFilter).getByRole('tab', { name: /全部库 1/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(tierFilter).getByRole('tab', { name: /F1 原始库 0/ })).toBeInTheDocument();
    expect(within(tierFilter).getByRole('tab', { name: /F2 改造库 1/ })).toBeInTheDocument();
    expect(within(tierFilter).getByRole('tab', { name: /F3 组合库 0/ })).toBeInTheDocument();
    expect(within(lifecycleFilter).getByRole('tab', { name: /全部生命周期 1/ })).toBeInTheDocument();
    expect(within(lifecycleFilter).getByRole('tab', { name: /沙箱 0/ })).toBeInTheDocument();
    expect(within(lifecycleFilter).getByRole('tab', { name: /线上 1/ })).toBeInTheDocument();
    expect(within(lifecycleFilter).getByRole('tab', { name: /待校准 0/ })).toBeInTheDocument();
    expect(screen.getByText('因子资产台账')).toBeInTheDocument();
    expect(screen.getByText(/当前范围：全部库/)).toBeInTheDocument();
    expect(screen.queryByText(/当前视图 \d+ 个因子/)).not.toBeInTheDocument();
    expect(screen.getByText('F1 原始指标')).toBeInTheDocument();
    expect(screen.getByText('F2 已标准化')).toBeInTheDocument();
    expect(screen.getByText('F3 在线 Alpha')).toBeInTheDocument();
    expect(screen.getByText('待校准/归档')).toBeInTheDocument();
    const levelFilter = screen.getByLabelText('因子级别筛选');
    const allLevelButton = within(levelFilter).getByRole('button', { name: '全部因子级别' });
    expect(allLevelButton).not.toHaveClass('is-active');
    for (const level of ['S顶级', 'A优秀', 'B合格']) {
      expect(within(levelFilter).getByRole('button', { name: level })).toHaveClass('is-active');
    }
    for (const level of ['C微弱', 'D噪声', '其他']) {
      expect(within(levelFilter).getByRole('button', { name: level })).not.toHaveClass('is-active');
    }
    expect(lifecycleLevelRow).toContainElement(levelFilter);
    expect(lifecycleLevelRow.firstElementChild).toBe(levelFilter);
    expect(lifecycleLevelRow.lastElementChild).toBe(lifecycleFilter);

    const factorTable = screen.getByRole('table');
    expect(within(factorTable).queryByText('Fama-French 风格合成 Alpha')).not.toBeInTheDocument();
    fireEvent.click(within(levelFilter).getByRole('button', { name: 'C微弱' }));
    expect(within(levelFilter).getByRole('button', { name: 'C微弱' })).toHaveClass('is-active');
    expect(within(factorTable).getByText('12-1月截面动量排名')).toBeInTheDocument();
    expect(within(factorTable).queryByText('默认库')).not.toBeInTheDocument();
    expect(within(factorTable).queryByText('人工库')).not.toBeInTheDocument();
    expect(within(factorTable).queryByText('挖掘库')).not.toBeInTheDocument();
    expect(within(factorTable).queryByText('F2 改造')).not.toBeInTheDocument();
    expect(within(factorTable).queryByText('总市值原值')).not.toBeInTheDocument();
    expect(within(factorTable).queryByText('F1 原始')).not.toBeInTheDocument();
    expect(within(factorTable).queryByText('复权收盘价')).not.toBeInTheDocument();
    expect(within(factorTable).getByText('Fama-French 风格合成 Alpha')).toBeInTheDocument();
    expect(within(factorTable).getAllByRole('button', { name: /查看血缘/ }).length).toBeGreaterThanOrEqual(1);
    expect(within(factorTable).getAllByText('W').length).toBeGreaterThan(0);
    expect(within(factorTable).getAllByText('N').length).toBeGreaterThan(0);
    expect(within(factorTable).getAllByText('Z').length).toBeGreaterThan(0);
    expect(within(factorTable).getAllByText('T').length).toBeGreaterThan(0);
    expect(within(factorTable).getAllByText(/RankIC 0\.052/).length).toBeGreaterThan(0);
    expect(within(factorTable).getAllByText(/IR 0\.72/).length).toBeGreaterThan(0);
    expect(within(factorTable).getAllByText('丨').length).toBeGreaterThan(0);
    expect(within(factorTable).getAllByText(/衰减 21日/).length).toBeGreaterThan(0);
    expect(within(factorTable).getAllByText(/覆盖 92\.4%/).length).toBeGreaterThan(0);
    expect(document.querySelector('.factor-sparkline__zero')).not.toBeNull();
    expect(document.querySelector('.factor-sparkline__zero-label')).not.toBeNull();
    expect(within(factorTable).queryByRole('button', { name: '诊断' })).not.toBeInTheDocument();
    expect(within(factorTable).getAllByRole('button', { name: '详情' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('血缘树预览')).not.toBeInTheDocument();
    const momentumRow = within(factorTable).getByText('12-1月截面动量排名').closest('tr') as HTMLElement;
    const lineageButton = within(momentumRow).getByRole('button', { name: /查看血缘/ });
    expect(lineageButton).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(lineageButton);
    const lineageDialog = screen.getByRole('dialog', { name: '血缘树预览' });
    expect(lineageDialog).toHaveClass('factor-lineage-preview');
    expect(within(lineageDialog).getByText('血缘树预览')).toBeInTheDocument();
    expect(within(lineageDialog).getByText('复权收盘价')).toBeInTheDocument();
    expect(within(lineageDialog).getByText(/当前预览：/)).toBeInTheDocument();
    fireEvent.click(within(lineageDialog).getByRole('button', { name: '收起' }));
    expect(screen.queryByText('血缘树预览')).not.toBeInTheDocument();
    expect(screen.getByText('正交性热力图')).toBeInTheDocument();
    expect(screen.getByText('相关性阈值 0.70')).toBeInTheDocument();

    expect(within(levelFilter).getByRole('button', { name: 'C微弱' })).toHaveClass('is-active');
    expect(allLevelButton).not.toHaveClass('is-active');
    fireEvent.click(within(tierFilter).getByRole('tab', { name: /F3 组合库/ }));
    expect(within(factorTable).getByText('Fama-French 风格合成 Alpha')).toBeInTheDocument();
    expect(within(factorTable).queryByText('F3 组合')).not.toBeInTheDocument();

    fireEvent.click(allLevelButton);
    const layerCards = screen.getByLabelText('F1/F2/F3 因子库分层');
    fireEvent.click(within(layerCards).getByRole('button', { name: /F1 原始库/ }));
    expect(within(layerCards).getByRole('button', { name: /F1 原始库/ })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(fakeFactorApi.getF1Catalog).toHaveBeenCalledTimes(1));
    const f1Panel = await screen.findByTestId('f1-raw-catalog');
    expect(within(f1Panel).getByRole('heading', { name: 'F1 原始字段目录' })).toBeInTheDocument();
    expect(screen.queryByText('因子资产台账')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('因子族多选')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('因子级别筛选')).not.toBeInTheDocument();
    expect(within(f1Panel).getByText(/不设 IC 门槛/)).toBeInTheDocument();
    expect(within(f1Panel).getByRole('columnheader', { name: '字段' })).toBeInTheDocument();
    expect(within(f1Panel).getByRole('columnheader', { name: '层级' })).toBeInTheDocument();
    expect(within(f1Panel).getByRole('columnheader', { name: '覆盖' })).toBeInTheDocument();
    expect(within(f1Panel).getByRole('columnheader', { name: '时点' })).toBeInTheDocument();
    expect(within(f1Panel).getByRole('columnheader', { name: '阻塞' })).toBeInTheDocument();
    expect(within(f1Panel).queryByText('DATA_SOURCE_BLOCKED')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /数据质量状态/ })).not.toBeInTheDocument();
    expect(screen.queryByText('F1 归入“其他”，不按 RankIC/IR 分级约束')).not.toBeInTheDocument();
    fireEvent.click(within(layerCards).getByRole('button', { name: /F2 改造库/ }));
    const refreshedFamilyFilter = await screen.findByLabelText('因子族多选');
    const refreshedTierFilter = screen.getByLabelText('所属库筛选');
    const refreshedLifecycleFilter = screen.getByLabelText('因子生命周期视图');
    fireEvent.click(within(refreshedFamilyFilter).getByRole('button', { name: '动量' }));
    expect(within(refreshedTierFilter).getByRole('tab', { name: /F2 改造库 1/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(refreshedLifecycleFilter).getByRole('tab', { name: /全部生命周期 1/ })).toBeInTheDocument();
    const refreshedFactorTable = screen.getByRole('table');
    expect(within(refreshedFactorTable).getByText('12-1月截面动量排名')).toBeInTheDocument();
  });

  it('shows configure strategy only for completed WNZT S/A L3 US factors and routes with composite prefill', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          tier_level: 'F3',
          tier_label: 'F3 组合',
          tier_projection: { key: 'F3', label: 'F3 组合', description: 'L3 publishable factor' },
          factor_level: 'S',
          factor_level_label: 'S顶级',
          factor_level_projection: { key: 'S', label: 'S顶级', description: '可进入合成策略' },
          op_status: {
            completed: ['W', 'N', 'Z', 'T'],
            missing: [],
            lights: [
              { code: 'W', key: 'winsorize', label: '去极值', active: true, status: 'done' },
              { code: 'N', key: 'neutralize', label: '中性化', active: true, status: 'done' },
              { code: 'Z', key: 'zscore', label: '标准化', active: true, status: 'done' },
              { code: 'T', key: 'tsrank', label: '时序排名', active: true, status: 'done' },
            ],
          },
        }),
        makeFactor({
          id: 's_val_ep_ltm_raw',
          name: '估值 EP 原值',
          tier_level: 'F2',
          tier_projection: { key: 'F2', label: 'F2 改造', description: 'Not L3' },
        }),
      ],
      summary: { system_seed_count: 2, pit_status: 'READY', governance_queue_count: 0, online_count: 2, offline_count: 0 },
    });

    renderLegacyFactorLibraryPage();

    const table = await screen.findByRole('table');
    const configureButtons = within(table).getAllByRole('button', { name: '配置策略' });
    expect(configureButtons).toHaveLength(1);
    fireEvent.click(configureButtons[0]);

    expect(window.location.hash).toContain('#/factor-models/new?');
    expect(window.location.hash).toContain('strategy_type=COMPOSITE_FACTOR');
    expect(window.location.hash).toContain('factor_id=s_mom_12m1m_rank');
    expect(window.location.hash).toContain('weights=100');
    expect(window.location.hash).toContain('directions=HIGH_IS_BETTER');
  });

  it('keeps 10Y admission repair as a warning instead of a hard blocker', async () => {
    const repairMessage = '10 active-in-window symbols still need price evidence or identity repair; factor admission remains allowed with repair disclosure.';
    const repairWarning = {
      code: 'FACTOR_ADMISSION_10Y_REPAIR',
      severity: 'WARNING',
      label: '10Y repair queue',
      message: repairMessage,
    };
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 's_mom_repair_10y',
          name: '10Y补源动量',
          ui_state: 'robust',
          ui_state_label: '稳健',
          lifecycle: 'to_be_verified',
          lifecycle_label: '待校准',
          factor_level: 'C',
          factor_level_label: 'C微弱',
          readiness_blockers: [repairWarning],
          blocker_reason_summary: {
            status: 'warning',
            label: '1 个风险提示',
            reasons: [{ ...repairWarning, severity: 'warning' }],
            warning_count: 1,
            blocked_count: 0,
          },
          strategy_creation_risk: {
            can_create: true,
            warning_count: 1,
            blocked_count: 0,
            warnings: [{ ...repairWarning, severity: 'warning' }],
            hard_blockers: [],
          },
        }),
      ],
      summary: { system_seed_count: 1, pit_status: 'REPAIR', governance_queue_count: 0, online_count: 1, offline_count: 0 },
    });
    fakeFactorApi.getPitDataOverview.mockResolvedValue(makePitOverview());

    renderLegacyFactorLibraryPage();

    fireEvent.click(screen.getByRole('button', { name: 'C微弱' }));
    const factorButton = await screen.findByRole('button', { name: '10Y补源动量' });
    const row = factorButton.closest('tr') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText('C')).toBeInTheDocument();
    expect(within(row).getByLabelText('C微弱')).toBeInTheDocument();
    expect(within(row).getByText('待校准')).toBeInTheDocument();
    expect(within(row).queryByText('降权建议')).not.toBeInTheDocument();
    expect(within(row).queryByText('10Y 准入补源队列')).not.toBeInTheDocument();
    expect(within(row).queryByText('硬阻断')).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent('10Y repair queue');
    expect(row).not.toHaveTextContent('active-in-window symbols');
  });

  it('uses group bars and factor id for governance reverse diagnostic popovers', async () => {
    const reverseFactorId = 'm_vol_downsiderev_252d_rank';
    const goodGroups = [
      { group: 'Q1', mean_return: 0.026, sample_count: 120 },
      { group: 'Q2', mean_return: 0.015, sample_count: 120 },
      { group: 'Q3', mean_return: 0.005, sample_count: 120 },
      { group: 'Q4', mean_return: -0.001, sample_count: 120 },
      { group: 'Q5', mean_return: -0.009, sample_count: 120 },
    ];
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: reverseFactorId,
          name: '反向下行波动率代理（252日）',
          source: 'MANUAL',
          lifecycle_status: 'VERIFIED',
          diagnostic_status: 'COMPLETED',
          descriptor: {
            canonical_id: reverseFactorId,
            source_prefix: 'm',
            category: 'vol',
            metric: 'downsiderev',
            window: '252d',
            operator: 'rank',
            schema_version: '1',
          },
          ui_state: 'robust',
          ui_state_label: '稳健',
          latest_diagnostic_summary: {
            run_id: 'reverse-preview:fdiag_b290db5ee459',
            factor_id: reverseFactorId,
            status: 'COMPLETED',
            diagnostic_mode: 'VERIFIED',
            rank_ic: 0.062,
            ir: 1.09,
            coverage: 98.5,
            group_returns: goodGroups,
            group_return_series: Array.from({ length: 5 }, (_, index) => ({
              date: `2026-0${index + 1}-28`,
              groups: goodGroups,
              q1_mean_return: -0.009,
              q5_mean_return: 0.026,
              q1_q5_spread: -0.035,
            })),
            data_lineage: { kind: 'GOVERNANCE_REVERSE_FACTOR_PREVIEW' },
            compliance_trail: { diagnosed_at: '2026-05-08T18:43:00Z' },
          },
          blocker_reason_summary: {
            status: 'clear',
            label: '无阻断',
            reasons: [],
            warning_count: 0,
            blocked_count: 0,
          },
          strategy_creation_risk: {
            can_create: true,
            warning_count: 0,
            blocked_count: 0,
            warnings: [],
            hard_blockers: [],
          },
        }),
      ],
      summary: { system_seed_count: 0, pit_status: 'READY', governance_queue_count: 0, online_count: 1, offline_count: 0 },
    });

    renderLegacyFactorLibraryPage();

    const factorButton = await screen.findByRole('button', { name: '反向下行波动率代理（252日）' });
    const row = factorButton.closest('tr') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText(reverseFactorId)).toBeInTheDocument();
    expect(within(row).getByText(/RankIC 0\.052/)).toBeInTheDocument();
    expect(within(row).getByText(/IR 0\.72/)).toBeInTheDocument();
    expect(row).not.toHaveTextContent('reverse-preview:fdiag_b290db5ee459');
    expect(row).not.toHaveTextContent('分组收益倒挂');
  });

  it('reclassifies completed A/B sandbox diagnostics to calibration states on the online table', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 's_alpha_ffblend_cur_rank',
          name: 'Fama-French 风格合成 Alpha',
          diagnostic_status: 'SANDBOX_READY',
          ui_state: 'sandbox',
          ui_state_label: '沙箱',
          lifecycle: 'to_be_verified',
          lifecycle_label: '待校准',
          factor_level: 'B',
          factor_level_label: 'B合格',
          latest_diagnostic_summary: {
            run_id: 'fdiag_alpha_live',
            status: 'COMPLETED',
            diagnostic_mode: 'SANDBOX',
            rank_ic: 0.0134,
            ir: 0.5853,
            coverage: 58.98,
            group_returns: [
              { group: 'Q1', mean_return: 0.0167, sample_count: 120 },
              { group: 'Q2', mean_return: 0.0082, sample_count: 120 },
              { group: 'Q3', mean_return: 0.0139, sample_count: 120 },
              { group: 'Q4', mean_return: 0.0182, sample_count: 120 },
              { group: 'Q5', mean_return: -0.0051, sample_count: 120 },
            ],
            ic_series: [
              { date: '2025-12-17', rank_ic: 0.0128 },
              { date: '2026-01-20', rank_ic: 0.0334 },
              { date: '2026-02-19', rank_ic: 0.0260 },
              { date: '2026-03-20', rank_ic: 0.0218 },
            ],
          },
          strategy_creation_risk: {
            can_create: true,
            warning_count: 2,
            blocked_count: 0,
            warnings: [
              {
                code: 'COVERAGE_EDGE',
                severity: 'warning',
                message: '诊断覆盖率低于 90%，限值研究使用并建议补齐样本覆盖。',
              },
              {
                code: 'FULL_READY_ARCHIVAL_GAP',
                severity: 'warning',
                message: '189 个前置窗口或非核心标的仍在 Full Ready 归档修复队列。',
              },
            ],
            hard_blockers: [],
          },
          blocker_reason_summary: {
            status: 'warning',
            label: '2 个风险提示',
            reasons: [
              {
                code: 'COVERAGE_EDGE',
                severity: 'warning',
                message: '诊断覆盖率低于 90%，限值研究使用并建议补齐样本覆盖。',
              },
              {
                code: 'FULL_READY_ARCHIVAL_GAP',
                severity: 'warning',
                message: '189 个前置窗口或非核心标的仍在 Full Ready 归档修复队列。',
              },
            ],
            warning_count: 2,
            blocked_count: 0,
          },
          batch_diagnostic_summary: {
            status: 'COMPLETED',
            latest_run_id: 'fdiag_alpha_live',
            diagnostic_mode: 'SANDBOX',
            rank_ic: 0.0134,
            ir: 0.5853,
            coverage: 58.98,
            completed_at: '2026-05-08T10:43:32Z',
            ui_state: 'sandbox',
            warning_count: 2,
            blocked_count: 0,
          },
        }),
      ],
      summary: { system_seed_count: 1, pit_status: 'REPAIR', governance_queue_count: 0, online_count: 1, offline_count: 0 },
    });

    renderLegacyFactorLibraryPage();

    const factorButton = await screen.findByRole('button', { name: 'Fama-French 风格合成 Alpha' });
    const row = factorButton.closest('tr') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText('B')).toBeInTheDocument();
    expect(within(row).getByLabelText('B合格')).toBeInTheDocument();
    expect(within(row).getByText('待校准')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('沙箱');
  });

  it('shows standard category tags beside factor names and filters by the new taxonomy', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 's_beta_resid_252d_z',
          name: '残差贝塔代理（252日 Z分）',
          descriptor: {
            canonical_id: 's_beta_resid_252d_z',
            source_prefix: 's',
            category: 'beta',
            metric: 'resid',
            window: '252d',
            operator: 'z',
            schema_version: '1',
          },
          tags: ['beta'],
        }),
        makeFactor({
          id: 's_inv_assetgrowth_1y_rank',
          name: '资产增长代理（1年）',
          descriptor: {
            canonical_id: 's_inv_assetgrowth_1y_rank',
            source_prefix: 's',
            category: 'inv',
            metric: 'assetgrowth',
            window: '1y',
            operator: 'rank',
            schema_version: '1',
          },
          tags: ['investment'],
        }),
        makeFactor({
          id: 's_inv_capex_ltm_raw',
          name: '资本开支强度（LTM）',
          descriptor: {
            canonical_id: 's_inv_capex_ltm_raw',
            source_prefix: 's',
            category: 'inv',
            metric: 'capex',
            window: 'ltm',
            operator: 'raw',
            schema_version: '1',
          },
          tags: ['investment'],
        }),
        makeFactor({
          id: 's_liq_turnover_20d_rank',
          name: '换手率代理（20日）',
          descriptor: {
            canonical_id: 's_liq_turnover_20d_rank',
            source_prefix: 's',
            category: 'liq',
            metric: 'turnover',
            window: '20d',
            operator: 'rank',
            schema_version: '1',
          },
          tags: ['liquidity'],
        }),
        makeFactor({
          id: 's_alpha_ffblend_cur_rank',
          name: 'Fama-French 风格合成 Alpha',
          descriptor: {
            canonical_id: 's_alpha_ffblend_cur_rank',
            source_prefix: 's',
            category: 'alpha',
            metric: 'ffblend',
            window: 'cur',
            operator: 'rank',
            schema_version: '1',
          },
          tags: ['alpha_blend'],
        }),
      ],
      summary: { system_seed_count: 5, pit_status: 'READY', governance_queue_count: 0, online_count: 5, offline_count: 0 },
    });

    renderLegacyFactorLibraryPage();

    const factorCell = async (name: string) => {
      const link = await screen.findByRole('button', { name });
      return link.closest('td') as HTMLElement;
    };

    const betaCell = await factorCell('残差贝塔代理（252日 Z分）');
    expect(within(betaCell).getByText('风险')).toHaveClass('factor-category-tag');
    const assetGrowthCell = await factorCell('资产增长代理（1年）');
    expect(within(assetGrowthCell).getByText('质量')).toHaveClass('factor-category-tag');
    const capexCell = await factorCell('资本开支强度（LTM）');
    expect(within(capexCell).getByText('质量')).toHaveClass('factor-category-tag');
    const turnoverCell = await factorCell('换手率代理（20日）');
    expect(within(turnoverCell).getByText('情绪')).toHaveClass('factor-category-tag');
    const alphaCell = await factorCell('Fama-French 风格合成 Alpha');
    expect(within(alphaCell).getByText('综合')).toHaveClass('factor-category-tag');

    const familyFilter = screen.getByLabelText('因子族多选');
    expect(screen.queryByLabelText('因子族')).not.toBeInTheDocument();

    fireEvent.click(within(familyFilter).getByRole('button', { name: '质量' }));
    expect(screen.getByRole('button', { name: '资产增长代理（1年）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '资本开支强度（LTM）' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '残差贝塔代理（252日 Z分）' })).not.toBeInTheDocument();

    fireEvent.click(within(familyFilter).getByRole('button', { name: '情绪' }));
    expect(screen.getByRole('button', { name: '换手率代理（20日）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '资产增长代理（1年）' })).toBeInTheDocument();

    fireEvent.click(within(familyFilter).getByRole('button', { name: '全部因子族' }));
    fireEvent.click(within(familyFilter).getByRole('button', { name: '综合' }));
    expect(screen.getByRole('button', { name: 'Fama-French 风格合成 Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '换手率代理（20日）' })).not.toBeInTheDocument();
  });

  it('filters lifecycle tabs and correlation heatmap to the visible factor set', async () => {
    const onlineFactors = [
      makeFactor(),
      makeFactor({
        id: 's_val_ep_ltm_raw',
        name: '滚动市盈率倒数 (LTM)',
        descriptor: {
          canonical_id: 's_val_ep_ltm_raw',
          source_prefix: 's',
          category: 'val',
          metric: 'ep',
          window: 'ltm',
          operator: 'raw',
          schema_version: '1',
        },
      }),
    ];
    const offlineFactors = [
      makeFactor({
        id: 's_noise_legacy_rank',
        name: '旧版噪声因子',
        lifecycle_status: 'DEPRECATED',
        offline_reason: '强制下线：Grade D、低效 20 个交易日且分组收益倒挂。',
        offline_at: '2026-05-08T09:00:00Z',
        offline_command: 'DEPRECATE',
        ui_state: 'decayed',
        ui_state_label: '已下线',
      }),
      makeFactor({
        id: 's_val_bp_latest_raw',
        name: '账面市值比冗余因子',
        lifecycle_status: 'PRUNED',
        offline_reason: '冗余裁剪：同簇高相关且非 MVP 因子。',
        offline_at: '2026-05-08T09:30:00Z',
        offline_command: 'PRUNE',
        offline_detail: {
          keep_factor_id: 's_val_ep_ltm_raw',
          correlation: 0.93,
          comparison: {
            mvp: {
              factor_id: 's_val_ep_ltm_raw',
              factor_name: '滚动市盈率倒数 (LTM)',
            },
          },
        },
        ui_state: 'decayed',
        ui_state_label: '已下线',
      }),
    ];
    fakeFactorApi.listFactors.mockImplementation((params?: { lifecycle?: string }) => {
      const lifecycle = params?.lifecycle ?? 'all';
      const items = lifecycle === 'archived' || lifecycle === 'offline'
        ? offlineFactors
        : lifecycle === 'all'
          ? [...onlineFactors, ...offlineFactors]
          : onlineFactors;
      return Promise.resolve({
        items,
        summary: {
          system_seed_count: 2,
          pit_status: 'READY',
          all_count: onlineFactors.length + offlineFactors.length,
          online_count: onlineFactors.length,
          offline_count: offlineFactors.length,
          archived_count: offlineFactors.length,
          lifecycle_sandbox_count: 0,
          to_be_verified_count: 0,
          f1_count: 0,
          f2_count: onlineFactors.length + offlineFactors.length,
          f3_count: 0,
          governance_queue_count: 0,
        },
      });
    });

    renderLegacyFactorLibraryPage();

    expect(await screen.findByRole('tab', { name: /全部生命周期/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('columnheader', { name: /操作/ })).toBeInTheDocument();
    expect(screen.queryByText('下线原因')).not.toBeInTheDocument();
    expect(screen.queryByText('下线时间')).not.toBeInTheDocument();
    expect(fakeFactorApi.listFactors).toHaveBeenCalledWith(expect.objectContaining({ lifecycle: 'all' }));
    await waitFor(() => expect(document.querySelector('.factor-correlation__grid')?.getAttribute('style')).toContain('--factor-count: 4'));
    fireEvent.click(screen.getByRole('tab', { name: /已归档/ }));
    expect(fakeFactorApi.listFactors).toHaveBeenCalledTimes(1);
    expect((await screen.findAllByText('旧版噪声因子')).length).toBeGreaterThan(0);
    expect(screen.queryByText('阻断 / 风险')).not.toBeInTheDocument();
    expect(screen.queryByText('比对 / 操作')).not.toBeInTheDocument();
    expect(screen.getAllByText(/已归档/).length).toBeGreaterThan(0);
    expect(screen.queryByText('滚动市盈率倒数 (LTM)')).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.factor-correlation__grid')?.getAttribute('style')).toContain('--factor-count: 2'));
  });

  it('opens governance tasks, executes offline actions with confirmation, and routes draft suggestions', async () => {
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
      summary: { system_seed_count: 1, pit_status: 'READY', governance_queue_count: 1, strategy_usage_factor_count: 2, online_count: 2, offline_count: 0 },
    });
    fakeFactorApi.getFactorGovernanceOverview.mockResolvedValue({
      as_of: '2026-05-06T09:00:00Z',
      queue_count: 2,
      actions: [
        {
          id: 'gq_deprecate_s_mom_12m1m_rank',
          kind: 'DEPRECATE',
          command: 'DEPRECATE',
          label: '强制下线',
          title: '动量因子满足强制下线条件',
          detail: 'Grade D、20 个交易日低效且 Q1/Q5 严重倒挂。',
          factor_ids: ['s_mom_12m1m_rank'],
          affected_factor_ids: ['s_mom_12m1m_rank'],
          offline_reason: '强制下线：Grade D、低效 20 个交易日且分组收益倒挂。',
          severity: 'danger',
        },
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
          title: '[Auto-Mined] 动量因子策略',
          detail: '该 L3 组合因子已达到 S/A 级，且当前线上多因子策略尚未引用；建议以该因子 100% 权重生成待审查策略草稿。',
          factor_ids: ['a_mom_auto_rank'],
          suggested_weights: [
            { factor_id: 'a_mom_auto_rank', weight_pct: 100, direction: 'HIGH_IS_BETTER' },
          ],
          severity: 'info',
          target: {
            route: '#/factor-models/new',
            query: {
              source: 'governance_queue',
              factorIds: 'a_mom_auto_rank',
              weights: '100',
              directions: 'HIGH_IS_BETTER',
              modelName: '[Auto-Mined] 动量因子策略',
            },
          },
        },
      ],
    });
    fakeFactorApi.executeFactorGovernanceAction.mockResolvedValue({
      status: 'EXECUTED',
      action_id: 'gq_deprecate_s_mom_12m1m_rank',
      command: 'DEPRECATE',
      affected_factor_ids: ['s_mom_12m1m_rank'],
      keep_factor_id: null,
      offline_at: '2026-05-08T09:00:00Z',
      reason: '强制下线：Grade D、低效 20 个交易日且分组收益倒挂。',
      items: [
        makeFactor({
          lifecycle_status: 'DEPRECATED',
          offline_reason: '强制下线：Grade D、低效 20 个交易日且分组收益倒挂。',
          offline_at: '2026-05-08T09:00:00Z',
          offline_command: 'DEPRECATE',
        }),
      ],
      governance_overview: {
        as_of: '2026-05-08T09:00:00Z',
        queue_count: 1,
        actions: [
          {
            id: 'gq_model_a_mom_auto_rank',
            kind: 'FACTOR_MODEL_SUGGESTION',
            label: '策略草稿建议',
            title: '[Auto-Mined] 动量因子策略',
            detail: '该 L3 组合因子已达到 S/A 级，且当前线上多因子策略尚未引用；建议以该因子 100% 权重生成待审查策略草稿。',
            factor_ids: ['a_mom_auto_rank'],
            suggested_weights: [
              { factor_id: 'a_mom_auto_rank', weight_pct: 100, direction: 'HIGH_IS_BETTER' },
            ],
            severity: 'info',
            target: {
              route: '#/factor-models/new',
              query: {
                source: 'governance_queue',
                factorIds: 'a_mom_auto_rank',
                weights: '100',
                directions: 'HIGH_IS_BETTER',
                modelName: '[Auto-Mined] 动量因子策略',
              },
            },
          },
        ],
      },
    });
    renderLegacyFactorLibraryPage();

    expect((await screen.findAllByText('F1 原始库')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /查看 PIT 门禁/ })).not.toBeInTheDocument();
    const trigger = await screen.findByRole('button', { name: /治理任务/ });
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog', { name: '治理任务' })).toBeInTheDocument();
    await waitFor(() => expect(fakeFactorApi.getFactorGovernanceOverview).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.factor-governance-modal__body')).not.toBeNull();
    await waitFor(() => expect(trigger).toHaveTextContent('2'));
    expect(await screen.findByText('动量因子满足强制下线条件')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '二次确认' })[0]);
    const confirmDialog = await screen.findByRole('dialog', { name: '确认治理任务' });
    expect(confirmDialog).toBeInTheDocument();
    expect(confirmDialog.querySelector('.factor-governance-modal__body')).not.toBeNull();
    expect(confirmDialog.querySelector('.factor-governance-modal__footer')).not.toBeNull();
    expect(confirmDialog).toHaveTextContent('强制下线会写入“已强制下线”状态');
    expect(confirmDialog).not.toHaveTextContent('DEPRECATE');
    expect(confirmDialog).not.toHaveTextContent('DEPRECATED');
    expect(confirmDialog).not.toHaveTextContent('PRUNE');
    expect(confirmDialog).not.toHaveTextContent('PRUNED');
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await waitFor(() => expect(fakeFactorApi.executeFactorGovernanceAction).toHaveBeenCalledWith(
      'gq_deprecate_s_mom_12m1m_rank',
      expect.objectContaining({ confirm: true, command: 'DEPRECATE', factor_ids: ['s_mom_12m1m_rank'] }),
    ));
    expect(await screen.findByText('[Auto-Mined] 动量因子策略')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '带入创建页' }));

    await waitFor(() => expect(window.location.hash).toContain('#/factor-models/new'));
    expect(window.location.hash).toContain('source=governance_queue');
    expect(decodeURIComponent(window.location.hash)).toContain('a_mom_auto_rank');
    expect(decodeURIComponent(window.location.hash)).toContain('weights=100');
    const routedQuery = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    expect(routedQuery.get('modelName')).toBe('[Auto-Mined] 动量因子策略');
  });

  it('shows governance execute failures inside the confirmation dialog', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [makeFactor()],
      summary: { system_seed_count: 1, pit_status: 'READY', governance_queue_count: 1, strategy_usage_factor_count: 1, online_count: 1, offline_count: 0 },
    });
    fakeFactorApi.getFactorGovernanceOverview.mockResolvedValue({
      as_of: '2026-05-15T09:00:00Z',
      queue_count: 1,
      actions: [
        {
          id: 'gq_deprecate_s_mom_12m1m_rank',
          kind: 'DEPRECATE',
          command: 'DEPRECATE',
          label: 'Deprecate',
          title: 'Deprecate stale factor',
          detail: 'Diagnostic decay requires offline review.',
          factor_ids: ['s_mom_12m1m_rank'],
          affected_factor_ids: ['s_mom_12m1m_rank'],
          offline_reason: 'Diagnostic decay',
          severity: 'danger',
        },
      ],
    });
    fakeFactorApi.executeFactorGovernanceAction.mockRejectedValue(new Error('Factor already offline: s_mom_12m1m_rank'));

    renderLegacyFactorLibraryPage();

    const trigger = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('.factor-governance-trigger');
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(trigger);

    await waitFor(() => expect(fakeFactorApi.getFactorGovernanceOverview).toHaveBeenCalledTimes(1));
    const executeButton = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('.factor-governance-action .factor-btn--primary');
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(executeButton);

    const confirmDialog = await waitFor(() => {
      const dialogs = document.querySelectorAll<HTMLElement>('.factor-governance-modal');
      expect(dialogs.length).toBeGreaterThan(1);
      return dialogs[1];
    });
    const confirmButton = confirmDialog.querySelector<HTMLButtonElement>('.factor-governance-modal__footer .factor-btn--primary');
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton!);

    await waitFor(() => expect(fakeFactorApi.executeFactorGovernanceAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(confirmDialog).toHaveTextContent('Factor already offline: s_mom_12m1m_rank'));
  });

  it('refreshes the governance trigger count from the latest overview when opened', async () => {
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
      summary: { system_seed_count: 1, pit_status: 'READY', governance_queue_count: 1, strategy_usage_factor_count: 2, online_count: 2, offline_count: 0 },
    });
    let resolveOverview!: (overview: {
      as_of: string;
      queue_count: number;
      actions: Array<Record<string, unknown>>;
    }) => void;
    fakeFactorApi.getFactorGovernanceOverview.mockReturnValue(new Promise((resolve) => {
      resolveOverview = resolve;
    }));

    renderLegacyFactorLibraryPage();

    const trigger = await screen.findByRole('button', { name: /治理任务/ });
    expect(trigger).toHaveTextContent('1');
    fireEvent.click(trigger);
    await waitFor(() => expect(fakeFactorApi.getFactorGovernanceOverview).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveOverview({
        as_of: '2026-05-12T09:00:00Z',
        queue_count: 2,
        actions: [
          {
            id: 'gq_deprecate_s_mom_12m1m_rank',
            kind: 'DEPRECATE',
            command: 'DEPRECATE',
            label: '强制下线',
            title: '12-1 动量因子需要强制下线',
            detail: 'Grade D 且连续分组收益倒挂，需要进入治理队列。',
            factor_ids: ['s_mom_12m1m_rank'],
            affected_factor_ids: ['s_mom_12m1m_rank'],
            severity: 'danger',
          },
          {
            id: 'gq_model_a_mom_auto_rank',
            kind: 'FACTOR_MODEL_SUGGESTION',
            label: '策略草稿建议',
            title: '自动挖掘因子建议进入策略草稿',
            detail: '治理任务建议把自动挖掘因子带入多因子创建页。',
            factor_ids: ['a_mom_auto_rank'],
            suggested_weights: [
              { factor_id: 'a_mom_auto_rank', weight_pct: 100, direction: 'HIGH_IS_BETTER' },
            ],
            severity: 'info',
            target: {
              route: '#/factor-models/new',
              query: {
                source: 'governance_queue',
                factorIds: 'a_mom_auto_rank',
                weights: '100',
                directions: 'HIGH_IS_BETTER',
              },
            },
          },
        ],
      });
    });
    await waitFor(() => expect(trigger).toHaveTextContent('2'));

    expect(await screen.findByRole('dialog', { name: '治理任务' })).toBeInTheDocument();
    await waitFor(() => expect(fakeFactorApi.getFactorGovernanceOverview).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('12-1 动量因子需要强制下线')).toBeInTheDocument();
  });

  it('confirms factor optimization tasks and submits the reverse factor publish command', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 's_vol_downside_252d_rank',
          name: '下行波动率代理（252日）',
          source: 'SYSTEM_SEED',
          lifecycle_status: 'VERIFIED',
          diagnostic_status: 'COMPLETED',
          expression: 'DownsideStd(Return(Close, 1), 252)',
        }),
      ],
      summary: { system_seed_count: 1, pit_status: 'READY', governance_queue_count: 1, strategy_usage_factor_count: 1, online_count: 1, offline_count: 0 },
    });
    fakeFactorApi.getFactorGovernanceOverview.mockResolvedValue({
      as_of: '2026-05-12T09:00:00Z',
      queue_count: 1,
      actions: [
        {
          id: 'gq_optimize_s_vol_downside_252d_rank',
          kind: 'FACTOR_OPTIMIZATION',
          command: 'PUBLISH_OPTIMIZED_FACTOR',
          label: '因子优化',
          title: '下行波动率代理（252日） 生成反向因子待入库',
          detail: '分组收益倒挂，反向因子再次诊断为 Grade B，等待确认入库。',
          factor_ids: ['s_vol_downside_252d_rank'],
          affected_factor_ids: ['s_vol_downside_252d_rank'],
          severity: 'info',
          optimized_factor: {
            id: 's_alpha_vol_downsiderev_std_rk',
            name: '反向下行波动率代理（252日）',
            expression: 'DownsideStd(Return(Close, 1), 252)',
            direction: 'HIGH_IS_BETTER',
            grade: 'B',
            confirmable: true,
            diagnostic_summary: { rank_ic: 0.021, ir: 0.72, coverage: 96.2 },
          },
        },
      ],
    });
    fakeFactorApi.executeFactorGovernanceAction.mockResolvedValue({
      status: 'EXECUTED',
      action_id: 'gq_optimize_s_vol_downside_252d_rank',
      command: 'PUBLISH_OPTIMIZED_FACTOR',
      affected_factor_ids: ['s_vol_downside_252d_rank'],
      keep_factor_id: null,
      offline_at: '2026-05-12T09:05:00Z',
      executed_at: '2026-05-12T09:05:00Z',
      reason: '分组收益倒挂，反向因子再次诊断为 Grade B，等待确认入库。',
      items: [
        makeFactor({
          id: 's_alpha_vol_downsiderev_std_rk',
          name: '反向下行波动率代理（252日）',
          source: 'MANUAL',
          lifecycle_status: 'VERIFIED',
          diagnostic_status: 'COMPLETED',
          expression: 'DownsideStd(Return(Close, 1), 252)',
        }),
      ],
      created_factor_id: 's_alpha_vol_downsiderev_std_rk',
      governance_overview: {
        as_of: '2026-05-12T09:05:00Z',
        queue_count: 0,
        actions: [],
      },
    });

    renderLegacyFactorLibraryPage();
    fireEvent.click(await screen.findByRole('button', { name: /治理任务/ }));
    expect(await screen.findByText('下行波动率代理（252日） 生成反向因子待入库')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '确认入库' }));

    const confirmDialog = await screen.findByRole('dialog', { name: '确认治理任务' });
    expect(confirmDialog).toHaveTextContent('优化后因子');
    expect(confirmDialog).toHaveTextContent('反向下行波动率代理（252日）');
    expect(confirmDialog).toHaveTextContent('s_alpha_vol_downsiderev_std_rk');
    expect(confirmDialog).toHaveTextContent('Grade B');
    expect(confirmDialog).toHaveTextContent('Rank IC');
    expect(confirmDialog).toHaveTextContent('0.021');
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '确认入库' }));

    await waitFor(() => expect(fakeFactorApi.executeFactorGovernanceAction).toHaveBeenCalledWith(
      'gq_optimize_s_vol_downside_252d_rank',
      expect.objectContaining({
        confirm: true,
        command: 'PUBLISH_OPTIMIZED_FACTOR',
        factor_ids: ['s_vol_downside_252d_rank'],
      }),
    ));
  });

  it('shows prune confirmation factor identities, metric comparison, and final plan', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 'm_mom_longdra_126d_rank',
          name: '下行风险调整后6m动量',
          descriptor: {
            canonical_id: 'm_mom_longdra_126d_rank',
            source_prefix: 'm',
            category: 'mom',
            metric: 'longdra',
            window: '126d',
            operator: 'rank',
            schema_version: '1',
          },
        }),
        makeFactor({
          id: 'm_mom_longra_126d_rank',
          name: '风险调整后动量',
          descriptor: {
            canonical_id: 'm_mom_longra_126d_rank',
            source_prefix: 'm',
            category: 'mom',
            metric: 'longra',
            window: '126d',
            operator: 'rank',
            schema_version: '1',
          },
        }),
      ],
      summary: { system_seed_count: 0, pit_status: 'READY', governance_queue_count: 1, online_count: 2, offline_count: 0 },
    });
    fakeFactorApi.getFactorGovernanceOverview.mockResolvedValue({
      as_of: '2026-05-08T09:00:00Z',
      queue_count: 1,
      actions: [
        {
          id: 'gq_prune_m_mom_longdra_126d_rank',
          kind: 'PRUNE',
          command: 'PRUNE',
          label: '冗余裁剪',
          title: '下行风险调整后6m动量 标记为冗余挂起',
          detail: '同簇相关性超过 0.90，保留 IR/覆盖率更优的 MVP 因子。',
          factor_ids: ['m_mom_longdra_126d_rank'],
          affected_factor_ids: ['m_mom_longdra_126d_rank'],
          keep_factor_id: 'm_mom_longra_126d_rank',
          offline_reason: '冗余裁剪：同簇高相关且弱于风险调整后动量',
          offline_detail: {
            eligible: true,
            factor_id: 'm_mom_longdra_126d_rank',
            keep_factor_id: 'm_mom_longra_126d_rank',
            correlation: 0.94,
            comparison: {
              candidate: {
                factor_id: 'm_mom_longdra_126d_rank',
                factor_name: '下行风险调整后6m动量',
                rank_ic: 0.0294,
                ir: 1.2591,
                coverage: 99.13,
              },
              mvp: {
                factor_id: 'm_mom_longra_126d_rank',
                factor_name: '风险调整后动量',
                rank_ic: 0.0308,
                ir: 1.3205,
                coverage: 99.13,
              },
            },
          },
          severity: 'warning',
        },
      ],
    });

    renderLegacyFactorLibraryPage();
    fireEvent.click((await screen.findByText('治理任务')).closest('button') as HTMLButtonElement);
    fireEvent.click(await screen.findByRole('button', { name: '二次确认' }));

    const confirmDialog = await screen.findByRole('dialog', { name: '确认治理任务' });
    expect(confirmDialog).toHaveTextContent('待裁剪因子');
    expect(confirmDialog).toHaveTextContent('保留 MVP');
    expect(confirmDialog).toHaveTextContent('最终方案');
    expect(confirmDialog).toHaveTextContent('下行风险调整后6m动量');
    expect(confirmDialog).toHaveTextContent('m_mom_longdra_126d_rank');
    expect(confirmDialog).toHaveTextContent('风险调整后动量');
    expect(confirmDialog).toHaveTextContent('m_mom_longra_126d_rank');
    expect(confirmDialog).toHaveTextContent('相关性 0.94');
    expect(confirmDialog).toHaveTextContent('Rank IC 0.029');
    expect(confirmDialog).toHaveTextContent('IR 1.26');
    expect(confirmDialog).toHaveTextContent('覆盖率 99.13%');
    expect(confirmDialog).toHaveTextContent('保留 风险调整后动量');
    expect(confirmDialog).toHaveTextContent('下线 下行风险调整后6m动量');
  });

  it('renders no-IC factors as sandbox instead of showing a synthetic IC curve', async () => {
    fakeFactorApi.listFactors.mockResolvedValue({
      items: [
        makeFactor({
          id: 's_beta_market_252d_raw',
          name: '市场贝塔代理（252日）',
          diagnostic_status: 'READY_TO_DIAGNOSE',
          ui_state: 'sandbox',
          ui_state_label: '沙箱',
          latest_diagnostic_summary: null,
          last_diagnostic_run_id: null,
          ic_sparkline: [],
          quality_view: {
            rank_ic: null,
            ir: null,
            coverage: null,
            decay_days: null,
            decay_label: '待生成',
            sparkline: [],
            sparkline_window: '最近12期',
          },
          diagnostic_gap_summary: {
            rank_ic: 'Rank IC: 尚未提交诊断',
            coverage: '覆盖: 等待首次诊断',
            next_action: '提交 Verified 诊断',
          },
        }),
      ],
      summary: { system_seed_count: 1, pit_status: 'READY' },
    });

    renderLegacyFactorLibraryPage();

    expect((await screen.findAllByText('市场贝塔代理（252日）')).length).toBeGreaterThan(0);
    expect(screen.getByText('Rank IC: 尚未提交诊断')).toBeInTheDocument();
    expect(screen.getByText('暂无 IC')).toBeInTheDocument();
    const factorButton = screen.getByRole('button', { name: '市场贝塔代理（252日）' });
    expect(factorButton.closest('tr')).toHaveTextContent('线上');
    expect(screen.queryByLabelText('IC 累积曲线缩略图')).not.toBeInTheDocument();
  });

  it('keeps list quality compact and moves reference lineage out of the table', async () => {
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

    renderLegacyFactorLibraryPage();

    expect((await screen.findAllByText('6个月动量排名')).length).toBeGreaterThan(0);
    expect(screen.queryByText('参考口径')).not.toBeInTheDocument();
    expect(screen.getByText('RankIC 0.052')).toBeInTheDocument();
    expect(screen.getByText(/IR 0\.72/)).toBeInTheDocument();
    expect(screen.getByText(/衰减 21日/)).toBeInTheDocument();
    expect(screen.getByText(/覆盖 92\.4%/)).toBeInTheDocument();
    const diagnosticCell = screen.getByText('RankIC 0.052').closest('.factor-diagnostic-cell');
    expect(diagnosticCell?.children[0]).toHaveClass('factor-diagnostic-cell__metrics');
    expect(diagnosticCell?.children[1]).toHaveClass('factor-sparkline');
    expect(screen.getAllByText(/稳健|待校准|失效|沙箱/).length).toBeGreaterThan(0);
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

    renderLegacyFactorLibraryPage();

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
    expect(await screen.findByText('RankIC 0.031')).toBeInTheDocument();
    expect(document.querySelector('.factor-diagnostic-cell__reference')).toBeNull();
  });

  it('renders factor detail from the light factor response before the PIT overview finishes', async () => {
    fakeFactorApi.getFactor.mockResolvedValue(makeFactorDetail());
    fakeFactorApi.getPitDataOverview.mockReturnValue(new Promise(() => undefined));

    render(<FactorDetailPage factorId="s_alpha_ffblend_cur_rank" />);

    expect(await screen.findByRole('heading', { level: 1, name: /Fama-French 风格合成 Alpha诊断报告/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '点击诊断' })).toBeDisabled();
    expect(screen.getByText('尚未生成诊断报告')).toBeInTheDocument();
    expect(screen.getByText('等待 PIT 数据门禁恢复后可诊断')).toBeInTheDocument();
    expect(fakeFactorApi.getPitDataOverview).toHaveBeenCalledTimes(1);
  });

  it('shows rerun diagnostic toast, busy state, staged wait copy, and refreshed summary', async () => {
    vi.useFakeTimers();
    const existingSummary = makeFactorDiagnosticSummary();
    let resolveDiagnostic: (value: { run_id: string; summary: ApiFactorDiagnosticSummary }) => void = () => undefined;
    fakeFactorApi.getFactor.mockResolvedValue(makeFactorDetail({
      diagnostic_status: 'COMPLETED',
      latest_diagnostic_summary: existingSummary,
      last_diagnostic_run_id: existingSummary.run_id,
    }));
    fakeFactorApi.getPitDataOverview.mockResolvedValue(makePitOverview());
    fakeFactorApi.getF1Catalog.mockResolvedValue({
      snapshot: {
        id: 'f1_catalog_snapshot_test',
        snapshot_id: 'f1_catalog_snapshot_test',
        run_id: 'pit_preprocessing_test',
        as_of_date: '2026-05-19',
        generated_at: '2026-05-19T08:00:00Z',
        field_count: 2,
        callable_count: 1,
        blocked_count: 1,
        timing_gap_count: 0,
        summary: { ic_ir_gate: 'NOT_APPLIED' },
      },
      summary: {
        item_count: 2,
        callable_count: 1,
        blocked_count: 1,
        timing_gap_count: 0,
        ic_ir_gate: 'NOT_APPLIED',
        admission_policy: 'PIT_COVERAGE_TIMING_BLOCKER_ONLY',
      },
      items: [
        {
          factor_id: 'f1_market_cap',
          name: '总市值原值',
          category: '规模',
          pit_layer: 'L1',
          source_refs: { dataset_snapshot_id: 'ds-price', source: 'runtime_price' },
          coverage_ratio: 0.88,
          available_symbol_count: 88,
          total_symbol_count: 100,
          missing_symbols: ['MSFT'],
          missing_symbol_count: 1,
          publish_date_rule: '交易日收盘生成',
          available_at_rule: 'T 日收盘后',
          missing_policy: '缺失 L1 输出 NaN',
          blocker_code: 'DATA_SOURCE_BLOCKED',
          admission_state: 'DATA_SOURCE_BLOCKED',
          future_leakage_risk: 'REVIEW_REQUIRED',
          last_updated_at: '2026-05-19T08:00:00Z',
          metadata: {},
        },
        {
          factor_id: 'f1_price_close',
          name: '复权收盘价',
          category: '价格',
          pit_layer: 'L1',
          source_refs: { dataset_snapshot_id: 'ds-price', source: 'runtime_price' },
          coverage_ratio: 1,
          available_symbol_count: 100,
          total_symbol_count: 100,
          missing_symbols: [],
          missing_symbol_count: 0,
          publish_date_rule: '交易日收盘生成',
          available_at_rule: 'T 日收盘后',
          missing_policy: '不足历史输出 NaN',
          blocker_code: null,
          admission_state: 'READY',
          future_leakage_risk: 'LOW',
          last_updated_at: '2026-05-19T08:00:00Z',
          metadata: {},
        },
      ],
    });
    fakeFactorApi.runFactorDiagnostics.mockReturnValue(new Promise((resolve) => {
      resolveDiagnostic = resolve;
    }));

    render(<FactorDetailPage factorId="s_alpha_ffblend_cur_rank" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rerunButton = screen.getByRole('button', { name: '重新诊断' });
    expect(rerunButton).not.toBeDisabled();
    fireEvent.click(rerunButton);

    expect(screen.getByRole('status')).toHaveTextContent('正在重新诊断');
    expect(screen.getByRole('status')).toHaveTextContent('s_alpha_ffblend_cur_rank');
    expect(screen.getByRole('button', { name: '诊断中...' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '诊断中...' }));
    expect(fakeFactorApi.runFactorDiagnostics).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('仍在计算横截面 IC');

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('诊断耗时较长');

    await act(async () => {
      resolveDiagnostic({
        run_id: 'fdiag_hot_cache_001',
        summary: makeFactorDiagnosticSummary({
          run_id: 'fdiag_hot_cache_001',
          rank_ic: 0.064,
          coverage: 98.1,
        }),
      });
      await Promise.resolve();
    });

    expect(screen.getByRole('status')).toHaveTextContent('诊断完成');
    expect(screen.getByRole('status')).toHaveTextContent('fdiag_hot_cache_001');
    expect(screen.getByRole('button', { name: '重新诊断' })).not.toBeDisabled();
    expect(screen.getByText('0.064')).toBeInTheDocument();
  });

  it('shows alert toast and keeps the error panel in sync when rerun diagnostics fails', async () => {
    const existingSummary = makeFactorDiagnosticSummary();
    fakeFactorApi.getFactor.mockResolvedValue(makeFactorDetail({
      diagnostic_status: 'COMPLETED',
      latest_diagnostic_summary: existingSummary,
      last_diagnostic_run_id: existingSummary.run_id,
    }));
    fakeFactorApi.getPitDataOverview.mockResolvedValue(makePitOverview());
    fakeFactorApi.runFactorDiagnostics.mockRejectedValue(new Error('PIT sample window is stale'));

    render(<FactorDetailPage factorId="s_alpha_ffblend_cur_rank" />);
    expect(await screen.findByRole('button', { name: '重新诊断' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));

    await waitFor(() => {
      expect(screen.getAllByRole('alert').map((item) => item.textContent ?? '').join('\n')).toContain('PIT sample window is stale');
    });
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('诊断失败');
    expect(screen.getByRole('button', { name: '重新诊断' })).not.toBeDisabled();
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
    expect(css).toContain('.factor-model-builder-page .factor-model-metric-chip--level');
    expect(css).toContain('.factor-model-builder-page .factor-model-metric-chip--rank-ic');
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-metric-chip\s*\{[^}]*background:\s*#f7f8fa;[^}]*color:\s*#52616d;/s);
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-name-control\s*\{[^}]*grid-template-columns:\s*max-content minmax\(180px,\s*280px\);/s);
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-metric-chip--category,[\s\S]*\.factor-model-builder-page \.factor-model-metric-chip--level,[\s\S]*\.factor-model-builder-page \.factor-model-metric-chip--rank-ic,[\s\S]*\.factor-model-builder-page \.factor-model-metric-chip--ir\s*\{[^}]*background:\s*#f7f8fa;[^}]*color:\s*#52616d;/s);
    expect(css).toMatch(/\.factor-model-builder-page \.factor-model-governance-row\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(240px,\s*100%\),\s*1fr\)\);/s);
    expect(css).toContain('.factor-model-builder-page .factor-model-rebalance-control');
    expect(css).toContain('.factor-model-builder-page .score-card small');
    expect(css).toContain('.factor-model-builder-page .neutral-block');
    expect(css).toContain('.factor-model-builder-page .switch--off');
    expect(css).toContain('.factor-model-builder-page .strategy-risk-module');
    expect(css).toContain('overflow-wrap: anywhere;');
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.factor-phase2-metrics,[\s\S]*\.factor-model-factor,[\s\S]*\.factor-model-builder-page \.factor-model-weight-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
    expect(factorsCss).toContain('.factor-diagnostic-popover');
    expect(factorsCss).toContain('.factor-diagnostic-popover__reason');
    expect(factorsCss).toContain('.factor-diagnostic-state__button');
    expect(factorsCss).not.toContain('.factor-gate-pill--warn');
    expect(factorsCss).toContain('.factor-sparkline-empty');
    expect(factorsCss).toContain('.factor-category-tag');
    expect(factorsCss).not.toContain('.factor-category-tag[data-category="risk"]');
    expect(factorsCss).toContain('.factor-correlation__group[data-category="sentiment"]');
    expect(factorsCss).toContain('.factor-correlation__group[data-category="other"]');
    expect(factorsCss).toContain('.factor-governance-confirm-note');
    expect(factorsCss).toMatch(/\.factor-governance-modal__panel--confirm \.factor-action-row\s*\{[^}]*justify-content:\s*flex-end;/s);
    expect(factorsCss).toMatch(/\.factor-governance-modal\s*\{[^}]*z-index:\s*100;[^}]*background:\s*rgba\(17,\s*24,\s*39,\s*0\.22\);[^}]*backdrop-filter:\s*blur\(6px\);/s);
    expect(factorsCss).toMatch(/\.factor-governance-modal__panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[^}]*overflow:\s*hidden;[^}]*border-radius:\s*16px;[^}]*background:\s*linear-gradient\(180deg,\s*#ffffff 0%,\s*#fcfcfd 100%\);[^}]*box-shadow:\s*var\(--shadow-float,\s*0 16px 36px rgba\(15,\s*23,\s*42,\s*0\.12\)\);/s);
    expect(factorsCss).toMatch(/\.factor-governance-modal__header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*2;[^}]*background:\s*linear-gradient\(180deg,\s*#ffffff 0%,\s*#fcfcfd 100%\);/s);
    expect(factorsCss).toMatch(/\.factor-governance-modal__body\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;[^}]*padding:\s*18px 24px 24px;[^}]*overscroll-behavior:\s*contain;/s);
    expect(factorsCss).toMatch(/\.factor-governance-modal__footer\s*\{[^}]*border-top:\s*1px solid var\(--gsl-color-border,\s*#e5e7eb\);[^}]*background:\s*#ffffff;/s);
    expect(factorsCss).toContain('.factor-governance-modal__close');
    expect(factorsCss).toMatch(/\.factor-governance-action\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*max-content;[^}]*border-radius:\s*12px;[^}]*background:\s*#ffffff;/s);
    expect(factorsCss).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.factor-governance-modal\s*\{[\s\S]*padding:\s*16px;[\s\S]*\.factor-governance-modal__body\s*\{[\s\S]*padding:\s*14px 18px 18px;[\s\S]*\.factor-governance-action\s*\{[\s\S]*grid-template-columns:\s*1fr;/s);
    expect(factorsCss).toContain('.factor-level-cell');
    expect(factorsCss).toContain('.factor-level-badge--s');
    expect(factorsCss).toContain('.factor-tier-tabs');
    expect(factorsCss).toContain('.factor-ledger-filter-row--library-family');
    expect(factorsCss).toContain('.factor-ledger-filter-row--lifecycle-level');
    expect(factorsCss).toContain('.factor-family-filter');
    expect(factorsCss).not.toContain('.factor-source-tag');
    expect(factorsCss).toContain('.factor-level-filter');
    expect(factorsCss).toContain('.factor-level-filter__all');
    expect(factorsCss).toMatch(/\.factor-ledger-filter-row\s*\{[^}]*justify-content:\s*flex-start;/s);
    expect(factorsCss).toMatch(/\.factor-ledger-filter-row \.factor-tier-tabs,\s*\.factor-ledger-filter-row \.factor-lifecycle-tabs\s*\{[^}]*margin-left:\s*auto;/s);
    expect(factorsCss).toMatch(/\.factor-family-filter\s*\{[^}]*justify-content:\s*flex-start;[^}]*flex:\s*0 1 auto;/s);
    expect(factorsCss).toMatch(/\.factor-level-filter\s*\{[^}]*justify-content:\s*flex-start;[^}]*flex:\s*0 1 auto;/s);
    expect(factorsCss).toContain('.factor-lineage-button');
    expect(factorsCss).toMatch(/\.factor-lineage-preview\s*\{[^}]*position:\s*fixed;[^}]*min-height:\s*94px;[^}]*box-shadow:\s*0 0 0 9999px/s);
    expect(factorsCss).toContain('.factor-op-light.is-active');
    expect(factorsCss).toContain('.factor-lifecycle-badge--to_be_verified');
    expect(factorsCss).toContain('.factor-sparkline__zero-label');
    expect(factorsCss).toContain('.factor-diagnostic-cell__separator');
    expect(factorsCss).toMatch(/\.factor-table-wrap\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(factorsCss).toMatch(/\.factor-table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*100%;[^}]*table-layout:\s*auto;/s);
    expect(factorsCss).toMatch(/\.factor-table--phase1\s*\{[^}]*min-width:\s*1420px;/s);
    expect(factorsCss).toMatch(/\.factor-table--phase1 th:nth-child\(1\),\s*\.factor-table--phase1 td:nth-child\(1\)\s*\{[^}]*min-width:\s*310px;[^}]*max-width:\s*none;/s);
    expect(factorsCss).toMatch(/\.factor-table--phase1 th:nth-child\(4\),\s*\.factor-table--phase1 td:nth-child\(4\)\s*\{[^}]*min-width:\s*430px;[^}]*width:\s*430px;/s);
    expect(factorsCss).toMatch(/\.factor-table--phase1 th:nth-child\(5\),\s*\.factor-table--phase1 td:nth-child\(5\)\s*\{[^}]*min-width:\s*138px;[^}]*white-space:\s*nowrap;/s);
    expect(factorsCss).toContain('.factor-table--phase1 th:nth-child(7)');
    expect(factorsCss).toContain('.factor-table--phase1 th:nth-child(8)');
    expect(factorsCss).toContain('.factor-table__level-header .factor-th-content');
    expect(factorsCss).toContain('.factor-created-at');
    expect(factorsCss).toContain('.factor-offline-reason');
    expect(factorsCss).toContain('.factor-row-actions--inline');
    expect(factorsCss).toMatch(/\.factor-diagnostic-cell\s*\{[^}]*grid-template-columns:\s*minmax\(300px,\s*1fr\)\s*112px;[^}]*min-width:\s*420px;/s);
    expect(factorsCss).toMatch(/\.factor-diagnostic-state\s*\{[^}]*position:\s*relative;/s);
    expect(factorsCss).toMatch(/\.factor-diagnostic-popover\s*\{[^}]*z-index:\s*80;/s);
    expect(factorsCss).toMatch(/\.factor-diagnostic-popover\s*\{[^}]*top:\s*calc\(100%\s*\+\s*8px\);[^}]*left:\s*0;[^}]*right:\s*auto;/s);
    expect(factorsCss).toMatch(/\.factor-table tbody tr:nth-last-child\(-n\s*\+\s*2\):not\(:first-child\) \.factor-diagnostic-popover\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*calc\(100%\s*\+\s*8px\);/s);
    expect(factorsCss).toMatch(/\.factor-table tbody tr:has\(\.factor-diagnostic-popover\),[\s\S]*\.factor-table tbody tr:has\(\.factor-gap-popover\)\s*\{[\s\S]*z-index:\s*60;/s);
    expect(factorsCss).toMatch(/\.factor-row-actions\s*\{[^}]*display:\s*grid;/s);
    expect(factorsCss).toMatch(/\.factor-table--phase1 \.factor-row-actions\s*\{[^}]*display:\s*inline-flex;[^}]*white-space:\s*nowrap;/s);
    expect(factorsCss).toMatch(/\.factor-table td\s*\{[^}]*vertical-align:\s*middle;/s);
    expect(factorsCss).not.toContain('.factor-gate-reason');
    expect(factorsCss).toMatch(/\.factor-table tbody tr:last-child \.factor-gap-popover\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*30px;/s);
  });
});
