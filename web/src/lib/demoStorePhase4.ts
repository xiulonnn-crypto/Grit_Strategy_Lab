import {
  ApiError,
  type ApiBacktestRunDetail,
  type ApiBacktestRunListItem,
  type ApiBacktestRunTradeAudit,
  type ApiBacktestRunTradePage,
  type ApiBacktestSubmissionPreview,
  type ApiConfirmationUpdateRequest,
  type ApiOptimizationJobDetail,
  type ApiSnapshotOverview,
  type ApiStrategyCreationSession,
  type ApiStrategyDetail,
  type ApiStrategyListItem,
  type ApiWorkspaceOverview,
  type CreateCandidatePayload,
  type DemoApi,
  type PromoteMode,
} from '../types';
import { createInitialState } from './demoStoreSeed';
import { clone, createCandidate, nextId, nowIso } from './demoStoreShared';

let state = createInitialState();

function findStrategy(id: string): ApiStrategyDetail {
  const strategy = state.strategies.find((item) => item.id === id);
  if (!strategy) throw new ApiError({ status: 404, code: 'strategy_not_found', message: `Strategy ${id} was not found.` });
  return strategy;
}

function findJob(id: string): ApiOptimizationJobDetail {
  const job = state.optimizationJobs.find((item) => item.id === id);
  if (!job) throw new ApiError({ status: 404, code: 'optimization_job_not_found', message: `Optimization job ${id} was not found.` });
  return job;
}

function findRun(id: string): ApiBacktestRunDetail {
  const run = state.runs.find((item) => item.id === id);
  if (!run) throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
  return run;
}

function recalculateJob(job: ApiOptimizationJobDetail): void {
  job.candidates = [...job.candidates].sort((left, right) => left.rank - right.rank || right.score - left.score).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  job.summary.candidate_count = job.candidates.length;
  job.result.best_candidate_id = job.candidates[0]?.id ?? null;
  job.updated_at = nowIso();
}

function promoteConflictKey(jobId: string, candidateId: string): string {
  return `${jobId}:${candidateId}`;
}

export function resetDemoStore(): void {
  state = createInitialState();
}

export function setPromoteConflict(jobId: string, candidateId: string): void {
  state.promoteConflicts.add(promoteConflictKey(jobId, candidateId));
}

export function getLosingCandidateIds(jobId: string): string[] {
  return findJob(jobId).candidates.filter((candidate) => typeof candidate.metrics.total_return === 'number' ? candidate.metrics.total_return < 0 : candidate.score < 0).map((candidate) => candidate.id);
}

function createSnapshotOverview(refreshedAt = '2026-04-01T07:48:00Z'): ApiSnapshotOverview {
  return {
    overall_status: 'READY',
    last_refreshed_at: refreshedAt,
    dataset_snapshots: [
      {
        id: 'dataset-corporate-actions',
        name: '公司行为数据',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
        start_date: '1996-01-01',
        end_date: '2026-04-01',
        row_count: 182430,
        source: 'Yahoo',
        fallback_source: 'fallback unavailable',
        blocker: null,
      },
      {
        id: 'dataset-price-bars',
        name: '股票价格数据',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
        start_date: '1996-01-01',
        end_date: '2026-04-01',
        row_count: 4320,
        source: 'Yahoo',
        fallback_source: 'fallback unavailable',
        blocker: null,
      },
    ],
    universe_snapshots: [
      {
        id: 'universe-sp500',
        name: '标普500',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 500,
        source: 'Yahoo',
        fallback_source: '本地冷备',
        blocker: null,
      },
      {
        id: 'universe-nasdaq100',
        name: '纳指100',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 100,
        source: 'Yahoo',
        fallback_source: '本地冷备',
        blocker: null,
      },
    ],
    latest_job: {
      id: 'snap-job-20260401',
      status: 'COMPLETED',
      started_at: '2026-04-01T07:30:00Z',
      completed_at: refreshedAt,
      summary: {
        dataset_snapshot_count: 2,
        universe_snapshot_count: 2,
      },
      warnings: [],
      errors: [],
    },
    blocking_code: null,
    blocking_target: null,
    message: '这里会集中展示价格数据、公司行为和股票池的最新状态。',
    allowed_actions: ['refresh_snapshots'],
  };
}

