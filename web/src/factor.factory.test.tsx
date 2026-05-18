import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAppHash } from './lib/appRouteContext';
import { ApiClientProvider } from './lib/demoStoreContext';
import FactorFactoryPage from './pages/factor-factory-page';
import type { ApiFactorFactoryOverview } from './types';

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
  const quarantineCandidate = {
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
    quarantine: { items: [quarantineCandidate], summary: { total: 1 } },
    gate_policy: gatePolicy,
    task_summary: {
      total_tasks: 3,
      delivered_candidates: 3,
      submitted_to_quarantine: 1,
      publishable_count: 1,
      rejected_history_count: 0,
      hard_blocked_count: 0,
    },
    task_rows: [
      { id: '2026-05-18-mining', task_date: '2026-05-18', kind: 'mining', title: '2026-05-18 PIT 原子信号挖掘', summary: 'PIT 原始字段可留在 L1；Return/MA/Std 等算子候选进入 L2 Raw Signal。', status: '已完成', target_layer: 'L2', delivered_candidate_count: 1, current_candidate_count: 1 },
      { id: '2026-05-18-refinement', task_date: '2026-05-18', kind: 'refinement', title: '2026-05-18 Raw 标准链改造', summary: 'Raw -> Winsorize -> Neutralize -> Z-Score -> Rank。', status: '已完成', target_layer: 'L2', operator_chain: operatorChain, delivered_candidate_count: 1, current_candidate_count: 1 },
      { id: '2026-05-18-composition', task_date: '2026-05-18', kind: 'composition', title: '2026-05-18 L3 组合因子生成', summary: '风格复合、风险调节、估值锚定、背离惩罚、残差/中性化、时序降噪。', status: '已完成', target_layer: 'L3', parent_factor_ids: ['s_mom_6m_rank', 's_qlty_roe_ltm_raw'], delivered_candidate_count: 1, current_candidate_count: 1 },
    ],
    scoring_candidates: [quarantineCandidate.scoring_detail],
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
      composition_methods: quarantineCandidate.composition_methods,
      investment_logic: '质量驱动动量组合。',
      detail_modal_enabled: true,
    }],
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
    expect(screen.getByRole('heading', { name: '可发布因子名单' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一键发布' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '因子任务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '因子打分' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '因子检疫' })).toBeInTheDocument();
    expect(document.querySelector('.factor-factory-b1b4-page')).toBeInTheDocument();
    expect(document.querySelectorAll('.factor-factory-fixed-panel')).toHaveLength(3);
    expect(screen.getByLabelText('因子任务类型')).toBeInTheDocument();
  });

  it('keeps fixed factory panels scrollable instead of clipping their body content', () => {
    const css = readFileSync('src/pages/factor-phase2-pages.css', 'utf8');

    expect(css).toMatch(/\.factor-factory-fixed-panel\s*\{[^}]*display:\s*grid;[^}]*height:\s*var\(--workbench-panel-height,\s*760px\);[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s);
    expect(css).toMatch(/\.factor-factory-fixed-panel \.factor-phase2-panel__body,\s*\.factor-factory-scroll-body\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
    expect(css).toMatch(/\.factor-factory-result-row,\s*\.factor-factory-report-row\s*\{[^}]*grid-template-columns:\s*minmax\(72px,\s*0\.7fr\)[^}]*minmax\(64px,\s*0\.45fr\);[^}]*max-width:\s*100%;/s);
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
    const resultRows = Array.from(document.querySelectorAll('.factor-factory-result-row:not(.factor-factory-result-row--head)'));
    expect(resultRows[0]).toHaveTextContent('Return(Close, 21)');
    expect(resultRows[0]).toHaveTextContent('2026-05-15');
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
    expect(screen.getByText('显示 2/2')).toBeInTheDocument();
    const resultRows = Array.from(document.querySelectorAll('.factor-factory-result-row:not(.factor-factory-result-row--head)'));
    expect(resultRows).toHaveLength(2);
    expect(resultRows[0]).toHaveTextContent('Return(Close, 21)');
    expect(resultRows[1]).toHaveTextContent('Return(Close, 3)');
  });

  it('renders task dates, fixed status vocabulary, collapsed scoring cards, and one-key send', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(factoryOverview()));

    renderFactory();

    expect(await screen.findByText('2026-05-18 PIT 原子信号挖掘')).toBeInTheDocument();
    expect(screen.getAllByText('已完成').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('可推进')).not.toBeInTheDocument();
    expect(screen.getByText('Raw -> Winsorize -> Neutralize -> Z-Score -> Rank。')).toBeInTheDocument();
    expect(screen.getByText('F1 仅限 Close、Open、Volume、MarketCap、Sector 等未经算子的事实字段；出现 Return、MA、Std 等算子即进入 F2 Raw Signal，并保留 WNZT 缺失与同族冗余提示。')).toBeInTheDocument();
    expect(screen.getByText('2026-05-18 F3 组合因子生成')).toBeInTheDocument();
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
    expect(screen.getByLabelText('结果')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '因子检疫结果列表' });
    expect(within(table).getByText('日期')).toBeInTheDocument();
    expect(within(table).getByText('因子名')).toBeInTheDocument();
    expect(within(table).getByText('结果')).toBeInTheDocument();
    expect(within(table).getByText('原因')).toBeInTheDocument();
    expect(within(table).getByText('操作')).toBeInTheDocument();

    fireEvent.click(within(table).getByRole('button', { name: '详情' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '因子打分明细' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '因子检疫明细' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '准入报告' })).toHaveTextContent('Agent D 建议');
    expect(screen.getByText('OOS 衰减')).toBeInTheDocument();
    expect(screen.getByText('换手率')).toBeInTheDocument();
    expect(screen.getByText('拒绝上线：调仓过频，摩擦成本过大。')).toBeInTheDocument();
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
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-quarantine/intake'), expect.objectContaining({ method: 'POST' }));
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-quarantine/candidates/fq_factory_001/publish'), expect.objectContaining({ method: 'POST' }));
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
    expect(screen.queryByRole('heading', { name: '可发布因子名单' })).not.toBeInTheDocument();
    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'factory offline' }, 500));
    renderFactory();
    expect(await screen.findByText(/factory offline/)).toBeInTheDocument();
    expect(screen.queryByText('s_mom_6m_rank * s_qlty_roe_ltm_raw')).not.toBeInTheDocument();
  });
});
