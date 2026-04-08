export type StrategyType = 'GENERAL' | 'GRID' | 'MOMENTUM' | 'MEAN_REVERSION' | 'BUY_AND_HOLD';
export type BacktestRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED';
export type PromoteMode = 'set_current' | 'create_copy';
export type SnapshotRefreshMode = 'incremental' | 'repair' | 'full';
export type SnapshotRefreshTarget = 'price' | 'corporate' | 'universes';
export type ParameterValue = string | number | boolean | null;

export class ApiError extends Error {
  status: number;
  code: string;
  blocking_code?: string;
  blocking_target?: unknown;
  next_action?: string;

  constructor({
    status,
    code,
    message,
    blocking_code,
    blocking_target,
    next_action,
  }: {
    status: number;
    code: string;
    message: string;
    blocking_code?: string;
    blocking_target?: unknown;
    next_action?: string;
  }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.blocking_code = blocking_code;
    this.blocking_target = blocking_target;
    this.next_action = next_action;
  }
}

export type ApiWorkspaceOverview = {
  workspace_name: string;
  subtitle: string;
  strategy_count: number;
  active_run_count: number;
  running_optimization_count: number;
  latest_strategy_id: string | null;
  latest_backtest_run_id: string | null;
  latest_optimization_job_id: string | null;
  top_momentum_warning: string;
  quick_actions: string[];
  last_cleanup_count?: number;
};

export type ApiStrategyListItem = {
  id: string;
  name: string;
  description?: string | null;
  strategy_type: StrategyType;
  universe_name: string;
  rebalance_frequency?: string | null;
  lifecycle_status?: string;
  latest_run_id?: string | null;
  latest_successful_run_id?: string | null;
  latest_optimization_job_id?: string | null;
  current_parameter_version?: number;
  current_parameter_version_id?: string | null;
  dataset_snapshot_id?: string | null;
  universe_snapshot_id?: string | null;
  benchmark_symbol?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  parameters?: Record<string, ParameterValue>;
};

export type ApiParameterHistoryEntry = {
  version_number: number;
  parameter_version_id: string;
  revision: number;
  created_at: string | null;
  comment?: string | null;
  parameters: Record<string, ParameterValue>;
};

export type ApiStrategyDetail = ApiStrategyListItem & {
  confirmation_fields?: Record<string, unknown>;
  parameter_history: ApiParameterHistoryEntry[];
  allowed_actions?: string[];
};

export type ApiOptimizationCandidate = {
  id: string;
  label: string;
  summary?: string | null;
  status: string;
  rank: number;
  score: number;
  parameter_snapshot: Record<string, ParameterValue>;
  parameter_delta: Record<string, ParameterValue>;
  metrics: Record<string, number>;
  base_parameter_version_id?: string | null;
  allowed_actions?: string[];
};

export type ApiOptimizationJobDetail = {
  id: string;
  strategy_id: string;
  status: string;
  request: {
    objective?: string;
    base_parameter_version_id?: string | null;
    [key: string]: unknown;
  };
  summary: {
    objective?: string;
    candidate_count: number;
    baseline_parameter_version_id?: string | null;
    [key: string]: unknown;
  };
  result: {
    best_candidate_id?: string | null;
    baseline_parameter_version_id?: string | null;
    [key: string]: unknown;
  };
  candidates: ApiOptimizationCandidate[];
  base_parameter_version_id?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
};

export type ApiStrategyCreationSession = {
  id: string;
  status: string;
  revision?: number;
  mode?: string;
  base_strategy_id?: string | null;
  base_parameter_version_id?: string | null;
  top_level?: {
    strategy_type?: StrategyType | null;
    universe_name?: string | null;
    rebalance_frequency?: string | null;
  };
  messages?: Array<{
    id?: string;
    role?: string | null;
    content: string;
    created_at?: string | null;
    extracted_tags?: Array<{
      key: string;
      label: string;
      value: string;
      status: 'synced' | 'manual_override_preserved';
    }>;
  }>;
  confirmation_fields?: {
    top_level: Array<{ key: string; label: string; value: unknown; source: string }>;
    parameters: Array<{ key: string; label: string; value: unknown; source: string }>;
  };
  pending_inputs?: Array<{ key: string; label: string; message: string }>;
  manual_conflicts?: Array<{
    key: string;
    label: string;
    message: string;
    suggested_value?: ParameterValue;
  }>;
};

