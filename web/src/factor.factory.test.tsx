import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    operators: ['Return', 'Rank', 'ZScore'],
    candidate_count: 1000,
    random_seed: 42,
    min_rank_ic: 0.03,
    max_depth: 4,
    generation_mode: 'HYBRID_COMPOSITION',
    source_factor_ids: [
      's_mom_6m_rank',
      's_qlty_roe_ltm_raw',
      's_vol_252d_rank',
      's_val_cfp_ltm_raw',
      's_size_cur_log',
      's_vol_downside_252d_rank',
      's_liq_amihud_20d_rank',
    ],
    recipe_families: [
      'style_blend',
      'risk_adjusted',
      'value_anchor',
      'divergence',
      'residual_neutralized',
      'ts_denoise',
    ],
    exploration_budget: 24,
    composition_policy: {
      mode: 'template_plus_exploration',
      publish_boundary: 'manual_after_quarantine',
    },
  };
  const gatePolicy = {
    pit_gate_mode: 'DIAGNOSTIC_ONLY' as const,
    max_style_correlation: 0.3,
    residual_enabled: true,
    max_drawdown_relative_to_benchmark: 1.5,
    min_oos_to_is_ratio: 0.5,
  };
  const miningJob = {
    id: 'fm_factory_001',
    status: 'COMPLETED' as const,
    request,
    progress: {
      total_candidates: 1000,
      evaluated_candidates: 1000,
      failed_candidates: 8,
      throughput_per_second: 2.26,
      percent: 100,
    },
    top_candidates: [{
      id: 'cand_factory_residual',
      expression: 's_mom_6m_rank * s_qlty_roe_ltm_raw',
      score: 0.052,
      rank_ic: 0.061,
      turnover: 0.31,
      coverage: 0.96,
      depth: 3,
      risk_flags: [],
      fitness_score: 0.052,
      max_style_correlation: 0.52,
      correlation_penalty: 0.22,
      max_drawdown_pct: 0.18,
      benchmark_max_drawdown_pct: 0.15,
      drawdown_vs_benchmark_ratio: 1.2,
      auto_residual_summary: {
        residual_expression: 'ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))',
        control_factor_id: 's_vol_252d_raw',
        residual_rank_ic: 0.052,
      },
      source_factor_ids: ['s_mom_6m_rank', 's_qlty_roe_ltm_raw'],
      recipe_kind: 'template',
      recipe_family: 'style_blend',
      orthogonality_intent: 'quality_driven_momentum',
      composition_metadata: { label: 'Quality-Driven Momentum', publish_boundary: 'manual_after_quarantine' },
    }],
    failed_samples: [],
    created_at: '2026-05-08T08:00:00Z',
    updated_at: '2026-05-08T08:02:00Z',
    completed_at: '2026-05-08T08:02:00Z',
  };
  const quarantineCandidate = {
    id: 'fq_factory_001',
    mining_candidate_id: 'cand_factory_residual',
    source_mining_job_id: 'fm_factory_001',
    expression: 's_mom_6m_rank * s_qlty_roe_ltm_raw',
    status: 'PASSED',
    publish_status: 'ELIGIBLE',
    gate_summary: {
      pit: 'Limited Ready',
      pit_gate_mode: 'DIAGNOSTIC_ONLY',
      auto_residual: 'PASSED',
      max_drawdown_relative_to_benchmark: 1.2,
    },
    cluster_id: 'cluster_factory_mom',
    candidate_metrics: {
      rank_ic: 0.061,
      ir: 1.22,
      coverage: 100,
      max_style_correlation: 0.52,
      correlation_penalty: 0.22,
      drawdown_vs_benchmark_ratio: 1.2,
      max_drawdown_pct: 0.18,
      benchmark_max_drawdown_pct: 0.15,
      auto_residual_summary: {
        residual_expression: 'ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))',
        control_factor_id: 's_vol_252d_raw',
        residual_rank_ic: 0.052,
      },
    },
    failure_samples: [],
    pit_evidence: {
      status: 'LIMITED_READY',
      gate_mode: 'DIAGNOSTIC_ONLY',
      promotion_eligible: true,
      diagnostic_warnings: ['PIT 覆盖不足已记录为诊断证据'],
    },
    publish_eligibility: { status: 'ELIGIBLE', reason: 'PIT warning is diagnostic only' },
    target_factor_id: null,
    created_at: '2026-05-08T08:03:00Z',
    updated_at: '2026-05-08T08:05:00Z',
    published_at: null,
    rejected_reason: null,
    latest_run: {
      diagnostic_warnings: ['10Y 准入通过可送检/发布'],
      orthogonal: {
        max_abs_correlation: 0.24,
        auto_residual: {
          residual_expression: 'ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))',
          control_factor_id: 's_vol_252d_raw',
          residual_rank_ic: 0.052,
        },
      },
      stability: {
        drawdown_vs_benchmark_ratio: 1.2,
      },
    },
  };
  const overview: ApiFactorFactoryOverview = {
    profile: {
      id: 'default',
      status: 'PAUSED',
      timezone: 'Asia/Hong_Kong',
      schedule_time: '14:00',
      request,
      gate_policy: gatePolicy,
      created_at: '2026-05-08T08:00:00Z',
      updated_at: '2026-05-08T08:00:00Z',
      last_run_date: null,
      next_run_at: '2026-05-08T14:00:00+08:00',
    },
    active_run: null,
    latest_run: {
      id: 'ffr_factory_001',
      profile_id: 'default',
      run_date: '2026-05-08',
      trigger: 'DAILY',
      status: 'COMPLETED',
      request,
      gate_policy: gatePolicy,
      config_signature: 'factory-test',
      mining_job_id: 'fm_factory_001',
      mining_job: miningJob,
      summary: {
        top_candidate_count: 1,
        drawdown_threshold: 1.5,
        pit_gate_mode: 'DIAGNOSTIC_ONLY',
      },
      started_at: '2026-05-08T08:00:00Z',
      completed_at: '2026-05-08T08:05:00Z',
      created_at: '2026-05-08T08:00:00Z',
      updated_at: '2026-05-08T08:05:00Z',
    },
    runs: [],
    funnel: {
      mined_candidates: 1000,
      quarantine_candidates: 1,
      passed: 1,
      review_or_observation: 0,
      rejected: 0,
      published: 0,
    },
    mining: { items: [miningJob], summary: { total: 1 } },
    quarantine: { items: [quarantineCandidate], summary: { total: 1 } },
    gate_policy: gatePolicy,
  };
  return { ...overview, ...overrides };
}

