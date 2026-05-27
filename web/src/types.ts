export type StrategyType =
  | "GENERAL"
  | "GRID"
  | "MOMENTUM"
  | "MEAN_REVERSION"
  | "BUY_AND_HOLD"
  | "ASSET_ALLOCATION"
  | "MULTI_FACTOR"
  | "COMPOSITE_FACTOR";
export type CreationSessionStrategyType = Exclude<StrategyType, "MULTI_FACTOR" | "COMPOSITE_FACTOR">;
export type BacktestRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "INTERRUPTED"
  | "COMPLETED"
  | "COMPLETED_WITH_WARNINGS"
  | "FAILED";
export type OptimizationJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "INTERRUPTED"
  | "COMPLETED"
  | "PARTIALLY_FAILED"
  | "FAILED";
export type PromoteMode = "set_current" | "create_copy";
export type SnapshotRefreshMode = "incremental" | "repair" | "full";
export type SnapshotRefreshTarget =
  | "price"
  | "corporate"
  | "valuations"
  | "universes"
  | "fundamentals"
  | "sentiment"
  | "macro_derivatives"
  | "bond";
export type ParameterValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | unknown[];
export type ApiOptimizationConstraintPresetKey =
  | "balanced"
  | "defensive"
  | "offensive";
export type ApiOptimizationMatchingCombinationSource =
  | "all_trials"
  | "persisted_candidates";
export type OptimizationConstraintOperator = ">=" | "<=";
export type OptimizationConstraintCategory = "return" | "risk" | "stability";
export type OptimizationConstraintSource = "preset" | "manual";

export type ApiOptimizationConstraint = {
  key: string;
  label: string;
  category: OptimizationConstraintCategory;
  operator: OptimizationConstraintOperator;
  value: number;
  unit: string;
  baseline_value?: number | null;
  source?: OptimizationConstraintSource;
};

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
    this.name = "ApiError";
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

export type ApiStrategyLatestCompletedRunSummary = {
  run_id: string;
  parameter_version: number;
  parameter_version_id?: string | null;
  status: string;
  total_return: number;
  annualized_return: number;
  sharpe: number;
  max_drawdown: number;
  oos_total_return: number;
  oos_annualized_return: number;
  oos_sharpe: number;
  oos_max_drawdown: number;
  warning_count: number;
  execution_policy: string;
  dataset_snapshot_id: string;
  universe_snapshot_id: string;
  completed_at?: string | null;
  sparkline_points: Array<{ date: string; equity: number; is_oos: boolean }>;
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
  latest_completed_run_summary?: ApiStrategyLatestCompletedRunSummary | null;
};

export type ApiStrategyLibraryResponse = {
  strategies: ApiStrategyListItem[];
  runs: ApiBacktestRunListItem[];
};

export type ApiStrategyArchivePreview = {
  id: string;
  strategy_id: string;
  name?: string | null;
  lifecycle_status?: string | null;
  can_archive: boolean;
  reference_count: number;
  strategy_leg_reference_counts?: Record<string, number>;
  backtest_run_count: number;
  optimization_job_count: number;
  blocking_code?: string | null;
  next_action?: string | null;
};

export type ApiStrategyArchiveResult = {
  id: string;
  strategy_id: string;
  status: string;
  archived_at: string;
  deleted_at: string;
  deleted_reason: string;
  deleted_backtest_run_count: number;
  deleted_optimization_job_count: number;
};

export type ApiParameterHistoryEntry = {
  version_number: number;
  parameter_version_id: string;
  revision: number;
  created_at: string | null;
  comment?: string | null;
  decision_note?: string | null;
  change_summary?: string | null;
  source?: ApiParameterVersionSource | null;
  alternative_versions?: ApiParameterVersionAlternative[];
  rollbackable?: boolean;
  parameters: Record<string, ParameterValue>;
};

export type ApiParameterVersionSource = {
  kind: string;
  job_id?: string | null;
  run_id?: string | null;
  candidate_id?: string | null;
  candidate_label?: string | null;
  base_parameter_version_id?: string | null;
  source_parameter_version_id?: string | null;
  source_version_number?: number | null;
  [key: string]: unknown;
};

export type ApiParameterVersionAlternative = {
  candidate_id?: string | null;
  parameter_version_id?: string | null;
  label?: string | null;
  rank?: number | null;
  score?: number | null;
  version_number?: number | null;
  metrics?: Record<string, number>;
  parameter_delta?: Record<string, ParameterValue>;
};

export type ParameterVersionRestorePayload = {
  idempotency_key: string;
  base_parameter_version_id?: string | null;
  decision_note?: string | null;
};

export type ApiConfirmationFieldEntry = {
  key: string;
  label: string;
  value: unknown;
  source: string;
};

export type ApiConfirmationFields = {
  top_level: ApiConfirmationFieldEntry[];
  parameters: ApiConfirmationFieldEntry[];
};

export type ApiMultiFactorComponent = {
  factor_id: string;
  name?: string | null;
  family?: string | null;
  direction?: string | null;
  weight: number;
  normalized_weight: number;
  diagnostic_status?: string | null;
  pit_coverage?: Record<string, unknown>;
};

export type ApiMultiFactorNeutralization = {
  enabled: boolean;
  method: string;
  industry_field?: string | null;
  taxonomy?: string | null;
  covered_symbol_count?: number | null;
  missing_symbol_count?: number | null;
  source_names?: string[];
  execution_status: string;
  blocker_reason?: string | null;
  blockers?: string[];
};

export type ApiMultiFactorProfile = {
  components: ApiMultiFactorComponent[];
  neutralization: ApiMultiFactorNeutralization;
  scoring_method: string;
  rebalance_frequency: string;
  pit_snapshot_refs?: Record<string, unknown>;
  coverage_summary?: Record<string, unknown>;
};

export type ApiMultiFactorPrecheck = {
  status: "PASS" | "WARN" | "BLOCKED";
  factor_count: number;
  coverage_pct: number;
  blocked_factors: Array<Record<string, unknown>>;
  neutralization_status: Record<string, unknown>;
  estimated_turnover_pct?: number | null;
  warnings: string[];
};

export type ApiMultiFactorAttribution = {
  summary: Record<string, unknown>;
  factor_contributions: Array<Record<string, unknown>>;
  industry_exposures: Array<Record<string, unknown>>;
  coverage: Record<string, unknown>;
  neutralization_status: Record<string, unknown>;
  attribution_source: string;
  warnings: string[];
};

export type ApiMultiFactorParameterRange = {
  key: string;
  label: string;
  mode: "range" | "fixed" | "discrete";
  current?: ParameterValue;
  start?: ParameterValue;
  end?: ParameterValue;
  step?: ParameterValue;
  values?: ParameterValue[];
};

export type ApiStrategyDetail = ApiStrategyListItem & {
  confirmation_fields?: ApiConfirmationFields;
  parameter_history: ApiParameterHistoryEntry[];
  allowed_actions?: string[];
  multi_factor_profile?: ApiMultiFactorProfile | null;
  multi_factor_parameter_ranges?: ApiMultiFactorParameterRange[] | null;
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
  title?: string | null;
  status_label?: string | null;
  analysis?: {
    title?: string | null;
    thesis?: string | null;
    shelf_copy?: string | null;
    stability_verdict?: string | null;
    stability_summary?: string | null;
    stability_checks?: ApiOptimizationStabilityCheck[];
    validation_windows?: ApiOptimizationValidationWindow[];
    heatmap?: ApiOptimizationHeatmap | null;
  };
};

export type ApiOptimizationStabilityCheck = {
  key: string;
  label: string;
  value: number;
  verdict: "pass" | "watch" | "risk";
  detail: string;
};

export type ApiOptimizationValidationWindow = {
  label: string;
  period_label?: string;
  annualized_return: number;
  return_sharpe: number;
  out_of_sample_sharpe: number;
  max_drawdown_pct: number;
  stability: number;
  verdict: "pass" | "watch" | "risk";
};

export type ApiOptimizationHeatmap = {
  x_key: string | null;
  y_key: string | null;
  x_label?: string | null;
  y_label?: string | null;
  x_values: number[];
  y_values: number[];
  cells: Array<{
    x: number;
    y: number;
    score: number;
    metrics?: Record<string, number>;
    is_candidate?: boolean;
    tone?: "hot" | "warm" | "cool";
  }>;
};

export type ApiOptimizationSearchSpaceField = {
  key: string;
  label: string;
  mode: "range" | "fixed" | "discrete";
  current?: ParameterValue;
  start?: ParameterValue;
  end?: ParameterValue;
  step?: ParameterValue;
  value?: ParameterValue;
  values?: ParameterValue[];
  tag?: string | null;
  constraint_group?: string | null;
  constraint_target?: number | null;
};

export type ApiOptimizationTrialSummary = {
  trial_index: number;
  label: string;
  status: string;
  parameter_snapshot: Record<string, ParameterValue>;
  metrics: Record<string, number>;
  score: number;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

export type ApiOptimizationJobListItem = {
  id: string;
  strategy_id: string;
  strategy_name?: string | null;
  status: string;
  entry_point?: string | null;
  validation_mode?: string | null;
  source_run_id?: string | null;
  budget_combinations?: number | null;
  completed_combinations?: number | null;
  progress_pct?: number | null;
  current_stage?: string | null;
  latest_update?: string | null;
  estimated_remaining_minutes?: number | null;
  estimated_completed_at?: string | null;
  active_execution_seconds?: number | null;
  execution_seconds?: number | null;
  best_candidate_id?: string | null;
  best_candidate_label?: string | null;
  constraint_preset_key?: ApiOptimizationConstraintPresetKey | null;
  constraint_label?: string | null;
  constraints?: ApiOptimizationConstraint[];
  base_parameter_version_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  resume_ready?: boolean;
  persisted_trial_count?: number | null;
  next_trial_index?: number | null;
  interrupted_reason?: string | null;
  best_metrics_summary?: ApiOptimizationTrialSummary | null;
};

export type ApiOptimizationJobDeleteResult = {
  id: string;
  deleted_at: string;
  deleted_reason: string;
};

export type ApiOptimizationJobCreatePayload = {
  objective?: string;
  base_parameter_version_id?: string | null;
  source_run_id?: string | null;
  entry_point?: string | null;
  validation_mode?: string | null;
  budget_combinations?: number | null;
  search_space?: ApiOptimizationSearchSpaceField[];
  constraint_preset_key?: ApiOptimizationConstraintPresetKey | null;
  constraint_label?: string | null;
  constraints?: ApiOptimizationConstraint[];
};

export type ApiOptimizationJobConstraintUpdatePayload = {
  objective?: string | null;
  constraint_preset_key?: ApiOptimizationConstraintPresetKey | null;
  constraint_label?: string | null;
  constraints?: ApiOptimizationConstraint[];
};

export type ApiOptimizationFilteredResultCreatePayload =
  ApiOptimizationJobConstraintUpdatePayload;

export type ApiOptimizationJobDetail = {
  id: string;
  strategy_id: string;
  strategy_name?: string | null;
  status: string;
  request: {
    objective?: string;
    base_parameter_version_id?: string | null;
    source_run_id?: string | null;
    entry_point?: string | null;
    validation_mode?: string | null;
    budget_combinations?: number | null;
    search_space?: ApiOptimizationSearchSpaceField[];
    constraint_preset_key?: ApiOptimizationConstraintPresetKey | null;
    constraint_label?: string | null;
    constraints?: ApiOptimizationConstraint[];
    [key: string]: unknown;
  };
  summary: {
    objective?: string;
    candidate_count: number;
    baseline_parameter_version_id?: string | null;
    entry_point?: string | null;
    validation_mode?: string | null;
    source_run_id?: string | null;
    budget_combinations?: number | null;
    completed_combinations?: number | null;
    progress_pct?: number | null;
    current_stage?: string | null;
    latest_update?: string | null;
    estimated_remaining_minutes?: number | null;
    estimated_completed_at?: string | null;
    active_execution_seconds?: number | null;
    execution_seconds?: number | null;
    search_space?: ApiOptimizationSearchSpaceField[];
    constraint_preset_key?: ApiOptimizationConstraintPresetKey | null;
    constraint_label?: string | null;
    constraints?: ApiOptimizationConstraint[];
    matching_combination_count?: number | null;
    matching_combination_source?: ApiOptimizationMatchingCombinationSource | null;
    resume_ready?: boolean;
    persisted_trial_count?: number | null;
    next_trial_index?: number | null;
    interrupted_reason?: string | null;
    best_metrics_summary?: ApiOptimizationTrialSummary | null;
    [key: string]: unknown;
  };
  result: {
    best_candidate_id?: string | null;
    best_candidate_label?: string | null;
    baseline_parameter_version_id?: string | null;
    headline?: string | null;
    summary?: string | null;
    stability_verdict?: string | null;
    constraint_preset_key?: ApiOptimizationConstraintPresetKey | null;
    constraint_label?: string | null;
    constraints?: ApiOptimizationConstraint[];
    active_execution_seconds?: number | null;
    execution_seconds?: number | null;
    [key: string]: unknown;
  };
  candidates: ApiOptimizationCandidate[];
  base_parameter_version_id?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  active_execution_seconds?: number | null;
  execution_seconds?: number | null;
  resume_ready?: boolean;
  persisted_trial_count?: number | null;
  next_trial_index?: number | null;
  interrupted_reason?: string | null;
  best_metrics_summary?: ApiOptimizationTrialSummary | null;
  matching_combination_count?: number | null;
  matching_combination_source?: ApiOptimizationMatchingCombinationSource | null;
  matching_combinations?: ApiOptimizationCandidate[];
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
      status: "synced" | "manual_override_preserved";
    }>;
  }>;
  confirmation_fields?: ApiConfirmationFields;
  pending_inputs?: Array<{ key: string; label: string; message: string }>;
  manual_conflicts?: Array<{
    key: string;
    label: string;
    message: string;
    suggested_value?: ParameterValue;
  }>;
};

export type CreateCreationSessionPayload = {
  strategy_type?: CreationSessionStrategyType;
  mode?: "CREATE" | "REVISION";
  base_strategy_id?: string | null;
  base_parameter_version_id?: string | null;
};

export type ApiConfirmationUpdateRequest = {
  revision: number;
  strategy_type?: StrategyType;
  core?: Record<string, ParameterValue>;
  logic?: Record<string, ParameterValue>;
  parameters?: Record<string, ParameterValue>;
};

export type AssetAllocationRecommendationAsset = {
  symbol: string;
  display_name?: string | null;
  asset_class?: string | null;
  target_weight_pct?: number | null;
};

export type AssetAllocationRecommendationRequest = {
  assets: AssetAllocationRecommendationAsset[];
  lookback_days?: number;
};

export type AssetAllocationRecommendedWeight = {
  symbol: string;
  display_name?: string | null;
  asset_class?: string | null;
  target_weight_pct: number;
  risk_contribution_pct: number;
  data_status: string;
};

export type AssetAllocationRecommendationResponse = {
  method: string;
  weights: AssetAllocationRecommendedWeight[];
  diagnostics?: Record<string, unknown>;
  warnings?: string[];
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
  window_days?: number;
  window_return_pct?: number;
  window_volatility_pct?: number;
  window_sharpe?: number;
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
  execution_policy?: string | null;
  snapshot_summary?: Record<string, unknown>;
  metrics?: ApiBacktestMetricSummary;
  parameter_snapshot?: Record<string, ParameterValue>;
  parameter_version_id?: string | null;
  environment_summary?: Record<string, unknown>;
  blind_test_zone?: Record<string, unknown>;
  multi_factor_precheck?: ApiMultiFactorPrecheck | null;
};

export type ApiBacktestRunListItem = {
  id: string;
  strategy_id: string;
  strategy_name?: string;
  status: BacktestRunStatus;
  start_date?: string | null;
  end_date?: string | null;
  effective_date?: string | null;
  oos_start_date?: string | null;
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
  resume_ready?: boolean;
  interrupted_reason?: string | null;
  progress_pct?: number;
  persisted_step_count?: number;
  total_step_count?: number;
  next_step_index?: number;
  current_stage?: string | null;
  latest_update?: string | null;
};