export type ApiConfirmationUpdateRequest = {
  revision: number;
  strategy_type?: StrategyType;
  core?: Record<string, ParameterValue>;
  logic?: Record<string, ParameterValue>;
  parameters?: Record<string, ParameterValue>;
};

export type ApiBacktestMetricSummary = Record<string, number>;

export type ApiBacktestChartPoint = {
  trade_date: string;
  equity: number;
  benchmark: number;
  drawdown: number;
  is_oos: boolean;
  strategy_return?: number;
  benchmark_return?: number;
};

export type ApiMonthlyReturn = {
  month: string;
  return_pct: number | null;
  segment: string;
};

export type ApiDrawdownEvent = {
  start_date: string;
  trough_date: string;
  drawdown_pct: number;
  recovery_date?: string | null;
  status: string;
  segment: string;
};

export type ApiRollingMetricPoint = {
  trade_date?: string;
  date?: string;
  trailing_252_return?: number;
  trailing_252_sharpe?: number;
  [key: string]: unknown;
};

export type ApiBacktestSubmissionPreview = {
  warnings?: string[];
  effective_date?: string;
  effective_start_date?: string;
  effective_end_date?: string;
  oos_start_date?: string;
  coverage_ratio?: number;
  coverage_days?: number;
  data_segment_type?: string;
  snapshot_summary?: Record<string, unknown>;
  metrics?: ApiBacktestMetricSummary;
  parameter_snapshot?: Record<string, ParameterValue>;
  parameter_version_id?: string | null;
  environment_summary?: Record<string, unknown>;
  blind_test_zone?: Record<string, unknown>;
};

export type ApiBacktestRunListItem = {
  id: string;
  strategy_id: string;
  strategy_name?: string;
  status: BacktestRunStatus;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  metrics?: ApiBacktestMetricSummary;
  warnings?: string[];
  preview?: ApiBacktestSubmissionPreview;
  data_segment_type?: string;
  parameter_version_id?: string | null;
  is_permanent?: boolean;
  source_run_id?: string | null;
  trades_count?: number;
};

export type ApiBacktestTradeItem = {
  trade_time: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  segment: string;
  signal_date?: string;
  signal_time?: string;
  fill_date?: string;
  fill_time?: string;
  direction_semantic?: string;
  fill_price_raw?: number;
  fill_price_adj?: number;
  fee_paid?: number;
  net_amount?: number;
  pnl_contribution?: number;
  reason?: string;
  adjustment_factor_t1?: number;
  split_ratio_t1?: number;
};

export type ApiBacktestRunTradePage = {
  items: ApiBacktestTradeItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages?: number;
};

export type ApiBacktestTradeAudit = ApiBacktestTradeAuditItem & {
  price_series: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    adj_close: number;
    volume: number;
  }>;
  trigger_snapshot: Record<string, ParameterValue>;
  risk_evaluation: {
    max_favorable_excursion_pct: number;
    max_adverse_excursion_pct: number;
    mfe_mae_ratio: number;
    slippage_cost_pct: number;
    commentary: string;
  };
  entry_marker: { date: string; price: number };
  exit_marker: { date: string; price: number };
  chart_band: { start_date: string; end_date: string; color: string; pnl_pct: number };
};

export type ApiBacktestRunTradeAudit = ApiBacktestTradeAudit;
export type BacktestRunListItem = ApiBacktestRunListItem;
export type BacktestRunDetail = ApiBacktestRunDetail;

