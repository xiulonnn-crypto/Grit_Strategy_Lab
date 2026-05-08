import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      expression: 'Rank(Return(Close, 21))',
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
    expression: 'Rank(Return(Close, 21))',
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
      diagnostic_warnings: ['PIT 非 Full Ready 不阻断发布'],
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

  it('renders funnel, residual, drawdown, and PIT diagnostic non-blocking evidence from runtime data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(factoryOverview()));

    renderFactory();

    expect(await screen.findByRole('heading', { level: 1, name: '因子工厂' })).toBeInTheDocument();
    expect(await screen.findByText('每日时间：GMT+8 14:00')).toBeInTheDocument();
    expect(screen.getByText('挖掘候选')).toBeInTheDocument();
    expect(screen.getAllByText('1000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))')).toBeInTheDocument();
    expect(screen.getByText('1.20x')).toBeInTheDocument();
    expect(screen.getByText('输出 2026-05-08 · Rank IC 0.061 · IR 1.22 · 覆盖 100.0%')).toBeInTheDocument();
    expect(screen.getAllByText('PIT 非 Full Ready 不阻断发布').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: '发布因子' })).not.toBeDisabled();
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/factor-factory/overview'), expect.any(Object));
  });

  it('shows review reasons below the needs-review status label on quarantine cards', async () => {
    const overview = factoryOverview();
    const reviewCandidate = {
      ...overview.quarantine.items[0],
      status: 'NEEDS_REVIEW',
      publish_status: 'MANUAL_REVIEW_REQUIRED',
      publish_eligibility: {
        status: 'MANUAL_REVIEW_REQUIRED',
        reason: 'OOS 衰减需要人工复核',
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...overview,
      quarantine: { ...overview.quarantine, items: [reviewCandidate] },
    }));

    renderFactory('quarantine');

    expect(await screen.findByText('待复核')).toBeInTheDocument();
    expect(screen.getByText('OOS 衰减需要人工复核')).toBeInTheDocument();
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
    expect(await screen.findByText('已创建一次性工厂 run；每日自动化状态保持不变。')).toBeInTheDocument();

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
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/factor-quarantine/intake') {
        return jsonResponse({ items: factoryOverview().quarantine.items, summary: { intake_count: 1 } });
      }
      if (url.pathname === '/factor-quarantine/candidates/fq_factory_001/run') {
        return jsonResponse(factoryOverview().quarantine.items[0]);
      }
      if (url.pathname === '/factor-quarantine/candidates/fq_factory_001/publish') {
        return jsonResponse({ candidate: { ...factoryOverview().quarantine.items[0], status: 'PUBLISHED' } });
      }
      return jsonResponse(factoryOverview());
    });

    renderFactory('sandbox');

    expect((await screen.findAllByText('Rank(Return(Close, 21))')).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: '送入检疫' }));
    expect(await screen.findByText('候选已进入 D2 检疫队列。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '执行检疫' }));
    expect(await screen.findByText('检疫已完成，PIT 证据按诊断项写入。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '发布因子' }));
    expect(await screen.findByText('候选已发布到正式因子库，并记录发布审计。')).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/factor-quarantine/intake'),
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
    expect(screen.queryByText('Rank(Return(Close, 21))')).not.toBeInTheDocument();
  });
});
