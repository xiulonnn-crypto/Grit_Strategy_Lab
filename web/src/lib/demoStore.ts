import {
  ApiError,
  type ApiBacktestRunDetail,
  type ApiBacktestRunListItem,
  type ApiBacktestRunTradePage,
  type ApiBacktestSubmissionPreview,
  type ApiConfirmationUpdateRequest,
  type ApiOptimizationCandidate,
  type ApiOptimizationJobDetail,
  type ApiSnapshotOverview,
  type ApiStrategyCreationSession,
  type ApiStrategyDetail,
  type ApiStrategyListItem,
  type ApiWorkspaceOverview,
  type CreateCandidatePayload,
  type DemoApi,
  type ParameterValue,
  type PromoteMode,
} from '../types';
import { buildParameterDiffRows } from './adapters';

type DemoState = {
  strategies: ApiStrategyDetail[];
  optimizationJobs: ApiOptimizationJobDetail[];
  sessions: ApiStrategyCreationSession[];
  runs: ApiBacktestRunDetail[];
  promoteConflicts: Set<string>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date('2026-03-30T09:00:00.000Z').toISOString();
}

function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

function createStrategy(overrides: Partial<ApiStrategyDetail>): ApiStrategyDetail {
  const id = overrides.id ?? nextId('strat');
  const parameterVersion = overrides.current_parameter_version ?? 2;
  return {
    id,
    name: overrides.name ?? 'Quality Momentum',
    description: overrides.description ?? 'Recovered strategy detail',
    strategy_type: overrides.strategy_type ?? 'MOMENTUM',
    universe_name: overrides.universe_name ?? 'SPY',
    rebalance_frequency: overrides.rebalance_frequency ?? 'monthly',
    lifecycle_status: overrides.lifecycle_status ?? 'ACTIVE',
    latest_run_id: overrides.latest_run_id ?? 'bt-001',
    latest_optimization_job_id: overrides.latest_optimization_job_id ?? 'opt-001',
    current_parameter_version: parameterVersion,
    current_parameter_version_id: overrides.current_parameter_version_id ?? `${id}-v${parameterVersion}`,
    parameters: overrides.parameters ?? {
      lookback_months: 6,
      skip_recent_months: 1,
      top_n: 5,
      weighting_method: 'equal_weight',
    },
    parameter_history: overrides.parameter_history ?? [
      {
        version_number: parameterVersion,
        parameter_version_id: overrides.current_parameter_version_id ?? `${id}-v${parameterVersion}`,
        revision: parameterVersion,
        created_at: nowIso(),
        parameters: overrides.parameters ?? {
          lookback_months: 6,
          skip_recent_months: 1,
          top_n: 5,
          weighting_method: 'equal_weight',
        },
      },
    ],
    confirmation_fields: overrides.confirmation_fields ?? {},
    allowed_actions: overrides.allowed_actions ?? ['run_backtest', 'open_optimization'],
    benchmark_symbol: overrides.benchmark_symbol ?? 'SPY',
  };
}

function createCandidate(
  strategy: ApiStrategyDetail,
  overrides: Partial<ApiOptimizationCandidate> = {},
  rank = 1,
): ApiOptimizationCandidate {
  const snapshot = overrides.parameter_snapshot ?? {
    ...strategy.parameters,
    top_n: Number(strategy.parameters?.top_n ?? 5) + rank,
  };
  return {
    id: overrides.id ?? nextId('trial'),
    label: overrides.label ?? `Candidate ${rank}`,
    summary: overrides.summary ?? 'Recovered optimization candidate',
    status: overrides.status ?? 'SUCCEEDED',
    rank,
    score: overrides.score ?? 0.67 + rank / 100,
    parameter_snapshot: snapshot,
    parameter_delta: overrides.parameter_delta ?? Object.fromEntries(buildParameterDiffRows(strategy.parameters ?? {}, snapshot).map((row) => [row.key, row.nextValue ?? null])),
    metrics: overrides.metrics ?? { sharpe: 1.1 + rank / 10 },
    base_parameter_version_id: overrides.base_parameter_version_id ?? strategy.current_parameter_version_id ?? null,
  };
}