export type ApiBacktestTradeAuditItem = {
  trade_id: string;
  symbol: string;
  segment: string;
  opened_at: string;
  closed_at: string;
  pnl_pct: number;
  max_favorable_excursion_pct: number;
  max_adverse_excursion_pct: number;
  slippage_cost_pct: number;
  commentary: string;
};

export type ApiBacktestRunDetail = {
  id: string;
  strategy_id?: string;
  strategy_name?: string;
  status: BacktestRunStatus;
  metrics: ApiBacktestMetricSummary;
  warnings?: string[];
  preview?: ApiBacktestSubmissionPreview;
  chart_series?: ApiBacktestChartPoint[];
  monthly_returns?: ApiMonthlyReturn[];
  trade_details?: Array<{
    trade_date: string;
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    notional: number;
    pnl_pct?: number;
    note?: string;
    signal?: string;
    segment?: string;
  }>;
  configuration?: Record<string, unknown>;
  parameter_snapshot?: Record<string, ParameterValue>;
  snapshot_summary?: Record<string, unknown>;
  environment_summary?: Record<string, unknown>;
  relative_metrics?: Record<string, number>;
  consistency_score?: Record<string, number>;
  risk_metrics?: Record<string, number>;
  drawdown_events?: ApiDrawdownEvent[];
  rolling_metrics?: ApiRollingMetricPoint[];
  data_segment_type?: string;
  parameter_version_id?: string | null;
  request?: Record<string, unknown>;
  oos_start_date?: string | null;
  effective_date?: string | null;
  coverage_ratio?: number;
  coverage_days?: number;
  is_permanent?: boolean;
  source_run_id?: string | null;
  trades_count?: number;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  trade_audit_items?: ApiBacktestTradeAuditItem[];
  trade_audit?: ApiBacktestTradeAudit[];
};

export type ApiSnapshotBlocker = {
  code: string;
  message: string;
  target?: string | null;
  [key: string]: unknown;
};

