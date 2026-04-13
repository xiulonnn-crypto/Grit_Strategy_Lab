import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApiBacktestRunDetail,
  ApiOptimizationJobCreatePayload,
  ApiOptimizationJobDetail,
  ApiOptimizationJobListItem,
  ApiOptimizationSearchSpaceField,
  ApiStrategyDetail,
  ApiWorkspaceOverview,
  DemoApi,
} from './types';
import { hydrateOptimizationJob, buildOptimizationJobListItem } from './lib/optimization-demo';

let currentApi: DemoApi;

vi.mock('./lib/demoStoreContext', async () => {
  const ReactModule = await import('react');
  const { createContext, useContext } = ReactModule;

  const ApiClientContext = createContext<DemoApi | null>(null);

  function ApiClientProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    return ReactModule.createElement(ApiClientContext.Provider, { value: currentApi }, children);
  }

  function useApiClient(): DemoApi {
    const api = useContext(ApiClientContext);
    if (!api) {
      throw new Error('useApiClient 必须在 ApiClientProvider 内使用。');
    }
    return api;
  }

  return {
    ApiClientProvider,
    DemoStoreProvider: ApiClientProvider,
    useApiClient,
    useDemoApi: useApiClient,
  };
});

import App from './app-runtime';
import { createStrategy, nowIso } from './lib/demoStoreShared';

type OptimizationJobState = {
  job: ApiOptimizationJobDetail;
  phase: number;
};

function formatVersionedStrategyName(name: string, version: number | undefined): string {
  const trimmed = name.trim();
  let cursor = trimmed.length;
  while (cursor > 0 && /\d/.test(trimmed[cursor - 1] ?? '')) {
    cursor -= 1;
  }
  const baseName =
    cursor > 0 && cursor < trimmed.length && trimmed[cursor - 1]?.toLowerCase() === 'v'
      ? trimmed.slice(0, cursor - 1).trimEnd()
      : trimmed;
  if (typeof version !== 'number' || !Number.isFinite(version) || version <= 1) {
    return baseName;
  }
  return `${baseName}v${Math.round(version)}`;
}

function makeSearchSpace(): ApiOptimizationSearchSpaceField[] {
  return [
    { key: 'lookback_months', label: '回看(月)', mode: 'range', current: 6, start: 6, end: 12, step: 1, tag: '主搜索维度' },
    { key: 'skip_recent_months', label: '跳过最近(月)', mode: 'range', current: 1, start: 1, end: 4, step: 1, tag: '辅助搜索维度' },
    { key: 'top_n', label: '买入排名阈值', mode: 'range', current: 10, start: 10, end: 100, step: 10, tag: '辅助搜索维度' },
    { key: 'hold_rank_threshold', label: '保留排名阈值', mode: 'range', current: 120, start: 110, end: 130, step: 10, tag: '辅助搜索维度' },
    { key: 'weighting_method', label: '加权方式', mode: 'fixed', current: 'equal_weight', value: 'equal_weight', start: 'equal_weight', end: 'equal_weight', step: 1, tag: '锁定参数' },
  ];
}

function createStrategyFixture(): ApiStrategyDetail {
  return createStrategy({
    id: 'strat-001',
    name: '标普动量策略',
    description: '用于验证优化实验室前端恢复流程的测试策略。',
    latest_run_id: 'bt-001',
    latest_optimization_job_id: 'opt-interrupted',
    current_parameter_version: 1,
    current_parameter_version_id: 'strat-001-v1',
    universe_name: 'SP500',
    strategy_type: 'MOMENTUM',
    parameters: {
      lookback_months: 6,
      skip_recent_months: 1,
      top_n: 10,
      hold_rank_threshold: 120,
      weighting_method: 'equal_weight',
    },
    latest_completed_run_summary: {
      run_id: 'bt-001',
      parameter_version: 1,
      parameter_version_id: 'strat-001-v1',
      status: 'COMPLETED',
      total_return: 0.18,
      annualized_return: 0.124,
      sharpe: 1.18,
      max_drawdown: -0.064,
      oos_total_return: 0.09,
      oos_annualized_return: 0.098,
      oos_sharpe: 0.87,
      oos_max_drawdown: -0.052,
      warning_count: 0,
      execution_policy: 'T_CLOSE_TO_T1_OPEN',
      dataset_snapshot_id: 'ds-001',
      universe_snapshot_id: 'un-001',
      completed_at: nowIso(),
      sparkline_points: [],
    },
  });
}

function createRunFixture(strategy: ApiStrategyDetail): ApiBacktestRunDetail {
  return {
    id: 'bt-001',
    strategy_id: strategy.id,
    strategy_name: strategy.name,
    status: 'COMPLETED',
    metrics: {
      total_return: 0.18,
      total_return_pct: 18,
      annualized_return: 0.124,
      sharpe: 1.18,
      out_of_sample_sharpe: 0.87,
      max_drawdown: -0.064,
      max_drawdown_pct: -6.4,
    },
    warnings: [],
    chart_series: [],
    monthly_returns: [],
    trade_details: [],
    configuration: { oos_start_date: '2025-02-01' },
    parameter_snapshot: strategy.parameters ?? {},
    snapshot_summary: { dataset_snapshot_id: 'ds-001', universe_snapshot_id: 'un-001' },
    data_segment_type: 'FULL',
    parameter_version_id: strategy.current_parameter_version_id,
    request: {
      start_date: '2025-01-02',
      end_date: '2025-02-28',
      execution_policy: 'T_CLOSE_TO_T1_OPEN',
    },
    is_permanent: false,
    source_run_id: null,
    trade_audit_items: [],
    trade_audit: [],
    analysis: {
      subtitle: '测试集仍在领先基准。',
      kpi_cards: [],
      decision_rail: { score: 67, summary: '测试集仍在领先基准。', items: [] },
    },
  };
}

