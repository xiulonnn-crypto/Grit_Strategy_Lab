import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAppHash } from './lib/appRouteContext';
import { ApiClientProvider } from './lib/demoStoreContext';
import FactorFactoryPage from './pages/factor-factory-page';
import type { ApiFactorFactoryOverview, ApiFactorQuarantineCandidate } from './types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function operatorConfigPayload() {
  return {
    profile_id: 'default',
    draft: {
      enabled_operators: ['TS_Return', 'TS_Rank', 'TS_Corr'],
      window_space: [3, 5, 10, 21, 63, 126, 252],
      default_depth: 2,
      daily_formula_budget: 10000,
      compute_backend: 'pandas_bottleneck',
      min_periods_policy: 'TS 默认 min_periods=n；TS_Return 需要 n+1 个有效观测；不足输出 NaN。',
      blocked_field_policy: '排除 DATA_SOURCE_BLOCKED 字段；缺失 L1 保持 NaN。',
      governance_protocol: {
        winsorize_enabled: true,
        neutralize_enabled: true,
        zscore_enabled: true,
        smoothing_enabled: true,
        orthogonalization_enabled: false,
        turnover_filter_enabled: false,
      },
      notes: 'Phase 0 默认草稿',
      f1_catalog_snapshot_id: 'f1_catalog_snapshot_20260519_001',
      created_by: 'ui',
    },
    registry_items: [
      {
        operator_id: 'TS_Return',
        operator_group: 'TS',
        enabled: true,
        definition: 'x_t / x_{t-n} - 1',
        economic_meaning: '度量 n 日收益率。',
        input_types: ['series'],
        output_dimension: 'time_series',
        default_params: { n: 21 },
        allowed_window_space: [3, 5, 10, 21, 63, 126, 252],
        min_periods_rule: 'n+1',
      },
      {
        operator_id: 'TS_Rank',
        operator_group: 'TS',
        enabled: true,
        definition: 'rank(x_t, window=n)',
        economic_meaning: '度量局部相对强弱。',
        input_types: ['series'],
        output_dimension: 'time_series',
        default_params: { n: 21 },
        allowed_window_space: [3, 5, 10, 21, 63, 126, 252],
        min_periods_rule: 'n',
      },
      {
        operator_id: 'TS_Corr',
        operator_group: 'MULTI',
        enabled: true,
        definition: 'corr(x, y, n)',
        economic_meaning: '度量两个序列的滚动相关。',
        input_types: ['series', 'series'],
        output_dimension: 'time_series',
        default_params: { n: 21 },
        allowed_window_space: [3, 5, 10, 21, 63, 126, 252],
        min_periods_rule: 'n',
      },
      {
        operator_id: 'CS_ZScore',
        operator_group: 'CS',
        enabled: false,
        definition: '(x - mean) / std',
        economic_meaning: '截面标准化。',
        input_types: ['cross_section'],
        output_dimension: 'cross_section',
        default_params: {},
        allowed_window_space: [],
        min_periods_rule: 'valid_cross_section',
      },
    ],
    latest_f1_catalog_snapshot: {
      id: 'f1_catalog_snapshot_20260519_001',
      snapshot_id: 'f1_catalog_snapshot_20260519_001',
      run_id: 'pit_pre_20260519_001',
      as_of_date: '2026-05-19',
      generated_at: '2026-05-19T08:00:00Z',
      field_count: 25,
      callable_count: 18,
      blocked_count: 3,
      timing_gap_count: 1,
      summary: { ic_ir_gate: 'NOT_APPLIED' },
    },
    latest_operator_config_snapshot: {
      id: 'op_config_snapshot_20260519_001',
      snapshot_id: 'op_config_snapshot_20260519_001',
      generated_at: '2026-05-19T08:10:00Z',
      status: 'ACTIVE',
      operator_count: 25,
      enabled_operators: ['TS_Return', 'TS_Rank', 'TS_Corr'],
      window_space: [3, 5, 10, 21, 63, 126, 252],
      default_depth: 2,
      daily_formula_budget: 10000,
      compute_backend: 'pandas_bottleneck',
      min_periods_policy: 'TS 默认 min_periods=n；TS_Return 需要 n+1 个有效观测；不足输出 NaN。',
      blocked_field_policy: '排除 DATA_SOURCE_BLOCKED 字段；缺失 L1 保持 NaN。',
      governance_protocol: {
        winsorize_enabled: true,
        neutralize_enabled: true,
        zscore_enabled: true,
        smoothing_enabled: true,
        orthogonalization_enabled: false,
        turnover_filter_enabled: false,
      },
      notes: '已冻结',
      f1_catalog_snapshot_id: 'f1_catalog_snapshot_20260519_001',
      created_by: 'ui',
      items: [],
    },
  };
}

