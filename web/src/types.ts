export type StrategyType =
  | "GENERAL"
  | "GRID"
  | "MOMENTUM"
  | "MEAN_REVERSION"
  | "BUY_AND_HOLD";
export type BacktestRunStatus =
  | "QUEUED"
  | "RUNNING"
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
export type SnapshotRefreshTarget = "price" | "corporate" | "valuations" | "universes" | "bond";
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

export type ApiParameterHistoryEntry = {
  version_number: number;
  parameter_version_id: string;
  revision: number;
  created_at: string | null;
  comment?: string | null;
  parameters: Record<string, ParameterValue>;
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

export type ApiStrategyDetail = ApiStrategyListItem & {
  confirmation_fields?: ApiConfirmationFields;
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
    [key: string]: unknown;
  };
  candidates: ApiOptimizationCandidate[];
  base_parameter_version_id?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
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
  strategy_type?: StrategyType;
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
  | "paid_optional";

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
  access_tier?: ApiSnapshotProviderAccessTier;
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

export type ApiDatasetSnapshotMetadata = Record<string, unknown> & {
  covered_symbol_count?: number;
  total_symbol_count?: number;
  missing_symbols?: string[];
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
  config?: Record<string, unknown>;
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
  alignment_window_start?: string | null;
  alignment_window_end?: string | null;
  aligned_points: number;
  missing_points: number;
  coverage_pct: number;
  fallback_used: boolean;
  notes: string[];
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
  current_ref_id?: string | null;
  checked_at?: string | null;
  alerts: string[];
};

export type ApiCompositionAuditTrailItem = {
  id: string;
  action: string;
  actor: string;
  at: string;
  summary: string;
  hash_before?: string | null;
  hash_after?: string | null;
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
};

export type ApiCompositionListItem = {
  id: string;
  name: string;
  status: string;
  composition_score: number;
  leg_count: number;
  rebalance_frequency?: string | null;
  benchmark_label?: string | null;
  annualized_return: number;
  sharpe: number;
  max_drawdown: number;
  updated_at: string;
  latest_activity_label: string;
  allowed_actions: string[];
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

export type ApiCompositionDetail = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  status_label: string;
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
  audit_trail?: ApiCompositionAuditTrailItem[];
  composition_score: ApiCompositionScore;
  latest_activity_label: string;
  deep_link_actions: string[];
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
  bond_fixed_income: ApiBondFixedIncomeOverview;
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
  getStrategyDetail: (id: string) => Promise<ApiStrategyDetail>;
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
  listOptimizationJobs: () => Promise<ApiOptimizationJobListItem[]>;
  getOptimizationJobDetail: (id: string) => Promise<ApiOptimizationJobDetail>;
  updateOptimizationJobConstraints: (
    jobId: string,
    payload: ApiOptimizationJobConstraintUpdatePayload,
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
  getSnapshotOverview: () => Promise<ApiSnapshotOverview>;
  refreshSnapshots: (
    payload?: ApiSnapshotRefreshRequest,
  ) => Promise<ApiSnapshotOverview>;
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
