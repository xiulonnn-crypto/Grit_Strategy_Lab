import {
  ApiError,
  type ApiBacktestRunDeleteResult,
  type ApiBacktestRunDetail,
  type ApiBacktestRunListItem,
  type ApiBacktestRunTradeAudit,
  type ApiBacktestRunTradePage,
  type ApiBacktestSubmissionPreview,
  type ApiConfirmationUpdateRequest,
  type ApiOptimizationCandidate,
  type ApiOptimizationJobCreatePayload,
  type ApiOptimizationJobDetail,
  type ApiOptimizationJobListItem,
  type ApiSnapshotOverview,
  type ApiStrategyCreationSession,
  type ApiStrategyDetail,
  type ApiStrategyListItem,
  type ApiWorkspaceOverview,
  type BacktestRunDetailRequest,
  type CreateCandidatePayload,
  type DemoApi,
  type PromoteMode,
} from '../types';
import { createInitialState } from './demoStoreSeed';
import { clone, createCandidate, formatVersionedStrategyName, nextId, nowIso } from './demoStoreShared';
import { buildOptimizationJobListItem, hydrateOptimizationJob } from './optimization-demo';

let state = createInitialState();

function findStrategy(id: string): ApiStrategyDetail {
  const strategy = state.strategies.find((item) => item.id === id);
  if (!strategy) {
    throw new ApiError({ status: 404, code: 'strategy_not_found', message: `Strategy ${id} was not found.` });
  }
  return strategy;
}

function findRun(id: string): ApiBacktestRunDetail {
  const run = state.runs.find((item) => item.id === id);
  if (!run) {
    throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
  }
  return run;
}

function findSourceRun(id: string | null | undefined): ApiBacktestRunDetail | null {
  if (!id) {
    return null;
  }
  return state.runs.find((item) => item.id === id) ?? null;
}

function getOptimizationSourceRun(job: ApiOptimizationJobDetail): ApiBacktestRunDetail | null {
  const sourceRunId =
    typeof job.request?.source_run_id === 'string'
      ? job.request.source_run_id
      : typeof job.summary?.source_run_id === 'string'
        ? job.summary.source_run_id
        : null;
  return findSourceRun(sourceRunId);
}

function sortOptimizationJobs(): void {
  state.optimizationJobs = [...state.optimizationJobs].sort((left, right) => {
    const leftTime = Date.parse(left.updated_at ?? left.completed_at ?? left.created_at ?? '');
    const rightTime = Date.parse(right.updated_at ?? right.completed_at ?? right.created_at ?? '');
    return rightTime - leftTime;
  });
}

function syncOptimizationJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
  const strategy = findStrategy(job.strategy_id);
  const normalized = hydrateOptimizationJob(strategy, job, getOptimizationSourceRun(job));
  const index = state.optimizationJobs.findIndex((item) => item.id === job.id);
  if (index >= 0) {
    state.optimizationJobs[index] = normalized;
  }
  return normalized;
}

function findJob(id: string): ApiOptimizationJobDetail {
  const job = state.optimizationJobs.find((item) => item.id === id);
  if (!job) {
    throw new ApiError({ status: 404, code: 'optimization_job_not_found', message: `Optimization job ${id} was not found.` });
  }
  return syncOptimizationJob(job);
}

function recalculateJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
  job.updated_at = nowIso();
  const normalized = syncOptimizationJob(job);
  sortOptimizationJobs();
  return normalized;
}

function isOptimizationInFlight(status: string | null | undefined): boolean {
  return ['QUEUED', 'RUNNING'].includes(String(status ?? '').toUpperCase());
}

function estimateCompletedAt(remainingMinutes: number | null): string | null {
  if (remainingMinutes === null) {
    return null;
  }
  if (remainingMinutes <= 0) {
    return nowIso();
  }
  return new Date(Date.now() + remainingMinutes * 60_000).toISOString();
}

