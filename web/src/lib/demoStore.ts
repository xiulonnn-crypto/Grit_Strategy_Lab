import {
  ApiError,
  type ApiBacktestRunDeleteResult,
  type ApiBacktestRunDetail,
  type ApiBacktestRunListItem,
  type ApiBacktestTradeAudit,
  type ApiBacktestRunTradePage,
  type ApiBacktestSubmissionPreview,
  type ApiConfirmationUpdateRequest,
  type ApiOptimizationCandidate,
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
  type ParameterValue,
  type PromoteMode,
} from '../types';
import { buildParameterDiffRows } from './adapters';
import { applyOptimizationJobConstraintUpdate } from './optimization-demo';

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
    confirmation_fields: overrides.confirmation_fields ?? { top_level: [], parameters: [] },
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
    label: overrides.label ?? `候选方案 ${rank}`,
    summary: overrides.summary ?? '已恢复优化候选方案。',
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
        createCandidate(strategies[0], { id: 'trial-001', label: '基线 + 1' }, 1),
        createCandidate(
          strategies[0],
          {
            id: 'trial-002',
            label: '差异示例候选',
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
        analysis: {
          subtitle: '测试集仍然跑赢基准，但近期回撤修复偏慢，建议优先检查样本外交易。',
          kpi_cards: [
            {
              key: 'total_return',
              label: '总收益',
              primary_text: '+18.4%',
              trend_direction: 'up',
              trend_text: '↑ 跑赢基准 6.1%',
              compare_text: '基准: +12.3% | 差值: +6.1%',
              insight_text: '收益稳定，建议检查 Beta 暴露是否过高。',
              insight_tone: 'positive',
              state: 'healthy',
            },
            {
              key: 'sharpe',
              label: '夏普比率',
              primary_text: '1.18',
              trend_direction: 'up',
              trend_text: '↑ 高于基准 0.42',
              compare_text: '基准: 0.76 | 差值: +0.42',
              insight_text: '风险回报领先，但仍要确认样本外一致性。',
              insight_tone: 'positive',
              state: 'healthy',
            },
            {
              key: 'max_drawdown',
              label: '最大回撤',
              primary_text: '-6.4%',
              trend_direction: 'up',
              trend_text: '↓ 优于基准 4.2%',
              compare_text: '基准: -10.6% | 差值: +4.2%',
              insight_text: '风控优于基准，但要继续观察回撤修复节奏。',
              insight_tone: 'neutral',
              state: 'watch',
            },
            {
              key: 'rolling_252_return',
              label: '最新 252 日滚动收益',
              primary_text: '+9.8%',
              trend_direction: 'up',
              trend_text: '↑ 高于基准 2.5%',
              compare_text: '基准: +7.3% | 差值: +2.5%',
              insight_text: '建议延长回测窗口，确认近期优势不是偶发样本。',
              insight_tone: 'warning',
              state: 'watch',
            },
            {
              key: 'trade_count',
              label: '交易数',
              primary_text: '24',
              trend_direction: 'flat',
              trend_text: '训练集 18 / 测试集 6',
              compare_text: '训练集: 18 | 测试集: 6',
              insight_text: '测试集样本偏少，需警惕过拟合。',
              insight_tone: 'warning',
              state: 'watch',
            },
          ],
          decision_rail: {
            score: 67,
            summary: '测试集收益仍成立，但优先级应放在核查样本外交易质量。',
            items: [
              {
                key: 'result',
                title: '结果判断',
                body: '测试集仍跑赢基准，方向没有被破坏。',
                tone: 'positive',
              },
              {
                key: 'risk',
                title: '风险判断',
                body: '回撤修复速度偏慢，需要结合成交明细确认衰退位置。',
                tone: 'warning',
              },
              {
                key: 'next_action',
                title: '下一步动作',
                body: '先看测试集交易，再决定是否进入下一轮参数寻优。',
                tone: 'neutral',
              },
            ],
          },
        },
      },
    ],
    promoteConflicts: new Set<string>(),
  };
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
    bond_fixed_income: {
      global_pulse: {
        status: 'READY',
        headline: '债券快照治理已纳入统一快照总览。',
        updated_at: refreshedAt,
        cards: [
          { id: 'health', label: '就绪比例', status: 'READY', value: '4/4', detail: '债券主清单已完成日终更新' },
          { id: 'coverage', label: '影子字段覆盖率', status: 'READY', value: '96%', detail: 'Dirty Price / Accrued / Duration / YTM' },
          { id: 'source', label: '来源健康度', status: 'READY', value: 'FMP / Polygon', detail: '主链路稳定' },
        ],
      },
      pillar_groups: [
        {
          id: 'ust',
          label: '利率债 (UST)',
          status: 'READY',
          items: [
            { id: 'ust-2y', label: '2Y', status: 'READY', value: '4.01%', detail: 'Accrued / Duration 已齐备' },
            { id: 'ust-10y', label: '10Y', status: 'READY', value: '4.22%', detail: '全价与净价同步' },
            { id: 'ust-30y', label: '30Y', status: 'READY', value: '4.48%', detail: '曲线点位可用于审计' },
          ],
        },
      ],
      curve_preview: [
        { tenor_label: '2Y', yield_pct: 4.01, spread_bps: 0 },
        { tenor_label: '10Y', yield_pct: 4.22, spread_bps: 21 },
        { tenor_label: '30Y', yield_pct: 4.48, spread_bps: 47 },
      ],
      audit_matrix: [
        { id: 'bond-ust-10y', label: 'UST 10Y', owner: 'FMP', status: 'READY', cadence_label: '日终', evidence: 'Dirty / Accrued / Duration / YTM' },
      ],
      raw_registry: [
        { id: 'bond-ust-10y', label: 'UST 10Y EOD', status: 'READY', source: 'FMP', snapshot_ref: 'bond_fixed_income.ust_10y', updated_at: refreshedAt, notes: ['可用于镜像生成资产腿'] },
      ],
      eligible_sources: [
        {
          id: 'bond-source-fmp',
          label: 'FMP Treasury EOD',
          source: 'FMP',
          status: 'READY',
          access_tier: 'runtime',
          instrument_types: ['BOND'],
          coverage_notes: ['clean/full price', 'accrued interest', 'YTM', 'duration'],
          updated_at: refreshedAt,
        },
      ],
      eligible_instruments: [
        {
          id: 'bond-ust-10y',
          label: 'UST 10Y EOD',
          instrument_type: 'BOND',
          source: 'FMP',
          status: 'READY',
          symbol: 'UST10Y',
          currency: 'USD',
          snapshot_date: '2026-04-01',
          clean_price: 99.64,
          net_price: 99.64,
          dirty_price: 101.18,
          full_price: 101.18,
          accrued_interest: 1.54,
          ytm_pct: 4.22,
          duration: 8.4,
          convexity: 0.76,
          snapshot_ref: 'bond_fixed_income.ust_10y',
          refresh_status: 'READY',
          missing_fields: [],
          inferred_fields: {},
          field_status: {
            clean_price: 'actual',
            full_price: 'actual',
            accrued_interest: 'actual',
            ytm_pct: 'actual',
            duration: 'actual',
            convexity: 'actual',
          },
          updated_at: refreshedAt,
        },
      ],
      scheduler: {
        status: 'READY',
        cadence_label: '日终刷新',
        next_action: '下次刷新 18:05 HKT',
        last_job_id: 'snap-job-20260401',
      },
      selected_source_summary: {
        primary_source: 'FMP',
        fallback_source: 'Polygon',
        selection_reason: '固定收益快照优先使用日终预计算 YTM / Duration。',
      },
      system_diagnostics: {
        blocking_code: null,
        blocking_target: null,
        refresh_job_status: 'COMPLETED',
        memory: {},
        notes: ['债券治理页签使用总览扩展字段，不单独新开快照 API。'],
      },
    },
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
  async getWorkspaceOverview(_includeCleanupAudit = false, _signal?: AbortSignal): Promise<ApiWorkspaceOverview> {
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

  async listStrategies(_signal?: AbortSignal): Promise<ApiStrategyListItem[]> {
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

  async listBacktestRuns(params, _signal?: AbortSignal): Promise<ApiBacktestRunListItem[]> {
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

  async getBacktestRunDetail(
    id: string,
    _options?: BacktestRunDetailRequest | AbortSignal,
  ): Promise<ApiBacktestRunDetail> {
    const run = state.runs.find((item) => item.id === id);
    if (!run) {
      throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
    }
    return clone(run);
  },

  async saveBacktestRun(id: string): Promise<ApiBacktestRunDetail> {
    const run = state.runs.find((item) => item.id === id);
    if (!run) {
      throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
    }
    run.is_permanent = true;
    return clone(run);
  },

  async deleteBacktestRun(id: string): Promise<ApiBacktestRunDeleteResult> {
    const run = state.runs.find((item) => item.id === id);
    if (!run) {
      throw new ApiError({ status: 404, code: 'run_not_found', message: `Run ${id} was not found.` });
    }
    if (run.status === 'QUEUED' || run.status === 'RUNNING') {
      throw new ApiError({ status: 409, code: 'backtest_run_delete_active', message: '进行中的回测暂不支持删除。' });
    }
    state.runs = state.runs.filter((item) => item.id !== id);
    return { id, deleted_at: nowIso(), deleted_reason: 'manual_delete' };
  },

  async getBacktestRunTrades(): Promise<ApiBacktestRunTradePage> {
    return { items: [], page: 1, page_size: 50, total: 0, total_pages: 1 };
  },

  async getBacktestTradeAudit(): Promise<ApiBacktestTradeAudit> {
    return {
      trade_id: 'trade-001',
      symbol: 'QQQ',
      segment: 'IS',
      opened_at: '2024-04-01T09:30:00Z',
      closed_at: '2024-04-08T16:00:00Z',
      pnl_pct: 2.4,
      max_favorable_excursion_pct: 3.1,
      max_adverse_excursion_pct: -1.2,
      slippage_cost_pct: 0.12,
      commentary: 'Recovered audit sample.',
      price_series: [
        {
          date: '2024-04-01',
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          adj_close: 101,
          volume: 1000000,
        },
        {
          date: '2024-04-08',
          open: 102,
          high: 104,
          low: 101,
          close: 103,
          adj_close: 103,
          volume: 1100000,
        },
      ],
      trigger_snapshot: { lookback_months: 6, top_n: 5 },
      risk_evaluation: {
        max_favorable_excursion_pct: 3.1,
        max_adverse_excursion_pct: -1.2,
        mfe_mae_ratio: 2.58,
        slippage_cost_pct: 0.12,
        commentary: 'Risk stayed within the expected band.',
      },
      entry_marker: { date: '2024-04-01', price: 101 },
      exit_marker: { date: '2024-04-08', price: 103 },
      chart_band: {
        start_date: '2024-04-01',
        end_date: '2024-04-08',
        color: 'green',
        pnl_pct: 2.4,
      },
    };
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

  async updateOptimizationJobConstraints(jobId, payload): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    if (!['COMPLETED', 'PARTIALLY_FAILED', 'FAILED'].includes(String(job.status).toUpperCase())) {
      throw new ApiError({
        status: 409,
        code: 'optimization_job_not_terminal',
        message: '只有已结束的优化任务才能重新过滤约束条件。',
      });
    }
    const updated = applyOptimizationJobConstraintUpdate(
      job,
      payload,
      findStrategy(job.strategy_id),
      nowIso(),
    );
    return clone(updated);
  },

  async saveOptimizationFilteredResult(jobId, payload): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    if (!['COMPLETED', 'PARTIALLY_FAILED', 'FAILED'].includes(String(job.status).toUpperCase())) {
      throw new ApiError({
        status: 409,
        code: 'optimization_job_not_terminal',
        message: 'Only completed optimization jobs can be saved as a filtered result.',
      });
    }
    const strategy = findStrategy(job.strategy_id);
    const savedAt = nowIso();
    const filtered = applyOptimizationJobConstraintUpdate(
      job,
      payload,
      strategy,
      savedAt,
    );
    const saved: ApiOptimizationJobDetail = {
      ...filtered,
      id: nextId('opt'),
      status: 'COMPLETED',
      request: {
        ...filtered.request,
        source_optimization_job_id: jobId,
        entry_point: 'saved_refilter_result',
      },
      summary: {
        ...filtered.summary,
        status: 'COMPLETED',
        progress_pct: 100,
        current_stage: 'Result ready',
        latest_update: '已另存过滤结果。',
      },
      result: {
        ...filtered.result,
        status: 'COMPLETED',
        progress_pct: 100,
        current_stage: 'Result ready',
        latest_update: '已另存过滤结果。',
      },
      created_at: savedAt,
      updated_at: savedAt,
      completed_at: savedAt,
    };
    state.optimizationJobs.unshift(saved);
    strategy.latest_optimization_job_id = saved.id;
    return clone(saved);
  },

  async listOptimizationJobs(): Promise<ApiOptimizationJobListItem[]> {
    return clone(
      state.optimizationJobs.map((job) => ({
        id: job.id,
        strategy_id: job.strategy_id,
        strategy_name: findStrategy(job.strategy_id).name,
        status: job.status,
        entry_point: (job.summary.entry_point as string | null | undefined) ?? null,
        validation_mode: (job.summary.validation_mode as string | null | undefined) ?? null,
        source_run_id: (job.summary.source_run_id as string | null | undefined) ?? null,
        budget_combinations:
          typeof job.summary.budget_combinations === 'number' ? job.summary.budget_combinations : null,
        completed_combinations:
          typeof job.summary.completed_combinations === 'number' ? job.summary.completed_combinations : null,
        progress_pct: typeof job.summary.progress_pct === 'number' ? job.summary.progress_pct : null,
        current_stage: (job.summary.current_stage as string | null | undefined) ?? null,
        latest_update: (job.summary.latest_update as string | null | undefined) ?? null,
        estimated_remaining_minutes:
          typeof job.summary.estimated_remaining_minutes === 'number'
            ? job.summary.estimated_remaining_minutes
            : null,
        estimated_completed_at: (job.summary.estimated_completed_at as string | null | undefined) ?? null,
        best_candidate_id: (job.result.best_candidate_id as string | null | undefined) ?? null,
        best_candidate_label: (job.result.best_candidate_label as string | null | undefined) ?? null,
        base_parameter_version_id: job.base_parameter_version_id ?? null,
        created_at: job.created_at ?? null,
        updated_at: job.updated_at ?? null,
        completed_at: job.completed_at ?? null,
        resume_ready: typeof job.resume_ready === 'boolean' ? job.resume_ready : undefined,
        persisted_trial_count:
          typeof job.persisted_trial_count === 'number' ? job.persisted_trial_count : null,
        next_trial_index: typeof job.next_trial_index === 'number' ? job.next_trial_index : null,
        interrupted_reason: job.interrupted_reason ?? null,
        best_metrics_summary: job.best_metrics_summary ?? null,
      })),
    );
  },

  async deleteOptimizationJob(id: string) {
    const job = findJob(id);
    const deletedAt = nowIso();
    state.optimizationJobs = state.optimizationJobs.filter((item) => item.id !== id);
    const strategy = findStrategy(job.strategy_id);
    strategy.latest_optimization_job_id =
      state.optimizationJobs.find((item) => item.strategy_id === strategy.id)?.id ?? null;
    return {
      id,
      deleted_at: deletedAt,
      deleted_reason: 'user_deleted',
    };
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

  async resumeOptimizationJob(jobId: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    job.status = 'QUEUED';
    job.summary = {
      ...job.summary,
      status: 'QUEUED',
      resume_ready: false,
      latest_update: '优化任务已继续执行。',
    };
    job.result = {
      ...job.result,
      status: 'QUEUED',
      latest_update: '优化任务已继续执行。',
    };
    job.updated_at = nowIso();
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

  async deleteOptimizationCandidate(jobId: string, trialId: string): Promise<ApiOptimizationJobDetail> {
    const job = findJob(jobId);
    job.candidates = job.candidates.filter((candidate) => candidate.id !== trialId);
    job.summary.candidate_count = job.candidates.length;
    job.updated_at = nowIso();
    return clone(job);
  },

  async getSnapshotOverview(): Promise<ApiSnapshotOverview> {
    return createSnapshotOverview();
  },

  async refreshSnapshots(): Promise<ApiSnapshotOverview> {
    return createSnapshotOverview('2026-04-01T10:00:00Z');
  },
};