function factoryOverview(overrides: Partial<ApiFactorFactoryOverview> = {}): ApiFactorFactoryOverview {
  const request = {
    universe: 'SP500',
    start_date: '2020-01-01',
    end_date: '2025-12-31',
    operators: ['return', 'winsorize', 'neutralize', 'zscore', 'rank'],
    candidate_count: 1000,
    random_seed: 42,
    min_rank_ic: 0.03,
    max_depth: 4,
    generation_mode: 'HYBRID_COMPOSITION',
    source_factor_ids: ['s_mom_6m_rank', 's_qlty_roe_ltm_raw'],
    recipe_families: ['style_blend', 'risk_adjusted', 'value_anchor', 'divergence', 'residual_neutralized', 'ts_denoise'],
    exploration_budget: 24,
    composition_policy: { mode: 'template_plus_exploration', publish_boundary: 'manual_after_quarantine' },
  };
  const gatePolicy = {
    pit_gate_mode: 'DIAGNOSTIC_ONLY' as const,
    max_style_correlation: 0.3,
    residual_enabled: true,
    max_drawdown_relative_to_benchmark: 1.5,
    min_oos_to_is_ratio: 0.6,
  };
  const operatorChain = [
    { code: 'RAW', label: 'Raw' },
    { code: 'MAD', label: 'Winsorize' },
    { code: 'N', label: 'Neutralize' },
    { code: 'Z', label: 'Z-Score' },
    { code: 'R', label: 'Rank' },
  ];
  const admissionReport = [
    { check: 'OOS 衰减', value_label: '12%', status: 'PASS', agent_d_advice: '样本内外一致性极高，可进入发布准入。' },
    { check: '正交性', value_label: '0.22', status: 'PASS', agent_d_advice: '与现有动量簇相关性低，增量信息有效。' },
    { check: '极端压力', value_label: '-18.5%', status: 'WARN', agent_d_advice: '2022 年表现一般，发布时需限制初始仓位。' },
    { check: '换手率', value_label: '45%', status: 'FAIL', agent_d_advice: '拒绝上线：调仓过频，摩擦成本过大。' },
    { check: 'PIT 完整性', value_label: '99.4%', status: 'PASS', agent_d_advice: '收盘后可按时完成计算，未发现未来数据依赖。' },
  ];
  const quarantineCandidate: ApiFactorQuarantineCandidate = {
    id: 'fq_factory_001',
    mining_candidate_id: 'cand_factory_001',
    source_mining_job_id: 'fm_factory_001',
    expression: 's_mom_6m_rank * s_qlty_roe_ltm_raw',
    status: 'PASSED' as const,
    publish_status: 'ELIGIBLE',
    target_layer: 'L3',
    gate_summary: { pit_gate_mode: 'DIAGNOSTIC_ONLY' },
    cluster_id: 'cluster_factory_mom',
    candidate_metrics: {
      rank_ic: 0.061,
      ir: 1.62,
      coverage: 99.4,
      source_factor_ids: ['s_mom_6m_rank', 's_qlty_roe_ltm_raw'],
      score: 0.91,
    },
    failure_samples: [],
    pit_evidence: { status: 'LIMITED_READY', gate_mode: 'DIAGNOSTIC_ONLY' },
    publish_eligibility: { status: 'ELIGIBLE', reason: '准入通过，可进入发布名单。' },
    target_factor_id: null,
    created_at: '2026-05-18T08:03:00Z',
    updated_at: '2026-05-18T08:05:00Z',
    published_at: null,
    rejected_reason: null,
    operator_chain: [],
    composition_methods: [
      { key: 'style_blend', label: '风格复合' },
      { key: 'risk_adjusted', label: '风险调节' },
      { key: 'value_anchor', label: '估值锚定' },
      { key: 'divergence', label: '背离惩罚' },
      { key: 'residual_neutralized', label: '残差/中性化' },
      { key: 'ts_denoise', label: '时序降噪' },
    ],
    investment_logic: '质量驱动动量组合。',
    quarantine_result: 'PASS',
    reason_summary: '准入通过，可进入发布名单。',
    admission_report: admissionReport,
    scoring_detail: {
      candidate_id: 'fq_factory_001',
      display_id: 's_mom_6m_rank * s_qlty_roe_ltm_raw',
      target_layer: 'L3',
      submitted_at: '2026-05-18T08:03:00Z',
      score: 0.91,
      status: 'PASS',
      gate_basis: '预测阈值准入',
      predictive_power: { rank_ic: 0.061, rank_icir: 1.62, monotonicity_score: 0.81 },
      stability_turnover: { autocorrelation: 0.72, ic_decay_t1: 0.056, ic_decay_t5: 0.041, ic_decay_t21: 0.029, turnover_rate_weekly: 18 },
      risk_orthogonality: { style_corr: 0.22, specific_ic: 0.05, incremental_ir: 0.08, max_drawdown: 12 },
      data_health: { coverage: 99.4, missing_data_ratio: 0.006, pit_timestamp_status: 'PASS' },
      collapsed_by_default: true,
      detail_modal_enabled: true,
      quarantine_candidate_id: 'fq_factory_001',
    },
    latest_run: {
      summary: { admission_report: admissionReport },
      created_at: '2026-05-18T08:05:00Z',
      completed_at: '2026-05-18T08:05:00Z',
    },
  };
  const miningJob = {
    id: 'fm_factory_001',
    status: 'COMPLETED' as const,
    request,
    progress: { total_candidates: 1000, evaluated_candidates: 1000, failed_candidates: 0, throughput_per_second: 2, percent: 100 },
    top_candidates: [{
      id: 'cand_factory_001',
      expression: 's_mom_6m_rank * s_qlty_roe_ltm_raw',
      score: 0.91,
      rank_ic: 0.061,
      turnover: 0.18,
      coverage: 0.994,
      depth: 3,
      risk_flags: [],
    }],
    failed_samples: [],
    created_at: '2026-05-18T08:00:00Z',
    updated_at: '2026-05-18T08:02:00Z',
    completed_at: '2026-05-18T08:02:00Z',
  };
  const run = {
    id: 'ffr_factory_001',
    profile_id: 'default',
    run_date: '2026-05-18',
    trigger: 'DAILY',
    status: 'COMPLETED' as const,
    request,
    gate_policy: gatePolicy,
    config_signature: 'factory-test',
    mining_job_id: 'fm_factory_001',
    mining_job: miningJob,
    summary: { top_candidate_count: 1, pit_gate_mode: 'DIAGNOSTIC_ONLY' },
    started_at: '2026-05-18T08:00:00Z',
    completed_at: '2026-05-18T08:05:00Z',
    created_at: '2026-05-18T08:00:00Z',
    updated_at: '2026-05-18T08:05:00Z',
  };
  const overview: ApiFactorFactoryOverview = {
    profile: {
      id: 'default',
      status: 'PAUSED' as const,
      timezone: 'Asia/Hong_Kong',
      schedule_time: '14:00',
      request,
      gate_policy: gatePolicy,
      next_run_at: '2026-05-18T14:00:00+08:00',
    },
    active_run: null,
    latest_run: run,
    runs: [run],
    funnel: { mined_candidates: 1, quarantine_candidates: 1, passed: 1, review_or_observation: 0, rejected: 0, published: 0 },
    mining: { items: [miningJob], summary: { total: 1 } },
    quarantine: { items: [quarantineCandidate], summary: { total: 1, page: 1, page_size: 50, total_pages: 1, passed_count: 1, rejected_count: 0 } },
    gate_policy: gatePolicy,
    task_summary: {
      total_tasks: 2,
      delivered_candidates: 3,
      submitted_to_quarantine: 1,
      publishable_count: 1,
      rejected_history_count: 0,
      hard_blocked_count: 0,
    },
    task_rows: [
      { id: '2026-05-18-mining', task_date: '2026-05-18', kind: 'mining', title: '2026-05-18 因子挖掘任务', summary: 'F1-算子展开-Raw_F2-WNZT-Refined_F2', status: '已完成', target_layer: 'L2', flow: ['F1', '算子展开', 'Raw_F2', 'WNZT', 'Refined_F2'], delivered_candidate_count: 1, current_candidate_count: 1, metric_label: 'Raw_F2因子交付量', metric_value: 1, secondary_metric_label: 'Refined_F2因子交付量', secondary_metric_value: 1 },
      { id: '2026-05-18-composition', task_date: '2026-05-18', kind: 'composition', title: '2026-05-18 因子组合任务', summary: '从 Refined_F2 构建 F3 组合候选，发布前仍需检疫通过和人工确认。', status: '已完成', target_layer: 'L3', flow: ['Refined_F2', 'F3组合', '检疫', '发布确认'], parent_factor_ids: ['s_mom_6m_rank', 's_qlty_roe_ltm_raw'], delivered_candidate_count: 1, current_candidate_count: 1, metric_label: '组合候选量', metric_value: 1 },
    ],
    monitor_summary: {
      formula_count: 1470,
      selected_date_formula_count: 1470,
      initial_screen_pass_count: 1,
      quarantine_pass_count: 1,
      s_grade_promotion_count: 1,
      alpha_concentration: 0.22,
      failure_candidate_count: 0,
      failure_reason_distribution: {},
    },
    scoring_candidates: [quarantineCandidate.scoring_detail!],
    quarantine_result_rows: [{
      candidate_id: 'fq_factory_001',
      submitted_at: '2026-05-18T08:03:00Z',
      factor_name: 's_mom_6m_rank * s_qlty_roe_ltm_raw',
      target_layer: 'L3',
      quarantine_result: 'PASS',
      reason_summary: '准入通过，可进入发布名单。',
      detail_modal_enabled: true,
    }],
    publishable_factors: [{
      candidate_id: 'fq_factory_001',
      factor_id: 'fq_factory_001',
      factor_name: 's_mom_6m_rank * s_qlty_roe_ltm_raw',
      target_layer: 'L3',
      score: 0.91,
      quarantine_status: 'PASS',
      parent_factor_ids: ['s_mom_6m_rank', 's_qlty_roe_ltm_raw'],
      expression: quarantineCandidate.expression,
      raw_expression: quarantineCandidate.raw_expression,
      refined_expression: quarantineCandidate.refined_expression,
      candidate_metrics: quarantineCandidate.candidate_metrics,
      latest_run: quarantineCandidate.latest_run,
      scoring_detail: quarantineCandidate.scoring_detail,
      admission_report: quarantineCandidate.admission_report,
      wnzt_missing: quarantineCandidate.wnzt_missing,
      wnzt_complete: quarantineCandidate.wnzt_complete,
      wnzt_evidence: quarantineCandidate.wnzt_evidence,
      gate_summary: quarantineCandidate.gate_summary,
      pit_evidence: quarantineCandidate.pit_evidence,
      publish_eligibility: quarantineCandidate.publish_eligibility,
      composition_methods: quarantineCandidate.composition_methods,
      investment_logic: '质量驱动动量组合。',
      detail_modal_enabled: true,
    }],
    operator_config: operatorConfigPayload(),
  };
  return { ...overview, ...overrides };
}

function renderFactory(): void {
  render(
    <ApiClientProvider>
      <FactorFactoryPage />
    </ApiClientProvider>,
  );
}