function buildDemoOptimizationProgressPlan(): Array<{
  status: ApiOptimizationJobDetail['status'];
  progressPct: number;
  candidateCount: number;
  currentStage: string;
  estimatedRemainingMinutes: number | null;
  latestUpdate: string | ((candidate: ApiOptimizationCandidate | undefined) => string);
}> {
  return [
    {
      status: 'QUEUED',
      progressPct: 0,
      candidateCount: 0,
      currentStage: '任务已创建',
      estimatedRemainingMinutes: null,
      latestUpdate: '优化任务已创建，正在准备搜索队列。',
    },
    {
      status: 'RUNNING',
      progressPct: 16,
      candidateCount: 0,
      currentStage: '首轮搜索',
      estimatedRemainingMinutes: null,
      latestUpdate: '正在收集首轮组合表现，结果中心会自动刷新。',
    },
    {
      status: 'RUNNING',
      progressPct: 44,
      candidateCount: 1,
      currentStage: '候选生成',
      estimatedRemainingMinutes: 18,
      latestUpdate: (candidate) => `首个候选 ${candidate?.label ?? '已生成'} 已进入稳定性检查。`,
    },
    {
      status: 'RUNNING',
      progressPct: 68,
      candidateCount: 2,
      currentStage: '稳定性验证',
      estimatedRemainingMinutes: 11,
      latestUpdate: (candidate) => `正在扩大验证窗口，当前首位候选为 ${candidate?.label ?? '待更新'}。`,
    },
    {
      status: 'RUNNING',
      progressPct: 88,
      candidateCount: 3,
      currentStage: '热区扫描',
      estimatedRemainingMinutes: 5,
      latestUpdate: '参数热区和多窗口验证即将完成。',
    },
    {
      status: 'COMPLETED',
      progressPct: 100,
      candidateCount: 4,
      currentStage: '优化完成',
      estimatedRemainingMinutes: 0,
      latestUpdate: (candidate) => `优化已完成，当前首选为 ${candidate?.label ?? '最新候选'}。`,
    },
  ];
}

function countCompletedCombinations(budgetCombinations: number, progressPct: number, minimum = 0): number {
  if (budgetCombinations <= 0) {
    return 0;
  }
  const estimated = Math.round((budgetCombinations * Math.max(progressPct, 0)) / 100);
  const floor = progressPct > 0 ? 1 : 0;
  return Math.min(budgetCombinations, Math.max(minimum, floor, estimated));
}

function advanceOptimizationJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
  if (!isOptimizationInFlight(job.status)) {
    return syncOptimizationJob(job);
  }

  const stagePlan = buildDemoOptimizationProgressPlan();
  const currentStageIndex =
    typeof job.summary?.mock_progress_stage === 'number' && Number.isFinite(job.summary.mock_progress_stage)
      ? job.summary.mock_progress_stage
      : 0;
  const nextStageIndex = Math.min(currentStageIndex + 1, stagePlan.length - 1);
  const nextStage = stagePlan[nextStageIndex];
  const strategy = findStrategy(job.strategy_id);
  const sourceRun = getOptimizationSourceRun(job);
  const allCandidates = hydrateOptimizationJob(strategy, { ...clone(job), status: 'COMPLETED' }, sourceRun).candidates;
  const publishedCandidates = allCandidates.slice(0, nextStage.candidateCount);
  const budgetCombinations =
    typeof job.request?.budget_combinations === 'number'
      ? job.request.budget_combinations
      : typeof job.summary?.budget_combinations === 'number'
        ? job.summary.budget_combinations
        : 42;
  const leadingCandidate = publishedCandidates[0];
  const latestUpdate =
    typeof nextStage.latestUpdate === 'function'
      ? nextStage.latestUpdate(leadingCandidate)
      : nextStage.latestUpdate;
  const estimatedRemainingMinutes = nextStage.estimatedRemainingMinutes;
  const estimatedCompletedAt = estimateCompletedAt(estimatedRemainingMinutes);

  job.status = nextStage.status;
  job.candidates = publishedCandidates;
  job.updated_at = nowIso();
  job.completed_at = nextStage.status === 'COMPLETED' ? nowIso() : null;
  job.summary = {
    ...job.summary,
    mock_progress_stage: nextStageIndex,
    budget_combinations: budgetCombinations,
    completed_combinations: countCompletedCombinations(
      budgetCombinations,
      nextStage.progressPct,
      publishedCandidates.length,
    ),
    current_stage: nextStage.currentStage,
    latest_update: latestUpdate,
    latest_candidate_label: leadingCandidate?.label ?? null,
    progress_pct: nextStage.progressPct,
    estimated_remaining_minutes: estimatedRemainingMinutes,
    estimated_completed_at: estimatedCompletedAt,
  };
  job.result = {
    ...job.result,
    best_candidate_id: leadingCandidate?.id ?? null,
    best_candidate_label: leadingCandidate?.label ?? null,
    headline:
      leadingCandidate?.title ??
      (nextStage.status === 'COMPLETED' ? '优化结果已就绪' : '优化进行中'),
    summary: latestUpdate,
    status: nextStage.status,
    progress_pct: nextStage.progressPct,
    current_stage: nextStage.currentStage,
    latest_update: latestUpdate,
  };

  return recalculateJob(job);
}