function buildCleanSnapshotOverview(
  refreshedAt = '2026-04-01T07:48:00Z',
  mode: 'incremental' | 'repair' | 'full' = 'incremental',
): ApiSnapshotOverview {
  return {
    overall_status: 'INCOMPLETE',
    last_refreshed_at: refreshedAt,
    dataset_snapshots: [
      {
        id: 'ds-corporate-actions',
        name: '公司行为数据',
        status: 'INCOMPLETE',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
        start_date: '1996-01-01',
        end_date: '2026-04-01',
        row_count: 182430,
        source: 'tiingo',
        fallback_source: 'alpha_vantage',
        blocker: {
          code: 'CORPORATE_ACTIONS_INCOMPLETE',
          message: '公司行为数据部分可用，正式回测仍会受限。',
        },
      },
      {
        id: 'ds-price',
        name: '股票价格数据',
        status: 'READY',
        as_of: refreshedAt,
        freshness_label: '刚刚刷新',
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
        name: '标普500',
        status: 'INCOMPLETE',
        as_of: refreshedAt,
        freshness_label: '历史锚点补齐中 (38/61)',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 502,
        source: 'official_announcement',
        fallback_source: 'wikipedia_revision_history',
        blocker: {
          code: 'UNIVERSE_HISTORY_INCOMPLETE',
          message: '股票池历史成分仍在补齐，当前还不能视为完整的点时成分快照。',
        },
      },
      {
        id: 'un-ndx100',
        name: '纳指100',
        status: 'INCOMPLETE',
        as_of: refreshedAt,
        freshness_label: '历史锚点补齐中 (14/61)',
        window_start: '1996-01-01',
        window_end: '2026-04-01',
        anchor_schedule: '01-01 / 07-01',
        member_count: 101,
        source: 'nasdaq_official_annual_changes',
        fallback_source: 'wikipedia_revision_history',
        blocker: {
          code: 'UNIVERSE_HISTORY_INCOMPLETE',
          message: '股票池历史成分仍在补齐，当前还不能视为完整的点时成分快照。',
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
    message: '当前已有可用数据，但还不是完整正式快照。',
    allowed_actions: ['refresh_snapshots'],
  };
}

export const demoApi: DemoApi = {
  async getWorkspaceOverview(includeCleanupAudit = false): Promise<ApiWorkspaceOverview> {
    const overview: ApiWorkspaceOverview = {
      workspace_name: 'Grit Strategy Lab',
      subtitle: 'Creation, backtest, and optimization workspace for local strategy recovery.',
      strategy_count: state.strategies.length,
      active_run_count: 1,
      running_optimization_count: 1,
      latest_strategy_id: state.strategies[0]?.id ?? null,
      latest_backtest_run_id: state.runs[0]?.id ?? null,
      latest_optimization_job_id: state.optimizationJobs[0]?.id ?? null,
      top_momentum_warning: 'Refresh snapshots before trusting any newly materialized momentum strategy.',
      quick_actions: ['open_creation', 'start_backtest', 'open_optimization'],
    };
    if (includeCleanupAudit) overview.last_cleanup_count = 3;
    return clone(overview);
  },
  async listStrategies(): Promise<ApiStrategyListItem[]> { return clone(state.strategies); },
  async getStrategyDetail(id: string): Promise<ApiStrategyDetail> { return clone(findStrategy(id)); },
  async getCreationSession(id: string): Promise<ApiStrategyCreationSession> {
    const existing = state.sessions.find((session) => session.id === id);
    if (!existing) throw new ApiError({ status: 404, code: 'session_not_found', message: `Session ${id} was not found.` });
    return clone(existing);
  },
  async createCreationSession(payload): Promise<ApiStrategyCreationSession> {
    const session: ApiStrategyCreationSession = { id: nextId('cs'), status: 'DRAFTING', revision: 1, messages: [], mode: 'CREATE', base_strategy_id: null, base_parameter_version_id: null, ...payload };
    state.sessions.unshift(session);
    return clone(session);
  },
  async appendCreationMessage(id: string, content: string, revision = 1): Promise<ApiStrategyCreationSession> {
    const session = await this.getCreationSession(id);
    const updated = { ...session, revision: Math.max(session.revision ?? 1, revision + 1), messages: [...(session.messages ?? []), { content }], status: 'NEEDS_INPUT' };
    state.sessions = state.sessions.map((item) => item.id === id ? updated : item);
    return clone(updated);
  },
  async prepareConfirmation(id: string): Promise<ApiStrategyCreationSession> { return this.getCreationSession(id); },
  async updateConfirmation(id: string, payload: ApiConfirmationUpdateRequest): Promise<ApiStrategyCreationSession> {
    const session = await this.getCreationSession(id);
    const updated = { ...session, revision: payload.revision + 1, status: 'READY_TO_MATERIALIZE' };
    state.sessions = state.sessions.map((item) => item.id === id ? updated : item);
    return clone(updated);
  },
  async materializeStrategy(): Promise<ApiStrategyDetail> { return clone(state.strategies[0]); },
  async listBacktestRuns(params): Promise<ApiBacktestRunListItem[]> {
    const filtered = params?.status ? state.runs.filter((run) => run.status === params.status) : state.runs;
    const limit = params?.limit ?? filtered.length;
    return clone(filtered.slice(0, limit).map((run) => ({ id: run.id, strategy_id: run.strategy_id ?? 'strat-001', status: run.status, created_at: nowIso() })));
  },
  async getBacktestRunDetail(id: string): Promise<ApiBacktestRunDetail> { return clone(findRun(id)); },
  async getBacktestRunTrades(id: string, params): Promise<ApiBacktestRunTradePage> {
    const run = findRun(id);
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.max(1, params?.page_size ?? 50);
    const segment = (params?.segment ?? 'all').toUpperCase();
    const allRows = (run.trade_audit_items ?? []).filter((item) => segment === 'ALL' || item.segment === segment).map((item) => ({ trade_time: item.opened_at, symbol: item.symbol, side: item.pnl_pct >= 0 ? 'BUY' : 'SELL', quantity: 1, price: item.pnl_pct, segment: item.segment }));
    const start = (page - 1) * pageSize;
    return { items: clone(allRows.slice(start, start + pageSize)), page, page_size: pageSize, total: allRows.length, total_pages: Math.max(1, Math.ceil(allRows.length / pageSize)) };
  },
  async getBacktestTradeAudit(runId: string, tradeId: string): Promise<ApiBacktestRunTradeAudit> {
    const tradeAudit = state.tradeAudits[runId]?.[tradeId];
    if (!tradeAudit) throw new ApiError({ status: 404, code: 'trade_audit_not_found', message: `Trade audit ${tradeId} was not found.` });
    return clone(tradeAudit);
  },
  async previewBacktestRun(): Promise<ApiBacktestSubmissionPreview> { return { warnings: [], effective_start_date: '2025-01-02', effective_end_date: '2025-02-28', data_segment_type: 'FULL' }; },
  async submitBacktestRun(): Promise<ApiBacktestRunDetail> { return clone(state.runs[0]); },
  async cloneBacktestRun(id: string): Promise<ApiBacktestRunDetail> {
    const source = findRun(id);
    const cloneRun: ApiBacktestRunDetail = { ...clone(source), id: nextId('bt'), status: 'COMPLETED', is_permanent: false, source_run_id: source.id };
    state.runs.unshift(cloneRun);
    return clone(cloneRun);
  },
  async getOptimizationJobDetail(id: string): Promise<ApiOptimizationJobDetail> { return clone(findJob(id)); },
  async createOptimizationJob(strategyId: string): Promise<ApiOptimizationJobDetail> {
    const strategy = findStrategy(strategyId);
    const job: ApiOptimizationJobDetail = { id: nextId('opt'), strategy_id: strategyId, status: 'COMPLETED', request: { objective: 'sharpe', base_parameter_version_id: strategy.current_parameter_version_id }, summary: { objective: 'sharpe', candidate_count: 0, baseline_parameter_version_id: strategy.current_parameter_version_id }, result: { best_candidate_id: null, baseline_parameter_version_id: strategy.current_parameter_version_id }, candidates: [], base_parameter_version_id: strategy.current_parameter_version_id, created_at: nowIso(), updated_at: nowIso(), completed_at: nowIso() };
    state.optimizationJobs.unshift(job);
    strategy.latest_optimization_job_id = job.id;
    return clone(job);
  },
  async createOptimizationCandidate(jobId: string, payload: CreateCandidatePayload): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const nextRank = job.candidates.length + 1;
    job.candidates.push(createCandidate(strategy, { label: payload.label ?? `Manual Candidate ${nextRank}`, summary: payload.summary ?? 'Created directly from the recovered manual lab.', parameter_snapshot: payload.parameter_snapshot, metrics: payload.metrics ?? { total_return: 3.8, sharpe: 0.84 }, base_parameter_version_id: payload.base_parameter_version_id ?? job.base_parameter_version_id ?? null, score: typeof payload.metrics?.total_return === 'number' ? Number((payload.metrics.total_return / 10).toFixed(2)) : 0.5 }, nextRank));
    recalculateJob(job);
    return clone(job);
  },
  async promoteOptimizationCandidate(jobId: string, trialId: string, mode: PromoteMode, _idempotencyKey: string, comment?: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const candidate = job.candidates.find((item) => item.id === trialId);
    if (!candidate) throw new ApiError({ status: 404, code: 'optimization_candidate_not_found', message: `Candidate ${trialId} was not found.` });
    if (state.promoteConflicts.has(promoteConflictKey(jobId, trialId))) {
      throw new ApiError({ status: 409, code: 'stale_base_parameter_version', message: 'The strategy has moved to a newer parameter version.', blocking_code: 'stale_base_parameter_version', blocking_target: { type: 'strategy', id: strategy.id }, next_action: 'refresh_strategy_detail' });
    }
    if (mode === 'set_current') {
      strategy.parameters = clone(candidate.parameter_snapshot);
      strategy.current_parameter_version = (strategy.current_parameter_version ?? 1) + 1;
      strategy.current_parameter_version_id = `${strategy.id}-v${strategy.current_parameter_version}`;
      strategy.parameter_history = [{ version_number: strategy.current_parameter_version, parameter_version_id: strategy.current_parameter_version_id, revision: strategy.current_parameter_version, created_at: nowIso(), comment: comment ?? null, parameters: clone(candidate.parameter_snapshot) }, ...strategy.parameter_history];
      job.base_parameter_version_id = strategy.current_parameter_version_id;
      job.request.base_parameter_version_id = strategy.current_parameter_version_id;
      job.summary.baseline_parameter_version_id = strategy.current_parameter_version_id;
      job.result.baseline_parameter_version_id = strategy.current_parameter_version_id;
      job.candidates = job.candidates.map((item) => ({ ...item, base_parameter_version_id: strategy.current_parameter_version_id }));
      recalculateJob(job);
    }
    return clone(job);
  },
  async deleteOptimizationCandidate(jobId: string, trialId: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    job.candidates = job.candidates.filter((candidate) => candidate.id !== trialId);
    recalculateJob(job);
    return clone(job);
  },
  async getSnapshotOverview(): Promise<ApiSnapshotOverview> { return buildCleanSnapshotOverview(); },
  async refreshSnapshots(payload): Promise<ApiSnapshotOverview> {
    return buildCleanSnapshotOverview('2026-04-01T10:00:00Z', payload?.mode ?? 'incremental');
  },
};