function createBestMetricsSummary(): NonNullable<ApiOptimizationJobDetail['summary']['best_metrics_summary']> {
  return {
    trial_index: 1,
    label: '稳定策略中心',
    status: 'SUCCEEDED',
    parameter_snapshot: {
      lookback_months: 6,
      skip_recent_months: 1,
      top_n: 10,
      hold_rank_threshold: 120,
      weighting_method: 'equal_weight',
    },
    metrics: {
      annualized_return: 0.138,
      return_sharpe: 1.14,
      out_of_sample_sharpe: 0.98,
      max_drawdown_pct: -12.4,
      stability: 82,
    },
    score: 1.043,
    error_message: null,
    started_at: '2026-03-31T04:42:00.000Z',
    completed_at: '2026-03-31T04:44:00.000Z',
  };
}

function createCompletedJob(strategy: ApiStrategyDetail, run: ApiBacktestRunDetail, jobId: string): ApiOptimizationJobDetail {
  const base: ApiOptimizationJobDetail = {
    id: jobId,
    strategy_id: strategy.id,
    status: 'COMPLETED',
    request: {
      objective: 'sharpe',
      base_parameter_version_id: strategy.current_parameter_version_id,
      source_run_id: run.id,
      entry_point: 'run_detail',
      validation_mode: 'walk_forward',
      budget_combinations: 70,
      search_space: makeSearchSpace(),
    },
    summary: {
      objective: 'sharpe',
      candidate_count: 0,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      entry_point: 'run_detail',
      validation_mode: 'walk_forward',
      source_run_id: run.id,
      budget_combinations: 70,
      completed_combinations: 70,
      progress_pct: 100,
      current_stage: '优化完成',
      latest_update: '优化任务已完成。',
      estimated_remaining_minutes: 0,
      estimated_completed_at: '2026-03-31T04:58:00.000Z',
      search_space: makeSearchSpace(),
      status: 'COMPLETED',
      best_metrics_summary: createBestMetricsSummary(),
    },
    result: {
      best_candidate_id: null,
      best_candidate_label: null,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      headline: '优化结果已就绪',
      summary: '优化任务已完成。',
      status: 'COMPLETED',
      progress_pct: 100,
      current_stage: '优化完成',
      latest_update: '优化任务已完成。',
    },
    candidates: [],
    base_parameter_version_id: strategy.current_parameter_version_id,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: nowIso(),
  };

  return hydrateOptimizationJob(strategy, base, run);
}

function createInterruptedJob(strategy: ApiStrategyDetail, run: ApiBacktestRunDetail, jobId: string): ApiOptimizationJobDetail {
  const base: ApiOptimizationJobDetail = {
    id: jobId,
    strategy_id: strategy.id,
    status: 'INTERRUPTED',
    request: {
      objective: 'sharpe',
      base_parameter_version_id: strategy.current_parameter_version_id,
      source_run_id: run.id,
      entry_point: 'run_detail',
      validation_mode: 'walk_forward',
      budget_combinations: 70,
      search_space: makeSearchSpace(),
    },
    summary: {
      objective: 'sharpe',
      candidate_count: 0,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      entry_point: 'run_detail',
      validation_mode: 'walk_forward',
      source_run_id: run.id,
      budget_combinations: 70,
      completed_combinations: 11,
      progress_pct: 16,
      current_stage: '已中断',
      latest_update: '已保存 11 组结果，点击继续优化可从第 12 组恢复。',
      estimated_remaining_minutes: 14,
      estimated_completed_at: '2026-03-31T05:14:00.000Z',
      search_space: makeSearchSpace(),
      status: 'INTERRUPTED',
      resume_ready: true,
      persisted_trial_count: 11,
      next_trial_index: 12,
      interrupted_reason: '服务重启',
      best_metrics_summary: createBestMetricsSummary(),
    },
    result: {
      best_candidate_id: null,
      best_candidate_label: null,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      headline: '优化已中断',
      summary: '已保存 11 组结果，点击继续优化可从第 12 组恢复。',
      status: 'INTERRUPTED',
      progress_pct: 16,
      current_stage: '已中断',
      latest_update: '已保存 11 组结果，点击继续优化可从第 12 组恢复。',
    },
    candidates: [],
    base_parameter_version_id: strategy.current_parameter_version_id,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: null,
    resume_ready: true,
    persisted_trial_count: 11,
    next_trial_index: 12,
    interrupted_reason: '服务重启',
    best_metrics_summary: createBestMetricsSummary(),
  };

  return hydrateOptimizationJob(strategy, base, run);
}