function resumeOptimizationJob(job: ApiOptimizationJobDetail): ApiOptimizationJobDetail {
  if (job.status !== 'INTERRUPTED') {
    return syncOptimizationJob(job);
  }

  job.status = 'RUNNING';
  job.updated_at = nowIso();
  job.summary = {
    ...job.summary,
    status: 'RUNNING',
    current_stage: job.summary.current_stage ?? '断点恢复中',
    latest_update: '已继续优化，正在从断点恢复。',
    resume_ready: false,
    estimated_remaining_minutes: 12,
    estimated_completed_at: estimateCompletedAt(12),
  };
  job.result = {
    ...job.result,
    status: 'RUNNING',
    current_stage: job.summary.current_stage ?? job.result.current_stage ?? '断点恢复中',
    latest_update: '已继续优化，正在从断点恢复。',
  };
  return recalculateJob(job);
}

function promoteConflictKey(jobId: string, candidateId: string): string {
  return `${jobId}:${candidateId}`;
}

function toRunListItem(run: ApiBacktestRunDetail): ApiBacktestRunListItem {
  return {
    id: run.id,
    strategy_id: run.strategy_id ?? 'strat-001',
    strategy_name: run.strategy_name,
    status: run.status,
    created_at: run.created_at ?? nowIso(),
    updated_at: run.updated_at ?? run.completed_at ?? nowIso(),
    completed_at: run.completed_at ?? null,
    metrics: clone(run.metrics ?? {}),
    warnings: clone(run.warnings ?? []),
    preview: run.preview ? clone(run.preview) : undefined,
    data_segment_type: run.data_segment_type,
    parameter_version_id: run.parameter_version_id ?? null,
    is_permanent: run.is_permanent,
    source_run_id: run.source_run_id ?? null,
    trades_count: run.trades_count,
  };
}