function renderFactory(initialSection: 'overview' | 'sandbox' | 'quarantine' = 'overview'): void {
  render(
    <ApiClientProvider>
      <FactorFactoryPage initialSection={initialSection} />
    </ApiClientProvider>,
  );
}

describe('FactorFactoryPage', () => {
  it('maps canonical and legacy routes to the unified factory surface', () => {
    expect(parseAppHash('#/factors/factory')).toEqual({ kind: 'factor-factory', section: 'overview' });
    expect(parseAppHash('#/factors/sandbox')).toEqual({ kind: 'factor-factory', section: 'sandbox' });
    expect(parseAppHash('#/factors/quarantine')).toEqual({ kind: 'factor-factory', section: 'quarantine' });
  });

  it('renders current-run funnel, quarantine reasons, and PIT diagnostic evidence from runtime data', async () => {
    const overview = factoryOverview();
    const olderMiningJob = {
      ...overview.mining.items[0],
      id: 'fm_old_factory_001',
      top_candidates: [{
        ...overview.mining.items[0].top_candidates[0],
        id: 'cand_old_factory',
        expression: 'Rank(Return(Close, 63))',
      }],
    };
    const olderQuarantineCandidate = {
      ...overview.quarantine.items[0],
      id: 'fq_old_factory_001',
      source_mining_job_id: 'fm_old_factory_001',
      expression: 'Rank(Return(Close, 63))',
    };
    const rejectedCurrentCandidate = {
      ...overview.quarantine.items[0],
      id: 'fq_factory_rejected_001',
      mining_candidate_id: 'cand_factory_rejected',
      expression: 'Return(Close, 5)',
      status: 'REJECTED',
      publish_status: 'BLOCKED',
      rejected_reason: 'Max drawdown relative to benchmark is >= 1.5x.',
      updated_at: '2026-05-08T09:05:00Z',
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      mining: { ...overview.mining, items: [olderMiningJob, ...overview.mining.items] },
      quarantine: { ...overview.quarantine, items: [olderQuarantineCandidate, rejectedCurrentCandidate, ...overview.quarantine.items] },
    }));

    renderFactory();

    expect(await screen.findByRole('heading', { level: 1, name: '因子工厂' })).toBeInTheDocument();
    expect(await screen.findByText('每日计划：GMT+8 14:00')).toBeInTheDocument();
    expect(screen.getByText('挖掘候选')).toBeInTheDocument();
    expect(screen.getByText('当前批次的候选因子池')).toBeInTheDocument();
    expect(screen.getByText('已进入 D2 检疫的候选因子')).toBeInTheDocument();
    expect(screen.getByText('通过检疫且具备发布资格')).toBeInTheDocument();
    expect(screen.getByText('已入库的自动挖掘因子')).toBeInTheDocument();
  expect(
    screen.getAllByText('输出 2026-05-08 · Rank IC 0.061 · IR 1.22 · 覆盖 100.0%').length,
  ).toBeGreaterThanOrEqual(1);
    const sandboxPanel = document.querySelector('[data-factory-section="sandbox"]') as HTMLElement;
    const quarantinePanel = document.querySelector('[data-factory-section="quarantine"]') as HTMLElement;
    expect(within(sandboxPanel).getByText('工作日期 2026-05-08')).toBeInTheDocument();
    expect(within(sandboxPanel).getByText('二次组合 · 风格复合 / 风险调节 / 估值锚定 · 自动送检，人工发布')).toBeInTheDocument();
    expect(within(sandboxPanel).queryByText('Rank(Return(Close, 21))')).not.toBeInTheDocument();
    expect(within(sandboxPanel).getByText('当前批次候选已全部进入检疫队列，请在右侧查看检疫结果。')).toBeInTheDocument();
    expect(within(quarantinePanel).getByText('s_mom_6m_rank * s_qlty_roe_ltm_raw')).toBeInTheDocument();
    const quarantineList = quarantinePanel.querySelector('.factor-phase2-list') as HTMLElement;
    const quarantineButtons = within(quarantineList).getAllByRole('button');
    expect(quarantineButtons[0]).toHaveTextContent('s_mom_6m_rank * s_qlty_roe_ltm_raw');
    expect(quarantineButtons[1]).toHaveTextContent('Return(Close, 5)');
    expect(screen.getByRole('button', { name: '送入检疫' })).toBeDisabled();
    expect(screen.queryByText('Rank(Return(Close, 63))')).not.toBeInTheDocument();
    expect(screen.queryByText('当前 run 的 top candidate projection')).not.toBeInTheDocument();
    expect(screen.queryByText('PASSED + ELIGIBLE 才可发布')).not.toBeInTheDocument();
    expect(screen.queryByText('正式因子库 AUTO_MINED')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '残差信号复核' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '回撤硬约束' })).not.toBeInTheDocument();
    expect(screen.getAllByText('10Y 准入通过可送检/发布').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: '发布因子' })).not.toBeDisabled();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-factory/overview'), expect.any(Object));
  });

  it('shows rejected reasons as a dedicated column on quarantine cards', async () => {
    const overview = factoryOverview();
    const rejectedCandidate = {
      ...overview.quarantine.items[0],
      status: 'REJECTED',
      publish_status: 'BLOCKED',
      rejected_reason: 'PIT is not Full Ready; recorded as diagnostic evidence only.; Max drawdown relative to benchmark is >= 1.5x.',
      publish_eligibility: {
        status: 'BLOCKED',
        reason: 'PIT is not Full Ready; recorded as diagnostic evidence only.; Max drawdown relative to benchmark is >= 1.5x.',
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      quarantine: { ...overview.quarantine, items: [rejectedCandidate] },
    }));

    renderFactory('quarantine');

    expect(await screen.findByText('已拒绝')).toBeInTheDocument();
    expect(screen.getByText('拒绝原因')).toBeInTheDocument();
    expect(screen.getByText('最大回撤相对基准超过 1.5x')).toBeInTheDocument();
    expect(screen.queryByText(/PIT is not Full Ready/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Max drawdown relative to benchmark/)).not.toBeInTheDocument();
  });

  it('separates daily automation from one-shot run-now actions', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/factor-factory/automation/start') {
        return jsonResponse(factoryOverview({ profile: { ...factoryOverview().profile, status: 'ACTIVE' } }));
      }
      if (url.pathname === '/factor-factory/run-now') {
        return jsonResponse(factoryOverview({ manual_run: factoryOverview().latest_run ?? undefined }));
      }
      if (url.pathname === '/factor-factory/automation/pause') {
        return jsonResponse(factoryOverview());
      }
      return jsonResponse(factoryOverview());
    });

    renderFactory();

    fireEvent.click(await screen.findByRole('button', { name: '启动自动化' }));
    expect(await screen.findByText('每日自动化已启动；GMT+8 14:00 运行，并自动送检与执行检疫。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '立即运行' }));
    expect(await screen.findByText('已创建临时挖掘批次；每日自动化状态保持不变。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '暂停自动化' }));
    expect(await screen.findByText('每日自动化已暂停；已存在的历史 run 不会被删除。')).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/factor-factory/automation/start'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/factor-factory/run-now'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('runs intake, quarantine, and publish through live endpoints without sample fallback', async () => {
    const overview = factoryOverview();
    const overviewBeforeIntake = {
      ...overview,
      quarantine: { ...overview.quarantine, items: [], summary: { total: 0 } },
    };
    let hasQuarantineResult = false;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/factor-quarantine/intake') {
        hasQuarantineResult = true;
        return jsonResponse({ items: overview.quarantine.items, summary: { intake_count: 1 } });
      }
      if (url.pathname === '/factor-quarantine/candidates/fq_factory_001/run') {
        return jsonResponse(overview.quarantine.items[0]);
      }
      if (url.pathname === '/factor-quarantine/candidates/fq_factory_001/publish') {
        return jsonResponse({ candidate: { ...overview.quarantine.items[0], status: 'PUBLISHED' } });
      }
      return jsonResponse(hasQuarantineResult ? overview : overviewBeforeIntake);
    });

    renderFactory('sandbox');

    expect((await screen.findAllByText('s_mom_6m_rank * s_qlty_roe_ltm_raw')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('风格复合 · template · quality_driven_momentum')).toBeInTheDocument();
    expect(screen.getByText('父因子 s_mom_6m_rank / s_qlty_roe_ltm_raw')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '送入检疫' }));
    expect(await screen.findByText('已送入 D2 检疫并执行 1 个候选；通过后可一键发布。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '发布因子' }));
    expect(await screen.findByText('候选已发布到正式因子库，并记录发布审计。')).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/factor-quarantine/intake'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/factor-quarantine/candidates/fq_factory_001/run'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/factor-quarantine/candidates/fq_factory_001/publish'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows a real error state instead of static sample rows when the overview API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'factory offline' }, 500));

    renderFactory();

    expect(await screen.findByText(/factory offline/)).toBeInTheDocument();
    expect(screen.queryByText('s_mom_6m_rank * s_qlty_roe_ltm_raw')).not.toBeInTheDocument();
  });
});