function createEmptyCompletedJob(strategy: ApiStrategyDetail, run: ApiBacktestRunDetail, jobId: string): ApiOptimizationJobDetail {
  const base: ApiOptimizationJobDetail = {
    id: jobId,
    strategy_id: strategy.id,
    status: 'COMPLETED',
    request: {
      objective: 'sharpe',
      base_parameter_version_id: strategy.current_parameter_version_id,
      source_run_id: run.id,
      entry_point: 'run_detail',
      validation_mode: 'walk_forward',
      budget_combinations: 20,
      search_space: makeSearchSpace(),
    },
    summary: {
      objective: 'sharpe',
      candidate_count: 0,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      entry_point: 'run_detail',
      validation_mode: 'walk_forward',
      source_run_id: run.id,
      budget_combinations: 20,
      completed_combinations: 20,
      progress_pct: 100,
      current_stage: '优化完成',
      latest_update: '优化任务已完成，但尚未形成可展示候选。',
      search_space: makeSearchSpace(),
      status: 'COMPLETED',
    },
    result: {
      best_candidate_id: null,
      best_candidate_label: null,
      baseline_parameter_version_id: strategy.current_parameter_version_id,
      headline: '优化结果已就绪',
      summary: '优化任务已完成，但尚未形成可展示候选。',
      status: 'COMPLETED',
      progress_pct: 100,
      current_stage: '优化完成',
      latest_update: '优化任务已完成，但尚未形成可展示候选。',
    },
    candidates: [],
    base_parameter_version_id: strategy.current_parameter_version_id,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: nowIso(),
  };

  return base;
}