function buildSnapshotOverview(
  refreshedAt = '2026-04-01T07:48:00Z',
  mode: 'incremental' | 'repair' | 'full' = 'incremental',
): ApiSnapshotOverview {
  return {
    overall_status: 'INCOMPLETE',
    last_refreshed_at: refreshedAt,
    dataset_snapshots: [
      {
        id: 'ds-corporate-actions',
        name: '公司行为快照',
        status: 'INCOMPLETE',
        as_of: refreshedAt,
        freshness_label: '最新数据可用',
        start_date: '1996-01-01',
        end_date: '2026-04-01',
        row_count: 182430,
        source: 'tiingo',
        fallback_source: 'alpha_vantage',
        blocker: {
          code: 'CORPORATE_ACTIONS_INCOMPLETE',
          message: '公司行为快照仍有缺口，正式回测前需要先补齐。',
        },
      },
      {
        id: 'ds-price',
        name: '价格条快照',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '最新数据可用',
        start_date: '1996-01-01',
        end_date: '2026-04-01',
        row_count: 4320,
        source: 'yahoo',
        fallback_source: 'sec_edgar',
        blocker: null,
      },
    ],
    universe_snapshots: [
      {
        id: 'un-sp500',
        name: 'SP500',
        status: 'INCOMPLETE',
        as_of: refreshedAt,
        freshness_label: '历史锚点待补齐 (38/61)',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 502,
        source: 'official_announcement',
        fallback_source: 'wikipedia_revision_history',
        blocker: {
          code: 'UNIVERSE_HISTORY_INCOMPLETE',
          message: '指数成员历史仍有缺口，正式回测会继续受限。',
        },
      },
      {
        id: 'un-ndx100',
        name: 'NASDAQ100',
        status: 'INCOMPLETE',
        as_of: refreshedAt,
        freshness_label: '历史锚点待补齐 (14/61)',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 101,
        source: 'nasdaq_official_annual_changes',
        fallback_source: 'wikipedia_revision_history',
        blocker: {
          code: 'UNIVERSE_HISTORY_INCOMPLETE',
          message: 'NASDAQ100 历史锚点仍在补齐中。',
        },
      },
    ],
    latest_job: {
      id: 'snap-job-20260401',
      status: 'COMPLETED',
      started_at: '2026-04-01T07:30:00Z',
      completed_at: refreshedAt,
      request: {
        mode,
        targets: ['price', 'corporate', 'universes'],
      },
      summary: {
        dataset_snapshot_count: 2,
        universe_snapshot_count: 2,
        status: 'INCOMPLETE',
        mode,
      },
      warnings: [],
      errors: [],
    },
    blocking_code: 'CORPORATE_ACTIONS_INCOMPLETE',
    blocking_target: 'ds-corporate-actions',
    message: '部分快照仍待补齐，正式回测前请先完成刷新。',
    allowed_actions: ['refresh_snapshots'],
  };
}

export function resetDemoStore(): void {
  state = createInitialState();
}

export function setPromoteConflict(jobId: string, candidateId: string): void {
  state.promoteConflicts.add(promoteConflictKey(jobId, candidateId));
}

export function getLosingCandidateIds(jobId: string): string[] {
  return findJob(jobId)
    .candidates.filter((candidate) =>
      typeof candidate.metrics.total_return === 'number' ? candidate.metrics.total_return < 0 : candidate.score < 0,
    )
    .map((candidate) => candidate.id);
}