export type ApiDatasetSnapshot = {
  id: string;
  name: string;
  status: string;
  as_of?: string | null;
  freshness_label?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  row_count?: number | null;
  source?: string | null;
  fallback_source?: string | null;
  blocker?: ApiSnapshotBlocker | null;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ApiUniverseSnapshot = {
  id: string;
  name: string;
  status: string;
  as_of?: string | null;
  freshness_label?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  anchor_schedule?: string | null;
  member_count?: number | null;
  source?: string | null;
  fallback_source?: string | null;
  blocker?: ApiSnapshotBlocker | null;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ApiSnapshotJob = {
  id?: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  completed_at?: string;
  request?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  warnings?: string[];
  errors?: string[];
  [key: string]: unknown;
};

export type ApiSnapshotOverview = {
  overall_status: string;
  last_refreshed_at?: string | null;
  dataset_snapshots: ApiDatasetSnapshot[];
  universe_snapshots: ApiUniverseSnapshot[];
  latest_job?: ApiSnapshotJob | null;
  blocking_code?: string | null;
  blocking_target?: unknown;
  message?: string | null;
  allowed_actions?: string[];
};

export type ApiSnapshotRefreshRequest = {
  reason?: string | null;
  mode?: SnapshotRefreshMode;
  targets?: SnapshotRefreshTarget[];
};

export type BacktestRunListQuery = {
  limit?: number;
  status?: BacktestRunStatus;
};

export type CreateCandidatePayload = {
  label?: string;
  parameter_snapshot: Record<string, ParameterValue>;
  base_parameter_version_id?: string;
  metrics?: Record<string, number>;
  summary?: string;
};

export type DemoApi = {
  getWorkspaceOverview: (includeCleanupAudit?: boolean) => Promise<ApiWorkspaceOverview>;
  listStrategies: () => Promise<ApiStrategyListItem[]>;
  getStrategyDetail: (id: string) => Promise<ApiStrategyDetail>;
  getCreationSession: (id: string) => Promise<ApiStrategyCreationSession>;
  createCreationSession: (payload?: { strategy_type?: StrategyType }) => Promise<ApiStrategyCreationSession>;
  appendCreationMessage: (id: string, content: string, revision?: number) => Promise<ApiStrategyCreationSession>;
  prepareConfirmation: (id: string) => Promise<ApiStrategyCreationSession>;
  updateConfirmation: (id: string, payload: ApiConfirmationUpdateRequest) => Promise<ApiStrategyCreationSession>;
  materializeStrategy: (id: string, idempotencyKey: string, confirmedRevision?: number) => Promise<ApiStrategyDetail>;
  listBacktestRuns: (params?: BacktestRunListQuery) => Promise<ApiBacktestRunListItem[]>;
  getBacktestRunDetail: (id: string) => Promise<ApiBacktestRunDetail>;
  getBacktestRunTrades: (id: string, params?: { page?: number; page_size?: number; segment?: string }) => Promise<ApiBacktestRunTradePage>;
  getBacktestTradeAudit: (runId: string, tradeId: string) => Promise<ApiBacktestTradeAudit>;
  previewBacktestRun: (strategyId: string, payload: Record<string, unknown>) => Promise<ApiBacktestSubmissionPreview>;
  submitBacktestRun: (strategyId: string, payload: Record<string, unknown>) => Promise<ApiBacktestRunDetail>;
  cloneBacktestRun: (id: string, idempotencyKey: string) => Promise<ApiBacktestRunDetail>;
  getOptimizationJobDetail: (id: string) => Promise<ApiOptimizationJobDetail>;
  createOptimizationJob: (strategyId: string) => Promise<ApiOptimizationJobDetail>;
  createOptimizationCandidate: (jobId: string, payload: CreateCandidatePayload) => Promise<ApiOptimizationJobDetail>;
  promoteOptimizationCandidate: (jobId: string, trialId: string, mode: PromoteMode, idempotencyKey: string, comment?: string) => Promise<ApiOptimizationJobDetail>;
  deleteOptimizationCandidate: (jobId: string, trialId: string) => Promise<ApiOptimizationJobDetail>;
  getSnapshotOverview: () => Promise<ApiSnapshotOverview>;
  refreshSnapshots: (payload?: ApiSnapshotRefreshRequest) => Promise<ApiSnapshotOverview>;
};

export type StrategyCompareCard = {
  id: string;
  name: string;
  strategyType: StrategyType;
  universeName: string;
  parameterVersion: number;
  parameterVersionId: string | null;
  latestOptimizationJobId: string | null;
  compareEligible: boolean;
  compareBlocker: string | null;
  cardState: 'READY' | 'PENDING_RUN' | 'RUNNING_CURRENT_VERSION';
  parameters: Record<string, ParameterValue>;
};

export type StrategyListItem = {
  id: string;
  name: string;
  lifecycleStatus?: string;
  parameterVersion?: number;
  cardState?: 'READY' | 'PENDING_RUN' | 'RUNNING_CURRENT_VERSION';
  compareEligible?: boolean;
  compareBlocker?: string | null;
  latestBacktestRunId?: string;
  latestBacktestStatus?: string;
  latestBacktestReturn?: number;
  latestCompletedRunSummary?: {
    runId: string;
    parameterVersion: number;
    status: string;
    totalReturn: number;
    annualizedReturn: number;
    sharpe: number;
    maxDrawdown: number;
    oosTotalReturn: number;
    oosAnnualizedReturn: number;
    oosSharpe: number;
    oosMaxDrawdown: number;
    warningCount: number;
    executionPolicy: string;
    datasetSnapshotId: string;
    universeSnapshotId: string;
    sparklinePoints: Array<{ date: string; equity: number; isOos: boolean }>;
  };
  latestOptimizationJobId?: string | null;
  latestOptimizationStatus?: string;
  createdAt?: string;
  updatedAt?: string;
  allowedActions?: string[];
};