function createInitialState(): DemoState {
  const strategies = [
    createStrategy({
      id: 'strat-001',
      name: 'Quality Momentum',
      latest_optimization_job_id: 'opt-001',
    }),
    createStrategy({
      id: 'strat-002',
      name: 'Low Vol Rotation',
      latest_optimization_job_id: null,
      parameters: {
        lookback_months: 3,
        skip_recent_months: 1,
        top_n: 2,
        weighting_method: 'risk_parity',
      },
    }),
  ];
  const optimizationJobs: ApiOptimizationJobDetail[] = [
    {
      id: 'opt-001',
      strategy_id: 'strat-001',
      status: 'COMPLETED',
      request: {
        objective: 'sharpe',
        base_parameter_version_id: strategies[0].current_parameter_version_id,
      },
      summary: {
        objective: 'sharpe',
        candidate_count: 2,
        baseline_parameter_version_id: strategies[0].current_parameter_version_id,
      },
      result: {
        best_candidate_id: 'trial-001',
        baseline_parameter_version_id: strategies[0].current_parameter_version_id,
      },
      candidates: [
        createCandidate(strategies[0], { id: 'trial-001', label: 'Baseline + 1' }, 1),
        createCandidate(
          strategies[0],
          {
            id: 'trial-002',
            label: 'Diff Only Candidate',
            parameter_snapshot: {
              ...strategies[0].parameters,
              top_n: 8,
              lookback_months: 12,
            },
          },
          2,
        ),
      ],
      base_parameter_version_id: strategies[0].current_parameter_version_id,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: nowIso(),
    },
  ];

  return {
    strategies,
    optimizationJobs,
    sessions: [],
    runs: [
      {
        id: 'bt-001',
        strategy_id: 'strat-001',
        status: 'COMPLETED_WITH_WARNINGS',
        metrics: { total_return: 18.4, sharpe: 1.18, max_drawdown: -6.4 },
        chart_series: [],
        monthly_returns: [],
        trade_details: [],
        configuration: { oos_start_date: '2025-01-01' },
        parameter_snapshot: strategies[0].parameters ?? {},
      },
    ],
    promoteConflicts: new Set<string>(),
  };
}

let state = createInitialState();

function findStrategy(id: string): ApiStrategyDetail {
  const strategy = state.strategies.find((item) => item.id === id);
  if (!strategy) {
    throw new ApiError({ status: 404, code: 'strategy_not_found', message: `Strategy ${id} was not found.` });
  }
  return strategy;
}