describe('FactorFactoryPage', () => {
  it('keeps legacy route mapping while rendering the B1-B4 factory workbench', async () => {
    expect(parseAppHash('#/factors/factory')).toEqual({ kind: 'factor-factory', section: 'overview' });
    expect(parseAppHash('#/factors/sandbox')).toEqual({ kind: 'factor-factory', section: 'sandbox' });
    expect(parseAppHash('#/factors/quarantine')).toEqual({ kind: 'factor-factory', section: 'quarantine' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(factoryOverview()));

    renderFactory();

    expect(await screen.findByRole('heading', { level: 1, name: '因子任务生产台' })).toBeInTheDocument();
    expect(screen.getByText('每日计划：GMT+8 14:00')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '可上线发布' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一键发布' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '因子任务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '治理候选' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '因子检疫' })).toBeInTheDocument();
    expect(document.querySelector('.factor-factory-b1b4-page')).toBeInTheDocument();
    expect(document.querySelectorAll('.factor-factory-fixed-panel')).toHaveLength(3);
    expect(screen.getByLabelText('因子任务类型')).toBeInTheDocument();
    expect(screen.queryByText('因子改造类')).not.toBeInTheDocument();
  });

  it('shows submitted public factor imports as B3 quarantine results instead of a manual intake queue', async () => {
    const overview = factoryOverview();
    const externalDisplayName = '[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]';
    const externalNameAudit = {
      structured_components: {
        style_family: '[外部]',
        style_family_reason: '来自学术公开因子库，作为外部 Beta 与风格暴露参照，不与自研 Alpha 混同。',
        core_semantic: 'Fama-French 美股研究日频因子',
        frequency_label: 'Daily',
        governance_tag: 'Refined',
        governance_reason: 'W/N/Z/T 算子灯已全部完成，作为 Refined_F2 展示。',
        benchmark_label: '学术 Beta / 风格暴露',
      },
      expert_review: {
        summary: '高 IC、低 IR、高换手的外部学术风格因子，更适合作为剥离工具或平滑后的参考信号，不建议直接作为 F3 权重项。',
        metric_diagnostics: [
          { metric: 'RankIC', value: 0.139, diagnosis: '预测能力较强；进入组合前仍需稳定性复核。' },
          { metric: 'RankICIR', value: 0.498, diagnosis: '稳定性不足，需通过平滑或更长窗口观察。' },
        ],
        architect_recommendations: ['作为中性化或归因剥离基准。', '尝试 TS_Mean(..., 5) 等时序平滑。'],
      },
    };
    const externalCandidate = {
      ...overview.quarantine.items[0]!,
      id: 'fq_ext_ready_001',
      mining_candidate_id: 'extcand_ready_001',
      source_mining_job_id: 'extimp_ready_001',
      expression: 'ExternalFactor(fama_french_us_research_factors_daily)',
      status: 'PASSED' as const,
      publish_status: 'ELIGIBLE',
      display_name_cn: externalDisplayName,
      factor_name: externalDisplayName,
      base_display_name_cn: externalDisplayName,
      name_audit: externalNameAudit,
      quarantine_result: 'PASS',
      reason_summary: '外部公开因子源文件已物化并完成 B3 源数据检疫；已进入可上线发布候选，正式发布仍需通过发布准入与历史重复过滤。',
      candidate_metrics: {
        pipeline_version: 'external_factor_import_v1',
        external_import_job_id: 'extimp_ready_001',
        external_import_display_name: externalDisplayName,
        manifest: { row_count: 18 },
        external_diagnostics: { factor_count: 6, date_count: 3 },
      },
      publish_eligibility: {
        status: 'ELIGIBLE',
        reason: '外部公开因子源文件已物化并完成 B3 源数据检疫；已进入可上线发布候选，正式发布仍需通过发布准入与历史重复过滤。',
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(factoryOverview({
      quarantine: {
        ...overview.quarantine,
        items: [externalCandidate, ...overview.quarantine.items],
        summary: { ...overview.quarantine.summary, total: 2, rejected_count: 1 },
      },
      external_import_review_queue: {
        items: [],
        summary: {
          total: 0,
          items_returned: 0,
          review_boundary: 'DIRECT_B3_QUARANTINE',
          queue_state: 'MATERIALIZED_TO_B3',
          direct_publish_allowed: false,
        },
      },
      external_import_quarantine: {
        items: [externalCandidate],
        summary: { total: 1, page: 1, page_size: 12, total_pages: 1, passed_count: 1 },
      },
      publishable_factors: [{
        candidate_id: 'fq_ext_ready_001',
        factor_id: 's_f2_mom_raw_cur_external_fama_french_us_research_factors_daily',
        factor_name: externalDisplayName,
        display_name_cn: externalDisplayName,
        base_display_name_cn: externalDisplayName,
        name_audit: externalNameAudit,
        target_layer: 'L2',
        score: 77.48,
        quarantine_status: 'PASS',
        quarantine_result: 'PASS',
        parent_factor_ids: ['external:fama_french_us_research_factors_daily'],
        expression: externalCandidate.expression,
        candidate_metrics: externalCandidate.candidate_metrics,
        gate_summary: externalCandidate.gate_summary,
        pit_evidence: externalCandidate.pit_evidence,
        publish_eligibility: externalCandidate.publish_eligibility,
        detail_modal_enabled: true,
      }],
      quarantine_result_rows: [{
        candidate_id: 'fq_ext_ready_001',
        submitted_at: '2026-05-26T05:26:37Z',
        factor_name: externalDisplayName,
        display_name_cn: externalDisplayName,
        base_display_name_cn: externalDisplayName,
        name_audit: externalNameAudit,
        target_layer: 'L2',
        quarantine_result: 'PASS',
        reason_summary: '外部公开因子源文件已物化并完成 B3 源数据检疫；已进入可上线发布候选，正式发布仍需通过发布准入与历史重复过滤。',
        detail_modal_enabled: true,
      }, ...(overview.quarantine_result_rows ?? [])],
    })));

    renderFactory();

    await screen.findByRole('heading', { name: '因子检疫' });
    expect(screen.queryByLabelText('外部因子复核队列')).not.toBeInTheDocument();
    expect(screen.getAllByText(externalDisplayName).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('外部公开因子源文件已物化并完成 B3 源数据检疫；已进入可上线发布候选，正式发布仍需通过发布准入与历史重复过滤。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '可上线发布' })).toBeInTheDocument();
    expect(screen.getAllByText('PASS').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]!);
    expect(await screen.findByRole('heading', { name: '专家复核建议' })).toBeInTheDocument();
    expect(screen.getByText('Fama-French 美股研究日频因子')).toBeInTheDocument();
    expect(screen.getByText('尝试 TS_Mean(..., 5) 等时序平滑。')).toBeInTheDocument();
  });

  it('renders quarantine reason fallbacks instead of unreadable placeholders', async () => {
    const overview = factoryOverview();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      quarantine_result_rows: [{
        ...overview.quarantine_result_rows![0],
        quarantine_result: 'PASS',
        reason_summary: '????????????????',
      }, {
        ...overview.quarantine_result_rows![0],
        candidate_id: 'fq_factory_fail_placeholder',
        quarantine_result: 'FAIL',
        reason_summary: 'D2 检疫通过；PIT Full Ready 缺口仅作为诊断证据。',
      }],
    }));

    renderFactory();

    expect(await screen.findByText('D2 检疫通过，已进入可上线发布队列。')).toBeInTheDocument();
    expect(screen.getByText('未通过检疫硬闸门，需在详情中复核 OOS、P-value、拥挤度、回撤或容量。')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('????????');
  });

  it('opens Phase 0 operator config modal, saves draft, snapshots config, and confirms dirty close', async () => {
    const config = operatorConfigPayload();
    const overview = factoryOverview({ operator_config: config });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (url.pathname === '/factor-factory/operator-config/snapshots') {
        return jsonResponse({
          ...config.latest_operator_config_snapshot,
          snapshot_id: 'op_config_snapshot_20260519_saved',
          id: 'op_config_snapshot_20260519_saved',
        });
      }
      if (url.pathname === '/factor-factory/operator-config' && method === 'PUT') {
        return jsonResponse({ ...config, draft: JSON.parse(String(init?.body ?? '{}')), saved: true });
      }
      if (url.pathname === '/factor-factory/operator-config') {
        return jsonResponse(config);
      }
      return jsonResponse(overview);
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderFactory();

    fireEvent.click(await screen.findByRole('button', { name: '工厂配置' }));
    const dialog = await screen.findByRole('dialog', { name: '因子工厂配置' });
    expect(within(dialog).getByText('算子预算、组合方法、治理协议、准入闸门和快照版本在此统一维护。')).toBeInTheDocument();
    const tablist = within(dialog).getByRole('navigation', { name: '工厂配置标签' });
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '算子注册',
      '组合方法',
      '治理协议',
      '准入闸门',
      'WNZT 证据与检疫裁决',
      '配置快照',
    ]);
    expect(within(tablist).getByRole('tab', { name: '算子注册' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: '组合方法' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: '治理协议' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: '准入闸门' })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: '算子注册' })).toHaveAttribute('aria-selected', 'true');
    expect(within(tablist).getByRole('tab', { name: 'WNZT 证据与检疫裁决' })).toHaveAttribute('aria-selected', 'false');
    expect(within(tablist).getByRole('tab', { name: '配置快照' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: '算子注册表' })).toBeInTheDocument();
    expect(within(dialog).getByText('25 个核心算子，默认启用 3 个。RankIC/IR/OOS 不参与 F1 准入，仅在 F2/F3 诊断中使用。')).toBeInTheDocument();
    expect(within(dialog).getByText('核心算子库')).toBeInTheDocument();
    expect(within(dialog).getByText('定义、含义、输入、输出、窗口与 min_periods')).toBeInTheDocument();
    expect(within(dialog).getAllByText('TS 时间序列类').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('CS / 多元 / 非线性 / 技术类').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText('TS_Return')).toBeInTheDocument();
    expect(within(dialog).getByText('x_t / x_{t-n} - 1')).toBeInTheDocument();
    expect(within(dialog).getByText('TS_Rank')).toBeInTheDocument();
    expect(within(dialog).getByText('TS_Corr')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '停用 TS_Return' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: '停用 TS_Rank' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: '停用 TS_Corr' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: '启用 TS_Mean' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog).getByText('引用快照')).toBeInTheDocument();
    expect(within(dialog).getByText('准入规则')).toBeInTheDocument();
    expect(within(dialog).getByText('运行预算')).toBeInTheDocument();
    expect(within(dialog).getByText('表达式上限')).toBeInTheDocument();
    expect(within(dialog).queryByText('发布边界')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('阻断规则')).not.toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: '组合方法' }));
    expect(within(dialog).getByRole('heading', { name: '组合方法库' })).toBeInTheDocument();
    expect(within(dialog).getByText('配置 Refined F2 生成 F3 组合候选的方法、公式和执行边界。启用项会写入配置快照，并在下一次工厂运行中生效。')).toBeInTheDocument();
    expect(dialog.querySelectorAll('.composition-method-row')).toHaveLength(7);
    expect(within(dialog).getAllByText('LINEAR_WEIGHTING').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('RATIO_RISK_ADJUSTED').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('TIME_SERIES_DENOISE').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('F3 = Σ(w_i * ZScore(F2_i))').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getAllByText('D2 检疫').length).toBeGreaterThanOrEqual(7);
    expect(within(dialog).getByText('包含 composition_methods')).toBeInTheDocument();
    expect(within(dialog).getByText('所有组合候选先进入 D2 检疫，不能直接写入正式因子库。')).toBeInTheDocument();
    const divergenceToggle = within(dialog).getByRole('button', { name: '启用 背离惩罚' });
    fireEvent.click(divergenceToggle);
    expect(within(dialog).getByRole('button', { name: '关闭 背离惩罚' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getAllByText('草稿已变更').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(within(tablist).getByRole('tab', { name: '算子注册' }));
    const groupSelect = within(dialog).getByLabelText('算子分组筛选') as HTMLSelectElement;
    const operatorSearch = within(dialog).getByLabelText('搜索算子或定义') as HTMLInputElement;
    expect(groupSelect.value).toBe('all');
    fireEvent.change(groupSelect, { target: { value: 'cross' } });
    expect(within(dialog).queryByText('TS_Mean')).not.toBeInTheDocument();
    expect(within(dialog).getByText('TS_Corr')).toBeInTheDocument();
    expect(within(dialog).getByText('CS_Rank / CS_ZScore / CS_Scale / CS_Neutral')).toBeInTheDocument();
    fireEvent.change(groupSelect, { target: { value: 'all' } });
    fireEvent.change(operatorSearch, { target: { value: 'TS_Return' } });
    expect(within(dialog).getByText('TS_Return')).toBeInTheDocument();
    expect(within(dialog).queryByText('TS_Rank')).not.toBeInTheDocument();
    fireEvent.change(operatorSearch, { target: { value: '' } });

    fireEvent.click(within(tablist).getByRole('tab', { name: 'WNZT 证据与检疫裁决' }));
    expect(within(dialog).getByText('W 去极值')).toBeInTheDocument();
    expect(within(dialog).getByText('N 中性化')).toBeInTheDocument();
    expect(within(dialog).getByText('Z 标准化')).toBeInTheDocument();
    expect(within(dialog).getAllByText('默认关闭')).toHaveLength(2);
    expect(within(dialog).getByText('引用快照')).toBeInTheDocument();
    expect(within(dialog).getByText('准入规则')).toBeInTheDocument();
    expect(within(dialog).getByText('运行预算')).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: '准入闸门' }));
    expect(within(dialog).getByText(/F1 原始库不设 IC 门槛/)).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole('tab', { name: '治理协议' }));
    expect(within(dialog).getByText('WNZT 标准流')).toBeInTheDocument();
    const optionalButtons = within(dialog).getAllByRole('button', { name: '默认关闭' });
    expect(optionalButtons).toHaveLength(2);
    optionalButtons.forEach((button) => expect(button).toHaveAttribute('aria-pressed', 'false'));

    fireEvent.click(within(tablist).getByRole('tab', { name: '算子注册' }));
    expect(within(dialog).getAllByText('启用').length).toBeGreaterThanOrEqual(3);
    expect(within(dialog).getByText('算子注册表')).toBeInTheDocument();
    expect(within(dialog).getAllByText('窗口空间').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(within(dialog).getByRole('button', { name: '启用 TS_Mean' }));
    expect(within(dialog).getAllByText('草稿已变更').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(confirmSpy).toHaveBeenCalledWith('配置草稿尚未保存，确认关闭弹层？');
    expect(screen.getByRole('dialog', { name: '因子工厂配置' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/factor-factory/operator-config'),
      expect.objectContaining({ method: 'PUT' }),
    ));
    const putCall = fetchSpy.mock.calls.find(([input, init]) => (
      String(input).includes('/factor-factory/operator-config') && String(init?.method ?? 'GET').toUpperCase() === 'PUT'
    ));
    const savedDraft = JSON.parse(String(putCall?.[1]?.body ?? '{}')) as { composition_methods?: Array<{ id: string; enabled: boolean }> };
    expect(savedDraft.composition_methods).toHaveLength(7);
    expect(savedDraft.composition_methods?.find((method) => method.id === 'divergence_penalty')?.enabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '生成配置快照' }));
    expect(await screen.findByText(/op_config_snapshot_20260519_saved/)).toBeInTheDocument();
    const snapshotCall = fetchSpy.mock.calls.find(([input, init]) => (
      String(input).includes('/factor-factory/operator-config/snapshots') && String(init?.method ?? 'GET').toUpperCase() === 'POST'
    ));
    const snapshotDraft = JSON.parse(String(snapshotCall?.[1]?.body ?? '{}')) as { composition_methods?: Array<{ id: string; enabled: boolean }> };
    expect(snapshotDraft.composition_methods).toHaveLength(7);
    expect(snapshotDraft.composition_methods?.find((method) => method.id === 'divergence_penalty')?.enabled).toBe(true);
  });

  it('keeps fixed factory panels scrollable instead of clipping their body content', () => {
    const css = readFileSync('src/pages/factor-phase2-pages.css', 'utf8');

    expect(css).toMatch(/\.factor-factory-fixed-panel\s*\{[^}]*display:\s*grid;[^}]*height:\s*var\(--workbench-panel-height,\s*760px\);[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s);
    expect(css).toMatch(/\.factor-factory-fixed-panel \.factor-phase2-panel__body,\s*\.factor-factory-scroll-body\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
    expect(css).toMatch(/\.factor-factory-result-row,\s*\.factor-factory-report-row\s*\{[^}]*grid-template-columns:\s*minmax\(72px,\s*0\.7fr\)[^}]*minmax\(64px,\s*0\.45fr\);[^}]*max-width:\s*100%;/s);
    expect(css).toMatch(/\.composition-method-row\s*\{[^}]*grid-template-columns:\s*34px minmax\(0,\s*0\.9fr\)[^}]*minmax\(0,\s*0\.68fr\);/s);
    expect(css).toMatch(/@media \(max-width:\s*980px\)[\s\S]*\.composition-method-row\s*\{[^}]*grid-template-columns:\s*32px minmax\(0,\s*1fr\);/s);
  });

  it('highlights duplicated structured factor names and exposes naming audit details', async () => {
    const overview = factoryOverview();
    const base = overview.quarantine.items[0]!;
    const makeDisplayName = (windowLabel: string) => `[估值] - 下行风险调节-现金流回报比 (${windowLabel}) [Refined-Rank]`;
    const makeCandidate = (id: string, windowLabel: string, score: number, rankIc: number, ir: number) => ({
      ...base,
      id,
      display_name_cn: makeDisplayName(windowLabel),
      factor_name: makeDisplayName(windowLabel),
      base_display_name_cn: makeDisplayName(windowLabel),
      name_collision_key: 'cashflow-risk-return',
      name_dedupe_suffix: '参数/治理链',
      name_collision_group: ['fq_collision_ltm', 'fq_collision_21d'],
      name_audit: {
        structured_components: {
          parameter_label: windowLabel,
          governance_level: 'Refined-Rank',
          governance_tag: 'Refined-Rank',
          benchmark_label: '对标 SP500',
        },
      },
      candidate_metrics: {
        ...base.candidate_metrics,
        rank_ic: rankIc,
        ir,
        score,
        source_factor_ids: ['s_val_cfp_ltm_raw', 's_vol_downside_252d_rank'],
      },
      scoring_detail: {
        ...(base.scoring_detail ?? {}),
        candidate_id: id,
        quarantine_candidate_id: id,
        display_name_cn: makeDisplayName(windowLabel),
        base_display_name_cn: makeDisplayName(windowLabel),
        name_collision_key: 'cashflow-risk-return',
        name_dedupe_suffix: '参数/治理链',
        name_collision_group: ['fq_collision_ltm', 'fq_collision_21d'],
        score,
        predictive_power: { rank_ic: rankIc, rank_icir: ir, monotonicity_score: 0.8 },
      },
    });
    const first = makeCandidate('fq_collision_ltm', 'LTM/252d', 0.83, 0.044, 1.72);
    const second = makeCandidate('fq_collision_21d', 'FY1/252d', 0.79, 0.039, 1.44);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      quarantine: { ...overview.quarantine, items: [first, second], summary: { total: 2, page: 1, page_size: 50, total_pages: 1 } },
      scoring_candidates: [first.scoring_detail, second.scoring_detail],
      quarantine_result_rows: [first, second].map((candidate) => ({
        candidate_id: candidate.id,
        submitted_at: candidate.created_at,
        factor_name: candidate.factor_name,
        display_name_cn: candidate.display_name_cn,
        base_display_name_cn: candidate.base_display_name_cn,
        name_collision_key: candidate.name_collision_key,
        name_dedupe_suffix: candidate.name_dedupe_suffix,
        name_collision_group: candidate.name_collision_group,
        name_audit: candidate.name_audit,
        target_layer: 'L3',
        quarantine_result: 'PASS',
        reason_summary: '准入通过，可进入发布名单。',
        detail_modal_enabled: true,
      })),
      publishable_factors: [first, second].map((candidate) => ({
        candidate_id: candidate.id,
        factor_id: candidate.id,
        factor_name: candidate.factor_name,
        display_name_cn: candidate.display_name_cn,
        base_display_name_cn: candidate.base_display_name_cn,
        name_collision_key: candidate.name_collision_key,
        name_dedupe_suffix: candidate.name_dedupe_suffix,
        name_collision_group: candidate.name_collision_group,
        name_audit: candidate.name_audit,
        target_layer: 'L3',
        score: Number(candidate.candidate_metrics.score),
        quarantine_status: 'PASS',
        parent_factor_ids: ['s_val_cfp_ltm_raw', 's_vol_downside_252d_rank'],
        composition_methods: candidate.composition_methods,
        detail_modal_enabled: true,
      })),
    }));

    renderFactory();

    await screen.findByRole('heading', { level: 1, name: '因子任务生产台' });
    expect(document.querySelectorAll('.factor-factory-publish-card.is-name-collision')).toHaveLength(2);
    expect(document.querySelectorAll('.factor-factory-result-row.is-name-collision')).toHaveLength(0);
    expect(document.querySelectorAll('.factor-factory-result-row .factor-name-diff-chips')).toHaveLength(0);
    expect(screen.getAllByText('LTM/252d').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('FY1/252d').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('RankIC 0.044').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]);
    const dialog = await screen.findByRole('dialog', { name: /现金流回报/ });
    expect(within(dialog).getByText('命名审计')).toBeInTheDocument();
    expect(within(dialog).getByText('基础名称')).toBeInTheDocument();
    expect(within(dialog).getByText('最终名称')).toBeInTheDocument();
    expect(within(dialog).getByText('去重')).toBeInTheDocument();
    expect(within(dialog).getByText('对标 SP500')).toBeInTheDocument();
    expect(within(dialog).getByText('s_val_cfp_ltm_raw / s_vol_downside_252d_rank')).toBeInTheDocument();
  });

  it('opens publishable factor detail when the candidate is outside the current quarantine page', async () => {
    const overview = factoryOverview();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      quarantine: { ...overview.quarantine, items: [], summary: { total: 1470, page: 1, page_size: 50, total_pages: 30 } },
      quarantine_result_rows: [],
      scoring_candidates: [],
    }));

    renderFactory();

    await screen.findByRole('heading', { name: '可上线发布' });
    const publishCard = document.querySelector('.factor-factory-publish-card') as HTMLElement;
    expect(publishCard).toBeInTheDocument();
    fireEvent.click(within(publishCard).getByRole('button', { name: '详情' }));
    const dialog = await screen.findByRole('dialog', { name: /s_mom_6m_rank/ });
    expect(dialog).toHaveTextContent('0.061');
    expect(dialog).toHaveTextContent('1.620');
    expect(dialog).toHaveTextContent('99.4%');
  });

  it('does not rebuild the publish queue from quarantine rows when the API returns an empty canonical list', async () => {
    const overview = factoryOverview({
      task_summary: {
        total_tasks: 2,
        delivered_candidates: 3,
        submitted_to_quarantine: 1,
        publishable_count: 0,
        rejected_history_count: 0,
        hard_blocked_count: 0,
      },
      monitor_summary: {
        ...factoryOverview().monitor_summary,
        s_grade_promotion_count: 1,
      },
      publishable_factors: [],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(overview));

    renderFactory();

    await waitFor(() => expect(document.querySelector('[data-page-root="factor-factory"]')).toBeInTheDocument());
    expect(document.querySelector('.factor-factory-publish-queue')).not.toBeInTheDocument();
    expect(document.querySelector('.factor-factory-publish-card')).not.toBeInTheDocument();
  });

  it('sorts scoring and quarantine rows by latest task time and defaults to the newest completed submission date', async () => {
    const overview = factoryOverview();
    const base = overview.quarantine.items[0]!;
    const older = {
      ...base,
      id: 'fq_older_completed',
      expression: 'Return(Close, 3)',
      created_at: '2026-05-07T09:00:00Z',
      updated_at: '2026-05-12T09:05:00Z',
      latest_run: { ...(base.latest_run ?? {}), created_at: '2026-05-12T09:05:00Z', completed_at: '2026-05-12T09:05:00Z' },
      scoring_detail: {
        ...(base.scoring_detail ?? {}),
        candidate_id: 'fq_older_completed',
        quarantine_candidate_id: 'fq_older_completed',
        display_id: 'Return(Close, 3)',
        submitted_at: '2026-05-07T09:00:00Z',
        score: 0.31,
      },
    };
    const newer = {
      ...base,
      id: 'fq_newer_completed',
      expression: 'Return(Close, 21)',
      created_at: '2026-05-07T09:00:00Z',
      updated_at: '2026-05-15T07:09:00Z',
      latest_run: { ...(base.latest_run ?? {}), created_at: '2026-05-15T07:09:00Z', completed_at: '2026-05-15T07:09:00Z' },
      scoring_detail: {
        ...(base.scoring_detail ?? {}),
        candidate_id: 'fq_newer_completed',
        quarantine_candidate_id: 'fq_newer_completed',
        display_id: 'Return(Close, 21)',
        submitted_at: '2026-05-07T09:00:00Z',
        score: 0.86,
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      publishable_factors: [],
      quarantine: { ...overview.quarantine, items: [older, newer] },
      scoring_candidates: [older.scoring_detail, newer.scoring_detail],
      quarantine_result_rows: [
        {
          candidate_id: older.id,
          submitted_at: older.created_at,
          factor_name: older.expression,
          target_layer: 'L2',
          quarantine_result: 'FAIL',
          reason_summary: 'older',
          detail_modal_enabled: true,
        },
        {
          candidate_id: newer.id,
          submitted_at: newer.created_at,
          factor_name: newer.expression,
          target_layer: 'L2',
          quarantine_result: 'FAIL',
          reason_summary: 'newer',
          detail_modal_enabled: true,
        },
      ],
    }));

    renderFactory();

    await screen.findByRole('heading', { level: 1, name: '因子任务生产台' });
    await waitFor(() => expect((document.querySelector('.factor-factory-filter-row input[type="date"]') as HTMLInputElement)?.value).toBe('2026-05-15'));
    const scoreCards = Array.from(document.querySelectorAll('.factor-factory-score-card'));
    expect(scoreCards[0]).toHaveTextContent('Return(Close, 21)');
    expect(scoreCards[0]).toHaveTextContent('2026-05-15');
    let resultRows = Array.from(document.querySelectorAll('.factor-factory-result-row:not(.factor-factory-result-row--head)'));
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]).toHaveTextContent('Return(Close, 21)');
    expect(resultRows[0]).toHaveTextContent('2026-05-15');
    const dateInput = document.querySelector('.factor-factory-filter-row input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-05-12' } });
    resultRows = Array.from(document.querySelectorAll('.factor-factory-result-row:not(.factor-factory-result-row--head)'));
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]).toHaveTextContent('Return(Close, 3)');
    expect(resultRows[0]).toHaveTextContent('2026-05-12');
    fireEvent.change(dateInput, { target: { value: '' } });
    resultRows = Array.from(document.querySelectorAll('.factor-factory-result-row:not(.factor-factory-result-row--head)'));
    expect(resultRows).toHaveLength(2);
    expect(resultRows[0]).toHaveTextContent('Return(Close, 21)');
    expect(resultRows[1]).toHaveTextContent('Return(Close, 3)');
  });

  it('aligns task and metric counts to the active quarantine date and exposes metric tooltips', async () => {
    const overview = factoryOverview();
    const makeRow = (index: number, result: 'PASS' | 'FAIL', date = '2026-05-19', targetLayer = 'L2') => ({
      candidate_id: `fq_${date}_${index}`,
      submitted_at: `${date}T09:${String(index).padStart(2, '0')}:00Z`,
      factor_name: `Factory Candidate ${date} ${index}`,
      target_layer: targetLayer,
      quarantine_result: result,
      reason_summary: result === 'PASS' ? 'accepted' : 'blocked',
      detail_modal_enabled: true,
    });
    const currentRows = [
      ...Array.from({ length: 2 }, (_, index) => makeRow(index + 1, 'PASS', '2026-05-19', 'L3')),
      ...Array.from({ length: 2 }, (_, index) => makeRow(index + 3, 'PASS')),
      ...Array.from({ length: 5 }, (_, index) => makeRow(index + 5, 'FAIL')),
    ];
    const olderRows = Array.from({ length: 4 }, (_, index) => makeRow(index + 1, 'PASS', '2026-05-15'));
    const overviewPayload = {
      ...overview,
      latest_run: { ...overview.latest_run!, run_date: '2026-05-19' },
      task_rows: [
        { id: '2026-05-19-mining', task_date: '2026-05-19', kind: 'mining', title: '2026-05-19 mining', status: 'COMPLETED', target_layer: 'L2', current_candidate_count: 10, delivered_candidate_count: 10 },
        { id: '2026-05-19-refinement', task_date: '2026-05-19', kind: 'refinement', title: '2026-05-19 refinement', status: 'COMPLETED', target_layer: 'L2', current_candidate_count: 24, delivered_candidate_count: 24 },
        { id: '2026-05-19-quarantine', task_date: '2026-05-19', kind: 'quarantine', title: '2026-05-19 quarantine', status: 'COMPLETED', target_layer: 'L2', current_candidate_count: 26, delivered_candidate_count: 26 },
      ],
      monitor_summary: {
        formula_count: 1470,
        selected_date_formula_count: 1470,
        initial_screen_pass_count: 10,
        quarantine_pass_count: 4,
        s_grade_promotion_count: 0,
        alpha_concentration: 0.22,
        failure_candidate_count: 5,
        failure_reason_distribution: {
          a: 1,
          b: 1,
          c: 1,
          d: 1,
          e: 1,
          f: 1,
          g: 1,
        },
      },
      scoring_candidates: [],
      quarantine: { ...overview.quarantine, items: [], summary: { total: currentRows.length + olderRows.length } },
      quarantine_result_rows: [...currentRows, ...olderRows],
      publishable_factors: [],
    };
    const candidateFromRow = (row: ReturnType<typeof makeRow>): ApiFactorQuarantineCandidate => ({
      id: row.candidate_id,
      mining_candidate_id: row.candidate_id,
      expression: row.factor_name,
      factor_name: row.factor_name,
      target_layer: row.target_layer,
      status: row.quarantine_result === 'PASS' ? 'PASSED' : 'REJECTED',
      quarantine_result: row.quarantine_result,
      publish_status: row.quarantine_result === 'PASS' ? 'ELIGIBLE' : 'BLOCKED',
      gate_summary: {},
      candidate_metrics: { target_layer: row.target_layer },
      failure_samples: [],
      pit_evidence: {},
      publish_eligibility: {
        status: row.quarantine_result === 'PASS' ? 'ELIGIBLE' : 'BLOCKED',
        reason: row.reason_summary,
      },
      created_at: row.submitted_at,
      updated_at: row.submitted_at,
      last_quarantine_at: row.submitted_at,
      latest_run: {
        id: `${row.candidate_id}_run`,
        status: 'COMPLETED',
        created_at: row.submitted_at,
        completed_at: row.submitted_at,
        summary: {},
      },
      reason_summary: row.reason_summary,
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/factor-quarantine/candidates')) {
        const parsed = new URL(url, 'http://127.0.0.1');
        const date = parsed.searchParams.get('date') ?? '';
        const result = parsed.searchParams.get('result') ?? 'ALL';
        const page = Number(parsed.searchParams.get('page') ?? '1');
        const pageSize = Number(parsed.searchParams.get('page_size') ?? '50');
        const matchingRows = [...currentRows, ...olderRows]
          .filter((row) => !date || row.submitted_at.slice(0, 10) === date)
          .filter((row) => result === 'ALL' || row.quarantine_result === result);
        const start = Math.max(0, (page - 1) * pageSize);
        return jsonResponse({
          items: matchingRows.slice(start, start + pageSize).map(candidateFromRow),
          summary: {
            total: matchingRows.length,
            page,
            page_size: pageSize,
            total_pages: matchingRows.length ? Math.ceil(matchingRows.length / pageSize) : 1,
            passed_count: matchingRows.filter((row) => row.quarantine_result === 'PASS').length,
            published_count: 0,
            rejected_count: matchingRows.filter((row) => row.quarantine_result === 'FAIL').length,
            needs_review_count: 0,
          },
        });
      }
      return jsonResponse(overviewPayload);
    });

    renderFactory();

    await waitFor(() => expect((document.querySelector('.factor-factory-filter-row input[type="date"]') as HTMLInputElement)?.value).toBe('2026-05-19'));
    const metricValue = (key: string) => document.querySelector(`[data-metric-key="${key}"] .factor-phase2-metric__value`) as HTMLElement;
    expect(metricValue('yesterday_formula_count')).toHaveTextContent('1470');
    expect(metricValue('initial_screen_pass')).toHaveTextContent('10');
    expect(metricValue('quarantine_pass')).toHaveTextContent('4');
    expect(metricValue('failure_candidate')).toHaveTextContent('5');
    expect(metricValue('alpha_concentration')).toHaveTextContent('0.220');
    expect(document.querySelectorAll('.factor-factory-metric-tooltip')).toHaveLength(6);
    expect(document.querySelector('[data-metric-key="quarantine_pass"] .factor-factory-metric-tooltip')).toHaveAttribute(
      'title',
      expect.stringContaining('当前日期'),
    );

    const taskDelivered = (kind: string) => document.querySelector(`[data-task-kind="${kind}"] .factor-factory-task-meta strong`) as HTMLElement;
    expect(taskDelivered('mining')).toHaveTextContent('10');
    expect(taskDelivered('composition')).toHaveTextContent('2');
    expect(document.querySelector('[data-task-kind="refinement"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-task-kind="quarantine"]')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.factor-factory-result-row:not(.factor-factory-result-row--head)')).toHaveLength(9);

    const dateInput = document.querySelector('.factor-factory-filter-row input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-05-15' } });
    await waitFor(() => expect(metricValue('yesterday_formula_count')).toHaveTextContent('4'));
    expect(metricValue('initial_screen_pass')).toHaveTextContent('4');
    expect(metricValue('quarantine_pass')).toHaveTextContent('4');
    expect(metricValue('alpha_concentration')).toHaveTextContent('0.000');
    expect(metricValue('failure_candidate')).toHaveTextContent('0');
    expect(document.querySelector('[data-metric-key="failure_candidate"] .factor-phase2-metric__hint')).toHaveTextContent('2026-05-15');

    fireEvent.change(dateInput, { target: { value: '2026-05-14' } });
    await waitFor(() => expect(metricValue('yesterday_formula_count')).toHaveTextContent('0'));
    expect(metricValue('initial_screen_pass')).toHaveTextContent('0');
    expect(metricValue('quarantine_pass')).toHaveTextContent('0');
    expect(metricValue('alpha_concentration')).toHaveTextContent('0.000');
    expect(metricValue('failure_candidate')).toHaveTextContent('0');
  });

  it('keeps submitted factors in quarantine history instead of sending them back to scoring', async () => {
    const overview = factoryOverview();
    const base = overview.quarantine.items[0]!;
    const older = {
      ...base,
      id: 'fq_submitted_older',
      expression: 'Return(Close, 3)',
      latest_run: { ...(base.latest_run ?? {}), completed_at: '2026-05-12T09:05:00Z' },
      updated_at: '2026-05-12T09:05:00Z',
    };
    const newer = {
      ...base,
      id: 'fq_submitted_newer',
      expression: 'Return(Close, 21)',
      latest_run: { ...(base.latest_run ?? {}), completed_at: '2026-05-15T07:09:00Z' },
      updated_at: '2026-05-15T07:09:00Z',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      task_summary: { ...overview.task_summary, submitted_to_quarantine: 2 },
      quarantine: { ...overview.quarantine, items: [older, newer], summary: { total: 2 } },
      scoring_candidates: [],
      quarantine_result_rows: [
        {
          candidate_id: older.id,
          submitted_at: older.created_at,
          factor_name: older.expression,
          target_layer: 'L2',
          quarantine_result: 'FAIL',
          reason_summary: 'older',
          detail_modal_enabled: true,
        },
        {
          candidate_id: newer.id,
          submitted_at: newer.created_at,
          factor_name: newer.expression,
          target_layer: 'L2',
          quarantine_result: 'FAIL',
          reason_summary: 'newer',
          detail_modal_enabled: true,
        },
      ],
    }));

    renderFactory();

    await screen.findByText('暂无待送检候选；已送检因子已移至 B3 因子检疫列表。');
    expect(document.querySelector('.factor-factory-score-card')).not.toBeInTheDocument();
    await waitFor(() => expect((document.querySelector('.factor-factory-filter-row input[type="date"]') as HTMLInputElement)?.value).toBe('2026-05-15'));
    const dateInput = document.querySelector('.factor-factory-filter-row input[type="date"]') as HTMLInputElement;
    let resultRows = Array.from(document.querySelectorAll('.factor-factory-result-row:not(.factor-factory-result-row--head)'));
    expect(resultRows).toHaveLength(1);
    expect(resultRows[0]).toHaveTextContent('Return(Close, 21)');
    fireEvent.change(dateInput, { target: { value: '' } });
    resultRows = Array.from(document.querySelectorAll('.factor-factory-result-row:not(.factor-factory-result-row--head)'));
    expect(resultRows).toHaveLength(2);
    expect(resultRows[0]).toHaveTextContent('Return(Close, 21)');
    expect(resultRows[1]).toHaveTextContent('Return(Close, 3)');
  });

  it('renders task dates, fixed status vocabulary, collapsed scoring cards, and one-key send', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(factoryOverview()));

    renderFactory();

    expect(await screen.findByText('2026-05-18 因子挖掘任务')).toBeInTheDocument();
    expect(screen.getByText('2026-05-18 因子组合任务')).toBeInTheDocument();
    expect(screen.getAllByText('已完成').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('可推进')).not.toBeInTheDocument();
    expect(screen.getByText('F1-算子展开-Raw_F2-WNZT-Refined_F2')).toBeInTheDocument();
    expect(screen.getByText('F1 仅限 Close、Open、Volume、MarketCap、Sector 等未经算子的事实字段；出现 Return、MA、Std 等算子即进入 F2 Raw Signal，并保留 WNZT 缺失与同族冗余提示。')).toBeInTheDocument();
    expect(screen.getByText('因子挖掘任务')).toBeInTheDocument();
    expect(screen.getByText('因子组合任务')).toBeInTheDocument();
    expect(screen.queryByText('因子改造类')).not.toBeInTheDocument();
    expect(document.querySelector('[data-task-kind="quarantine"]')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bL[1-3]\b/);
    expect(document.querySelector('.factor-factory-score-card.is-collapsed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一键送检' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '送入检疫' })).not.toBeInTheDocument();
  });

  it('keeps L1 raw-source scoring on PIT admission instead of RankIC thresholds', async () => {
    const overview = factoryOverview();
    const baseCandidate = overview.quarantine.items[0]!;
    const l1Scoring = {
      ...(baseCandidate.scoring_detail ?? {}),
      candidate_id: 'score_l1_close',
      quarantine_candidate_id: 'fq_l1_close',
      display_id: 'Close',
      target_layer: 'L1',
      gate_basis: 'PIT 准入审计',
      predictive_power: { rank_ic: -0.019, rank_icir: -0.2, monotonicity_score: 0.1 },
      data_health: { coverage: 99.2, missing_data_ratio: 0.002, pit_timestamp_status: 'PASS' },
    };
    const l1Candidate = {
      ...baseCandidate,
      id: 'fq_l1_close',
      expression: 'Close',
      target_layer: 'L1',
      gate_basis: 'PIT 准入审计',
      scoring_detail: l1Scoring,
      publish_status: 'NEEDS_REVIEW',
      candidate_metrics: { ...baseCandidate.candidate_metrics, rank_ic: -0.019, coverage: 99.2 },
      admission_report: [
        { check: 'PIT 准入审计', value_label: 'PASS', status: 'PASS', agent_d_advice: '原始水源可用于上层因子构造。' },
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      quarantine: { ...overview.quarantine, items: [l1Candidate] },
      scoring_candidates: [l1Scoring],
      publishable_factors: [],
    }));

    renderFactory();

    await screen.findByRole('heading', { level: 1, name: '因子任务生产台' });
    const scoreCard = Array.from(document.querySelectorAll('.factor-factory-score-card'))
      .find((card) => card.textContent?.includes('Close')) as HTMLElement;
    expect(scoreCard).toHaveTextContent('F1');
    expect(scoreCard).not.toHaveTextContent('L1');
    expect(scoreCard).toHaveTextContent('PIT 准入审计');
    expect(scoreCard).not.toHaveTextContent('RankIC -0.019');
    fireEvent.click(within(scoreCard).getByRole('button', { name: '详情' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('F1');
    expect(dialog).not.toHaveTextContent('L1');
    expect(within(dialog).getByText('PIT 准入审计 · 通过')).toBeInTheDocument();
    expect(within(dialog).getByText('水源角色 · 不参与 RankIC 优选')).toBeInTheDocument();
    expect(within(dialog).queryByText('RankIC · > 0.025')).not.toBeInTheDocument();
  });

  it('renders quarantine filters, result list, detail modal, scoring detail, and Agent D admission report', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(factoryOverview()));

    renderFactory();

    expect(await screen.findByLabelText('历史检疫筛选')).toBeInTheDocument();
    expect(screen.getByLabelText('日期')).toBeInTheDocument();
    expect(screen.getByLabelText('因子名')).toBeInTheDocument();
    expect(screen.getByLabelText('裁决')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '因子检疫结果列表' });
    expect(within(table).getByText('日期')).toBeInTheDocument();
    expect(within(table).getByText('因子名')).toBeInTheDocument();
    expect(within(table).getByText('裁决')).toBeInTheDocument();
    expect(within(table).getByText('原因')).toBeInTheDocument();
    expect(within(table).getByText('操作')).toBeInTheDocument();

    fireEvent.click(within(table).getByRole('button', { name: '详情' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '因子打分明细' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Raw / Refined F2 证据' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '因子检疫明细' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '准入报告' })).toHaveTextContent('Agent D 建议');
    expect(screen.getByText('OOS 衰减')).toBeInTheDocument();
    expect(screen.getByText('换手率')).toBeInTheDocument();
    expect(screen.getByText('拒绝上线：调仓过频，摩擦成本过大。')).toBeInTheDocument();
  });

  it('shows real Raw_F2 and missing Refined_F2 evidence in the detail modal', async () => {
    const overview = factoryOverview();
    const base = overview.quarantine.items[0]!;
    const rawCandidate = {
      ...base,
      id: 'fq_raw_f2_missing_001',
      expression: 'TS_Rank(TS_Return(f1_analyst_expectation_raw, 5), 3)',
      raw_expression: 'TS_Rank(TS_Return(f1_analyst_expectation_raw, 5), 3)',
      refined_expression: null,
      target_layer: 'L2',
      status: 'REJECTED',
      publish_status: 'BLOCKED',
      quarantine_result: 'FAIL',
      reason_summary: 'Raw_F2 缺少 WNZT 完整治理证据，需重新生成 Refined_F2 后再进入发布名单。',
      candidate_metrics: {
        ...base.candidate_metrics,
        raw_f2: true,
        refined_f2: false,
        wnzt_complete: false,
        raw_expression: 'TS_Rank(TS_Return(f1_analyst_expectation_raw, 5), 3)',
        refined_expression: null,
        wnzt_missing: ['W 去极值缺失', 'N 行业/风险中性化缺失', 'Z 截面标准化缺失'],
      },
      wnzt_complete: false,
      wnzt_missing: ['W 去极值缺失', 'N 行业/风险中性化缺失', 'Z 截面标准化缺失'],
      scoring_detail: {
        ...(base.scoring_detail ?? {}),
        candidate_id: 'fq_raw_f2_missing_001',
        quarantine_candidate_id: 'fq_raw_f2_missing_001',
        display_id: 'TS_Rank(TS_Return(f1_analyst_expectation_raw, 5), 3)',
        target_layer: 'L2',
        status: 'FAIL',
        wnzt_missing: ['W 去极值缺失', 'N 行业/风险中性化缺失', 'Z 截面标准化缺失'],
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      quarantine: { ...overview.quarantine, items: [rawCandidate], summary: { total: 1, page: 1, page_size: 50, total_pages: 1, rejected_count: 1 } },
      scoring_candidates: [rawCandidate.scoring_detail],
      quarantine_result_rows: [{
        candidate_id: rawCandidate.id,
        submitted_at: rawCandidate.updated_at,
        factor_name: rawCandidate.expression,
        target_layer: 'L2',
        quarantine_result: 'FAIL',
        reason_summary: rawCandidate.reason_summary,
        detail_modal_enabled: true,
      }],
      publishable_factors: [],
    }));

    renderFactory();

    const table = await screen.findByRole('table', { name: '因子检疫结果列表' });
    fireEvent.click(within(table).getByRole('button', { name: '详情' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('TS_Rank(TS_Return(f1_analyst_expectation_raw, 5), 3)');
    expect(dialog).toHaveTextContent('Refined_F2 表达式');
    expect(dialog).toHaveTextContent('未生成');
    expect(dialog).toHaveTextContent('W 去极值缺失');
    expect(dialog).toHaveTextContent('N 行业/风险中性化缺失');
    expect(dialog).toHaveTextContent('Z 截面标准化缺失');
  });

  it('keeps mining task counts from backend production metrics when date filter scopes quarantine rows', async () => {
    const overview = factoryOverview();
    const baseRow = (overview.quarantine_result_rows ?? [])[0]!;
    const scopedRows = Array.from({ length: 28 }, (_, index) => ({
      ...baseRow,
      candidate_id: `fq_refined_scope_${index}`,
      submitted_at: `2026-05-20T08:${String(index).padStart(2, '0')}:00Z`,
      target_layer: 'L2',
      quarantine_result: 'FAIL' as const,
    }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      scoring_candidates: [],
      quarantine_result_rows: scopedRows,
      quarantine: {
        ...overview.quarantine,
        items: [],
        summary: { total: 28, page: 1, page_size: 50, total_pages: 1, rejected_count: 28 },
      },
      task_rows: (overview.task_rows ?? []).map((task) => (
        task.kind === 'mining'
          ? { ...task, metric_value: 24, current_candidate_count: 24, delivered_candidate_count: 24, secondary_metric_value: 24 }
          : { ...task, metric_value: 0, current_candidate_count: 0, delivered_candidate_count: 0 }
      )),
    }));

    renderFactory();

    await screen.findAllByText('2026-05-20');
    const miningCard = document.querySelector('[data-task-kind="mining"]');
    expect(miningCard).toBeInTheDocument();
    expect(miningCard).toHaveTextContent('Refined_F2');
    expect(miningCard).toHaveTextContent('24 当前批次');
    expect(miningCard).not.toHaveTextContent('28 当前批次');
    expect(document.querySelector('[data-task-kind="refinement"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-task-kind="quarantine"]')).not.toBeInTheDocument();
  });

  it('runs automation, manual run, one-key send, quarantine history search, and one-key publish through live endpoints', async () => {
    const overview = factoryOverview();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/factor-quarantine/intake') {
        return jsonResponse({ items: overview.quarantine.items, summary: { intake_count: 1 } });
      }
      if (url.pathname === '/factor-quarantine/candidates/fq_factory_001/run') {
        return jsonResponse(overview.quarantine.items[0]);
      }
      if (url.pathname === '/factor-quarantine/candidates') {
        return jsonResponse(overview.quarantine);
      }
      if (url.pathname === '/factor-quarantine/candidates/fq_factory_001/publish') {
        return jsonResponse({ candidate: { ...overview.quarantine.items[0], status: 'PUBLISHED' } });
      }
      return jsonResponse(overview);
    });

    renderFactory();

    fireEvent.click(await screen.findByRole('button', { name: '启动自动化' }));
    expect(await screen.findByText('每日自动化已启动；GMT+8 14:00 运行，并自动送检与执行检疫。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '立即运行' }));
    expect(await screen.findByText('已创建临时 B1-B4 批次；每日自动化状态保持不变。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '一键送检' }));
    expect(await screen.findByText('一键送检已完成：1 个候选进入检疫并执行准入检测。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-quarantine/candidates?'), expect.any(Object)));
    fireEvent.click(screen.getByRole('button', { name: '一键发布' }));
    expect(await screen.findByText('一键发布已完成：1 个因子写入 F2/F3 发布审计。')).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-factory/automation/start'), expect.objectContaining({ method: 'POST' }));
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-factory/run-now'), expect.objectContaining({ method: 'POST' }));
    fireEvent.click(screen.getByRole('button', { name: '线上 Raw_F2 精炼' }));
    expect(await screen.findByText('已创建线上 Raw_F2 一次性精炼任务：WNZT 完成后交付 Refined_F2 检疫。')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-factory/refine-online-raw-f2'), expect.objectContaining({ method: 'POST' }));
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-quarantine/intake'), expect.objectContaining({ method: 'POST' }));
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-quarantine/candidates/fq_factory_001/publish'), expect.objectContaining({ method: 'POST' }));

    const startCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/factor-factory/automation/start'));
    const runNowCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/factor-factory/run-now'));
    const refineCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/factor-factory/refine-online-raw-f2'));
    const startBody = JSON.parse(String((startCall?.[1] as RequestInit | undefined)?.body ?? '{}'));
    const runNowBody = JSON.parse(String((runNowCall?.[1] as RequestInit | undefined)?.body ?? '{}'));
    const refineBody = JSON.parse(String((refineCall?.[1] as RequestInit | undefined)?.body ?? '{}'));
    expect(startBody.operator_config_snapshot_id).toBe('op_config_snapshot_20260519_001');
    expect(startBody.f1_catalog_snapshot_id).toBe('f1_catalog_snapshot_20260519_001');
    expect(runNowBody.operator_config_snapshot_id).toBe('op_config_snapshot_20260519_001');
    expect(runNowBody.f1_catalog_snapshot_id).toBe('f1_catalog_snapshot_20260519_001');
    expect(refineBody.operator_config_snapshot_id).toBe('op_config_snapshot_20260519_001');
    expect(refineBody.f1_catalog_snapshot_id).toBe('f1_catalog_snapshot_20260519_001');
    expect(refineBody.candidate_limit).toBe(10000);
  });

  it('hides publishable queue when no candidate is publishable and does not render sample rows on API failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      ...factoryOverview(),
      publishable_factors: [],
      quarantine: { items: [], summary: { total: 0 } },
      quarantine_result_rows: [],
      scoring_candidates: [],
    }));
    renderFactory();
    expect(await screen.findByRole('heading', { name: '因子任务生产台' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '可上线发布' })).not.toBeInTheDocument();
    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'factory offline' }, 500));
    renderFactory();
    expect(await screen.findByText(/factory offline/)).toBeInTheDocument();
    expect(screen.queryByText('s_mom_6m_rank * s_qlty_roe_ltm_raw')).not.toBeInTheDocument();
  });
});