export const demoApi: DemoApi = {
  async getWorkspaceOverview(includeCleanupAudit = false, _signal?: AbortSignal): Promise<ApiWorkspaceOverview> {
    state.optimizationJobs.forEach((job) => {
      syncOptimizationJob(job);
    });
    sortOptimizationJobs();

    const overview: ApiWorkspaceOverview = {
      workspace_name: 'Grit Strategy Lab',
      subtitle: 'Creation, backtest, and optimization workspace for local strategy recovery.',
      strategy_count: state.strategies.length,
      active_run_count: 1,
      running_optimization_count: state.optimizationJobs.filter((job) => ['QUEUED', 'RUNNING'].includes(job.status)).length,
      latest_strategy_id: state.strategies[0]?.id ?? null,
      latest_backtest_run_id: state.runs[0]?.id ?? null,
      latest_optimization_job_id: state.optimizationJobs[0]?.id ?? null,
      top_momentum_warning: 'Refresh snapshots before trusting any newly materialized momentum strategy.',
      quick_actions: ['open_creation', 'start_backtest', 'open_optimization'],
    };

    if (includeCleanupAudit) {
      overview.last_cleanup_count = 3;
    }
    return clone(overview);
  },
  async listStrategies(_signal?: AbortSignal): Promise<ApiStrategyListItem[]> {
    return clone(state.strategies);
  },
  async getStrategyDetail(id: string): Promise<ApiStrategyDetail> {
    return clone(findStrategy(id));
  },
  async getCreationSession(id: string): Promise<ApiStrategyCreationSession> {
    const existing = state.sessions.find((session) => session.id === id);
    if (!existing) {
      throw new ApiError({ status: 404, code: 'session_not_found', message: `Session ${id} was not found.` });
    }
    return clone(existing);
  },
  async createCreationSession(payload): Promise<ApiStrategyCreationSession> {
    const session: ApiStrategyCreationSession = {
      id: nextId('cs'),
      status: 'DRAFTING',
      revision: 1,
      messages: [],
      mode: 'CREATE',
      base_strategy_id: null,
      base_parameter_version_id: null,
      ...payload,
    };
    state.sessions.unshift(session);
    return clone(session);
  },
  async appendCreationMessage(id: string, content: string, revision = 1): Promise<ApiStrategyCreationSession> {
    const session = await this.getCreationSession(id);
    const updated = {
      ...session,
      revision: Math.max(session.revision ?? 1, revision + 1),
      messages: [...(session.messages ?? []), { content }],
      status: 'NEEDS_INPUT',
    };
    state.sessions = state.sessions.map((item) => (item.id === id ? updated : item));
    return clone(updated);
  },
  async prepareConfirmation(id: string): Promise<ApiStrategyCreationSession> {
    return this.getCreationSession(id);
  },
  async updateConfirmation(id: string, payload: ApiConfirmationUpdateRequest): Promise<ApiStrategyCreationSession> {
    const session = await this.getCreationSession(id);
    const updated = { ...session, revision: payload.revision + 1, status: 'READY_TO_MATERIALIZE' };
    state.sessions = state.sessions.map((item) => (item.id === id ? updated : item));
    return clone(updated);
  },
  async materializeStrategy(): Promise<ApiStrategyDetail> {
    return clone(state.strategies[0]);
  },
  async listBacktestRuns(params, _signal?: AbortSignal): Promise<ApiBacktestRunListItem[]> {
    const filtered = params?.status ? state.runs.filter((run) => run.status === params.status) : state.runs;
    const limit = params?.limit ?? filtered.length;
    return clone(filtered.slice(0, limit).map(toRunListItem));
  },
  async getBacktestRunDetail(
    id: string,
    _options?: BacktestRunDetailRequest | AbortSignal,
  ): Promise<ApiBacktestRunDetail> {
    return clone(findRun(id));
  },
  async saveBacktestRun(id: string): Promise<ApiBacktestRunDetail> {
    const run = findRun(id);
    run.is_permanent = true;
    return clone(run);
  },
  async deleteBacktestRun(id: string): Promise<ApiBacktestRunDeleteResult> {
    const run = findRun(id);
    if (run.status === 'QUEUED' || run.status === 'RUNNING') {
      throw new ApiError({ status: 409, code: 'backtest_run_delete_active', message: '进行中的回测暂不支持删除。' });
    }
    state.runs = state.runs.filter((item) => item.id !== id);
    return { id, deleted_at: nowIso(), deleted_reason: 'manual_delete' };
  },
  async getBacktestRunTrades(id: string, params): Promise<ApiBacktestRunTradePage> {
    const run = findRun(id);
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.max(1, params?.page_size ?? 50);
    const segment = (params?.segment ?? 'all').toUpperCase();
    const allRows = (run.trade_audit_items ?? [])
      .filter((item) => segment === 'ALL' || item.segment === segment)
      .map((item) => ({
        trade_time: item.opened_at,
        symbol: item.symbol,
        side: item.pnl_pct >= 0 ? 'BUY' : 'SELL',
        quantity: 1,
        price: item.pnl_pct,
        segment: item.segment,
      }));
    const start = (page - 1) * pageSize;
    return {
      items: clone(allRows.slice(start, start + pageSize)),
      page,
      page_size: pageSize,
      total: allRows.length,
      total_pages: Math.max(1, Math.ceil(allRows.length / pageSize)),
    };
  },
  async getBacktestTradeAudit(runId: string, tradeId: string): Promise<ApiBacktestRunTradeAudit> {
    const tradeAudit = state.tradeAudits[runId]?.[tradeId];
    if (!tradeAudit) {
      throw new ApiError({ status: 404, code: 'trade_audit_not_found', message: `Trade audit ${tradeId} was not found.` });
    }
    return clone(tradeAudit);
  },
  async previewBacktestRun(): Promise<ApiBacktestSubmissionPreview> {
    return {
      warnings: [],
      effective_start_date: '2025-01-02',
      effective_end_date: '2025-02-28',
      data_segment_type: 'FULL',
    };
  },
  async submitBacktestRun(): Promise<ApiBacktestRunDetail> {
    return clone(state.runs[0]);
  },
  async cloneBacktestRun(id: string): Promise<ApiBacktestRunDetail> {
    const source = findRun(id);
    const cloneRun: ApiBacktestRunDetail = {
      ...clone(source),
      id: nextId('bt'),
      status: 'COMPLETED',
      is_permanent: false,
      source_run_id: source.id,
    };
    state.runs.unshift(cloneRun);
    return clone(cloneRun);
  },
  async listOptimizationJobs(): Promise<ApiOptimizationJobListItem[]> {
    state.optimizationJobs.forEach((job) => {
      if (isOptimizationInFlight(job.status)) {
        advanceOptimizationJob(job);
        return;
      }
      syncOptimizationJob(job);
    });
    sortOptimizationJobs();
    return clone(
      state.optimizationJobs.map((job) => buildOptimizationJobListItem(findStrategy(job.strategy_id), job)),
    );
  },
  async getOptimizationJobDetail(id: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(id);
    return clone(isOptimizationInFlight(job.status) ? advanceOptimizationJob(job) : job);
  },
  async deleteOptimizationJob(id: string) {
    const job = findJob(id);
    const deletedAt = nowIso();
    state.optimizationJobs = state.optimizationJobs.filter((item) => item.id !== id);
    sortOptimizationJobs();
    const strategy = findStrategy(job.strategy_id);
    strategy.latest_optimization_job_id =
      state.optimizationJobs.find((item) => item.strategy_id === strategy.id)?.id ?? null;
    return {
      id,
      deleted_at: deletedAt,
      deleted_reason: 'user_deleted',
    };
  },
  async createOptimizationJob(strategyId: string, payload?: ApiOptimizationJobCreatePayload): Promise<ApiOptimizationJobDetail> {
    const strategy = findStrategy(strategyId);
    const job: ApiOptimizationJobDetail = {
      id: nextId('opt'),
      strategy_id: strategyId,
      status: 'QUEUED',
      request: {
        objective: payload?.objective ?? 'sharpe',
        base_parameter_version_id: payload?.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
        source_run_id: payload?.source_run_id ?? null,
        entry_point: payload?.entry_point ?? (payload?.source_run_id ? 'run_detail' : 'lab_menu'),
        validation_mode: payload?.validation_mode ?? 'walk_forward',
        budget_combinations: payload?.budget_combinations ?? 42,
        search_space: clone(payload?.search_space ?? []),
      },
      summary: {
        objective: payload?.objective ?? 'sharpe',
        candidate_count: 0,
        baseline_parameter_version_id: payload?.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
        budget_combinations: payload?.budget_combinations ?? 42,
        completed_combinations: 0,
        progress_pct: 0,
        current_stage: '任务已创建',
        latest_update: '优化任务已创建，正在准备搜索队列。',
        estimated_remaining_minutes: null,
        estimated_completed_at: null,
        mock_progress_stage: 0,
      },
      result: {
        best_candidate_id: null,
        baseline_parameter_version_id: payload?.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
        headline: '优化进行中',
        summary: '优化任务已创建，正在准备搜索队列。',
        status: 'QUEUED',
        progress_pct: 0,
        current_stage: '任务已创建',
        latest_update: '优化任务已创建，正在准备搜索队列。',
      },
      candidates: [],
      base_parameter_version_id: payload?.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: null,
    };
    state.optimizationJobs.unshift(job);
    strategy.latest_optimization_job_id = job.id;
    return clone(recalculateJob(job));
  },
  async resumeOptimizationJob(jobId: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const resumed = resumeOptimizationJob(job);
    return clone(resumed);
  },
  async createOptimizationCandidate(jobId: string, payload: CreateCandidatePayload): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const nextRank = job.candidates.length + 1;
    job.candidates.push(
      createCandidate(
        strategy,
        {
          label: payload.label ?? `候选 ${nextRank}`,
          summary: payload.summary ?? '新增候选已进入当前任务，可继续比较稳定性和参数热区。',
          parameter_snapshot: payload.parameter_snapshot,
          metrics: payload.metrics ?? { total_return: 3.8, sharpe: 0.84 },
          base_parameter_version_id: payload.base_parameter_version_id ?? job.base_parameter_version_id ?? null,
          score:
            typeof payload.metrics?.total_return === 'number'
              ? Number((payload.metrics.total_return / 10).toFixed(2))
              : 0.5,
        },
        nextRank,
      ),
    );
    return clone(recalculateJob(job));
  },
  async promoteOptimizationCandidate(jobId: string, trialId: string, mode: PromoteMode, _idempotencyKey: string, comment?: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const candidate = job.candidates.find((item) => item.id === trialId);
    if (!candidate) {
      throw new ApiError({ status: 404, code: 'optimization_candidate_not_found', message: `Candidate ${trialId} was not found.` });
    }
    if (state.promoteConflicts.has(promoteConflictKey(jobId, trialId))) {
      throw new ApiError({
        status: 409,
        code: 'stale_base_parameter_version',
        message: 'The strategy has moved to a newer parameter version.',
        blocking_code: 'stale_base_parameter_version',
        blocking_target: { type: 'strategy', id: strategy.id },
        next_action: 'refresh_strategy_detail',
      });
    }

    if (mode === 'set_current') {
      strategy.parameters = clone(candidate.parameter_snapshot);
      strategy.current_parameter_version = (strategy.current_parameter_version ?? 1) + 1;
      strategy.current_parameter_version_id = `${strategy.id}-v${strategy.current_parameter_version}`;
      strategy.name = formatVersionedStrategyName(strategy.name, strategy.current_parameter_version);
      strategy.latest_optimization_job_id = job.id;
      strategy.parameter_history = [
        {
          version_number: strategy.current_parameter_version,
          parameter_version_id: strategy.current_parameter_version_id,
          revision: strategy.current_parameter_version,
          created_at: nowIso(),
          comment: comment ?? null,
          parameters: clone(candidate.parameter_snapshot),
        },
        ...strategy.parameter_history,
      ];
      job.base_parameter_version_id = strategy.current_parameter_version_id;
      job.request.base_parameter_version_id = strategy.current_parameter_version_id;
      job.summary.baseline_parameter_version_id = strategy.current_parameter_version_id;
      job.result.baseline_parameter_version_id = strategy.current_parameter_version_id;
      job.candidates = job.candidates.map((item) => ({
        ...item,
        base_parameter_version_id: strategy.current_parameter_version_id,
      }));
    }

    return clone(recalculateJob(job));
  },
  async deleteOptimizationCandidate(jobId: string, trialId: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    job.candidates = job.candidates.filter((candidate) => candidate.id !== trialId);
    return clone(recalculateJob(job));
  },
  async getSnapshotOverview(): Promise<ApiSnapshotOverview> {
    return buildSnapshotOverview();
  },
  async refreshSnapshots(payload): Promise<ApiSnapshotOverview> {
    return buildSnapshotOverview('2026-04-01T10:00:00Z', payload?.mode ?? 'incremental');
  },
};