function findJob(id: string): ApiOptimizationJobDetail {
  const job = state.optimizationJobs.find((item) => item.id === id);
  if (!job) {
    throw new ApiError({ status: 404, code: 'optimization_job_not_found', message: `Optimization job ${id} was not found.` });
  }
  return job;
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

export const demoApi: DemoApi = {
  async getWorkspaceOverview(): Promise<ApiWorkspaceOverview> {
    return clone({
      workspace_name: 'Grit Strategy Lab',
      subtitle: 'Creation, backtest, and optimization workspace for local strategy recovery.',
      strategy_count: state.strategies.length,
      active_run_count: 0,
      running_optimization_count: 0,
      latest_strategy_id: state.strategies[0]?.id ?? null,
      latest_backtest_run_id: state.runs[0]?.id ?? null,
      latest_optimization_job_id: state.optimizationJobs[0]?.id ?? null,
      top_momentum_warning: 'Refresh snapshots before trusting any newly materialized momentum strategy.',
      quick_actions: ['open_creation', 'start_backtest', 'open_optimization'],
    });
  },

  async listStrategies(): Promise<ApiStrategyListItem[]> {
    return clone(state.strategies);
  },

  async getStrategyDetail(id: string): Promise<ApiStrategyDetail> {
    return clone(findStrategy(id));
  },

  async getCreationSession(id: string): Promise<ApiStrategyCreationSession> {
    const existing = state.sessions.find((session) => session.id === id);
    if (existing) {
      return clone(existing);
    }
    throw new ApiError({ status: 404, code: 'session_not_found', message: `Session ${id} was not found.` });
  },

  async createCreationSession(payload): Promise<ApiStrategyCreationSession> {
    const session: ApiStrategyCreationSession = {
      id: nextId('cs'),
      status: 'DRAFTING',
      revision: 1,
      messages: [],
      mode: 'CREATE',
      ...payload,
    };
    state.sessions.unshift(session);
    return clone(session);
  },

  async appendCreationMessage(id: string, content: string): Promise<ApiStrategyCreationSession> {
    const session = await this.getCreationSession(id);
    const updated = {
      ...session,
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
    const updated = { ...session, revision: payload.revision + 1 };
    state.sessions = state.sessions.map((item) => (item.id === id ? updated : item));
    return clone(updated);
  },

  async materializeStrategy(id: string): Promise<ApiStrategyDetail> {
    return this.getStrategyDetail('strat-001');
  },

  async listBacktestRuns(params): Promise<ApiBacktestRunListItem[]> {
    const limit = params?.limit ?? state.runs.length;
    return clone(
      state.runs.slice(0, limit).map((run) => ({
        id: run.id,
        strategy_id: run.strategy_id ?? 'strat-001',
        status: run.status,
        created_at: nowIso(),
      })),
    );
  },

  async getBacktestRunDetail(id: string): Promise<ApiBacktestRunDetail> {
    const run = state.runs.find((item) => item.id === id);
    if (!run) {
      throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
    }
    return clone(run);
  },

  async getBacktestRunTrades(): Promise<ApiBacktestRunTradePage> {
    return { items: [], page: 1, page_size: 50, total: 0, total_pages: 1 };
  },

  async previewBacktestRun(): Promise<ApiBacktestSubmissionPreview> {
    return { warnings: [], effective_start_date: '2024-01-02', effective_end_date: '2025-01-31', data_segment_type: 'FULL' };
  },

  async submitBacktestRun(): Promise<ApiBacktestRunDetail> {
    return clone(state.runs[0]);
  },

  async cloneBacktestRun(): Promise<ApiBacktestRunDetail> {
    return clone(state.runs[0]);
  },

  async getOptimizationJobDetail(id: string): Promise<ApiOptimizationJobDetail> {
    return clone(findJob(id));
  },

  async createOptimizationJob(strategyId: string): Promise<ApiOptimizationJobDetail> {
    const strategy = findStrategy(strategyId);
    const job: ApiOptimizationJobDetail = {
      id: nextId('opt'),
      strategy_id: strategyId,
      status: 'COMPLETED',
      request: {
        objective: 'sharpe',
        base_parameter_version_id: strategy.current_parameter_version_id,
      },
      summary: {
        objective: 'sharpe',
        candidate_count: 1,
        baseline_parameter_version_id: strategy.current_parameter_version_id,
      },
      result: {
        best_candidate_id: null,
        baseline_parameter_version_id: strategy.current_parameter_version_id,
      },
      candidates: [createCandidate(strategy, {}, 1)],
      base_parameter_version_id: strategy.current_parameter_version_id,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: nowIso(),
    };
    job.result.best_candidate_id = job.candidates[0].id;
    state.optimizationJobs.unshift(job);
    strategy.latest_optimization_job_id = job.id;
    return clone(job);
  },

  async createOptimizationCandidate(jobId: string, payload: CreateCandidatePayload): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const candidate = createCandidate(
      strategy,
      {
        label: payload.label ?? `Manual Candidate ${job.candidates.length + 1}`,
        summary: payload.summary,
        parameter_snapshot: payload.parameter_snapshot,
        metrics: payload.metrics ?? {},
        base_parameter_version_id: payload.base_parameter_version_id ?? job.base_parameter_version_id ?? null,
      },
      job.candidates.length + 1,
    );
    job.candidates.push(candidate);
    job.summary.candidate_count = job.candidates.length;
    job.updated_at = nowIso();
    return clone(job);
  },

  async promoteOptimizationCandidate(jobId: string, trialId: string, mode: PromoteMode): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    const strategy = findStrategy(job.strategy_id);
    const candidate = job.candidates.find((item) => item.id === trialId);
    if (!candidate) {
      throw new ApiError({ status: 404, code: 'optimization_candidate_not_found', message: `Candidate ${trialId} was not found.` });
    }
    const conflictKey = promoteConflictKey(jobId, trialId);
    if (state.promoteConflicts.has(conflictKey)) {
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
    }
    return clone(job);
  },

  async getSnapshotOverview(): Promise<ApiSnapshotOverview> {
    return { status: 'READY', latest_job: null };
  },

  async refreshSnapshots(): Promise<ApiSnapshotOverview> {
    return { status: 'READY', latest_job: null };
  },
};