function createOptimizationTestApi(): DemoApi {
  const strategy = createStrategyFixture();
  const run = createRunFixture(strategy);
  const jobs = new Map<string, OptimizationJobState>([
    ['opt-001', { job: createCompletedJob(strategy, run, 'opt-001'), phase: 0 }],
    ['opt-interrupted', { job: createInterruptedJob(strategy, run, 'opt-interrupted'), phase: 0 }],
    ['opt-empty', { job: createEmptyCompletedJob(strategy, run, 'opt-empty'), phase: 0 }],
  ]);
  let createdJobCounter = 0;

  function cloneJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
    return structuredClone(job);
  }

  function buildQueuedJob(jobId: string, payload: Partial<ApiOptimizationJobDetail['request']> = {}): OptimizationJobState {
    const queued: ApiOptimizationJobDetail = {
      id: jobId,
      strategy_id: strategy.id,
      status: 'QUEUED',
      request: {
        objective: 'sharpe',
        base_parameter_version_id: strategy.current_parameter_version_id,
        source_run_id: run.id,
        entry_point: 'run_detail',
        validation_mode: 'walk_forward',
        budget_combinations: 70,
        search_space: makeSearchSpace(),
        ...payload,
      },
      summary: {
        objective: 'sharpe',
        candidate_count: 0,
        baseline_parameter_version_id: strategy.current_parameter_version_id,
        entry_point: 'run_detail',
        validation_mode: 'walk_forward',
        source_run_id: run.id,
        budget_combinations: 70,
        completed_combinations: 0,
        progress_pct: 0,
        current_stage: '任务已创建',
        latest_update: '优化任务已创建，正在准备搜索队列。',
        estimated_remaining_minutes: null,
        estimated_completed_at: null,
        search_space: makeSearchSpace(),
        status: 'QUEUED',
      },
      result: {
        best_candidate_id: null,
        best_candidate_label: null,
        baseline_parameter_version_id: strategy.current_parameter_version_id,
        headline: '优化进行中',
        summary: '优化任务已创建，正在准备搜索队列。',
        status: 'QUEUED',
        progress_pct: 0,
        current_stage: '任务已创建',
        latest_update: '优化任务已创建，正在准备搜索队列。',
      },
      candidates: [],
      base_parameter_version_id: strategy.current_parameter_version_id,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: null,
    };

    return { job: queued, phase: 0 };
  }

  function materializeCompletedJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
    const completed = createCompletedJob(strategy, run, job.id);
    return {
      ...completed,
      request: {
        ...completed.request,
        ...job.request,
        search_space: job.request.search_space?.length ? structuredClone(job.request.search_space) : completed.request.search_space,
      },
      summary: {
        ...completed.summary,
        ...job.summary,
        completed_combinations: job.request.budget_combinations ?? completed.summary.completed_combinations,
        progress_pct: 100,
        current_stage: '优化完成',
        latest_update: '优化任务已完成。',
        status: 'COMPLETED',
      },
      result: {
        ...completed.result,
        ...job.result,
        status: 'COMPLETED',
        progress_pct: 100,
        current_stage: '优化完成',
        latest_update: '优化任务已完成。',
      },
      created_at: job.created_at ?? completed.created_at,
      updated_at: nowIso(),
      completed_at: nowIso(),
    };
  }

  function advanceJob(state: OptimizationJobState): ApiOptimizationJobDetail {
    const job = state.job;
    const status = String(job.status ?? '').toUpperCase();
    if (status === 'INTERRUPTED' || status === 'COMPLETED') {
      return cloneJob(job);
    }

    if (status === 'QUEUED') {
      if (state.phase === 0) {
        state.phase = 1;
        return cloneJob(job);
      }
      if (state.phase === 1) {
        state.phase = 2;
        job.status = 'RUNNING';
        job.updated_at = nowIso();
        job.summary = {
          ...job.summary,
          status: 'RUNNING',
          progress_pct: 16,
          current_stage: '首轮搜索',
          latest_update: '正在收集首轮组合表现，结果中心会自动刷新。',
          completed_combinations: 11,
          latest_candidate_label: '候选方案 1',
        };
        job.result = {
          ...job.result,
          status: 'RUNNING',
          progress_pct: 16,
          current_stage: '首轮搜索',
          latest_update: '正在收集首轮组合表现，结果中心会自动刷新。',
          summary: '正在收集首轮组合表现，结果中心会自动刷新。',
        };
        return cloneJob(job);
      }
      state.job = materializeCompletedJob(job);
      state.phase = 3;
      return cloneJob(state.job);
    }

    if (status === 'RUNNING') {
      if (state.phase === 0) {
        state.phase = 1;
        return cloneJob(job);
      }
      state.job = materializeCompletedJob(job);
      state.phase = 2;
      return cloneJob(state.job);
    }

    return cloneJob(job);
  }

  function findJob(jobId: string): OptimizationJobState {
    const job = jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    return job;
  }

  function updateStrategyForPromotion(jobId: string, applyVersionPromotion = false): void {
    strategy.latest_optimization_job_id = jobId;
    if (applyVersionPromotion) {
      strategy.current_parameter_version = (strategy.current_parameter_version ?? 1) + 1;
      strategy.current_parameter_version_id = `${strategy.id}-v${strategy.current_parameter_version}`;
      strategy.name = formatVersionedStrategyName(strategy.name, strategy.current_parameter_version);
    }
  }

  function syncLatestOptimizationJob(): void {
    const orderedJobs = [...jobs.values()].sort((left, right) => {
      const leftTime = Date.parse(left.job.updated_at ?? left.job.completed_at ?? left.job.created_at ?? '');
      const rightTime = Date.parse(right.job.updated_at ?? right.job.completed_at ?? right.job.created_at ?? '');
      return rightTime - leftTime;
    });
    strategy.latest_optimization_job_id = orderedJobs[0]?.job.id ?? null;
  }

  return {
    async getWorkspaceOverview(): Promise<ApiWorkspaceOverview> {
      const orderedJobs = [...jobs.values()].sort((left, right) => {
        const leftTime = Date.parse(left.job.updated_at ?? left.job.completed_at ?? left.job.created_at ?? '');
        const rightTime = Date.parse(right.job.updated_at ?? right.job.completed_at ?? right.job.created_at ?? '');
        return rightTime - leftTime;
      });
      return {
        workspace_name: 'Grit Strategy Lab',
        subtitle: '优化实验室前端测试',
        strategy_count: 1,
        active_run_count: 1,
        running_optimization_count: orderedJobs.filter((item) => ['QUEUED', 'RUNNING'].includes(String(item.job.status))).length,
        latest_strategy_id: strategy.id,
        latest_backtest_run_id: run.id,
        latest_optimization_job_id: orderedJobs[0]?.job.id ?? null,
        top_momentum_warning: '测试环境提示',
        quick_actions: ['open_optimization'],
      };
    },
    async listStrategies(): Promise<ApiStrategyDetail[]> {
      return [structuredClone(strategy)];
    },
    async getStrategyDetail(id: string): Promise<ApiStrategyDetail> {
      if (id !== strategy.id) {
        throw new Error(`Strategy ${id} not found`);
      }
      return structuredClone(strategy);
    },
    async getCreationSession(): Promise<never> {
      throw new Error('not implemented');
    },
    async createCreationSession(): Promise<never> {
      throw new Error('not implemented');
    },
    async appendCreationMessage(): Promise<never> {
      throw new Error('not implemented');
    },
    async prepareConfirmation(): Promise<never> {
      throw new Error('not implemented');
    },
    async updateConfirmation(): Promise<never> {
      throw new Error('not implemented');
    },
    async materializeStrategy(): Promise<never> {
      throw new Error('not implemented');
    },
    async listBacktestRuns(): Promise<never> {
      throw new Error('not implemented');
    },
    async getBacktestRunDetail(id: string): Promise<ApiBacktestRunDetail> {
      if (id !== run.id) {
        throw new Error(`Run ${id} not found`);
      }
      return structuredClone(run);
    },
    async saveBacktestRun(): Promise<ApiBacktestRunDetail> {
      return structuredClone(run);
    },
    async deleteBacktestRun(): Promise<{ id: string; deleted_at: string; deleted_reason: string }> {
      return {
        id: run.id,
        deleted_at: nowIso(),
        deleted_reason: 'user_deleted',
      };
    },
    async getBacktestRunTrades(): Promise<never> {
      throw new Error('not implemented');
    },
    async getBacktestTradeAudit(): Promise<never> {
      throw new Error('not implemented');
    },
    async previewBacktestRun(): Promise<never> {
      throw new Error('not implemented');
    },
    async submitBacktestRun(): Promise<never> {
      throw new Error('not implemented');
    },
    async cloneBacktestRun(): Promise<never> {
      throw new Error('not implemented');
    },
    async listOptimizationJobs(): Promise<ApiOptimizationJobListItem[]> {
      return [...jobs.values()]
        .map(({ job }) => buildOptimizationJobListItem(strategy, job))
        .sort((left, right) => {
          const leftTime = Date.parse(left.updated_at ?? left.completed_at ?? left.created_at ?? '');
          const rightTime = Date.parse(right.updated_at ?? right.completed_at ?? right.created_at ?? '');
          return rightTime - leftTime;
        });
    },
    async getOptimizationJobDetail(jobId: string): Promise<ApiOptimizationJobDetail> {
      return advanceJob(findJob(jobId));
    },
    async deleteOptimizationJob(jobId: string) {
      findJob(jobId);
      jobs.delete(jobId);
      syncLatestOptimizationJob();
      return {
        id: jobId,
        deleted_at: nowIso(),
        deleted_reason: 'user_deleted',
      };
    },
    async createOptimizationJob(strategyId: string, payload?: ApiOptimizationJobCreatePayload): Promise<ApiOptimizationJobDetail> {
      if (strategyId !== strategy.id) {
        throw new Error(`Strategy ${strategyId} not found`);
      }
      createdJobCounter += 1;
      const jobId = `opt-created-${createdJobCounter}`;
      const state = buildQueuedJob(jobId, payload);
      jobs.set(jobId, state);
      updateStrategyForPromotion(jobId);
      return cloneJob(state.job);
    },
    async resumeOptimizationJob(jobId: string): Promise<ApiOptimizationJobDetail> {
      const state = findJob(jobId);
      if (String(state.job.status).toUpperCase() !== 'INTERRUPTED') {
        return cloneJob(state.job);
      }
      state.phase = 0;
      state.job = {
        ...state.job,
        status: 'RUNNING',
        updated_at: nowIso(),
        summary: {
          ...state.job.summary,
          status: 'RUNNING',
          latest_update: '已继续优化，正在从断点恢复。',
          current_stage: '断点恢复中',
          resume_ready: false,
        },
        result: {
          ...state.job.result,
          status: 'RUNNING',
          latest_update: '已继续优化，正在从断点恢复。',
          current_stage: '断点恢复中',
        },
      };
      return cloneJob(state.job);
    },
    async createOptimizationCandidate(): Promise<never> {
      throw new Error('not implemented');
    },
    async promoteOptimizationCandidate(jobId: string): Promise<ApiOptimizationJobDetail> {
      const state = findJob(jobId);
      updateStrategyForPromotion(jobId, true);
      return cloneJob(state.job);
    },
    async deleteOptimizationCandidate(): Promise<never> {
      throw new Error('not implemented');
    },
    async getSnapshotOverview(): Promise<never> {
      throw new Error('not implemented');
    },
    async refreshSnapshots(): Promise<never> {
      throw new Error('not implemented');
    },
  };
}