export type ApiBacktestTradeItem = {
  trade_time?: string;
  symbol: string;
  side?: string;
  quantity?: number;
  price?: number;
  segment?: string;
  trade_date?: string;
  action?: string;
  weight_before?: number;
  weight_after?: number;
  signal_date?: string;
  signal_time?: string;
  fill_date?: string;
  fill_time?: string;
  direction_semantic?: string;
  fill_price_raw?: number;
  fill_price_adj?: number;
  fee_paid?: number;
  net_amount?: number;
  pnl_amount?: number;
  pnl_contribution?: number;
  reason?: string;
  adjustment_factor_t1?: number;
  split_ratio_t1?: number;
  contribution_multiplier?: number;
  valuation_percentile_10y?: number;
  valuation_bucket?: string;
};

export type ApiBacktestRunTradePage = {
  items: ApiBacktestTradeItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages?: number;
};

export type ApiBacktestRunDeleteResult = {
  id: string;
  deleted_at: string;
  deleted_reason: string;
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
  chart_band: {
    start_date: string;
    end_date: string;
    color: string;
    pnl_pct: number;
  };
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

export type ApiRunDetailTrendDirection = "up" | "down" | "flat";
export type ApiRunDetailInsightTone =
  | "neutral"
  | "positive"
  | "warning"
  | "critical";
export type ApiRunDetailKpiState =
  | "healthy"
  | "watch"
  | "risk"
  | "insufficient_data";

export type ApiRunDetailKpiCard = {
  key: string;
  label: string;
  primary_text: string;
  trend_direction: ApiRunDetailTrendDirection;
  trend_text: string;
  compare_text: string;
  footer_items?: Array<{
    label: string;
    value: string;
  }>;
  insight_text: string;
  insight_tone: ApiRunDetailInsightTone;
  state: ApiRunDetailKpiState;
};

export type ApiRunDetailDecisionItem = {
  key: string;
  title: string;
  body: string;
  tone: ApiRunDetailInsightTone;
};

export type ApiRunDetailDecisionRail = {
  score: number;
  label?: string;
  summary?: string;
  items: ApiRunDetailDecisionItem[];
};

export type ApiBacktestRunDetailAnalysis = {
  subtitle: string;
  kpi_cards: ApiRunDetailKpiCard[];
  decision_rail: ApiRunDetailDecisionRail;
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
  trades?: Array<{
    trade_date?: string;
    symbol: string;
    action?: string;
    side?: string;
    quantity?: number;
    price?: number;
    weight_before?: number;
    weight_after?: number;
    net_amount?: number;
    pnl_amount?: number;
    pnl_contribution?: number;
    reason?: string;
    segment?: string;
    contribution_multiplier?: number;
    valuation_percentile_10y?: number;
    valuation_bucket?: string;
  }>;
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
  start_date?: string | null;
  end_date?: string | null;
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
  analysis?: ApiBacktestRunDetailAnalysis;
  multi_factor_attribution?: ApiMultiFactorAttribution | null;
  resume_ready?: boolean;
  interrupted_reason?: string | null;
  progress_pct?: number;
  persisted_step_count?: number;
  total_step_count?: number;
  next_step_index?: number;
  current_stage?: string | null;
  latest_update?: string | null;
};

export type ApiSnapshotBlocker = {
  code: string;
  message: string;
  target?: string | null;
  [key: string]: unknown;
};

export type ApiSnapshotProviderAccessTier =
  | "public"
  | "free_account"
  | "paid_optional"
  | "public_web"
  | "repo_local";

export type ApiSnapshotProviderSummaryItem = {
  kinds?: string[];
  reasons?: string[];
  attempted_symbols?: number;
  succeeded_symbols?: number;
  selected_primary_symbols?: number;
  succeeded_not_selected_symbols?: number;
  failed_symbols?: number;
  limited_symbols?: number;
  skipped_symbols?: number;
  empty_symbols?: number;
  unavailable_symbols?: number;
  landed_row_count?: number;
  landed_symbol_count?: number;
  actions_supported?: boolean;
  access_tier?: ApiSnapshotProviderAccessTier | string;
  quota_limited?: boolean;
  probe_complete?: boolean;
  next_retry_at?: string | null;
  [key: string]: unknown;
};

export type ApiSnapshotProviderSummary = {
  attempted_providers?: string[];
  skipped_providers?: string[];
  unavailable_providers?: string[];
  providers?: Record<string, ApiSnapshotProviderSummaryItem>;
  [key: string]: unknown;
};

export type ApiSnapshotProviderOpenBBReadinessSummary = {
  enabled: boolean;
  provider_count: number;
  enabled_provider_count: number;
  credential_ready_provider_count?: number;
  usable_provider_count?: number;
  attempted_provider_count: number;
  attempt_event_count?: number;
  latest_job_attempt_event_count?: number;
  latest_job_attempted_provider_count?: number;
  missing_credential_provider_count: number;
  [key: string]: unknown;
};

export type ApiSnapshotProviderReadinessSummary = {
  provider_count: number;
  registered_provider_count?: number;
  enabled_provider_count: number;
  credential_ready_provider_count?: number;
  usable_provider_count?: number;
  attempted_provider_count: number;
  attempt_event_count?: number;
  unique_attempted_provider_count?: number;
  latest_job_attempt_event_count?: number;
  latest_job_attempted_provider_count?: number;
  attempt_rollup_policy?: string;
  quota_limited_provider_count: number;
  cooldown_provider_count: number;
  missing_credential_provider_count: number;
  failed_provider_count: number;
  auxiliary_only_provider_count: number;
  target_type_counts: Record<string, number>;
  top_blockers: Array<Record<string, unknown>>;
  last_attempt_at?: string | null;
  openbb: ApiSnapshotProviderOpenBBReadinessSummary;
};

export type ApiSnapshotProviderTrustProfile = {
  trust_tier?: string;
  evidence_scope?: string[];
  can_upgrade_full_ready?: boolean;
  can_upgrade_pit_readiness?: boolean;
  pit_role?: string;
  limitations?: string[];
  operator_action?: string;
  credential_status?: string;
  missing_env_vars?: string[];
  readiness_status?: string;
  secret_persistence?: string;
  [key: string]: unknown;
};

export type ApiDataTrustLayer = {
  id: string;
  label: string;
  role?: string;
  status: string;
  provider_ids?: string[];
  registered_provider_ids?: string[];
  enabled_provider_ids?: string[];
  usable_provider_ids?: string[];
  missing_env_vars?: string[];
  preferred_provider?: string | null;
  evidence_scope?: string[];
  limitations?: string[];
  full_ready_gate?: string | null;
  operator_action?: string | null;
  provider_count?: number;
  usable_provider_count?: number;
  [key: string]: unknown;
};

export type ApiDataTrustSummary = {
  generated_at?: string;
  status?: string;
  summary_label?: string;
  layers: ApiDataTrustLayer[];
  layer_count?: number;
  usable_layer_count?: number;
  missing_credential_layer_count?: number;
  attempt_status_counts?: Record<string, number>;
  full_ready_rules?: string[];
  [key: string]: unknown;
};

export type ApiSnapshotProviderRegistryItem = {
  provider_id: string;
  source_name: string;
  access_tier: ApiSnapshotProviderAccessTier | string;
  credential_requirements: {
    required_env_vars?: string[];
    configured?: boolean;
    configured_env_vars?: string[];
    missing_env_vars?: string[];
    secret_persistence?: string;
    notes?: string[];
    [key: string]: unknown;
  };
  target_types: string[];
  fallback_order: Record<string, number>;
  latest_attempt?: Record<string, unknown> | null;
  quota_cooldown: Record<string, unknown>;
  error_summary: Record<string, unknown>;
  pit_permission: {
    mode?: string;
    can_upgrade_pit_readiness?: boolean;
    notes?: string[];
    [key: string]: unknown;
  };
  source_governance?: {
    source_url?: string;
    license?: string;
    source_manifest_required?: boolean;
    secret_persistence?: string;
    [key: string]: unknown;
  };
  trust_profile?: ApiSnapshotProviderTrustProfile;
  enabled: boolean;
  credential_ready?: boolean;
  usable?: boolean;
  readiness_status?: string;
  optional_layer?: string | null;
};

export type ApiSnapshotProviderRegistry = {
  generated_at: string;
  openbb_enabled: boolean;
  items: ApiSnapshotProviderRegistryItem[];
};

export type ApiSnapshotProviderAttemptItem = {
  attempt_id: string;
  provider_id: string;
  target_type: string;
  snapshot_kind: string;
  snapshot_id: string;
  job_id?: string | null;
  status: string;
  selection_status?: string | null;
  access_tier: ApiSnapshotProviderAccessTier | string;
  attempted_at?: string | null;
  next_retry_at?: string | null;
  quota_limited: boolean;
  cooldown_active: boolean;
  reason?: string | null;
  error?: string | null;
  landed_row_count: number;
  landed_symbol_count: number;
  auxiliary_only: boolean;
  pit_effect: Record<string, unknown>;
};

export type ApiSnapshotProviderAttempts = {
  generated_at: string;
  latest_job_id?: string | null;
  items: ApiSnapshotProviderAttemptItem[];
  rollup?: {
    policy?: string;
    latest_job_id?: string | null;
    event_count?: number;
    unique_provider_count?: number;
    latest_job_event_count?: number;
    latest_job_unique_provider_count?: number;
    providers?: Array<{
      provider_id: string;
      selected_from?: string;
      selection_reason?: string;
      event_count?: number;
      selected_event_count?: number;
      latest_job_event_count?: number;
      target_types?: string[];
      status_counts?: Record<string, number>;
      status?: string | null;
      attempted_at?: string | null;
      job_id?: string | null;
      quota_limited?: boolean;
      cooldown_active?: boolean;
      auxiliary_only?: boolean;
      landed_row_count?: number;
      landed_symbol_count?: number;
    }>;
  };
};

export type ApiDatasetSnapshotMetadata = Record<string, unknown> & {
  covered_symbol_count?: number;
  total_symbol_count?: number;
  missing_symbols?: string[];
  available_fields?: string[];
  raw_covered_symbol_count?: number;
  raw_coverage_pct?: number;
  effective_covered_symbol_count?: number;
  effective_coverage_pct?: number;
  unclassified_missing_symbol_count?: number;
  fundamental_gap_policy?: Record<string, unknown>;
  selected_latest_symbols?: string[];
  selected_symbols?: string[];
  covered_symbols?: string[];
  benchmark_etf_coverage?: {
    ready_count?: number;
    total_count?: number;
    missing_symbols?: string[];
    symbols?: Array<{
      symbol?: string;
      status?: string;
      start_date?: string | null;
      end_date?: string | null;
      trade_days?: number;
    }>;
  };
  probe_status_breakdown?: Record<string, number>;
  coverage_kind_breakdown?: Record<string, number>;
  complete_no_events_symbol_count?: number;
  formal_event_symbol_count?: number;
  proxy_keys?: string[];
  observation_frequency?: string;
  latest_date?: string;
  latest_pe_ttm?: number;
  latest_percentile_10y?: number;
  provider_summary?: ApiSnapshotProviderSummary;
};

export type ApiUniverseSnapshotMetadata = Record<string, unknown> & {
  anchor_count?: number;
  historical_anchor_count?: number;
  fallback_anchor_count?: number;
  source_quality_breakdown?: Record<string, number>;
  official_seed_status?: "complete" | "partial" | "missing";
  official_seed_source_count?: number;
  official_seed_missing_anchors?: string[];
  provider_summary?: ApiSnapshotProviderSummary;
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
  metadata?: ApiDatasetSnapshotMetadata;
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
  metadata?: ApiUniverseSnapshotMetadata;
  [key: string]: unknown;
};

export type ApiSnapshotJob = {
  id?: string;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  request?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  warnings?: string[];
  errors?: string[];
  [key: string]: unknown;
};

export type ApiLegType = "strategy" | "asset" | "cash";
export type ApiCompositionStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export type ApiLegInventoryFilterItem = {
  value: string;
  label: string;
  count: number;
};

export type ApiLegInventoryRow = {
  id: string;
  leg_type: ApiLegType;
  name: string;
  version_label?: string | null;
  proof_label?: string | null;
  reference_count: number;
  reference_summary: string;
  status: string;
  status_label: string;
  has_new_version: boolean;
  has_new_parameters?: boolean;
  is_orphan: boolean;
  attribute_tags: string[];
  allowed_actions: string[];
  source_ref_id?: string | null;
  source_ref_type?: string | null;
  source_integrity?: ApiCompositionSourceIntegrity | null;
  freeze_hash?: string | null;
  signature_status?: string | null;
  drift_status?: string | null;
  current_ref_id?: string | null;
  alerts?: string[];
  return_quality?: ApiCompositionReturnQualityLeg | null;
  config?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ApiLegInventory = {
  counts: {
    all: number;
    strategy: number;
    asset: number;
    cash: number;
  };
  filters: {
    statuses: ApiLegInventoryFilterItem[];
    attribute_tags: ApiLegInventoryFilterItem[];
  };
  rows: ApiLegInventoryRow[];
  strategy_reference_counts?: Record<string, number>;
};

export type ApiAssetLegCreatePayload = {
  name: string;
  symbol: string;
  asset_kind: string;
  source_snapshot_id: string;
  source_provider?: string | null;
  freeze_mode: string;
  notes?: string | null;
  summary?: Record<string, unknown>;
};

export type ApiLegArchivePayload = {
  status: "ARCHIVED";
};

export type ApiAssetLegUpdatePayload = ApiAssetLegCreatePayload | ApiLegArchivePayload;

export type ApiAssetLeg = {
  id: string;
  name: string;
  symbol: string;
  asset_kind: string;
  source_snapshot_id: string;
  source_provider?: string | null;
  freeze_mode: string;
  notes?: string | null;
  summary: Record<string, unknown>;
  status: string;
  eligibility_summary: Record<string, unknown>;
  attribute_tags: string[];
  allowed_actions: string[];
  created_at: string;
  updated_at: string;
};

export type ApiCashLegCreatePayload = {
  name: string;
  cash_rule_kind: string;
  buffer_bps?: number;
  yield_source?: string | null;
  freeze_mode: string;
  notes?: string | null;
  summary?: Record<string, unknown>;
};

export type ApiCashLegUpdatePayload = ApiCashLegCreatePayload | ApiLegArchivePayload;

export type ApiCashLeg = {
  id: string;
  name: string;
  cash_rule_kind: string;
  buffer_bps: number;
  yield_source?: string | null;
  freeze_mode: string;
  notes?: string | null;
  summary: Record<string, unknown>;
  status: string;
  attribute_tags: string[];
  allowed_actions: string[];
  created_at: string;
  updated_at: string;
};

export type ApiCompositionBenchmarkDefinition = {
  label?: string | null;
  symbol?: string | null;
  source?: string | null;
  notes?: string | null;
};

export type ApiCompositionCostPolicy = {
  expense_ratio_bps?: number | null;
  turnover_budget_bps?: number | null;
  trade_cost_bps?: number | null;
  notes?: string | null;
};

export type ApiCompositionLegInput = {
  leg_kind: ApiLegType;
  source_ref_id: string;
  source_ref_type?: string | null;
  display_name?: string | null;
  weight_pct: number;
  weight_locked?: boolean;
  ordering?: number | null;
  config?: Record<string, unknown>;
};

export type ApiCompositionPreviewLeg = {
  id: string;
  leg_kind: ApiLegType;
  source_ref_id: string;
  source_ref_type: string;
  display_name: string;
  weight_pct: number;
  weight_locked: boolean;
  ordering: number;
  version_label?: string | null;
  proof_label?: string | null;
  status: string;
  status_label: string;
  attribute_tags: string[];
  reference_summary: string;
  config: Record<string, unknown>;
  allowed_actions: string[];
};

export type ApiCompositionWeightSummary = {
  total_weight_pct: number;
  target_weight_pct: number;
  residual_weight_pct: number;
  locked_weight_pct: number;
  unlocked_weight_pct: number;
  within_tolerance: boolean;
};

export type ApiCompositionReturnPoint = {
  label: string;
  date?: string | null;
  portfolio_return_pct: number;
  cumulative_return_pct: number;
  gross_return_pct?: number;
  net_return_pct?: number;
  maintenance_cost_drag_pct?: number;
  slippage_drag_pct?: number;
  rebalance_cost_drag_pct?: number;
  cash_buffer_drag_pct?: number;
  total_cost_drag_pct?: number;
  cumulative_net_return_pct?: number;
};

export type ApiCompositionBenchmarkPoint = {
  label: string;
  date?: string | null;
  benchmark_return_pct: number;
  cumulative_return_pct: number;
};

export type ApiCompositionSpreadPoint = {
  label: string;
  date?: string | null;
  spread_pct: number;
};

export type ApiCompositionCorrelationCell = {
  x_key: string;
  y_key: string;
  correlation: number;
};

export type ApiCompositionRiskContribution = {
  leg_id: string;
  label: string;
  weight_pct: number;
  volatility_pct: number;
  contribution_pct: number;
  return_contribution_pct?: number;
  marginal_contribution_pct?: number;
  budget_usage_pct?: number;
  duration_contribution_years?: number | null;
  convexity_contribution?: number | null;
};

export type ApiCompositionMaintenanceCostSummary = {
  expense_ratio_bps: number;
  turnover_budget_bps: number;
  trade_cost_bps: number;
  total_estimated_bps: number;
  notes: string[];
};

export type ApiCompositionRebalanceSummary = {
  rebalance_frequency?: string | null;
  cadence_label?: string | null;
  checks_per_year: number;
  operating_tempo_label?: string | null;
};

export type ApiCompositionScoreFactor = {
  key: string;
  label: string;
  score: number;
  detail: string;
  tone: string;
};

export type ApiCompositionScore = {
  score: number;
  verdict: string;
  factors: ApiCompositionScoreFactor[];
};

export type ApiCompositionReturnQualitySummary = {
  status: string;
  metric_basis?: string | null;
  metric_window_label?: string | null;
  source_metric_basis?: string | null;
  alignment_window_start?: string | null;
  alignment_window_end?: string | null;
  aligned_points: number;
  missing_points: number;
  coverage_pct: number;
  fallback_used: boolean;
  notes: string[];
  leg_quality?: ApiCompositionReturnQualityLeg[];
};

export type ApiCompositionReturnQualityLeg = {
  leg_id: string;
  display_name: string;
  leg_kind?: string | null;
  source_ref_id?: string | null;
  sample_points: number;
  aligned_points: number;
  missing_points: number;
  coverage_pct: number;
  metric_basis?: string | null;
  source_metric_basis?: string | null;
  source_run_id?: string | null;
  source_annualized_return_pct?: number | null;
  source_max_drawdown_pct?: number | null;
  aligned_annualized_return_pct?: number | null;
  aligned_max_drawdown_pct?: number | null;
  aligned_sharpe?: number | null;
  window_start?: string | null;
  window_end?: string | null;
  issue_types?: string[];
};

export type ApiCompositionRebalanceEvent = {
  label: string;
  date?: string | null;
  index: number;
  turnover_pct: number;
  estimated_cost_bps: number;
  cost_drag_pct: number;
  cash_buffer_pct: number;
  weight_before: Record<string, number>;
  weight_after: Record<string, number>;
  notes: string[];
};

export type ApiCompositionSourceIntegrity = {
  leg_id: string;
  display_name: string;
  source_ref_id?: string | null;
  freeze_hash?: string | null;
  signature_status: string;
  drift_status: string;
  has_new_parameters?: boolean;
  current_ref_id?: string | null;
  checked_at?: string | null;
  alerts: string[];
};

export type ApiCompositionStatusAction = {
  label: string;
  action_key: string;
  action_kind: 'open_new_tab' | 'execute' | 'inspect' | string;
  route?: string | null;
  enabled?: boolean;
};

export type ApiCompositionProxyContext = {
  leg_id?: string | null;
  target_symbol?: string | null;
  proxy_symbol?: string | null;
  horizon_label?: string | null;
  proxy_signature: string;
  proxy_source: 'system' | 'user' | 'unconfirmed' | string;
  coverage_window?: Record<string, unknown>;
  explanation?: string | null;
};

export type ApiCompositionStatusDiagnosis = {
  status: '稳健' | '待校准' | '失效' | string;
  issue_type: string;
  diagnosis_type: string;
  diagnosis_label: string;
  frontend_explanation: string;
  action: string;
  resolution_criteria: string;
  actions: ApiCompositionStatusAction[];
  proxy_context?: ApiCompositionProxyContext[];
  system_disposition?: string | null;
  debug_facts?: Record<string, unknown>;
};

export type ApiCompositionProxyConfirmationPayload = {
  leg_id?: string | null;
  target_symbol?: string | null;
  proxy_symbol?: string | null;
  horizon_label?: string | null;
  proxy_signature?: string | null;
  coverage_window?: Record<string, unknown>;
  reason?: string | null;
  confirmed_by?: string | null;
};

export type ApiCompositionAuditTrailItem = {
  id: string;
  action: string;
  actor: string;
  at: string;
  summary: string;
  hash_before?: string | null;
  hash_after?: string | null;
  reason?: string | null;
  change_summary?: string | null;
  version_before?: number | null;
  version_after?: number | null;
  version_source?: string | null;
  version_candidate_id?: string | null;
  version_candidate_label?: string | null;
};

export type ApiCompositionPreviewPayload = {
  name?: string | null;
  description?: string | null;
  benchmark_definition?: ApiCompositionBenchmarkDefinition | null;
  rebalance_frequency?: string | null;
  cost_policy?: ApiCompositionCostPolicy | null;
  legs: ApiCompositionLegInput[];
};

export type ApiCompositionPreview = {
  weight_summary: ApiCompositionWeightSummary;
  normalized_legs: ApiCompositionPreviewLeg[];
  returns_preview: ApiCompositionReturnPoint[];
  benchmark_series: ApiCompositionBenchmarkPoint[];
  spread_series: ApiCompositionSpreadPoint[];
  correlation_matrix: ApiCompositionCorrelationCell[];
  risk_contribution_preview: ApiCompositionRiskContribution[];
  maintenance_cost_summary: ApiCompositionMaintenanceCostSummary;
  rebalance_summary: ApiCompositionRebalanceSummary;
  composition_score: ApiCompositionScore;
  return_quality_summary?: ApiCompositionReturnQualitySummary;
  rebalance_events?: ApiCompositionRebalanceEvent[];
  source_integrity?: ApiCompositionSourceIntegrity[];
  primary_diagnosis?: ApiCompositionStatusDiagnosis | null;
  diagnoses?: ApiCompositionStatusDiagnosis[];
  warnings: string[];
  advisories: string[];
};

export type ApiCompositionCreatePayload = ApiCompositionPreviewPayload & {
  status?: ApiCompositionStatus;
};

export type ApiCompositionUpdatePayload = {
  name?: string | null;
  description?: string | null;
  status?: ApiCompositionStatus;
  benchmark_definition?: ApiCompositionBenchmarkDefinition | null;
  rebalance_frequency?: string | null;
  cost_policy?: ApiCompositionCostPolicy | null;
  legs?: ApiCompositionLegInput[] | null;
  version_reason?: string | null;
  version_change_summary?: string | null;
  version_source?: string | null;
  version_candidate_id?: string | null;
  version_candidate_label?: string | null;
};

export type ApiCompositionSourceFreezeRefreshPayload = {
  reason?: string | null;
  confirmed_by?: string | null;
};

export type ApiCompositionListItem = {
  id: string;
  name: string;
  status: string;
  composition_score: number;
  leg_count: number;
  rebalance_frequency?: string | null;
  benchmark_label?: string | null;
  version_label?: string | null;
  version_status?: string | null;
  version_status_label?: string | null;
  evidence_grade?: string | null;
  evidence_label?: string | null;
  latest_backtest_label?: string | null;
  latest_backtest_detail?: string | null;
  latest_backtest_summary?: Record<string, unknown>;
  backtest_period_coverage?: ApiCompositionBacktestPeriodCoverage[];
  allocation_lab_label?: string | null;
  allocation_lab_detail?: string | null;
  lab_summary?: Record<string, unknown>;
  pending_decision_count?: number | null;
  promotion_candidate_count?: number | null;
  promotion_readiness?: Record<string, unknown>;
  annualized_return: number;
  sharpe: number;
  max_drawdown: number;
  updated_at: string;
  latest_activity_label: string;
  allowed_actions: string[];
  has_new_version?: boolean;
  source_integrity?: ApiCompositionSourceIntegrity[];
  return_quality_summary?: ApiCompositionReturnQualitySummary;
  primary_diagnosis?: ApiCompositionStatusDiagnosis | null;
  diagnoses?: ApiCompositionStatusDiagnosis[];
};

export type ApiCompositionBacktestPeriodCoverage = {
  period: '10Y' | '20Y' | '30Y' | string;
  status: 'covered' | 'missing' | 'warning' | string;
  run_id?: string | null;
  label?: string | null;
  detail?: string | null;
  completed_at?: string | null;
};

export type ApiCompositionGlobalBacktestRunListItem = {
  id: string;
  run_id?: string | null;
  composition_id: string;
  composition_name?: string | null;
  composition_version_label?: string | null;
  status: string;
  time_period_label?: string | null;
  verdict_label?: string | null;
  verdict_detail?: string | null;
  annualized_return?: number | null;
  sharpe?: number | null;
  max_drawdown?: number | null;
  scenario_id?: string | null;
  scenario_label?: string | null;
  scenario_detail?: string | null;
  scenario_status_label?: string | null;
  scenario_drawdown?: number | null;
  scenario_benchmark_drawdown?: number | null;
  scenario_recovery_days?: number | null;
  scenario_benchmark_recovery_days?: number | null;
  scenario_defensive_delta?: number | null;
  scenario_source?: string | null;
  order_count?: number | null;
  order_evidence_label?: string | null;
  risk_budget_label?: string | null;
  evidence_grade?: string | null;
  evidence_label?: string | null;
  primary_diagnosis?: ApiCompositionStatusDiagnosis | null;
  diagnoses?: ApiCompositionStatusDiagnosis[];
  created_at?: string | null;
  completed_at?: string | null;
};

export type ApiCompositionBacktestRunDeleteResult = {
  id: string;
  run_id?: string | null;
  composition_id: string;
  status: string;
  deleted_at: string;
  deleted_reason: string;
};

export type ApiCompositionGlobalAllocationJobListItem = {
  id: string;
  job_id?: string | null;
  composition_id: string;
  composition_name?: string | null;
  composition_version_label?: string | null;
  status: string;
  method_key?: string | null;
  method_label?: string | null;
  method_detail?: string | null;
  best_candidate_label?: string | null;
  candidate_count?: number | null;
  promotion_ready_count?: number | null;
  promotion_gate_label?: string | null;
  gate_status?: string | null;
  migration_cost_bps?: number | null;
  annualized_return_delta?: number | null;
  sharpe_delta?: number | null;
  max_drawdown_delta?: number | null;
  enb?: number | null;
  evidence_grade?: string | null;
  evidence_label?: string | null;
  primary_diagnosis?: ApiCompositionStatusDiagnosis | null;
  diagnoses?: ApiCompositionStatusDiagnosis[];
  policy_violation_count?: number | null;
  created_at?: string | null;
  completed_at?: string | null;
};

export type ApiCompositionKpi = {
  key: string;
  label: string;
  value: string | number;
  unit?: string | null;
  tone: string;
  detail?: string | null;
};

export type ApiCompositionHeroSummary = {
  title: string;
  subtitle?: string | null;
  status: string;
  status_label: string;
  benchmark_label?: string | null;
  leg_count: number;
  composition_score: number;
  updated_at?: string | null;
};

export type ApiCompositionRebalanceMarker = {
  label: string;
  date?: string | null;
  index: number;
};

export type ApiCompositionScenarioSummary = {
  base_case: Record<string, unknown>;
  stress_case: Record<string, unknown>;
  cases?: Array<Record<string, unknown>>;
  dispersion_note?: string | null;
};

export type ApiCompositionSourceFreeze = {
  id: string;
  leg_id: string;
  display_name: string;
  freeze_ref_type: string;
  freeze_ref_id: string;
  freeze_hash: string;
  captured_at: string;
  snapshot: Record<string, unknown>;
  signature_status?: string | null;
  drift_status?: string | null;
  current_ref_id?: string | null;
  alerts?: string[];
};

export type ApiCompositionBacktestHistoryItem = {
  run_id: string;
  created_at: string;
  completed_at?: string | null;
  composition_version_label?: string | null;
  composition_version_number?: number | null;
  strategy_version_label?: string | null;
  strategy_versions?: Array<Record<string, unknown>>;
  period_label?: string | null;
  horizon_years?: number | null;
  annualized_return?: number | null;
  sharpe?: number | null;
};

export type ApiCompositionDetail = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  status_label: string;
  current_composition_version_label?: string | null;
  current_composition_version_number?: number | null;
  created_at: string;
  updated_at: string;
  benchmark_definition?: ApiCompositionBenchmarkDefinition | null;
  rebalance_frequency?: string | null;
  cost_policy: ApiCompositionCostPolicy;
  hero_summary: ApiCompositionHeroSummary;
  kpis: ApiCompositionKpi[];
  weight_summary: ApiCompositionWeightSummary;
  normalized_legs: ApiCompositionPreviewLeg[];
  returns_preview: ApiCompositionReturnPoint[];
  benchmark_series: ApiCompositionBenchmarkPoint[];
  spread_series: ApiCompositionSpreadPoint[];
  rebalance_markers: ApiCompositionRebalanceMarker[];
  correlation_matrix: ApiCompositionCorrelationCell[];
  risk_contribution_preview: ApiCompositionRiskContribution[];
  maintenance_cost_summary: ApiCompositionMaintenanceCostSummary;
  return_quality_summary?: ApiCompositionReturnQualitySummary;
  rebalance_events?: ApiCompositionRebalanceEvent[];
  scenario_summary: ApiCompositionScenarioSummary;
  source_evidence: ApiCompositionSourceFreeze[];
  source_integrity?: ApiCompositionSourceIntegrity[];
  backtest_history?: ApiCompositionBacktestHistoryItem[];
  audit_trail?: ApiCompositionAuditTrailItem[];
  primary_diagnosis?: ApiCompositionStatusDiagnosis | null;
  diagnoses?: ApiCompositionStatusDiagnosis[];
  composition_score: ApiCompositionScore;
  latest_activity_label: string;
  deep_link_actions: string[];
};

export type ApiCompositionBacktestRunPayload = {
  idempotency_key: string;
  composition_version?: string | null;
  period?: string | null;
  horizon_years?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  rebalance_frequency?: string | null;
  drift_threshold_pct?: number | null;
  fee_bps?: number | null;
  slippage_bps?: number | null;
  missing_data_rule?: string | null;
  notes?: string | null;
};

export type ApiCompositionBacktestRun = {
  id: string;
  run_id: string;
  composition_id: string;
  current_composition_version_label?: string | null;
  current_composition_version_number?: number | null;
  status: string;
  created_at: string;
  completed_at?: string | null;
  request: Record<string, unknown>;
  summary: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  returns_preview: ApiCompositionReturnPoint[];
  benchmark_series: ApiCompositionBenchmarkPoint[];
  risk_contribution_preview: ApiCompositionRiskContribution[];
  rebalance_events: ApiCompositionRebalanceEvent[];
  return_quality_summary: ApiCompositionReturnQualitySummary;
  source_integrity: ApiCompositionSourceIntegrity[];
  audit_trail: ApiCompositionAuditTrailItem[];
  order_summary: Record<string, unknown>;
  evidence: Record<string, unknown>;
  evidence_grade?: string | null;
  scenario_anchors?: Array<Record<string, unknown>>;
  risk_budget_timeline?: Array<Record<string, unknown>>;
  promotion_readiness?: Record<string, unknown>;
  primary_diagnosis?: ApiCompositionStatusDiagnosis | null;
  diagnoses?: ApiCompositionStatusDiagnosis[];
  warnings: string[];
};

export type ApiCompositionBacktestOrder = {
  id: string;
  order_id: string;
  run_id: string;
  event_id: string;
  event_label: string;
  event_date?: string | null;
  symbol: string;
  side: string;
  quantity?: number | null;
  quantity_unit: string;
  price?: number | null;
  slippage_bps: number;
  fee_amount?: number | null;
  source_leg_id: string;
  source_leg_name: string;
  source_leg_kind: string;
  trigger_reason: string;
  gross_buy_quantity: number;
  gross_sell_quantity: number;
  internal_net_quantity: number;
  external_quantity: number;
  netting_ratio_pct: number;
  netting_status: string;
  execution_kind: string;
  quality_label: string;
  evidence_label: string;
};

export type ApiCompositionBacktestOrderPage = {
  items: ApiCompositionBacktestOrder[];
  page: number;
  page_size: number;
  total: number;
  symbol_filter?: string | null;
  source_leg_filter?: string | null;
  filters: Record<string, unknown>;
  generated_from: string;
  quality_label: string;
  evidence_label: string;
};

export type ApiCompositionBacktestOrderNetting = {
  order_id: string;
  run_id: string;
  composition_id: string;
  symbol: string;
  event_id: string;
  event_label: string;
  event_date?: string | null;
  source_leg_id: string;
  source_leg_name: string;
  before_netting: Record<string, number>;
  after_netting: Record<string, number>;
  internal_net_quantity: number;
  external_quantity: number;
  netting_ratio_pct: number;
  netting_status: string;
  generated_from: string;
  quality_label: string;
  evidence_label: string;
};

export type ApiCompositionBacktestOrdersQuery = {
  symbol?: string | null;
  source_leg?: string | null;
  scenario?: string | null;
  page?: number;
  page_size?: number;
};

export type ApiCompositionOrderExportFormat = "csv" | "xlsx";

export type ApiCompositionAllocationJobPayload = {
  idempotency_key: string;
  intent?: string | null;
  target_volatility_pct?: number | null;
  volatility_band_pct?: number | null;
  lookback_window?: string | null;
  history_window_years?: number | null;
  max_turnover_bucket?: string | null;
  max_turnover_pct?: number | null;
  covariance_model?: string | null;
  return_source?: string | null;
  constraints?: Record<string, unknown>;
  notes?: string | null;
};

export type ApiCompositionAllocationJob = {
  id: string;
  job_id: string;
  composition_id: string;
  status: string;
  created_at: string;
  completed_at?: string | null;
  request: Record<string, unknown>;
  summary: Record<string, unknown>;
  candidates: Array<Record<string, unknown>>;
  frontier_points: Array<Record<string, unknown>>;
  residual_budget: Record<string, unknown>;
  covariance_preview: Array<Record<string, unknown>>;
  return_quality_summary: ApiCompositionReturnQualitySummary;
  source_integrity: ApiCompositionSourceIntegrity[];
  audit_trail: ApiCompositionAuditTrailItem[];
  evidence: Record<string, unknown>;
  evidence_grade?: string | null;
  scenario_anchors?: Array<Record<string, unknown>>;
  risk_budget_timeline?: Array<Record<string, unknown>>;
  promotion_readiness?: Record<string, unknown>;
  primary_diagnosis?: ApiCompositionStatusDiagnosis | null;
  diagnoses?: ApiCompositionStatusDiagnosis[];
  warnings: string[];
};

export type ApiCompositionVersion = {
  id: string;
  composition_id: string;
  version_number: number;
  status: string;
  source_kind: string;
  source_ref_id?: string | null;
  created_at: string;
  diff_summary?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  diff?: Record<string, unknown>;
};

export type ApiCompositionDecisionPacket = {
  id: string;
  composition_id: string;
  version_id?: string | null;
  source_refs: Record<string, unknown>;
  packet: Record<string, unknown>;
  export_markdown: string;
  export_html: string;
  created_at: string;
};

export type ApiBondSnapshotCard = {
  id: string;
  label: string;
  status: string;
  value?: string | null;
  detail?: string | null;
};

export type ApiBondSnapshotPillarGroup = {
  id: string;
  label: string;
  status: string;
  items: ApiBondSnapshotCard[];
};

export type ApiBondSnapshotCurvePoint = {
  tenor_label: string;
  yield_pct: number;
  spread_bps: number;
};

export type ApiBondSnapshotAuditRow = {
  id: string;
  label: string;
  owner: string;
  status: string;
  cadence_label: string;
  evidence: string;
};

export type ApiBondSnapshotRegistryItem = {
  id: string;
  label: string;
  status: string;
  source: string;
  snapshot_ref?: string | null;
  updated_at?: string | null;
  notes: string[];
};

export type ApiBondSnapshotSourcedReadyCount = {
  sourced?: number | null;
  ready?: number | null;
  sourced_count?: number | null;
  ready_count?: number | null;
  total?: number | null;
};

export type ApiBondSnapshotGroupCounts = {
  ust?: ApiBondSnapshotSourcedReadyCount | null;
  tips?: ApiBondSnapshotSourcedReadyCount | null;
  ig?: ApiBondSnapshotSourcedReadyCount | null;
  [key: string]: ApiBondSnapshotSourcedReadyCount | null | undefined;
};

export type ApiBondSnapshotEligibleSource = {
  id: string;
  label: string;
  source: string;
  status: string;
  access_tier?: string;
  instrument_types: string[];
  coverage_notes: string[];
  updated_at?: string | null;
};

export type ApiBondCreditQuality = string | Record<string, unknown>;

export type ApiBondSnapshotEligibleInstrument = {
  id: string;
  label: string;
  instrument_type: string;
  asset_type?: string | null;
  tenor_label?: string | null;
  audit_profile?: string | null;
  group?: string | null;
  category?: string | null;
  source: string;
  status: string;
  symbol?: string | null;
  isin?: string | null;
  cusip?: string | null;
  currency?: string | null;
  snapshot_date?: string | null;
  maturity_date?: string | null;
  coupon_rate_pct?: number | null;
  clean_price?: number | null;
  net_price?: number | null;
  dirty_price?: number | null;
  full_price?: number | null;
  accrued_interest?: number | null;
  ytm_pct?: number | null;
  discount_rate_pct?: number | null;
  real_yield_pct?: number | null;
  inflation_factor?: number | null;
  breakeven_inflation_bps?: number | null;
  breakeven_pct?: number | null;
  duration?: number | null;
  effective_duration?: number | null;
  sec_yield_30d_pct?: number | null;
  thirty_day_sec_yield_pct?: number | null;
  credit_quality?: ApiBondCreditQuality | null;
  tracking_error_bps?: number | null;
  tracking_error_source?: string | null;
  audit_alerts?: string[];
  audit_notes?: string[];
  tracking_status?: string | null;
  convexity?: number | null;
  snapshot_ref?: string | null;
  refresh_status?: string | null;
  creation_disabled_reason?: string | null;
  asset_leg_disabled_reason?: string | null;
  missing_fields: string[];
  inferred_fields: Record<string, unknown>;
  field_status: Record<string, string>;
  updated_at?: string | null;
};

export type ApiBondSnapshotScheduler = {
  status: string;
  cadence_label: string;
  next_action?: string | null;
  last_job_id?: string | null;
};

export type ApiBondSnapshotSourceSummary = {
  primary_source: string;
  fallback_source?: string | null;
  selection_reason: string;
};

export type ApiBondSnapshotSystemDiagnostics = {
  blocking_code?: string | null;
  blocking_target?: unknown;
  refresh_job_status?: string | null;
  memory: Record<string, unknown>;
  notes: string[];
};

export type ApiBondFixedIncomeOverview = {
  global_pulse: {
    status: string;
    headline: string;
    updated_at?: string | null;
    cards: ApiBondSnapshotCard[];
  };
  pillar_groups: ApiBondSnapshotPillarGroup[];
  curve_preview: ApiBondSnapshotCurvePoint[];
  audit_matrix: ApiBondSnapshotAuditRow[];
  raw_registry: ApiBondSnapshotRegistryItem[];
  eligible_sources: ApiBondSnapshotEligibleSource[];
  eligible_instruments: ApiBondSnapshotEligibleInstrument[];
  scheduler: ApiBondSnapshotScheduler;
  selected_source_summary: ApiBondSnapshotSourceSummary;
  system_diagnostics: ApiBondSnapshotSystemDiagnostics;
  group_counts?: ApiBondSnapshotGroupCounts;
  sourced_ready_counts?: ApiBondSnapshotGroupCounts;
  instrument_counts?: ApiBondSnapshotGroupCounts;
  ust_metrics?: Record<string, unknown> | null;
  tips_metrics?: Record<string, unknown> | null;
  lqd_metrics?: Record<string, unknown> | null;
  group_metrics?: Record<string, Record<string, unknown> | null> | null;
  ust_sourced_count?: number | null;
  ust_ready_count?: number | null;
  tips_sourced_count?: number | null;
  tips_ready_count?: number | null;
  ig_sourced_count?: number | null;
  ig_ready_count?: number | null;
  ust_10y_2y_spread_bps?: number | null;
  top_ust_10y_2y_spread_bps?: number | null;
  tips_real_yield_pct?: number | null;
  tips_inflation_factor?: number | null;
  tips_breakeven_pct?: number | null;
  lqd_effective_duration?: number | null;
  lqd_sec_yield_30d_pct?: number | null;
  lqd_credit_quality?: ApiBondCreditQuality | null;
  lqd_tracking_status?: string | null;
  quality_audit?: Array<Record<string, unknown>>;
  repair_rules?: Array<Record<string, unknown>>;
  daily_accrual_status?: Array<Record<string, unknown>>;
  risk_budget_inputs?: Array<Record<string, unknown>>;
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
  provider_readiness_summary?: ApiSnapshotProviderReadinessSummary;
  data_trust_summary?: ApiDataTrustSummary;
  data_layer_readiness?: Array<{
    layer_id: string;
    title_cn: string;
    status: string;
    summary: string;
    metrics?: Array<{
      label: string;
      value: string | number | null;
      detail?: string | null;
      tone?: string | null;
    }>;
    updated_at?: string | null;
    provider_keys?: string[];
    linked_targets?: string[];
    linked_target_evidence?: Array<{
      dataset_id: string;
      evidence_kind: string;
    }>;
    [key: string]: unknown;
  }>;
  snapshot_quality_alerts?: Array<{
    code: string;
    severity: string;
    title_cn: string;
    detail_cn: string;
    source_layer: string;
    blocking: boolean;
    target?: string | null;
    action_label_cn?: string | null;
    operator_action_cn?: string | null;
    [key: string]: unknown;
  }>;
  factor_dimension_readiness?: Array<{
    dimension_id: string;
    title_cn: string;
    status: string;
    supported_factors: string[];
    blockers?: string[];
    linked_layers?: string[];
    [key: string]: unknown;
  }>;
  bond_fixed_income: ApiBondFixedIncomeOverview;
};

export type ApiSnapshotRefreshRequest = {
  reason?: string | null;
  mode?: SnapshotRefreshMode;
  targets?: SnapshotRefreshTarget[];
  repair_symbol_limit?: number | null;
  symbols?: string[];
  phase2_scope?: 'sp500_10y' | 'l1_all' | 'custom' | null;
  phase2_max_symbols?: number | null;
  phase2_cursor?: string | null;
};

export type ApiPitDataOverview = {
  dataset_snapshot_id: string;
  fundamental_snapshot_id?: string;
  universe_snapshot_id: string;
  as_of_date: string;
  cleaning_version: string;
  overall_status: string;
  adjusted_price_status: string;
  universe_status: string;
  outlier_cleaning_status: string;
  corporate_action_status?: string | null;
  fundamental_status?: string;
  coverage: {
    covered_symbol_count: number;
    total_symbol_count: number;
    coverage_pct: number;
    price_bar_rows: number;
    universe_member_rows: number;
    raw_universe_member_rows?: number;
    universe_history_anchor_count?: number;
    universe_history_annual_anchor_count?: number;
  };
  fundamental_coverage?: {
    covered_symbol_count: number;
    total_symbol_count: number;
    coverage_pct: number;
    fundamental_point_rows: number;
    coverage_rows: number;
    available_fields: string[];
    missing_fields: string[];
    source_snapshot_status?: string;
    source_snapshot_updated_at?: string | null;
    seed_version?: string | null;
    missing_available_at_count?: number;
    missing_publish_date_count?: number;
    time_contract?: string | null;
  };
  blocking_items: Array<{
    code: string;
    message: string;
    target?: string | null;
    fix_hash?: string | null;
    [key: string]: unknown;
  }>;
  status_reasons?: Record<string, {
    status: string;
    cause: string;
    description: string;
  }>;
  ops_guidance?: {
    headline: string;
    severity: string;
    live_ready_risk?: string;
    identity_pending_count?: number;
    current_core_missing_count?: number;
    historical_lifecycle_missing_count?: number;
    actions?: Array<{
      label: string;
      target: string;
      priority?: string;
    }>;
  };
  sample_securities: string[];
  quality_events: Array<{
    id?: string;
    severity: string;
    event_type: string;
    title: string;
    message: string;
    target_date?: string | null;
    target_symbol?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  coverage_gap?: {
    missing_symbol_count: number;
    missing_share_pct: number;
    covered_symbol_count: number;
    total_symbol_count: number;
    default_ignored_symbols: string[];
    default_ignored_count: number;
    evidence_source: string;
    recommendation: string;
    identity_resolved_count?: number;
    buckets: Array<{
      id: string;
      label: string;
      count: number;
      share_pct: number;
      mcap_weight_pct?: number;
      symbols?: string[];
      sample_symbols: string[];
      temporal_distribution?: Array<{
        date: string;
        missing_count: number;
        member_count: number;
        share_pct: number;
        is_recent_window?: boolean;
      }>;
      symbol_details?: Array<{
        symbol: string;
        identity_status: string;
        canonical_symbol?: string;
        company_name?: string;
        mcap_weight_pct?: number;
        ticker_path: Array<{
          date?: string;
          symbol: string;
          canonical_symbol?: string;
          source?: string;
          label?: string;
        }>;
        mapping_action?: {
          label: string;
          endpoint: string;
          method: string;
        };
      }>;
      evidence: string;
      recommendation: string;
      action_label?: string;
      action_target?: string;
    }>;
  };
  factor_admission_coverage?: {
    status: string;
    window_years: number;
    window_start: string;
    window_end: string;
    blocks_factor_admission: boolean;
    diagnostics_enabled: boolean;
    source?: string;
    active_universe_symbol_count: number;
    covered_symbol_count: number;
    current_core_missing_count: number;
    current_core_missing_symbols?: string[];
    active_window_missing_count: number;
    active_window_missing_symbols?: string[];
    repair_symbol_count: number;
    repair_symbols?: string[];
    archival_missing_count: number;
    archival_missing_symbols?: string[];
    metadata_missing_count: number;
    metadata_mismatch_count: number;
    metadata_mismatch_symbols?: string[];
    warning_items?: Array<{
      code: string;
      label?: string;
      message: string;
      symbols?: string[];
      fix_hash?: string;
      [key: string]: unknown;
    }>;
    hard_blockers?: Array<{
      code: string;
      label?: string;
      message: string;
      symbols?: string[];
      fix_hash?: string;
      [key: string]: unknown;
    }>;
    policy?: string;
    stress_scenario_policy?: string;
  };
  cleaning_rule_previews?: Array<{
    id: string;
    method: string;
    label: string;
    description: string;
    status: string;
    excluded_count: number;
    excluded_pct: number;
    sample_size: number;
    threshold_label: string;
    sample_points: Array<{
      symbol: string;
      date: string;
      value: number | null;
    }>;
  }>;
  universe_history_series?: Array<{
    date: string;
    member_count: number;
    is_latest?: boolean;
  }>;
  adjustment_trace?: {
    symbol: string;
    points: Array<{
      date: string;
      close?: number | null;
      adjusted_close?: number | null;
      adjustment_factor?: number | null;
    }>;
    events: Array<Record<string, unknown>>;
    factor_min?: number | null;
    factor_max?: number | null;
  };
  research_waiver?: {
    id: string;
    status: string;
    dataset_snapshot_id: string;
    universe_snapshot_id: string;
    ignored_symbols: string[];
    ignored_symbol_count: number;
    reason: string;
    created_at?: string | null;
    created_by?: string | null;
    promotion_eligible: false;
    mode: string;
    impact_estimate?: {
      ignored_symbol_count: number;
      ignored_missing_share_pct: number;
      mcap_weight_pct: number;
      estimated_ic_delta_abs: number;
      risk_level: string;
      affected_buckets?: string[];
      method?: string;
      note?: string;
    };
  } | null;
  full_ready_repair_plan?: {
    status: string;
    target_status: string;
    remaining_symbol_count: number;
    queue_total_count: number;
    queue_symbols?: string[];
    queue_price_symbols?: string[];
    queue_corporate_action_symbols?: string[];
    queue_sample: Array<{
      symbol: string;
      bucket: string;
      priority: number;
      status: string;
      repair_targets: string[];
      alias_candidates: string[];
      price_providers: string[];
      corporate_action_providers: string[];
      identity_providers?: string[];
      membership_providers?: string[];
      provider_priority?: string[];
      next_provider?: string | null;
      required_evidence?: string[];
      trust_blocker?: string;
      evidence?: string;
    }>;
    bucket_counts: Record<string, number>;
    provider_cooldowns: Array<{
      provider: string;
      target: string;
      next_retry_at?: string | null;
      quota_limited?: boolean;
      reason?: string;
    }>;
    provider_cooldown_count: number;
    next_retry_at?: string | null;
    zero_event_certificates: Array<Record<string, unknown>>;
    zero_event_certificate_count: number;
    waiver_blocks_full_ready: boolean;
    free_source_policy: string;
    recommendation: string;
    rejection_criteria: string[];
  };
  external_source_readiness?: {
    generated_at: string;
    cache_dir: string;
    security_policy: Record<string, unknown>;
    kaggle_auth_status: Record<string, unknown>;
    kaggle_cache_manifest: {
      cache_dir: string;
      status: string;
      manifest_count: number;
      datasets: Array<Record<string, unknown>>;
      recommendations: Array<Record<string, unknown>>;
      search_terms: string[];
    };
    matrix_coverage_status: {
      status: string;
      source_count: number;
      latest_source_url?: string | null;
      latest_revision_id?: string | null;
      effective_start?: string | null;
      effective_end?: string | null;
      member_event_count: number;
      recommendations: Array<Record<string, unknown>>;
      requirement: string;
    };
    parquet_catalog_status: {
      status: string;
      duckdb_catalog: string;
      catalog_exists: boolean;
      normalized_dir: string;
      parquet_file_count: number;
      manifest_catalog_count: number;
      partitioning: string;
    };
    polygon_status: Record<string, unknown>;
    critical_polygon_candidates: Array<{
      symbol: string;
      bucket: string;
      repair_targets: string[];
      priority: number;
      reason: string;
    }>;
    remaining_blockers_by_source: Record<string, unknown>;
    source_recommendations: Record<string, unknown>;
  };
  data_trust_summary?: ApiDataTrustSummary;
  factor_diagnostics_enabled: boolean;
  verified_diagnostics_enabled?: boolean;
  limited_diagnostics_enabled?: boolean;
  sandbox_diagnostics_enabled?: boolean;
  diagnostic_windows?: {
    sandbox?: {
      mode: "SANDBOX";
      enabled: boolean;
      start_date: string;
      end_date: string;
      label: string;
    };
    verified?: {
      mode: "VERIFIED";
      enabled: boolean;
      start_date: string;
      end_date: string;
      label: string;
      missing_windows?: Array<{
        kind?: string;
        label: string;
        start_date?: string;
        end_date?: string;
      }>;
    };
  };
  gate_fix_target: string;
  source?: Record<string, unknown>;
  pit_layer_readiness?: Array<{
    layer_id: string;
    title_cn: string;
    status: string;
    summary: string;
    pit_alignment: string;
    blockers?: string[];
    available_at_health?: {
      status?: string;
      sampled_row_count?: number;
      missing_available_at_count?: number;
      missing_publish_date_count?: number;
      [key: string]: unknown;
    } | null;
    metrics?: Array<{
      label: string;
      value: string | number | boolean | null;
      [key: string]: unknown;
    }>;
    submodules?: Array<{
      id: string;
      title_cn: string;
      status: string;
      usable: boolean;
      summary_cn: string;
      linked_targets?: string[];
      metrics?: Record<string, unknown>;
      blockers?: string[];
      upstream_capabilities?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    }>;
    upstream_capabilities?: Array<{
      capability_id: string;
      factor_groups: string[];
      mode: string;
      allowed_actions: string[];
      required_checks?: string[];
      satisfied_checks?: string[];
      blocked_checks?: string[];
      summary_cn?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
  factor_diagnostic_readiness?: Array<{
    group_id: string;
    title_cn: string;
    status: string;
    factors: string[];
    rationale_cn: string;
    linked_snapshot_checks?: string[];
    required_checks?: string[];
    satisfied_checks?: string[];
    blocked_checks?: string[];
    upstream_capabilities?: Array<{
      capability_id: string;
      factor_groups: string[];
      mode: string;
      allowed_actions: string[];
      required_checks?: string[];
      satisfied_checks?: string[];
      blocked_checks?: string[];
      summary_cn?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }>;
  pit_quality_alerts?: Array<{
    code: string;
    severity: string;
    title_cn: string;
    detail_cn: string;
    hard_blocking: boolean;
    linked_factor_groups?: string[];
    [key: string]: unknown;
  }>;
  snapshot_layer_linkage?: Array<{
    check_id: string;
    check_title_cn: string;
    source_layer: string;
    target_factor_groups: string[];
    result_status: string;
    hard_blocking?: boolean;
    capability_mode?: string;
    detail_cn?: string;
    [key: string]: unknown;
  }>;
};

export type ApiPitResearchWaiverPayload = {
  dataset_snapshot_id?: string | null;
  universe_snapshot_id?: string | null;
  ignored_symbols?: string[];
  reason?: string | null;
  created_by?: string | null;
};

export type ApiPitIdentityOverridePayload = {
  symbol: string;
  canonical_symbol: string;
  company_name?: string | null;
  cik?: string | null;
  exchange?: string | null;
  ipo_date?: string | null;
  delisting_date?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  reason?: string | null;
  created_by?: string | null;
};

export type ApiPitIdentityScraperRestartPayload = {
  symbols?: string[];
  max_symbols?: number | null;
  reason?: string | null;
  created_by?: string | null;
};

export type ApiPitIdentityScraperRestartResponse = {
  job_id: string;
  status: string;
  message: string;
  started_at: string;
  completed_at: string;
  attempted_count: number;
  resolved_count: number;
  failed_count: number;
  external_resolved_count?: number;
  external_resolved_symbols?: string[];
  local_fallback_count?: number;
  local_fallback_symbols?: string[];
  pending_before: number;
  pending_after: number;
  resolved_symbols: string[];
  failed_symbols: string[];
  pit_data: ApiPitDataOverview;
};

export type ApiFactorLifecycleStatus =
  | "DRAFT"
  | "VERIFIED"
  | "PRODUCTION"
  | "DECAYED"
  | "DEPRECATED"
  | "PRUNED"
  | "INVALID"
  | "SOURCE_INVALID"
  | "DATA_SOURCE_INVALID";
export type ApiFactorDiagnosticStatus =
  | "READY_TO_DIAGNOSE"
  | "SANDBOX_READY"
  | "BLOCKED_PIT"
  | "BLOCKED_DATA"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED";
export type ApiFactorSource = "MANUAL" | "SYSTEM_SEED" | "AUTO_MINED";
export type ApiFactorDirection = "HIGH_IS_BETTER" | "LOW_IS_BETTER" | "NEUTRAL";
export type ApiFactorFrequency = "DAILY" | "WEEKLY" | "MONTHLY";
export type ApiFactorUiState = "robust" | "needs_calibration" | "decayed" | "sandbox";

export type ApiFactorDescriptor = {
  source_prefix: "s" | "m" | "a" | string;
  category: string;
  metric: string;
  window: string;
  operator: string;
  schema_version: string;
  canonical_id: string;
};

export type ApiFactorDiagnosticSummary = {
  run_id?: string;
  factor_id?: string;
  status?: string;
  diagnostic_mode?: "VERIFIED" | "SANDBOX";
  descriptor?: ApiFactorDescriptor;
  dataset_snapshot_id?: string;
  fundamental_snapshot_id?: string;
  universe_snapshot_id?: string;
  cleaning_version?: string;
  ic?: number | null;
  rank_ic?: number | null;
  ir?: number | null;
  ir_display_value?: number | null;
  ir_reference_only?: boolean;
  ir_evidence?: Record<string, unknown>;
  coverage?: number | null;
  group_returns?: Array<{ group: string; mean_return: number | null; sample_count: number }>;
  group_return_series?: Array<{
    date?: string | null;
    groups: Array<{ group: string; mean_return: number | null; sample_count: number }>;
    q1_mean_return?: number | null;
    q5_mean_return?: number | null;
    q1_q5_spread?: number | null;
  }>;
  monotonicity?: Record<string, unknown>;
  ic_series?: Array<{ date: string; ic?: number | null; rank_ic?: number | null; symbol_count?: number }>;
  evidence_heatmap?: Array<{ window: string; bucket: string; value?: number | null; state: string }>;
  turnover_decay?: Record<string, unknown>;
  stress_scenarios?: Array<Record<string, unknown>>;
  risk_flags?: string[];
  admission?: Record<string, unknown>;
  compliance_trail?: Record<string, unknown>;
  artifact_refs?: Record<string, string>;
  [key: string]: unknown;
};

export type ApiFactorCreationRiskItem = {
  factor_id?: string;
  code: string;
  severity: "warning" | "blocker" | string;
  message: string;
  label?: string;
  category?: string;
  fix_hash?: string;
  [key: string]: unknown;
};

export type ApiFactorStrategyCreationRisk = {
  can_create: boolean;
  warning_count: number;
  blocked_count: number;
  warnings: ApiFactorCreationRiskItem[];
  hard_blockers: ApiFactorCreationRiskItem[];
  summary_label?: string;
  summary?: string;
  [key: string]: unknown;
};

export type ApiFactorBlockerReasonSummary = {
  status: "clear" | "warning" | "blocked" | string;
  label: string;
  reasons: ApiFactorCreationRiskItem[];
  warning_count?: number;
  blocked_count?: number;
  [key: string]: unknown;
};

export type ApiFactorCorrelationClusterSummary = {
  cluster_id?: string;
  high_correlation_count: number;
  top_pairs?: Array<Record<string, unknown>>;
  max_correlation?: number | null;
  summary_label?: string;
  [key: string]: unknown;
};

export type ApiFactorBatchDiagnosticSummary = {
  latest_run_id?: string | null;
  latest_diagnostic_at?: string | null;
  rank_ic?: number | null;
  ir?: number | null;
  coverage?: number | null;
  turnover_decay?: Record<string, unknown>;
  warning_count?: number;
  blocked_count?: number;
  [key: string]: unknown;
};

export type ApiFactorTierLevel = "F1" | "F2" | "F3" | string;
export type ApiFactorLifecycleProjectionKey = "sandbox" | "online" | "to_be_verified" | "archived" | string;
export type ApiFactorLevelKey = "S" | "A" | "B" | "C" | "D" | string;

export type ApiFactorTierProjection = {
  key: ApiFactorTierLevel;
  label: string;
  name?: string;
  kind?: "raw" | "refined" | "composite" | string;
  description?: string;
  [key: string]: unknown;
};

export type ApiFactorLifecycleProjection = {
  key: ApiFactorLifecycleProjectionKey;
  label: string;
  description?: string;
  source_status?: string;
  [key: string]: unknown;
};

export type ApiFactorLevelProjection = {
  key: ApiFactorLevelKey;
  label: string;
  description?: string;
  [key: string]: unknown;
};

export type ApiFactorOpStatus = {
  lights: Array<{
    code: "W" | "N" | "Z" | "T" | string;
    key: string;
    label: string;
    active: boolean;
    status: "done" | "missing" | string;
  }>;
  completed?: string[];
  missing?: string[];
  summary?: string;
  [key: string]: unknown;
};

export type ApiFactorLineageSummary = {
  has_lineage: boolean;
  parent_count: number;
  parent_ids: string[];
  root_source?: string | null;
  relation_types?: string[];
  [key: string]: unknown;
};

export type ApiFactorQualityView = {
  rank_ic?: number | null;
  ir?: number | null;
  raw_ir?: number | null;
  ir_label?: string | null;
  ir_reference_only?: boolean;
  ir_evidence?: Record<string, unknown>;
  coverage?: number | null;
  decay_days?: number | null;
  decay_label?: string | null;
  sparkline?: Array<{ date?: string; value: number }>;
  sparkline_window?: string | null;
  [key: string]: unknown;
};

export type ApiFactorCompositeView = {
  quality?: {
    sharpe?: number | null;
    sharpe_label?: string | null;
    max_drawdown_pct?: number | null;
    max_drawdown_label?: string | null;
    incremental_ir?: number | null;
    [key: string]: unknown;
  };
  capacity?: {
    status?: "PASS" | "WARN" | "FAIL" | "UNKNOWN" | string;
    label?: string | null;
    score?: number | null;
    source?: string | null;
    [key: string]: unknown;
  };
  turnover_cost?: {
    turnover_rate_weekly?: number | null;
    turnover_rate_weekly_label?: string | null;
    cost_bps?: number | null;
    cost_bps_label?: string | null;
    [key: string]: unknown;
  };
  style_exposure?: {
    style_corr?: number | null;
    style_corr_label?: string | null;
    status?: "PASS" | "WARN" | "FAIL" | "UNKNOWN" | string;
    label?: string | null;
    [key: string]: unknown;
  };
  execution?: {
    portfolio_id?: string | null;
    portfolio_label?: string | null;
    execution_tag?: string | null;
    execution_tag_label?: string | null;
    [key: string]: unknown;
  };
  blend_info?: {
    component_count?: number | null;
    component_ids?: string[];
    method_labels?: string[];
    label?: string | null;
    [key: string]: unknown;
  };
  source?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ApiFactorListItem = {
  id: string;
  name: string;
  display_name_cn?: string | null;
  short_name_cn?: string | null;
  semantic_key?: string | null;
  governance_badges?: string[];
  name_schema_version?: string | null;
  naming_protocol_version?: string | null;
  naming_standard_version?: string | null;
  base_display_name_cn?: string | null;
  name_collision_key?: string | null;
  name_dedupe_suffix?: string | null;
  name_collision_group?: string[];
  legacy_name_aliases?: string[];
  name_audit?: Record<string, unknown>;
  stored_name?: string | null;
  market: string;
  universe: string;
  created_at?: string | null;
  updated_at?: string | null;
  source: ApiFactorSource;
  lifecycle_status: ApiFactorLifecycleStatus;
  diagnostic_status: ApiFactorDiagnosticStatus;
  tier_level?: ApiFactorTierLevel;
  tier_label?: string;
  tier_projection?: ApiFactorTierProjection;
  lifecycle?: ApiFactorLifecycleProjectionKey;
  lifecycle_label?: string;
  lifecycle_projection?: ApiFactorLifecycleProjection;
  factor_level?: ApiFactorLevelKey;
  factor_level_label?: string;
  factor_level_projection?: ApiFactorLevelProjection;
  op_status?: ApiFactorOpStatus;
  lineage_summary?: ApiFactorLineageSummary;
  quality_view?: ApiFactorQualityView;
  composite_view?: ApiFactorCompositeView;
  offline_reason?: string | null;
  offline_at?: string | null;
  offline_command?: "DEPRECATE" | "PRUNE" | string | null;
  offline_detail?: Record<string, unknown>;
  ui_state?: ApiFactorUiState;
  ui_state_label?: "稳健" | "待校准" | "失效" | "沙箱" | string;
  direction: ApiFactorDirection;
  frequency: ApiFactorFrequency;
  expression: string;
  descriptor?: ApiFactorDescriptor;
  factor_family?: string;
  formula_version?: string;
  pit_coverage?: Record<string, unknown>;
  coverage_loss?: number;
  tags: string[];
  data_requirements: string[];
  description?: string | null;
  institutional_note?: string | null;
  latest_diagnostic_summary?: ApiFactorDiagnosticSummary | null;
  last_diagnostic_run_id?: string | null;
  readiness_blockers: Array<Record<string, unknown>>;
  diagnostic_gap_summary?: {
    rank_ic?: string;
    coverage?: string;
    next_action?: string;
    [key: string]: unknown;
  };
  ic_sparkline: Array<{ date: string; value: number }>;
  ic_sparkline_window: string;
  gate_fix_target: string;
  batch_diagnostic_summary?: ApiFactorBatchDiagnosticSummary;
  correlation_cluster_summary?: ApiFactorCorrelationClusterSummary;
  blocker_reason_summary?: ApiFactorBlockerReasonSummary;
  strategy_creation_risk?: ApiFactorStrategyCreationRisk;
};

export type ApiFactorDetail = ApiFactorListItem & {
  versions: Array<{
    id: string;
    version: number;
    expression: string;
    status: string;
    metadata?: Record<string, unknown>;
    created_at: string;
  }>;
  correlation_cluster: {
    anchor_factor_id: string;
    top_n: number;
    method: string;
    nodes: Array<{
      factor_id: string;
      name: string;
      source: string;
      correlation: number;
      risk_label: string;
    }>;
  };
  lineage_tree?: {
    factor_id: string;
    persisted: boolean;
    node?: Record<string, unknown>;
    parents?: Array<Record<string, unknown>>;
    parent_count?: number;
    nodes: Array<Record<string, unknown>>;
  };
};

export type ApiFactorListResponse = {
  items: ApiFactorListItem[];
  summary: Record<string, unknown>;
};

export type ApiFactorDisplayNameBackfillItem = {
  factor_id: string;
  canonical_id?: string | null;
  previous_display_name?: string | null;
  new_display_name: string;
  display_name_cn: string;
  short_name_cn?: string | null;
  governance_badges?: string[];
  name_schema_version: string;
  naming_standard_version?: string | null;
  renamed_at?: string | null;
  rename_reason: string;
  legacy_name_aliases?: string[];
  would_change?: boolean;
};

export type ApiFactorDisplayNameBackfillResponse = {
  dry_run: boolean;
  name_schema_version: string;
  naming_standard_version?: string | null;
  items: ApiFactorDisplayNameBackfillItem[];
  summary: {
    candidate_count?: number;
    rename_count?: number;
    skipped_count?: number;
    applied_count?: number;
    rename_reason?: string;
    unchanged_count?: number;
    [key: string]: unknown;
  };
};

export type ApiFactorCreatePayload = {
  name: string;
  market: string;
  universe: string;
  expression: string;
  description?: string | null;
  frequency: ApiFactorFrequency;
  direction: ApiFactorDirection;
  tags: string[];
  descriptor: {
    source_prefix: "m";
    category: string;
    metric?: string;
    window: string;
    operator: string;
  };
};

export type ApiFactorDiagnosticPayload = {
  start_date: string;
  end_date: string;
  universe?: string | null;
  dataset_snapshot_id: string;
  universe_snapshot_id: string;
  return_window_days: number;
  group_count: number;
  diagnostic_mode?: "VERIFIED" | "SANDBOX";
};

export type ApiFactorDiagnosticRunResponse = {
  run_id: string;
  summary: ApiFactorDiagnosticSummary;
  governance_followups?: ApiFactorGovernanceAction[];
};

export type ApiFactorDiagnosticPreviewPayload = {
  expression?: string;
  market?: string;
  universe?: string;
  dataset_snapshot_id?: string | null;
  universe_snapshot_id?: string | null;
  lookback_years?: number;
  return_window_days?: number;
  batch?: boolean;
  factor_ids?: string[];
  diagnostic_mode?: "VERIFIED" | "SANDBOX";
  include?: string[];
};

export type ApiFactorDiagnosticPreview = {
  mode?: "SINGLE" | "BATCH" | string;
  status?: string;
  lookback_years?: number;
  expression?: string;
  rank_ic_preview?: Array<{ date: string; rank_ic: number }>;
  distribution?: Record<string, unknown>;
  risk_flags?: string[];
  message?: string;
  items?: Array<Record<string, unknown>>;
  batch_summary?: {
    factor_count: number;
    robust_count: number;
    needs_calibration_count: number;
    decayed_count: number;
    sandbox_count: number;
    warning_count: number;
    blocked_count: number;
    [key: string]: unknown;
  };
};

export type ApiFactorMiningJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "COMPLETED"
  | "PARTIALLY_FAILED"
  | "FAILED";

export type ApiFactorMiningJobCreatePayload = {
  universe: string;
  start_date: string;
  end_date: string;
  operators: string[];
  candidate_count: number;
  random_seed?: number | null;
  min_rank_ic: number;
  max_depth?: number;
  generation_mode?: "PRICE_OPERATOR" | "HYBRID_COMPOSITION" | string;
  source_factor_ids?: string[];
  recipe_families?: string[];
  exploration_budget?: number;
  composition_policy?: Record<string, unknown>;
};

export type ApiFactorMiningCandidate = {
  id: string;
  expression: string;
  score: number;
  rank_ic: number;
  pure_rank_ic?: number | null;
  ir?: number | null;
  information_ratio?: number | null;
  holding_period?: number | null;
  newey_west_lags?: number | null;
  turnover: number;
  coverage: number;
  depth?: number;
  risk_flags?: string[];
  fitness_score?: number | null;
  max_style_correlation?: number | null;
  correlation_penalty?: number | null;
  max_drawdown_pct?: number | null;
  benchmark_max_drawdown_pct?: number | null;
  drawdown_vs_benchmark_ratio?: number | null;
  auto_residual_summary?: Record<string, unknown> | null;
  source_factor_ids?: string[];
  recipe_kind?: string | null;
  recipe_family?: string | null;
  orthogonality_intent?: string | null;
  composition_metadata?: Record<string, unknown> | null;
};

export type ApiFactorMiningJob = {
  id: string;
  status: ApiFactorMiningJobStatus;
  request: ApiFactorMiningJobCreatePayload;
  progress: {
    total_candidates: number;
    evaluated_candidates: number;
    failed_candidates: number;
    throughput_per_second: number;
    percent: number;
  };
  top_candidates: ApiFactorMiningCandidate[];
  failed_samples: Array<{ expression: string; reason: string }>;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

export type ApiFactorMiningJobListResponse = {
  items: ApiFactorMiningJob[];
  summary: Record<string, unknown>;
};

export type ApiFactorGovernanceAction = {
  id: string;
  kind: string;
  command?: "DEPRECATE" | "PRUNE" | "PUBLISH_OPTIMIZED_FACTOR" | "RESTORE_PRUNED" | "FACTOR_MODEL_SUGGESTION" | string;
  label: string;
  title: string;
  detail: string;
  factor_ids: string[];
  affected_factor_ids?: string[];
  keep_factor_id?: string | null;
  offline_reason?: string | null;
  offline_detail?: Record<string, unknown>;
  criteria?: Record<string, unknown>;
  severity?: "info" | "warning" | "danger" | string;
  suggested_weights?: Array<{
    factor_id: string;
    weight_pct: number;
    direction: ApiFactorDirection | "HIGH_IS_GOOD" | "LOW_IS_GOOD" | string;
  }>;
  target?: {
    route: string;
    query?: Record<string, string>;
  };
  [key: string]: unknown;
};

export type ApiFactorGovernanceExecutePayload = {
  confirm: boolean;
  command: "DEPRECATE" | "PRUNE" | "PUBLISH_OPTIMIZED_FACTOR" | "RESTORE_PRUNED" | string;
  factor_ids?: string[];
  factor_id?: string;
  reason: string;
  keep_factor_id?: string | null;
  detail?: Record<string, unknown>;
  include_governance_overview?: boolean;
};

export type ApiFactorGovernanceExecuteResponse = {
  status: string;
  action_id: string;
  command: string;
  affected_factor_ids: string[];
  keep_factor_id?: string | null;
  offline_at?: string | null;
  restored_at?: string;
  executed_at?: string;
  reason: string;
  items: ApiFactorListItem[];
  created_factor_id?: string;
  created_factor?: ApiFactorListItem;
  governance_overview?: ApiFactorGovernanceOverview;
};

export type ApiFactorPruneRecoveryItem = {
  factor_id: string;
  name: string;
  source?: ApiFactorSource | string;
  diagnostic_status?: ApiFactorDiagnosticStatus | string;
  offline_at?: string | null;
  offline_reason?: string | null;
  keep_factor_id?: string | null;
  offline_correlation?: number;
  measured_correlation?: number;
  threshold?: number;
  recoverable: boolean;
  decision: "RESTORE" | "KEEP_PRUNED" | string;
  reason: string;
  evidence?: Record<string, unknown>;
};

export type ApiFactorPruneRecoveryPreview = {
  as_of: string;
  threshold: number;
  items: ApiFactorPruneRecoveryItem[];
  summary: Record<string, unknown>;
};

export type ApiFactorPruneRecoveryApplyPayload = {
  confirm: boolean;
  factor_ids?: string[];
  reason?: string;
};

export type ApiFactorPruneRecoveryApplyResponse = {
  status: string;
  command: "PRUNE_RECOVERY" | string;
  recovered_factor_ids: string[];
  recovered_count: number;
  skipped_count: number;
  reason: string;
  items: ApiFactorListItem[];
  recovery_preview?: ApiFactorPruneRecoveryPreview;
  governance_overview?: ApiFactorGovernanceOverview;
};

export type ApiFactorGovernanceOverview = {
  as_of: string;
  queue_count: number;
  actions: ApiFactorGovernanceAction[];
  summary?: Record<string, unknown>;
};

export type ApiFactorQuarantineCandidate = {
  id: string;
  name?: string | null;
  factor_name?: string | null;
  display_name_cn?: string | null;
  short_name_cn?: string | null;
  semantic_key?: string | null;
  governance_badges?: string[];
  name_schema_version?: string | null;
  naming_protocol_version?: string | null;
  naming_standard_version?: string | null;
  base_display_name_cn?: string | null;
  name_collision_key?: string | null;
  name_dedupe_suffix?: string | null;
  name_collision_group?: string[];
  legacy_name_aliases?: string[];
  name_audit?: Record<string, unknown>;
  mining_candidate_id?: string | null;
  source_mining_job_id?: string | null;
  expression: string;
  raw_expression?: string | null;
  refined_expression?: string | null;
  status: string;
  publish_status: string;
  gate_summary: Record<string, unknown>;
  cluster_id?: string | null;
  candidate_metrics: Record<string, unknown>;
  failure_samples: Array<Record<string, unknown>>;
  pit_evidence: Record<string, unknown>;
  publish_eligibility: Record<string, unknown>;
  target_factor_id?: string | null;
  publish_naming_rule?: string | null;
  created_at: string;
  updated_at: string;
  last_quarantine_at?: string | null;
  published_at?: string | null;
  rejected_reason?: string | null;
  latest_run?: Record<string, unknown>;
  target_layer?: "L1" | "L2" | "L3" | string;
  operator_chain?: ApiFactorOperatorChainStep[];
  composition_methods?: ApiFactorCompositionMethod[];
  investment_logic?: string;
  processing_status?: string;
  processing_status_label?: string;
  wnzt_missing?: string[];
  wnzt_complete?: boolean;
  wnzt_evidence?: Record<string, unknown>;
  artifact_refs?: Record<string, unknown>;
  scoring_detail?: ApiFactorScoringCandidate;
  admission_report?: ApiFactorAdmissionReportRow[];
  quarantine_result?: "PASS" | "WARN" | "FAIL" | string;
  reason_summary?: string;
  detail_modal_enabled?: boolean;
};

export type ApiFactorQuarantineCandidateListResponse = {
  items: ApiFactorQuarantineCandidate[];
  summary: {
    total?: number;
    page?: number;
    page_size?: number;
    total_pages?: number;
    passed_count?: number;
    needs_review_count?: number;
    published_count?: number;
    rejected_count?: number;
    [key: string]: unknown;
  };
};

export type ApiFactorQuarantineIntakePayload = {
  mining_job_id?: string;
  job_id?: string;
  candidate_ids?: string[];
};

export type ApiFactorQuarantineIntakeResponse = {
  items: ApiFactorQuarantineCandidate[];
  summary: {
    intake_count?: number;
    source_mining_job_id?: string | null;
    sandbox_candidates_persisted_to_factor_definitions?: boolean;
    [key: string]: unknown;
  };
};

export type ApiFactorQuarantineRunPayload = {
  reason?: string;
  [key: string]: unknown;
};

export type ApiFactorQuarantinePublishPayload = {
  operator?: string;
  rule_version?: string;
  [key: string]: unknown;
};

export type ApiFactorQuarantinePublishResponse = {
  candidate: ApiFactorQuarantineCandidate;
  factor?: ApiFactorDetail;
  event?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ApiFactorFactoryGatePolicy = {
  pit_gate_mode: "DIAGNOSTIC_ONLY";
  max_style_correlation: number;
  residual_enabled: boolean;
  max_drawdown_relative_to_benchmark: number;
  min_oos_to_is_ratio: number;
  p_value_max?: number;
  max_s_grade_correlation?: number;
  capacity_floor?: number;
  crowding_max?: number;
  [key: string]: unknown;
};

export type ApiF1AdmissionState =
  | "READY"
  | "READY_WITH_WARNING"
  | "OBSERVE"
  | "DATA_SOURCE_BLOCKED"
  | "MISSING_TIMING"
  | string;

export type ApiF1CatalogField = {
  factor_id: string;
  name: string;
  display_name_cn?: string | null;
  short_name_cn?: string | null;
  semantic_key?: string | null;
  governance_badges?: string[];
  name_schema_version?: string | null;
  naming_protocol_version?: string | null;
  naming_standard_version?: string | null;
  base_display_name_cn?: string | null;
  name_collision_key?: string | null;
  name_dedupe_suffix?: string | null;
  name_collision_group?: string[];
  legacy_name_aliases?: string[];
  name_audit?: Record<string, unknown>;
  category: string;
  pit_layer: "L1" | "L2" | "L3" | "L4" | string;
  source_refs?: Record<string, unknown>;
  coverage_ratio: number;
  available_symbol_count?: number;
  total_symbol_count?: number;
  missing_symbols?: string[];
  missing_symbol_count?: number;
  publish_date_rule?: string;
  available_at_rule?: string;
  missing_policy?: string;
  blocker_code?: string | null;
  admission_state: ApiF1AdmissionState;
  future_leakage_risk?: string | null;
  last_updated_at?: string | null;
  metadata?: Record<string, unknown>;
};

export type ApiF1CatalogSnapshot = {
  id: string;
  snapshot_id: string;
  run_id?: string | null;
  as_of_date?: string | null;
  generated_at?: string | null;
  field_count: number;
  callable_count: number;
  blocked_count: number;
  timing_gap_count: number;
  summary?: Record<string, unknown>;
  created_at?: string | null;
};

export type ApiF1CatalogResponse = {
  snapshot?: ApiF1CatalogSnapshot | null;
  items: ApiF1CatalogField[];
  summary: Record<string, unknown>;
};

export type ApiExternalFactorSourceType =
  | "ACADEMIC_LIBRARY"
  | "INSTITUTIONAL_LIBRARY"
  | "REFERENCE_TOOL"
  | "BACKTEST_TOOL"
  | "LOCAL_FILE";

export type ApiExternalFactorAccessPolicy =
  | "PUBLIC_DOWNLOAD"
  | "MANUAL_UPLOAD"
  | "REFERENCE_ONLY"
  | "LICENSE_REQUIRED";

export type ApiExternalFactorFrequency =
  | "DAILY"
  | "MONTHLY"
  | "QUARTERLY"
  | "ANNUAL"
  | "MIXED";

export type ApiExternalFactorImportMode =
  | "AUTO_DOWNLOAD"
  | "LOCAL_FILE"
  | "SOURCE_MANIFEST"
  | "REFERENCE_ONLY";

export type ApiExternalFactorDataset = {
  key: string;
  name: string;
  description?: string;
  frequency: ApiExternalFactorFrequency | string;
  status: "READY" | "MANUAL_REQUIRED" | "REFERENCE_ONLY" | string;
  factor_family?: string;
  default_usage?: string;
  recommended_system_family?: string;
  template_key: string;
  fields?: string[];
  update_lag_days?: number;
  governance_notes?: string[];
};

export type ApiExternalFactorSource = {
  id: string;
  name: string;
  short_name: string;
  source_type: ApiExternalFactorSourceType | string;
  access_policy: ApiExternalFactorAccessPolicy | string;
  homepage_url?: string | null;
  license_note?: string;
  sync_hint?: string;
  datasets: ApiExternalFactorDataset[];
  supported_import_modes?: ApiExternalFactorImportMode[];
  tags?: string[];
};

export type ApiExternalFactorSourceRegistryResponse = {
  sources: ApiExternalFactorSource[];
  recommended_flow: string[];
  template_version: string;
  review_boundary: string;
};

export type ApiExternalFactorManifest = {
  row_count: number;
  column_count: number;
  columns: string[];
  sample_rows: Array<Record<string, unknown>>;
  file_sha256: string;
  template_key: string;
  parsing_status: string;
  warnings: string[];
};

export type ApiExternalFactorMappingRow = {
  source_field: string;
  target_field: string;
  semantic_role: string;
  transform: string;
  data_type: string;
  required: boolean;
  confidence: number;
  notes?: string;
};

export type ApiExternalFactorArtifactPaths = {
  uploaded_file_id?: string | null;
  raw_file_ref?: string | null;
  manifest_ref?: string | null;
  template_ref?: string | null;
};

export type ApiExternalFactorLocalFileUploadPayload = {
  source_id: string;
  dataset_key: string;
  filename: string;
  content_text: string;
  content_type?: string | null;
};

export type ApiExternalFactorLocalFileUploadResponse = {
  file_id: string;
  source_id: string;
  dataset_key: string;
  filename: string;
  manifest: ApiExternalFactorManifest;
  mapping_rows: ApiExternalFactorMappingRow[];
  created_at: string;
  source_name?: string;
  dataset_name?: string;
};

export type ApiExternalFactorImportJobCreatePayload = {
  source_id: string;
  dataset_key: string;
  import_mode?: ApiExternalFactorImportMode;
  file_id?: string | null;
  as_of_date?: string | null;
  frequency?: ApiExternalFactorFrequency | string | null;
  created_by?: string;
  precheck_notes?: string | null;
};

export type ApiExternalFactorImportJob = {
  id: string;
  source_id: string;
  dataset_key: string;
  source_name: string;
  dataset_name: string;
  import_mode: ApiExternalFactorImportMode | string;
  status: string;
  review_status: string;
  frequency: ApiExternalFactorFrequency | string;
  as_of_date?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  submitted_at?: string | null;
  manifest: ApiExternalFactorManifest;
  mapping_rows: ApiExternalFactorMappingRow[];
  artifact_paths: ApiExternalFactorArtifactPaths;
  risk_flags: string[];
  next_actions: string[];
  governance_gate: string;
  job_projection?: Record<string, unknown>;
};

export type ApiExternalFactorImportReviewQueueItem = {
  id: string;
  source_id: string;
  dataset_key: string;
  source_name: string;
  dataset_name: string;
  import_mode: ApiExternalFactorImportMode | string;
  status: string;
  review_status: string;
  frequency: ApiExternalFactorFrequency | string;
  submitted_at?: string | null;
  updated_at?: string | null;
  manifest: Pick<ApiExternalFactorManifest, "row_count" | "column_count" | "parsing_status" | "template_key" | "warnings">;
  artifact_paths?: ApiExternalFactorArtifactPaths | Record<string, unknown>;
  risk_flags: string[];
  next_actions: string[];
  governance_gate: string;
  queue_state: string;
  direct_publish_allowed: false;
  [key: string]: unknown;
};

export type ApiExternalFactorImportReviewQueue = {
  items: ApiExternalFactorImportReviewQueueItem[];
  summary: {
    total: number;
    items_returned?: number;
    review_boundary?: string;
    queue_state?: string;
    direct_publish_allowed?: false;
    [key: string]: unknown;
  };
};

export type ApiOperatorRegistryItem = {
  operator_id: string;
  operator_group: "TS" | "CS" | "NONLINEAR" | string;
  enabled: boolean;
  display_name?: string;
  definition: string;
  economic_meaning: string;
  input_types: string[];
  output_dimension: string;
  default_params?: Record<string, unknown>;
  allowed_window_space: number[];
  min_periods_rule: string;
  domain_rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type CompositionMethodType =
  | "LINEAR_WEIGHTING"
  | "RATIO_RISK_ADJUSTED"
  | "RESIDUAL_ORTHOGONAL"
  | "RANK_POOLING"
  | "FFBLEND_STYLE"
  | "DIVERGENCE_PENALTY"
  | "TIME_SERIES_DENOISE";

export type CompositionMethodConfig = {
  id: string;
  label: string;
  theme: string;
  method_type: CompositionMethodType | string;
  enabled: boolean;
  formula_template: string;
  source_factor_ids: string[];
  params: Record<string, unknown>;
  publish_boundary: "D2_QUARANTINE_ONLY" | string;
};

export type ApiOperatorConfigDraft = {
  enabled_operators: string[];
  window_space: number[];
  default_depth: number;
  daily_formula_budget: number;
  compute_backend: "pandas_bottleneck" | string;
  min_periods_policy: string;
  blocked_field_policy: string;
  governance_protocol?: {
    wnzt_standard_flow?: boolean;
    winsorize_enabled?: boolean;
    neutralize_enabled?: boolean;
    zscore_enabled?: boolean;
    ts_smooth_enabled?: boolean;
    orthogonalization_enabled?: boolean;
    turnover_filter_enabled?: boolean;
    [key: string]: unknown;
  };
  composition_methods?: CompositionMethodConfig[];
  notes?: string;
  f1_catalog_snapshot_id?: string | null;
  created_by?: string | null;
};

export type ApiOperatorConfigSnapshot = ApiOperatorConfigDraft & {
  id: string;
  snapshot_id: string;
  generated_at?: string | null;
  status?: string;
  operator_count: number;
  items?: ApiOperatorRegistryItem[];
};

export type ApiFactorFactoryOperatorConfigResponse = {
  profile_id: string;
  draft: ApiOperatorConfigDraft;
  registry_items: ApiOperatorRegistryItem[];
  latest_f1_catalog_snapshot?: ApiF1CatalogSnapshot | null;
  latest_operator_config_snapshot?: ApiOperatorConfigSnapshot | null;
  defaults?: ApiOperatorConfigDraft;
  profile?: ApiFactorFactoryProfile;
  saved?: boolean;
};

export type ApiFactorOperatorChainStep = {
  code: string;
  label: string;
  description?: string;
};

export type ApiFactorCompositionMethod = {
  key: string;
  label: string;
};

export type ApiFactorTaskStatus = "待开始" | "进行中" | "已完成";

export type ApiFactorFactoryTaskRow = {
  id: string;
  task_date: string;
  kind: "mining" | "refinement" | "composition" | string;
  title: string;
  summary?: string;
  status: ApiFactorTaskStatus | string;
  target_layer: "L1" | "L2" | "L3" | string;
  delivered_candidate_count?: number | null;
  current_candidate_count?: number | null;
  expected_candidate_count?: number | null;
  metric_label?: string;
  metric_value?: number | null;
  secondary_metric_label?: string;
  secondary_metric_value?: number | null;
  operator_chain?: ApiFactorOperatorChainStep[];
  parent_factor_ids?: string[];
  [key: string]: unknown;
};

export type ApiFactorScoringCandidate = {
  candidate_id: string;
  display_id: string;
  display_name_cn?: string | null;
  short_name_cn?: string | null;
  governance_badges?: string[];
  name_schema_version?: string | null;
  naming_protocol_version?: string | null;
  naming_standard_version?: string | null;
  base_display_name_cn?: string | null;
  name_collision_key?: string | null;
  name_dedupe_suffix?: string | null;
  name_collision_group?: string[];
  score?: number | null;
  status?: "PASS" | "WARN" | "FAIL" | string;
  target_layer: "L1" | "L2" | "L3" | string;
  submitted_at?: string | null;
  predictive_power?: Record<string, unknown>;
  stability_turnover?: Record<string, unknown>;
  risk_orthogonality?: Record<string, unknown>;
  data_health?: Record<string, unknown>;
  thresholds?: Record<string, unknown>;
  operator_chain?: ApiFactorOperatorChainStep[];
  composition_methods?: ApiFactorCompositionMethod[];
  investment_logic?: string;
  collapsed_by_default?: boolean;
  submit_mode?: "AUTO_AFTER_TASK" | "MANUAL_BULK" | string;
  detail_modal_enabled?: boolean;
  quarantine_candidate_id?: string;
  quarantine_result?: "PASS" | "WARN" | "FAIL" | string;
  [key: string]: unknown;
};

export type ApiFactorQuarantineResultRow = {
  candidate_id: string;
  submitted_at?: string | null;
  factor_name: string;
  display_name_cn?: string | null;
  base_display_name_cn?: string | null;
  name_collision_key?: string | null;
  name_dedupe_suffix?: string | null;
  name_collision_group?: string[];
  governance_badges?: string[];
  name_audit?: Record<string, unknown>;
  target_layer: "L1" | "L2" | "L3" | string;
  quarantine_result: "PASS" | "WARN" | "FAIL" | string;
  reason_summary: string;
  detail_modal_enabled?: boolean;
  [key: string]: unknown;
};

export type ApiFactorAdmissionReportRow = {
  check: string;
  value?: number | string | null;
  value_label?: string;
  status: "PASS" | "WARN" | "FAIL" | string;
  agent_d_advice: string;
  [key: string]: unknown;
};

export type ApiPublishableFactorRow = {
  candidate_id?: string;
  factor_id: string;
  factor_name?: string;
  display_name_cn?: string | null;
  base_display_name_cn?: string | null;
  name_collision_key?: string | null;
  name_dedupe_suffix?: string | null;
  name_collision_group?: string[];
  governance_badges?: string[];
  name_audit?: Record<string, unknown>;
  target_layer: "L1" | "L2" | "L3" | string;
  score?: number | null;
  quarantine_status: "PASS" | "WARN" | string;
  parent_factor_ids?: string[];
  operator_chain?: ApiFactorOperatorChainStep[];
  composition_methods?: ApiFactorCompositionMethod[];
  investment_logic?: string;
  detail_modal_enabled?: boolean;
  [key: string]: unknown;
};

export type ApiFactorFactoryProfile = {
  id: string;
  status: "ACTIVE" | "PAUSED" | string;
  timezone: string;
  schedule_time: string;
  request: ApiFactorMiningJobCreatePayload;
  gate_policy: ApiFactorFactoryGatePolicy;
  created_at?: string | null;
  updated_at?: string | null;
  last_run_date?: string | null;
  next_run_at?: string | null;
  [key: string]: unknown;
};

export type ApiFactorFactoryRun = {
  id: string;
  profile_id?: string | null;
  run_date: string;
  trigger: "DAILY" | "MANUAL" | string;
  status: "QUEUED" | "RUNNING" | "CANCEL_REQUESTED" | "CANCELLED" | "COMPLETED" | "FAILED" | string;
  request: ApiFactorMiningJobCreatePayload;
  gate_policy: ApiFactorFactoryGatePolicy;
  config_signature?: string | null;
  mining_job_id?: string | null;
  mining_job?: ApiFactorMiningJob | null;
  summary?: Record<string, unknown>;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  error_message?: string | null;
};

export type ApiFactorFactoryFunnel = {
  mined_candidates: number;
  quarantine_candidates: number;
  passed: number;
  review_or_observation: number;
  rejected: number;
  published: number;
  [key: string]: unknown;
};

export type ApiFactorFactoryMonitorSummary = {
  formula_count?: number;
  selected_date_formula_count?: number;
  yesterday_formula_count?: number;
  raw_f2_delivered_count?: number;
  refined_f2_delivered_count?: number;
  initial_screen_pass_count?: number;
  quarantine_pass_count?: number;
  s_grade_promotion_count?: number;
  alpha_concentration?: number;
  failure_candidate_count?: number;
  failure_reason_distribution?: Record<string, number>;
  [key: string]: unknown;
};

export type ApiFactorFactoryOverview = {
  profile: ApiFactorFactoryProfile;
  active_run?: ApiFactorFactoryRun | null;
  latest_run?: ApiFactorFactoryRun | null;
  runs: ApiFactorFactoryRun[];
  funnel: ApiFactorFactoryFunnel;
  mining: ApiFactorMiningJobListResponse;
  quarantine: ApiFactorQuarantineCandidateListResponse;
  external_import_precheck_jobs?: ApiExternalFactorImportReviewQueue;
  external_import_review_queue?: ApiExternalFactorImportReviewQueue;
  external_import_quarantine?: ApiFactorQuarantineCandidateListResponse;
  gate_policy: ApiFactorFactoryGatePolicy;
  daily_run?: ApiFactorFactoryRun;
  manual_run?: ApiFactorFactoryRun;
  online_raw_f2_run?: ApiFactorFactoryRun;
  task_summary?: Record<string, unknown>;
  monitor_summary?: ApiFactorFactoryMonitorSummary;
  task_rows?: ApiFactorFactoryTaskRow[];
  scoring_candidates?: ApiFactorScoringCandidate[];
  quarantine_result_rows?: ApiFactorQuarantineResultRow[];
  publishable_factors?: ApiPublishableFactorRow[];
  phase2_contract?: Record<string, unknown>;
  operator_config?: ApiFactorFactoryOperatorConfigResponse;
  [key: string]: unknown;
};

export type ApiFactorFactoryAutomationPayload = {
  timezone?: string;
  schedule_time?: string;
  request?: ApiFactorMiningJobCreatePayload;
  gate_policy?: Partial<ApiFactorFactoryGatePolicy>;
  operator_config_snapshot_id?: string | null;
  f1_catalog_snapshot_id?: string | null;
};

export type ApiFactorFactoryRunNowPayload = {
  request?: ApiFactorMiningJobCreatePayload;
  gate_policy?: Partial<ApiFactorFactoryGatePolicy>;
  pipeline_scope?: "B1_B2_B3_B4" | "B1_ONLY" | "B2_B3" | "FULL";
  operator_config_snapshot_id?: string | null;
  f1_catalog_snapshot_id?: string | null;
};

export type ApiFactorFactoryOnlineRawF2Payload = {
  gate_policy?: Partial<ApiFactorFactoryGatePolicy>;
  factor_ids?: string[];
  candidate_limit?: number;
  operator_config_snapshot_id?: string | null;
  f1_catalog_snapshot_id?: string | null;
};

export type ApiFactorModelComponentPayload = {
  factor_id: string;
  weight: number;
  direction: ApiFactorDirection;
};

export type ApiFactorModelNeutralizationPayload = {
  enabled: boolean;
  method: string;
};

export type ApiFactorModelPreviewPayload = {
  strategy_type?: "MULTI_FACTOR" | "COMPOSITE_FACTOR";
  name?: string | null;
  universe: string;
  rebalance_frequency: string;
  top_n?: number | null;
  scoring_method: string;
  components: ApiFactorModelComponentPayload[];
  neutralization: ApiFactorModelNeutralizationPayload;
  universe_filter?: Record<string, unknown>;
  weight_mapping?: Record<string, unknown>;
  rebalance_logic?: Record<string, unknown>;
  execution_constraints?: Record<string, unknown>;
};

export type ApiFactorModelPreviewResponse = {
  strategy_type?: "MULTI_FACTOR" | "COMPOSITE_FACTOR";
  status: "READY" | "BLOCKED";
  normalized_weights: Array<ApiFactorModelComponentPayload & {
    normalized_weight: number;
    name?: string | null;
    diagnostic_status?: string | null;
  }>;
  coverage: Record<string, unknown>;
  score_preview: Array<Record<string, unknown>>;
  estimated_turnover: number;
  pit_blockers: Array<Record<string, unknown>>;
  neutralization_status: Record<string, unknown>;
  warnings: string[];
  strategy_creation_risk?: ApiFactorStrategyCreationRisk;
  diagnostic_summary?: Record<string, unknown> | null;
  sector_cap_forecast?: Record<string, unknown> | null;
  cost_forecast?: Record<string, unknown> | null;
};

export type ApiFactorModelCreatePayload = ApiFactorModelPreviewPayload & {
  idempotency_key?: string | null;
  description?: string | null;
};

export type BacktestRunListQuery = {
  limit?: number;
  status?: BacktestRunStatus;
};

export type BacktestRunDetailView =
  | "full"
  | "initial"
  | "context"
  | "trades"
  | "metrics";

export type BacktestRunDetailRequest = {
  view?: BacktestRunDetailView;
  signal?: AbortSignal;
};

export type CreateCandidatePayload = {
  label?: string;
  parameter_snapshot: Record<string, ParameterValue>;
  base_parameter_version_id?: string;
  metrics?: Record<string, number>;
  summary?: string;
};

export type DemoApi = {
  getWorkspaceOverview: (
    includeCleanupAudit?: boolean,
    signal?: AbortSignal,
  ) => Promise<ApiWorkspaceOverview>;
  listStrategies: (signal?: AbortSignal) => Promise<ApiStrategyListItem[]>;
  getStrategyLibrary?: (signal?: AbortSignal) => Promise<ApiStrategyLibraryResponse>;
  getStrategyDetail: (id: string) => Promise<ApiStrategyDetail>;
  previewStrategyArchive?: (id: string) => Promise<ApiStrategyArchivePreview>;
  archiveStrategy?: (id: string, payload: { confirm: true }) => Promise<ApiStrategyArchiveResult>;
  restoreStrategyParameterVersion?: (
    strategyId: string,
    parameterVersionId: string,
    payload: ParameterVersionRestorePayload,
  ) => Promise<ApiStrategyDetail>;
  getCreationSession: (id: string) => Promise<ApiStrategyCreationSession>;
  createCreationSession: (
    payload?: CreateCreationSessionPayload,
  ) => Promise<ApiStrategyCreationSession>;
  appendCreationMessage: (
    id: string,
    content: string,
    revision?: number,
  ) => Promise<ApiStrategyCreationSession>;
  prepareConfirmation: (id: string) => Promise<ApiStrategyCreationSession>;
  updateConfirmation: (
    id: string,
    payload: ApiConfirmationUpdateRequest,
  ) => Promise<ApiStrategyCreationSession>;
  recommendAssetAllocationWeights?: (
    id: string,
    payload: AssetAllocationRecommendationRequest,
  ) => Promise<AssetAllocationRecommendationResponse>;
  materializeStrategy: (
    id: string,
    idempotencyKey: string,
    confirmedRevision?: number,
  ) => Promise<ApiStrategyDetail>;
  listBacktestRuns: (
    params?: BacktestRunListQuery,
    signal?: AbortSignal,
  ) => Promise<ApiBacktestRunListItem[]>;
  getBacktestRunDetail: (
    id: string,
    options?: BacktestRunDetailRequest | AbortSignal,
  ) => Promise<ApiBacktestRunDetail>;
  saveBacktestRun: (id: string) => Promise<ApiBacktestRunDetail>;
  deleteBacktestRun: (id: string) => Promise<ApiBacktestRunDeleteResult>;
  getBacktestRunTrades: (
    id: string,
    params?: { page?: number; page_size?: number; segment?: string },
  ) => Promise<ApiBacktestRunTradePage>;
  getBacktestTradeAudit: (
    runId: string,
    tradeId: string,
  ) => Promise<ApiBacktestTradeAudit>;
  previewBacktestRun: (
    strategyId: string,
    payload: Record<string, unknown>,
  ) => Promise<ApiBacktestSubmissionPreview>;
  submitBacktestRun: (
    strategyId: string,
    payload: Record<string, unknown>,
  ) => Promise<ApiBacktestRunDetail>;
  cloneBacktestRun: (
    id: string,
    idempotencyKey: string,
  ) => Promise<ApiBacktestRunDetail>;
  resumeBacktestRun: (
    id: string,
    idempotencyKey: string,
  ) => Promise<ApiBacktestRunDetail>;
  listOptimizationJobs: () => Promise<ApiOptimizationJobListItem[]>;
  getOptimizationJobDetail: (
    id: string,
    params?: { matchingLimit?: number },
  ) => Promise<ApiOptimizationJobDetail>;
  updateOptimizationJobConstraints: (
    jobId: string,
    payload: ApiOptimizationJobConstraintUpdatePayload,
  ) => Promise<ApiOptimizationJobDetail>;
  saveOptimizationFilteredResult: (
    jobId: string,
    payload: ApiOptimizationFilteredResultCreatePayload,
  ) => Promise<ApiOptimizationJobDetail>;
  deleteOptimizationJob: (
    id: string,
  ) => Promise<ApiOptimizationJobDeleteResult>;
  createOptimizationJob: (
    strategyId: string,
    payload?: ApiOptimizationJobCreatePayload,
  ) => Promise<ApiOptimizationJobDetail>;
  resumeOptimizationJob: (
    jobId: string,
    idempotencyKey: string,
  ) => Promise<ApiOptimizationJobDetail>;
  createOptimizationCandidate: (
    jobId: string,
    payload: CreateCandidatePayload,
  ) => Promise<ApiOptimizationJobDetail>;
  promoteOptimizationCandidate: (
    jobId: string,
    trialId: string,
    mode: PromoteMode,
    idempotencyKey: string,
    comment?: string,
    baseParameterVersionId?: string | null,
  ) => Promise<ApiOptimizationJobDetail>;
  deleteOptimizationCandidate: (
    jobId: string,
    trialId: string,
  ) => Promise<ApiOptimizationJobDetail>;
  getLegInventory?: () => Promise<ApiLegInventory>;
  createAssetLeg?: (payload: ApiAssetLegCreatePayload) => Promise<ApiAssetLeg>;
  updateAssetLeg?: (id: string, payload: ApiAssetLegUpdatePayload) => Promise<ApiAssetLeg>;
  createCashLeg?: (payload: ApiCashLegCreatePayload) => Promise<ApiCashLeg>;
  updateCashLeg?: (id: string, payload: ApiCashLegUpdatePayload) => Promise<ApiCashLeg>;
  listCompositions?: () => Promise<ApiCompositionListItem[]>;
  listCompositionBacktestRuns?: () => Promise<ApiCompositionGlobalBacktestRunListItem[]>;
  listCompositionAllocationJobs?: () => Promise<ApiCompositionGlobalAllocationJobListItem[]>;
  getCompositionDetail?: (id: string) => Promise<ApiCompositionDetail>;
  previewComposition?: (
    payload: ApiCompositionPreviewPayload,
  ) => Promise<ApiCompositionPreview>;
  createComposition?: (
    payload: ApiCompositionCreatePayload,
  ) => Promise<ApiCompositionDetail>;
  updateComposition?: (
    id: string,
    payload: ApiCompositionUpdatePayload,
  ) => Promise<ApiCompositionDetail>;
  refreshCompositionDiagnostics?: (id: string) => Promise<ApiCompositionDetail>;
  refreshCompositionSourceFreezes?: (
    id: string,
    payload?: ApiCompositionSourceFreezeRefreshPayload,
  ) => Promise<ApiCompositionDetail>;
  confirmCompositionProxy?: (
    id: string,
    payload: ApiCompositionProxyConfirmationPayload,
  ) => Promise<ApiCompositionDetail>;
  createCompositionBacktestRun?: (
    id: string,
    payload: ApiCompositionBacktestRunPayload,
  ) => Promise<ApiCompositionBacktestRun>;
  getCompositionBacktestRun?: (
    id: string,
    runId: string,
  ) => Promise<ApiCompositionBacktestRun>;
  deleteCompositionBacktestRun?: (
    id: string,
    runId: string,
  ) => Promise<ApiCompositionBacktestRunDeleteResult>;
  getCompositionBacktestOrders?: (
    id: string,
    runId: string,
    params?: ApiCompositionBacktestOrdersQuery,
  ) => Promise<ApiCompositionBacktestOrderPage>;
  getCompositionBacktestOrderNetting?: (
    id: string,
    runId: string,
    orderId: string,
  ) => Promise<ApiCompositionBacktestOrderNetting>;
  exportCompositionBacktestOrders?: (
    id: string,
    runId: string,
    format?: ApiCompositionOrderExportFormat,
    params?: { symbol?: string | null; source_leg?: string | null; scenario?: string | null },
  ) => Promise<string>;
  createCompositionAllocationJob?: (
    id: string,
    payload: ApiCompositionAllocationJobPayload,
  ) => Promise<ApiCompositionAllocationJob>;
  getCompositionAllocationJob?: (
    id: string,
    jobId: string,
  ) => Promise<ApiCompositionAllocationJob>;
  promoteCompositionAllocationCandidateToDraft?: (
    id: string,
    jobId: string,
    candidateId: string,
    payload?: { decision_note?: string | null; base_version_id?: string | null },
  ) => Promise<ApiCompositionVersion>;
  createCompositionDecisionPacket?: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<ApiCompositionDecisionPacket>;
  getCompositionDecisionPacket?: (
    id: string,
    packetId: string,
  ) => Promise<ApiCompositionDecisionPacket>;
  exportCompositionDecisionPacket?: (
    id: string,
    packetId: string,
    format?: 'markdown' | 'html',
  ) => Promise<string>;
  getSnapshotOverview: () => Promise<ApiSnapshotOverview>;
  getSnapshotProviderRegistry?: () => Promise<ApiSnapshotProviderRegistry>;
  getSnapshotProviderAttempts?: (params?: {
    limit?: number;
    provider_id?: string | null;
    target_type?: string | null;
    status?: string | null;
  }) => Promise<ApiSnapshotProviderAttempts>;
  refreshSnapshots: (
    payload?: ApiSnapshotRefreshRequest,
  ) => Promise<ApiSnapshotOverview>;
  getPitDataOverview: () => Promise<ApiPitDataOverview>;
  createPitResearchWaiver: (
    payload?: ApiPitResearchWaiverPayload,
  ) => Promise<ApiPitDataOverview>;
  revokePitResearchWaiver: (id: string) => Promise<ApiPitDataOverview>;
  applyPitIdentityOverride: (
    payload: ApiPitIdentityOverridePayload,
  ) => Promise<ApiPitDataOverview>;
  restartPitIdentityScraper: (
    payload?: ApiPitIdentityScraperRestartPayload,
  ) => Promise<ApiPitIdentityScraperRestartResponse>;
  listFactors: (params?: {
    source?: string;
    tag?: string;
    market?: string;
    status?: string;
    lifecycle?: "online" | "offline" | "all" | "sandbox" | "to_be_verified" | "archived" | string;
  }) => Promise<ApiFactorListResponse>;
  getF1Catalog?: (params?: {
    snapshot_id?: string;
    layer?: string;
    status?: string;
    q?: string;
  }) => Promise<ApiF1CatalogResponse>;
  getExternalFactorSourceRegistry?: () => Promise<ApiExternalFactorSourceRegistryResponse>;
  uploadExternalFactorLocalFile?: (
    payload: ApiExternalFactorLocalFileUploadPayload,
  ) => Promise<ApiExternalFactorLocalFileUploadResponse>;
  createExternalFactorImportJob?: (
    payload: ApiExternalFactorImportJobCreatePayload,
  ) => Promise<ApiExternalFactorImportJob>;
  getExternalFactorImportJob?: (id: string) => Promise<ApiExternalFactorImportJob>;
  updateExternalFactorImportMapping?: (
    id: string,
    payload: {
      mapping_rows: ApiExternalFactorMappingRow[];
      review_status?: string;
      notes?: string | null;
    },
  ) => Promise<ApiExternalFactorImportJob>;
  submitExternalFactorImportReview?: (id: string) => Promise<ApiExternalFactorImportJob>;
  backfillFactorDisplayNamesV4?: (
    payload?: { dry_run?: boolean },
  ) => Promise<ApiFactorDisplayNameBackfillResponse>;
  createFactor: (payload: ApiFactorCreatePayload) => Promise<ApiFactorDetail>;
  getFactor: (id: string) => Promise<ApiFactorDetail>;
  runFactorDiagnostics: (
    id: string,
    payload: ApiFactorDiagnosticPayload,
  ) => Promise<ApiFactorDiagnosticRunResponse>;
  previewFactorDiagnostics: (
    payload: ApiFactorDiagnosticPreviewPayload,
  ) => Promise<ApiFactorDiagnosticPreview>;
  listFactorMiningJobs: () => Promise<ApiFactorMiningJobListResponse>;
  createFactorMiningJob: (payload: ApiFactorMiningJobCreatePayload) => Promise<ApiFactorMiningJob>;
  getFactorMiningJob: (id: string) => Promise<ApiFactorMiningJob>;
  cancelFactorMiningJob: (id: string) => Promise<ApiFactorMiningJob>;
  getFactorFactoryOverview?: () => Promise<ApiFactorFactoryOverview>;
  getFactorFactoryOperatorConfig?: () => Promise<ApiFactorFactoryOperatorConfigResponse>;
  saveFactorFactoryOperatorConfig?: (
    payload: ApiOperatorConfigDraft,
  ) => Promise<ApiFactorFactoryOperatorConfigResponse>;
  createFactorFactoryOperatorConfigSnapshot?: (
    payload: ApiOperatorConfigDraft,
  ) => Promise<ApiOperatorConfigSnapshot>;
  startFactorFactoryAutomation?: (
    payload?: ApiFactorFactoryAutomationPayload,
  ) => Promise<ApiFactorFactoryOverview>;
  pauseFactorFactoryAutomation?: () => Promise<ApiFactorFactoryOverview>;
  runFactorFactoryNow?: (
    payload?: ApiFactorFactoryRunNowPayload,
  ) => Promise<ApiFactorFactoryOverview>;
  runFactorFactoryOnlineRawF2Refinement?: (
    payload?: ApiFactorFactoryOnlineRawF2Payload,
  ) => Promise<ApiFactorFactoryOverview>;
  cancelFactorFactoryRun?: (id: string) => Promise<ApiFactorFactoryRun>;
  getFactorGovernanceOverview?: () => Promise<ApiFactorGovernanceOverview>;
  executeFactorGovernanceAction?: (
    actionId: string,
    payload: ApiFactorGovernanceExecutePayload,
  ) => Promise<ApiFactorGovernanceExecuteResponse>;
  previewFactorPruneRecovery?: () => Promise<ApiFactorPruneRecoveryPreview>;
  applyFactorPruneRecovery?: (
    payload: ApiFactorPruneRecoveryApplyPayload,
  ) => Promise<ApiFactorPruneRecoveryApplyResponse>;
  listFactorQuarantineCandidates?: (params?: {
    status?: string;
    source_job_id?: string;
    cluster?: string;
    date?: string;
    factor_name?: string;
    result?: "ALL" | "PASS" | "WARN" | "FAIL" | string;
    page?: number;
    page_size?: number;
  }) => Promise<ApiFactorQuarantineCandidateListResponse>;
  factorQuarantineIntake?: (
    payload?: ApiFactorQuarantineIntakePayload,
  ) => Promise<ApiFactorQuarantineIntakeResponse>;
  runFactorQuarantineCandidate?: (
    candidateId: string,
    payload?: ApiFactorQuarantineRunPayload,
  ) => Promise<ApiFactorQuarantineCandidate>;
  publishFactorQuarantineCandidate?: (
    candidateId: string,
    payload?: ApiFactorQuarantinePublishPayload,
  ) => Promise<ApiFactorQuarantinePublishResponse>;
  previewFactorModel: (payload: ApiFactorModelPreviewPayload) => Promise<ApiFactorModelPreviewResponse>;
  createFactorModel: (payload: ApiFactorModelCreatePayload) => Promise<ApiStrategyDetail>;
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
  cardState: "READY" | "PENDING_RUN" | "RUNNING_CURRENT_VERSION";
  parameters: Record<string, ParameterValue>;
};

export type StrategyListItem = {
  id: string;
  name: string;
  lifecycleStatus?: string;
  parameterVersion?: number;
  cardState?: "READY" | "PENDING_RUN" | "RUNNING_CURRENT_VERSION";
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