async function renderApp(hash: string): Promise<HTMLElement> {
  let container: HTMLElement | null = null;
  await act(async () => {
    window.location.hash = hash;
    ({ container } = render(<App />));
  });
  return container!;
}

beforeEach(() => {
  currentApi = createOptimizationTestApi();
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('optimization module flow', () => {
  it('navigates from jobs to select, config, and results', async () => {
    const container = await renderApp('#/optimization-jobs');

    await waitFor(() => expect(container.querySelector('.optimization-lab-page')).not.toBeNull());
    expect(container.querySelector('.optimization-steps')).toBeNull();

    const createButton = container.querySelector('.optimization-lab-panel--header .primary-button') as HTMLButtonElement | null;
    expect(createButton).toBeTruthy();
    fireEvent.click(createButton!);

    await waitFor(() => expect(window.location.hash).toBe('#/optimization-jobs/new'));

    await waitFor(() => expect(container.querySelector('.optimization-lab-panel__heading h2')).toBeTruthy());
    const selectButton = container.querySelector('tbody tr:first-child td:last-child button') as HTMLButtonElement | null;
    expect(selectButton).toBeTruthy();
    fireEvent.click(selectButton!);

    await waitFor(() =>
      expect(window.location.hash).toMatch(/^#\/optimization-jobs\/new\/config\?strategy_id=strat-001/),
    );
    await waitFor(() => expect(container.querySelector('.optimization-config-grid')).not.toBeNull());

    const startButton = container.querySelector('.optimization-hero-actions .primary-button') as HTMLButtonElement | null;
    expect(startButton).toBeTruthy();
    fireEvent.click(startButton!);

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/optimization-jobs\/opt-created-/));
    await waitFor(() => expect(container.querySelector('.optimization-progress-panel')).not.toBeNull());
    expect(container.querySelector('.optimization-results-grid')).toBeNull();
    expect(container.textContent).toContain('等待首批样本');
    await waitFor(() => expect(container.querySelector('.optimization-results-grid')).not.toBeNull());
  });

  it('removes the entry column and deletes a job after modal confirmation', async () => {
    const container = await renderApp('#/optimization-jobs');

    await waitFor(() => expect(container.querySelector('.optimization-lab-table')).not.toBeNull());
    const headerTexts = Array.from(container.querySelectorAll('thead th')).map((cell) => cell.textContent?.trim());
    expect(headerTexts).not.toContain('入口');
    expect(headerTexts).toContain('操作');

    const targetRow = Array.from(container.querySelectorAll('tbody tr')).find((row) => row.textContent?.includes('opt-001'));
    expect(targetRow).toBeTruthy();

    const deleteButton = targetRow?.querySelector('.optimization-jobs-table__delete') as HTMLButtonElement | null;
    expect(deleteButton).toBeTruthy();
    fireEvent.click(deleteButton!);

    await waitFor(() => expect(container.querySelector('.optimization-jobs-delete-dialog')).not.toBeNull());
    expect(container.textContent).toContain('删除优化任务');
    expect(container.textContent).toContain('确认删除任务 opt-001 吗？');

    const confirmButton = container.querySelector(
      '.optimization-jobs-delete-dialog .optimization-jobs-delete-dialog__confirm',
    ) as HTMLButtonElement | null;
    expect(confirmButton).toBeTruthy();
    fireEvent.click(confirmButton!);

    await waitFor(() => expect(container.querySelector('.optimization-jobs-delete-dialog')).toBeNull());
    expect(container.textContent).not.toContain('opt-001');
  });

  it('shows interrupted progress and a continue button without rendering result grids', async () => {
    const container = await renderApp('#/optimization-jobs/opt-interrupted');

    await waitFor(() => expect(container.querySelector('.optimization-progress-panel')).not.toBeNull());
    expect(container.querySelector('.optimization-results-grid')).toBeNull();
    expect(container.querySelector('.optimization-results-bottom-grid')).toBeNull();
    expect(container.querySelector('.optimization-shelf-grid')).toBeNull();
    expect(container.textContent).toContain('优化已中断');
    expect(container.textContent).toContain('继续优化');
    expect(container.textContent).toContain('14 分钟');
  });

  it('applies roomier spacing inside the in-progress panel', async () => {
    const container = await renderApp('#/optimization-jobs/opt-interrupted');

    const progressPanel = (await waitFor(() => container.querySelector('.optimization-progress-panel'))) as HTMLElement;
    const metricTile = progressPanel.querySelector('.optimization-metric-tile') as HTMLElement | null;
    const summaryRows = progressPanel.querySelectorAll('.optimization-summary-row');
    const middleSummaryRow = summaryRows[1] as HTMLElement | undefined;
    const summaryValue = middleSummaryRow?.querySelector('strong') as HTMLElement | null;

    expect(metricTile).toBeTruthy();
    expect(middleSummaryRow).toBeTruthy();
    expect(summaryValue).toBeTruthy();

    expect(getComputedStyle(progressPanel).gap).toBe('22px');
    expect(getComputedStyle(metricTile!).paddingTop).toBe('16px');
    expect(getComputedStyle(metricTile!).gap).toBe('10px');
    expect(getComputedStyle(middleSummaryRow!).display).toBe('grid');
    expect(getComputedStyle(middleSummaryRow!).paddingTop).toBe('14px');
    expect(getComputedStyle(summaryValue!).textAlign).toBe('left');
    expect(getComputedStyle(summaryValue!).lineHeight).not.toBe('normal');
  });

  it('continues an interrupted job and resumes polling until completion', async () => {
    const container = await renderApp('#/optimization-jobs/opt-interrupted');

    await waitFor(() => expect(container.querySelector('.optimization-progress-panel')).not.toBeNull());
    const continueButton = container.querySelector('.optimization-hero-actions .primary-button') as HTMLButtonElement | null;
    expect(continueButton).toBeTruthy();
    fireEvent.click(continueButton!);

    await waitFor(() => expect(container.querySelector('.optimization-progress-panel')).not.toBeNull());
    expect(container.querySelector('.optimization-results-grid')).toBeNull();

    await waitFor(() => expect(container.querySelector('.optimization-results-grid')).not.toBeNull());
    expect(container.querySelector('.optimization-progress-panel')).toBeNull();
    expect(container.querySelectorAll('.optimization-results-grid tbody tr').length).toBeGreaterThan(0);
    expect(
      Array.from(container.querySelectorAll('.optimization-hero-actions button')).map((button) => button.textContent?.trim()),
    ).toEqual(expect.arrayContaining(['继续调参', '晋升当前版本']));
  });

  it('syncs the stability center and shelf when selecting a different candidate', async () => {
    const container = await renderApp('#/optimization-jobs/opt-001');

    await waitFor(() => expect(container.querySelector('.optimization-results-grid')).not.toBeNull());
    const title = container.querySelector('.optimization-lab-panel--hero h1') as HTMLHeadingElement | null;
    expect(title).toBeTruthy();
    expect(title?.textContent).toContain('参数优化：');
    const subtitle = container.querySelector('.optimization-lab-panel--hero p:not(.optimization-lab-eyebrow)') as HTMLParagraphElement | null;
    expect(subtitle?.textContent).toContain('优化组合共 70个，耗时 0分钟');
    const parameterSummary = container.querySelector('.optimization-parameter-summary') as HTMLElement | null;
    expect(parameterSummary).toBeTruthy();
    expect(parameterSummary?.querySelectorAll('.optimization-parameter-summary__line').length).toBeGreaterThan(0);
    expect(parameterSummary?.textContent).not.toContain('equal_weight');
    expect(container.querySelector('.optimization-parameter-chip-list')).toBeTruthy();
    expect(container.querySelector('.optimization-check-list')).toBeNull();
    expect(container.querySelectorAll('.optimization-heatmap-cell').length).toBeGreaterThan(1);
    expect(container.textContent).toContain('窗口 A 为样本外起始验证窗口');
    expect(container.textContent).toContain('年化收益率');
    expect(container.textContent).toContain('综合评价');
    expect(container.textContent).toContain('按综合评分排序复核本轮参数组合');
    expect(container.textContent).toContain('按不同市场窗口复核策略表现');
    expect(container.querySelector('.optimization-mini-metric-strip')).toBeNull();
    expect(container.querySelector('.optimization-results-card--rail .optimization-lab-panel__heading .status-chip')).toBeNull();
    expect(container.querySelector('.optimization-results-card--rail .optimization-evaluation-panel__headline span')).toBeTruthy();
    const initialMetricRowText = container.querySelector('.optimization-metric-row')?.textContent;
    const initialActiveShelfCard = container.querySelector('.optimization-shelf-card--active') as HTMLButtonElement | null;
    const initialActiveShelfText = initialActiveShelfCard?.textContent;
    const chips = container.querySelector('.optimization-meta-chips') as HTMLElement | null;
    expect(chips?.textContent).toContain('任务编号：');
    expect(chips?.textContent).toContain('参数组合：回看(月)6-12；跳过最近(月)1-4；买入排名阈值10-100；保留排名阈值110-130');
    expect(chips?.textContent).not.toContain('策略：');
    expect(chips?.textContent).not.toContain('参数优化：');

    const rows = container.querySelectorAll('.optimization-results-grid tbody tr');
    expect(rows.length).toBeGreaterThan(4);
    const baselineRow = rows[rows.length - 1] as HTMLTableRowElement;
    expect(baselineRow.textContent).toContain('当前策略组合');
    expect(baselineRow.children[1]?.querySelector('span')).toBeNull();
    fireEvent.click(rows[1] as HTMLTableRowElement);

    await waitFor(() => expect(container.querySelector('.optimization-metric-row')?.textContent).not.toBe(initialMetricRowText));
    const activeShelfCard = container.querySelector('.optimization-shelf-card--active') as HTMLButtonElement | null;
    expect(activeShelfCard).toBeTruthy();
    expect(activeShelfCard?.textContent).not.toBe(initialActiveShelfText);
  });

  it('updates the hero strategy name with the promoted version after promoting the current candidate', async () => {
    const container = await renderApp('#/optimization-jobs/opt-001');

    await waitFor(() => expect(container.querySelector('.optimization-results-grid')).not.toBeNull());
    const promoteButton = Array.from(container.querySelectorAll('.optimization-hero-actions button')).find((button) =>
      button.textContent?.includes('晋升当前版本'),
    ) as HTMLButtonElement | undefined;
    expect(promoteButton).toBeTruthy();

    fireEvent.click(promoteButton!);

    await waitFor(() =>
      expect((container.querySelector('.optimization-lab-panel--hero h1') as HTMLHeadingElement | null)?.textContent).toContain(
        '参数优化：标普动量策略v2',
      ),
    );
    expect(container.textContent).toContain('已完成版本晋升，策略已更新为 标普动量策略v2。');
  });

  it('localizes legacy english evaluation copy from the optimization detail payload', async () => {
    const englishApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail = englishApi.getOptimizationJobDetail.bind(englishApi);
    englishApi.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      const firstCandidate = job.candidates[0];
      if (firstCandidate?.analysis) {
        firstCandidate.analysis.stability_summary =
          'This candidate already meets the core promotion guardrails. Use the validation windows to confirm the edge persists across different market regimes.';
        firstCandidate.analysis.stability_checks = [
          {
            key: 'annualized_return',
            label: 'Annualized Return',
            value: 32.9,
            verdict: 'pass',
            detail: 'Annualized return is strong enough to support promotion review.',
          },
        ];
      }
      return job;
    };
    currentApi = englishApi;

    const container = await renderApp('#/optimization-jobs/opt-001');

    await waitFor(() => expect(container.querySelector('.optimization-results-grid')).not.toBeNull());
    expect(container.textContent).toContain('该候选已满足核心晋升护栏，建议结合多窗口验证确认优势在不同市场阶段中的延续性。');
    expect(container.textContent).not.toContain('This candidate already meets the core promotion guardrails');
    expect(container.textContent).not.toContain('Annualized return is strong enough to support promotion review.');
  });

  it('localizes best candidate labels to chinese in the candidate table', async () => {
    const bestCandidateApi = createOptimizationTestApi();
    const originalGetOptimizationJobDetail = bestCandidateApi.getOptimizationJobDetail.bind(bestCandidateApi);
    bestCandidateApi.getOptimizationJobDetail = async (jobId: string) => {
      const job = await originalGetOptimizationJobDetail(jobId);
      const firstCandidate = job.candidates[0];
      if (firstCandidate) {
        firstCandidate.title = 'Best candidate';
        firstCandidate.label = 'Best candidate';
      }
      job.result.best_candidate_label = 'Best candidate';
      return job;
    };
    currentApi = bestCandidateApi;

    const container = await renderApp('#/optimization-jobs/opt-001');

    await waitFor(() => expect(container.querySelector('.optimization-results-grid')).not.toBeNull());
    expect(container.textContent).toContain('最佳候选');
    expect(container.textContent).not.toContain('Best candidate');
  });

  it('switches the heatmap between annualized return, sharpe, and drawdown values', async () => {
    const container = await renderApp('#/optimization-jobs/opt-001');

    await waitFor(() => expect(container.querySelector('.optimization-heatmap-toggle')).not.toBeNull());
    const metricButtons = container.querySelectorAll('.optimization-heatmap-toggle__option');
    expect(metricButtons).toHaveLength(3);
    expect(metricButtons[0]?.getAttribute('aria-checked')).toBe('true');

    const firstCell = container.querySelector('.optimization-heatmap-cell') as HTMLElement | null;
    expect(firstCell).toBeTruthy();
    const annualizedText = firstCell?.textContent;
    expect(annualizedText).toContain('%');

    const sharpeButton = Array.from(metricButtons).find((button) => button.textContent?.includes('收益夏普')) as HTMLButtonElement;
    fireEvent.click(sharpeButton);
    await waitFor(() => expect(firstCell?.textContent).not.toBe(annualizedText));

    const drawdownButton = Array.from(metricButtons).find((button) => button.textContent?.includes('最大回撤')) as HTMLButtonElement;
    fireEvent.click(drawdownButton);
    await waitFor(() => expect(firstCell?.textContent).toContain('%'));
  });

  it('hides terminal result modules when there is no real candidate data', async () => {
    const container = await renderApp('#/optimization-jobs/opt-empty');

    await waitFor(() => expect(container.querySelector('.optimization-progress-panel')).toBeNull());
    expect(container.querySelector('.optimization-results-grid')).toBeNull();
    expect(container.querySelector('.optimization-results-bottom-grid')).toBeNull();
    expect(container.querySelector('.optimization-shelf-grid')).toBeNull();
  });

  it('locks fixed search fields and recalculates budget combinations when the range changes', async () => {
    const container = await renderApp('#/optimization-jobs/new/config?strategy_id=strat-001');

    await waitFor(() => expect(container.querySelector('.optimization-config-grid')).not.toBeNull());

    const budgetInput = container.querySelector('input[aria-label="预算组合"]') as HTMLInputElement | null;
    expect(budgetInput).toBeTruthy();
    const initialBudget = Number(budgetInput!.value);
    expect(initialBudget).toBeGreaterThan(0);

    const firstRow = container.querySelector('.optimization-lab-table-shell--form tbody tr') as HTMLTableRowElement | null;
    expect(firstRow).toBeTruthy();

    const currentValue = firstRow!.children[1]?.textContent?.trim() ?? '';
    const modeSelect = firstRow!.querySelector('select') as HTMLSelectElement | null;
    const rowInputs = firstRow!.querySelectorAll('input');
    const startInput = rowInputs[0] as HTMLInputElement;
    const endInput = rowInputs[1] as HTMLInputElement;
    const stepInput = rowInputs[2] as HTMLInputElement;

    fireEvent.change(endInput, { target: { value: '10' } });
    await waitFor(() => expect(Number(budgetInput!.value)).toBeGreaterThan(initialBudget));
    const expandedBudget = Number(budgetInput!.value);

    fireEvent.change(modeSelect!, { target: { value: 'fixed' } });
    await waitFor(() => {
      expect(startInput.value).toBe(currentValue);
      expect(endInput.value).toBe(currentValue);
      expect(startInput.disabled).toBe(true);
      expect(endInput.disabled).toBe(true);
      expect(stepInput.disabled).toBe(true);
    });
    expect(Number(budgetInput!.value)).toBeLessThan(expandedBudget);
  });

  it('keeps search range inputs editable while the user clears or types a minus sign', async () => {
    const container = await renderApp('#/optimization-jobs/new/config?strategy_id=strat-001');

    await waitFor(() => expect(container.querySelector('.optimization-config-grid')).not.toBeNull());

    const firstRow = container.querySelector('.optimization-lab-table-shell--form tbody tr') as HTMLTableRowElement | null;
    expect(firstRow).toBeTruthy();

    const startInput = firstRow!.querySelectorAll('input')[0] as HTMLInputElement;
    expect(startInput).toBeTruthy();

    fireEvent.change(startInput, { target: { value: '' } });
    expect(startInput.value).toBe('');

    fireEvent.change(startInput, { target: { value: '-' } });
    expect(startInput.value).toBe('-');

    fireEvent.change(startInput, { target: { value: '-2' } });
    expect(startInput.value).toBe('-2');
  });
});
