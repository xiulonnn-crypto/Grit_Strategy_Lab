from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

AllowedAction = Literal[
    'start_backtest',
    'open_creation',
    'generate_confirmation',
    'materialize_strategy',
    'run_backtest',
    'clone_run',
    'open_optimization',
    'promote_candidate',
    'create_copy',
    'refresh_snapshots',
    'resolve_snapshot_block',
    'edit_parameters',
    'open_strategy_detail',
    'open_leg_inventory',
    'open_composition_workbench',
    'edit_leg_definition',
    'save_composition',
    'activate_composition',
    'archive_composition',
    'inspect_source_evidence',
]

CreationSessionMode = Literal['CREATE', 'REVISION']
CreationSessionStatus = Literal['DRAFTING', 'READY_FOR_CONFIRMATION', 'NEEDS_INPUT', 'LOCKED']
StrategyStatus = Literal['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']
StrategyType = Literal['GENERAL', 'GRID', 'MOMENTUM', 'MEAN_REVERSION', 'BUY_AND_HOLD']
FieldSource = Literal['user_input', 'system_inference', 'system_default', 'manual_override']
BacktestRunStatus = Literal['QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED']
BacktestExecutionStage = Literal['DATA_FETCHING', 'SIMULATING', 'METRIC_CALCULATING']
OptimizationJobStatus = Literal['QUEUED', 'RUNNING', 'INTERRUPTED', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED']
OptimizationMatchingCombinationSource = Literal['all_trials', 'persisted_candidates']
SnapshotStatus = Literal['READY', 'STALE', 'INCOMPLETE', 'FAILED']
SnapshotKind = Literal['DATASET', 'UNIVERSE']
TrialStatus = Literal['SUCCEEDED', 'FAILED', 'PENDING']
PromoteMode = Literal['set_current', 'create_copy']
SnapshotRefreshMode = Literal['incremental', 'repair', 'full']
SnapshotRefreshTarget = Literal['price', 'corporate', 'valuations', 'universes', 'bond']
DataSegmentType = Literal['FULL', 'TRAIN', 'TEST', 'VALIDATION']
OptimizationConstraintPresetKey = Literal['balanced', 'defensive', 'offensive']
SnapshotProviderAccessTier = Literal['public', 'free_account', 'paid_optional']
OfficialSeedStatus = Literal['complete', 'partial', 'missing']
LegType = Literal['strategy', 'asset', 'cash']
CompositionStatus = Literal['DRAFT', 'ACTIVE', 'ARCHIVED']


class CreationMessageCreate(BaseModel):
    content: str = Field(min_length=1)
    revision: int | None = Field(default=None, ge=1)


class CreateCreationSessionRequest(BaseModel):
    strategy_type: StrategyType | None = None
    mode: CreationSessionMode = 'CREATE'
    base_strategy_id: str | None = None
    base_parameter_version_id: str | None = None


class PrepareConfirmationRequest(BaseModel):
    context_notes: str | None = None
    revision: int | None = Field(default=None, ge=1)


class ConfirmationUpdateRequest(BaseModel):
    revision: int = Field(ge=1)
    strategy_type: StrategyType | None = None
    core: dict[str, Any] = Field(default_factory=dict)
    logic: dict[str, Any] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)


class MaterializeRequest(BaseModel):
    idempotency_key: str = Field(min_length=1)
    confirmed_revision: int | None = Field(default=None, ge=1)
    base_parameter_version_id: str | None = None


class StrategyUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    lifecycle_status: StrategyStatus | None = None
    dataset_snapshot_id: str | None = None
    universe_snapshot_id: str | None = None


class BacktestRunPreviewRequest(BaseModel):
    start_date: str | None = None
    end_date: str | None = None
    parameter_version_id: str | None = None
    data_segment_type: DataSegmentType | None = None
    dataset_snapshot_id: str | None = None
    universe_snapshot_id: str | None = None
    execution_policy: str | None = None
    fee_bps: float | None = Field(default=1.5, ge=0)
    slippage_bps: float | None = Field(default=2.5, ge=0)
    source_run_id: str | None = None


class BacktestRunCreateRequest(BacktestRunPreviewRequest):
    idempotency_key: str = Field(min_length=1)
    simulate_warning: bool = False
    is_permanent: bool = False


class BacktestRunCloneRequest(BaseModel):
    idempotency_key: str = Field(min_length=1)
    is_permanent: bool = False


class OptimizationConstraint(BaseModel):
    key: str = Field(min_length=1)
    label: str = Field(min_length=1)
    category: str = Field(min_length=1)
    operator: str = Field(min_length=1)
    value: Any
    unit: str = Field(default='')


class OptimizationJobCreateRequest(BaseModel):
    objective: str | None = None
    simulate_partial_failure: bool = False
    base_parameter_version_id: str | None = None
    source_run_id: str | None = None
    entry_point: str | None = None
    validation_mode: str | None = None
    budget_combinations: int | None = Field(default=None, ge=1)
    search_space: list[dict[str, Any]] = Field(default_factory=list)
    constraint_preset_key: OptimizationConstraintPresetKey | None = None
    constraint_label: str | None = None
    constraints: list[OptimizationConstraint] = Field(default_factory=list)


class OptimizationJobConstraintUpdateRequest(BaseModel):
    objective: str | None = None
    constraint_preset_key: OptimizationConstraintPresetKey | None = None
    constraint_label: str | None = None
    constraints: list[OptimizationConstraint] = Field(default_factory=list)


class ResumeOptimizationJobRequest(BaseModel):
    idempotency_key: str = Field(min_length=1)


class OptimizationCandidateCreateRequest(BaseModel):
    label: str | None = None
    parameter_snapshot: dict[str, Any] = Field(default_factory=dict)
    base_parameter_version_id: str | None = None
    metrics: dict[str, float] = Field(default_factory=dict)
    summary: str | None = None


class PromoteTrialRequest(BaseModel):
    idempotency_key: str = Field(min_length=1)
    mode: PromoteMode = 'set_current'
    base_parameter_version_id: str | None = None
    comment: str | None = None


class SnapshotRefreshRequest(BaseModel):
    reason: str | None = None
    mode: SnapshotRefreshMode = 'incremental'
    targets: list[SnapshotRefreshTarget] = Field(default_factory=list)


class SnapshotProviderSummaryItem(BaseModel):
    kinds: list[str] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    attempted_symbols: int = 0
    succeeded_symbols: int = 0
    selected_primary_symbols: int = 0
    succeeded_not_selected_symbols: int = 0
    failed_symbols: int = 0
    limited_symbols: int = 0
    skipped_symbols: int = 0
    empty_symbols: int = 0
    unavailable_symbols: int = 0
    landed_row_count: int = 0
    landed_symbol_count: int = 0
    actions_supported: bool = False
    access_tier: SnapshotProviderAccessTier = 'public'
    quota_limited: bool = False
    probe_complete: bool = False
    next_retry_at: str | None = None


class SnapshotProviderSummary(BaseModel):
    attempted_providers: list[str] = Field(default_factory=list)
    skipped_providers: list[str] = Field(default_factory=list)
    unavailable_providers: list[str] = Field(default_factory=list)
    providers: dict[str, SnapshotProviderSummaryItem] = Field(default_factory=dict)


class DatasetSnapshotMetadataModel(BaseModel):
    covered_symbol_count: int | None = None
    total_symbol_count: int | None = None
    missing_symbols: list[str] = Field(default_factory=list)
    benchmark_etf_coverage: dict[str, Any] = Field(default_factory=dict)
    probe_status_breakdown: dict[str, int] = Field(default_factory=dict)
    coverage_kind_breakdown: dict[str, int] = Field(default_factory=dict)
    complete_no_events_symbol_count: int | None = None
    formal_event_symbol_count: int | None = None
    proxy_keys: list[str] = Field(default_factory=list)
    observation_frequency: str | None = None
    latest_date: str | None = None
    latest_pe_ttm: float | None = None
    latest_percentile_10y: float | None = None
    provider_summary: SnapshotProviderSummary = Field(default_factory=SnapshotProviderSummary)


class UniverseSnapshotMetadataModel(BaseModel):
    anchor_count: int | None = None
    historical_anchor_count: int | None = None
    fallback_anchor_count: int | None = None
    source_quality_breakdown: dict[str, int] = Field(default_factory=dict)
    official_seed_status: OfficialSeedStatus | None = None
    official_seed_source_count: int | None = None
    official_seed_missing_anchors: list[str] = Field(default_factory=list)
    provider_summary: dict[str, Any] = Field(default_factory=dict)


class AssetLegCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    symbol: str = Field(min_length=1)
    asset_kind: str = Field(min_length=1)
    source_snapshot_id: str = Field(min_length=1)
    source_provider: str | None = None
    freeze_mode: str = Field(min_length=1)
    notes: str | None = None
    summary: dict[str, Any] = Field(default_factory=dict)


class AssetLegUpdateRequest(BaseModel):
    name: str | None = None
    symbol: str | None = None
    asset_kind: str | None = None
    source_snapshot_id: str | None = None
    source_provider: str | None = None
    freeze_mode: str | None = None
    notes: str | None = None
    summary: dict[str, Any] | None = None
    status: Literal['ACTIVE', 'ARCHIVED'] | None = None


class CashLegCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    cash_rule_kind: str = Field(min_length=1)
    buffer_bps: float = Field(default=0.0, ge=0)
    yield_source: str | None = None
    freeze_mode: str = Field(min_length=1)
    notes: str | None = None
    summary: dict[str, Any] = Field(default_factory=dict)


class CashLegUpdateRequest(BaseModel):
    name: str | None = None
    cash_rule_kind: str | None = None
    buffer_bps: float | None = Field(default=None, ge=0)
    yield_source: str | None = None
    freeze_mode: str | None = None
    notes: str | None = None
    summary: dict[str, Any] | None = None
    status: Literal['ACTIVE', 'ARCHIVED'] | None = None


class CompositionBenchmarkDefinitionModel(BaseModel):
    label: str | None = None
    symbol: str | None = None
    source: str | None = None
    notes: str | None = None


class CompositionCostPolicyModel(BaseModel):
    expense_ratio_bps: float | None = Field(default=None, ge=0)
    turnover_budget_bps: float | None = Field(default=None, ge=0)
    trade_cost_bps: float | None = Field(default=None, ge=0)
    notes: str | None = None


class CompositionLegInputModel(BaseModel):
    leg_kind: LegType
    source_ref_id: str = Field(min_length=1)
    source_ref_type: str | None = None
    display_name: str | None = None
    weight_pct: float = Field(ge=0)
    weight_locked: bool = False
    ordering: int | None = Field(default=None, ge=1)
    config: dict[str, Any] = Field(default_factory=dict)


class CompositionPreviewRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    benchmark_definition: CompositionBenchmarkDefinitionModel | None = None
    rebalance_frequency: str | None = None
    cost_policy: CompositionCostPolicyModel | None = None
    legs: list[CompositionLegInputModel] = Field(default_factory=list)


class CompositionCreateRequest(CompositionPreviewRequest):
    status: CompositionStatus = 'DRAFT'


class CompositionUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    status: CompositionStatus | None = None
    benchmark_definition: CompositionBenchmarkDefinitionModel | None = None
    rebalance_frequency: str | None = None
    cost_policy: CompositionCostPolicyModel | None = None
    legs: list[CompositionLegInputModel] | None = None


class LegInventoryFilterItemModel(BaseModel):
    value: str
    label: str
    count: int = 0


class LegInventoryCountModel(BaseModel):
    all: int = 0
    strategy: int = 0
    asset: int = 0
    cash: int = 0


class LegInventoryFiltersModel(BaseModel):
    statuses: list[LegInventoryFilterItemModel] = Field(default_factory=list)
    attribute_tags: list[LegInventoryFilterItemModel] = Field(default_factory=list)


class LegInventoryRowModel(BaseModel):
    id: str
    leg_type: LegType
    name: str
    version_label: str | None = None
    proof_label: str | None = None
    reference_count: int = 0
    reference_summary: str = ''
    status: str
    status_label: str
    has_new_version: bool = False
    is_orphan: bool = False
    attribute_tags: list[str] = Field(default_factory=list)
    allowed_actions: list[AllowedAction | str] = Field(default_factory=list)
    source_ref_id: str | None = None
    source_ref_type: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class LegInventoryResponseModel(BaseModel):
    counts: LegInventoryCountModel = Field(default_factory=LegInventoryCountModel)
    filters: LegInventoryFiltersModel = Field(default_factory=LegInventoryFiltersModel)
    rows: list[LegInventoryRowModel] = Field(default_factory=list)


class AssetLegResponseModel(BaseModel):
    id: str
    name: str
    symbol: str
    asset_kind: str
    source_snapshot_id: str
    source_provider: str | None = None
    freeze_mode: str
    notes: str | None = None
    summary: dict[str, Any] = Field(default_factory=dict)
    status: str
    eligibility_summary: dict[str, Any] = Field(default_factory=dict)
    attribute_tags: list[str] = Field(default_factory=list)
    allowed_actions: list[AllowedAction | str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class CashLegResponseModel(BaseModel):
    id: str
    name: str
    cash_rule_kind: str
    buffer_bps: float = 0.0
    yield_source: str | None = None
    freeze_mode: str
    notes: str | None = None
    summary: dict[str, Any] = Field(default_factory=dict)
    status: str
    attribute_tags: list[str] = Field(default_factory=list)
    allowed_actions: list[AllowedAction | str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class CompositionWeightSummaryModel(BaseModel):
    total_weight_pct: float = 0.0
    target_weight_pct: float = 100.0
    residual_weight_pct: float = 0.0
    locked_weight_pct: float = 0.0
    unlocked_weight_pct: float = 0.0
    within_tolerance: bool = False


class CompositionPreviewLegModel(BaseModel):
    id: str
    leg_kind: LegType
    source_ref_id: str
    source_ref_type: str
    display_name: str
    weight_pct: float = 0.0
    weight_locked: bool = False
    ordering: int = 1
    version_label: str | None = None
    proof_label: str | None = None
    status: str
    status_label: str
    attribute_tags: list[str] = Field(default_factory=list)
    reference_summary: str = ''
    config: dict[str, Any] = Field(default_factory=dict)
    allowed_actions: list[AllowedAction | str] = Field(default_factory=list)


class CompositionReturnPointModel(BaseModel):
    label: str
    date: str | None = None
    portfolio_return_pct: float = 0.0
    gross_return_pct: float = 0.0
    net_return_pct: float = 0.0
    maintenance_cost_drag_pct: float = 0.0
    slippage_drag_pct: float = 0.0
    rebalance_cost_drag_pct: float = 0.0
    cash_buffer_drag_pct: float = 0.0
    total_cost_drag_pct: float = 0.0
    cumulative_return_pct: float = 0.0
    cumulative_net_return_pct: float = 0.0


class CompositionBenchmarkPointModel(BaseModel):
    label: str
    date: str | None = None
    benchmark_return_pct: float = 0.0
    cumulative_return_pct: float = 0.0


class CompositionSpreadPointModel(BaseModel):
    label: str
    date: str | None = None
    spread_pct: float = 0.0


class CompositionCorrelationCellModel(BaseModel):
    x_key: str
    y_key: str
    correlation: float = 0.0


class CompositionRiskContributionModel(BaseModel):
    leg_id: str
    label: str
    weight_pct: float = 0.0
    volatility_pct: float = 0.0
    contribution_pct: float = 0.0
    return_contribution_pct: float = 0.0
    marginal_contribution_pct: float = 0.0
    budget_usage_pct: float = 0.0
    duration_contribution_years: float | None = None
    convexity_contribution: float | None = None


class CompositionMaintenanceCostSummaryModel(BaseModel):
    expense_ratio_bps: float = 0.0
    turnover_budget_bps: float = 0.0
    trade_cost_bps: float = 0.0
    total_estimated_bps: float = 0.0
    notes: list[str] = Field(default_factory=list)


class CompositionRebalanceSummaryModel(BaseModel):
    rebalance_frequency: str | None = None
    cadence_label: str | None = None
    checks_per_year: int = 0
    operating_tempo_label: str | None = None


class CompositionScoreFactorModel(BaseModel):
    key: str
    label: str
    score: float = 0.0
    detail: str = ''
    tone: str = 'neutral'


class CompositionScoreModel(BaseModel):
    score: float = 0.0
    verdict: str = 'watch'
    factors: list[CompositionScoreFactorModel] = Field(default_factory=list)


class CompositionReturnQualitySummaryModel(BaseModel):
    status: str = 'limited'
    alignment_window_start: str | None = None
    alignment_window_end: str | None = None
    aligned_points: int = 0
    missing_points: int = 0
    coverage_pct: float = 0.0
    fallback_used: bool = False
    notes: list[str] = Field(default_factory=list)


class CompositionRebalanceEventModel(BaseModel):
    label: str
    date: str | None = None
    index: int = 0
    turnover_pct: float = 0.0
    estimated_cost_bps: float = 0.0
    cost_drag_pct: float = 0.0
    cash_buffer_pct: float = 0.0
    weight_before: dict[str, float] = Field(default_factory=dict)
    weight_after: dict[str, float] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


class CompositionSourceIntegrityModel(BaseModel):
    leg_id: str
    display_name: str
    source_ref_id: str | None = None
    freeze_hash: str | None = None
    signature_status: str = 'unverified'
    drift_status: str = 'unknown'
    current_ref_id: str | None = None
    checked_at: str | None = None
    alerts: list[str] = Field(default_factory=list)


class CompositionAuditTrailItemModel(BaseModel):
    id: str
    action: str
    actor: str = 'system'
    at: str
    summary: str
    hash_before: str | None = None
    hash_after: str | None = None


class CompositionPreviewResponseModel(BaseModel):
    weight_summary: CompositionWeightSummaryModel = Field(default_factory=CompositionWeightSummaryModel)
    normalized_legs: list[CompositionPreviewLegModel] = Field(default_factory=list)
    returns_preview: list[CompositionReturnPointModel] = Field(default_factory=list)
    benchmark_series: list[CompositionBenchmarkPointModel] = Field(default_factory=list)
    spread_series: list[CompositionSpreadPointModel] = Field(default_factory=list)
    correlation_matrix: list[CompositionCorrelationCellModel] = Field(default_factory=list)
    risk_contribution_preview: list[CompositionRiskContributionModel] = Field(default_factory=list)
    maintenance_cost_summary: CompositionMaintenanceCostSummaryModel = Field(default_factory=CompositionMaintenanceCostSummaryModel)
    rebalance_summary: CompositionRebalanceSummaryModel = Field(default_factory=CompositionRebalanceSummaryModel)
    composition_score: CompositionScoreModel = Field(default_factory=CompositionScoreModel)
    return_quality_summary: CompositionReturnQualitySummaryModel = Field(default_factory=CompositionReturnQualitySummaryModel)
    rebalance_events: list[CompositionRebalanceEventModel] = Field(default_factory=list)
    source_integrity: list[CompositionSourceIntegrityModel] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    advisories: list[str] = Field(default_factory=list)


class CompositionListItemModel(BaseModel):
    id: str
    name: str
    status: str
    composition_score: float = 0.0
    leg_count: int = 0
    rebalance_frequency: str | None = None
    benchmark_label: str | None = None
    annualized_return: float = 0.0
    sharpe: float = 0.0
    max_drawdown: float = 0.0
    updated_at: str
    latest_activity_label: str
    allowed_actions: list[AllowedAction | str] = Field(default_factory=list)


class CompositionKpiModel(BaseModel):
    key: str
    label: str
    value: float | int | str
    unit: str | None = None
    tone: str = 'neutral'
    detail: str | None = None


class CompositionHeroSummaryModel(BaseModel):
    title: str
    subtitle: str | None = None
    status: str
    status_label: str
    benchmark_label: str | None = None
    leg_count: int = 0
    composition_score: float = 0.0
    updated_at: str | None = None


class CompositionRebalanceMarkerModel(BaseModel):
    label: str
    date: str | None = None
    index: int = 0


class CompositionScenarioSummaryModel(BaseModel):
    base_case: dict[str, Any] = Field(default_factory=dict)
    stress_case: dict[str, Any] = Field(default_factory=dict)
    cases: list[dict[str, Any]] = Field(default_factory=list)
    dispersion_note: str | None = None


class CompositionSourceFreezeModel(BaseModel):
    id: str
    leg_id: str
    display_name: str
    freeze_ref_type: str
    freeze_ref_id: str
    freeze_hash: str
    captured_at: str
    snapshot: dict[str, Any] = Field(default_factory=dict)
    signature_status: str | None = None
    drift_status: str | None = None
    current_ref_id: str | None = None
    alerts: list[str] = Field(default_factory=list)


class CompositionDetailResponseModel(BaseModel):
    id: str
    name: str
    description: str | None = None
    status: str
    status_label: str
    created_at: str
    updated_at: str
    benchmark_definition: CompositionBenchmarkDefinitionModel | None = None
    rebalance_frequency: str | None = None
    cost_policy: CompositionCostPolicyModel = Field(default_factory=CompositionCostPolicyModel)
    hero_summary: CompositionHeroSummaryModel
    kpis: list[CompositionKpiModel] = Field(default_factory=list)
    weight_summary: CompositionWeightSummaryModel = Field(default_factory=CompositionWeightSummaryModel)
    normalized_legs: list[CompositionPreviewLegModel] = Field(default_factory=list)
    returns_preview: list[CompositionReturnPointModel] = Field(default_factory=list)
    benchmark_series: list[CompositionBenchmarkPointModel] = Field(default_factory=list)
    spread_series: list[CompositionSpreadPointModel] = Field(default_factory=list)
    rebalance_markers: list[CompositionRebalanceMarkerModel] = Field(default_factory=list)
    correlation_matrix: list[CompositionCorrelationCellModel] = Field(default_factory=list)
    risk_contribution_preview: list[CompositionRiskContributionModel] = Field(default_factory=list)
    maintenance_cost_summary: CompositionMaintenanceCostSummaryModel = Field(default_factory=CompositionMaintenanceCostSummaryModel)
    return_quality_summary: CompositionReturnQualitySummaryModel = Field(default_factory=CompositionReturnQualitySummaryModel)
    rebalance_events: list[CompositionRebalanceEventModel] = Field(default_factory=list)
    scenario_summary: CompositionScenarioSummaryModel = Field(default_factory=CompositionScenarioSummaryModel)
    source_evidence: list[CompositionSourceFreezeModel] = Field(default_factory=list)
    source_integrity: list[CompositionSourceIntegrityModel] = Field(default_factory=list)
    audit_trail: list[CompositionAuditTrailItemModel] = Field(default_factory=list)
    composition_score: CompositionScoreModel = Field(default_factory=CompositionScoreModel)
    latest_activity_label: str
    deep_link_actions: list[AllowedAction | str] = Field(default_factory=list)


class SnapshotBlockerModel(BaseModel):
    code: str
    message: str


class DatasetSnapshotResponseModel(BaseModel):
    id: str
    name: str
    status: str
    as_of: str | None = None
    freshness_label: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    row_count: int | None = None
    source: str | None = None
    fallback_source: str | None = None
    blocker: SnapshotBlockerModel | None = None
    metadata: DatasetSnapshotMetadataModel | None = None


class UniverseSnapshotResponseModel(BaseModel):
    id: str
    name: str
    status: str
    as_of: str | None = None
    freshness_label: str | None = None
    window_start: str | None = None
    window_end: str | None = None
    anchor_schedule: str | None = None
    member_count: int | None = None
    source: str | None = None
    fallback_source: str | None = None
    blocker: SnapshotBlockerModel | None = None
    metadata: UniverseSnapshotMetadataModel | None = None


class SnapshotRefreshJobResponseModel(BaseModel):
    id: str | None = None
    status: str
    created_at: str | None = None
    updated_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    request: dict[str, Any] = Field(default_factory=dict)
    summary: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class BondSnapshotCardModel(BaseModel):
    id: str
    label: str
    status: str
    value: str | None = None
    detail: str | None = None


class BondSnapshotGlobalPulseModel(BaseModel):
    status: str
    headline: str
    updated_at: str | None = None
    cards: list[BondSnapshotCardModel] = Field(default_factory=list)


class BondSnapshotPillarGroupModel(BaseModel):
    id: str
    label: str
    status: str
    items: list[BondSnapshotCardModel] = Field(default_factory=list)


class BondSnapshotCurvePointModel(BaseModel):
    tenor_label: str
    yield_pct: float = 0.0
    spread_bps: float = 0.0


class BondSnapshotAuditRowModel(BaseModel):
    id: str
    label: str
    owner: str
    status: str
    cadence_label: str
    evidence: str


class BondSnapshotRegistryItemModel(BaseModel):
    id: str
    label: str
    status: str
    source: str
    asset_type: str | None = None
    tenor_label: str | None = None
    audit_profile: str | None = None
    discount_rate_pct: float | None = None
    real_yield_pct: float | None = None
    inflation_factor: float | None = None
    breakeven_inflation_bps: float | None = None
    effective_duration: float | None = None
    sec_yield_30d_pct: float | None = None
    credit_quality: dict[str, Any] | str | None = None
    tracking_error_bps: float | None = None
    audit_alerts: list[str] = Field(default_factory=list)
    audit_notes: list[str] = Field(default_factory=list)
    tracking_status: str | None = None
    snapshot_ref: str | None = None
    updated_at: str | None = None
    notes: list[str] = Field(default_factory=list)


class BondSnapshotEligibleSourceModel(BaseModel):
    id: str
    label: str
    source: str
    status: str
    access_tier: str = 'public'
    instrument_types: list[str] = Field(default_factory=list)
    coverage_notes: list[str] = Field(default_factory=list)
    updated_at: str | None = None


class BondSnapshotEligibleInstrumentModel(BaseModel):
    id: str
    label: str
    instrument_type: str
    source: str
    status: str
    asset_type: str | None = None
    tenor_label: str | None = None
    audit_profile: str | None = None
    symbol: str | None = None
    isin: str | None = None
    cusip: str | None = None
    currency: str | None = None
    snapshot_date: str | None = None
    maturity_date: str | None = None
    coupon_rate_pct: float | None = None
    clean_price: float | None = None
    net_price: float | None = None
    dirty_price: float | None = None
    full_price: float | None = None
    accrued_interest: float | None = None
    discount_rate_pct: float | None = None
    ytm_pct: float | None = None
    real_yield_pct: float | None = None
    inflation_factor: float | None = None
    breakeven_inflation_bps: float | None = None
    duration: float | None = None
    effective_duration: float | None = None
    convexity: float | None = None
    sec_yield_30d_pct: float | None = None
    credit_quality: dict[str, Any] | str | None = None
    tracking_error_bps: float | None = None
    audit_alerts: list[str] = Field(default_factory=list)
    audit_notes: list[str] = Field(default_factory=list)
    tracking_status: str | None = None
    snapshot_ref: str | None = None
    refresh_status: str | None = None
    missing_fields: list[str] = Field(default_factory=list)
    inferred_fields: dict[str, Any] = Field(default_factory=dict)
    field_status: dict[str, str] = Field(default_factory=dict)
    updated_at: str | None = None


class BondSnapshotSchedulerModel(BaseModel):
    status: str
    cadence_label: str
    next_action: str | None = None
    last_job_id: str | None = None


class BondSnapshotSourceSummaryModel(BaseModel):
    primary_source: str
    fallback_source: str | None = None
    selection_reason: str


class BondSnapshotSystemDiagnosticsModel(BaseModel):
    blocking_code: str | None = None
    blocking_target: Any | None = None
    refresh_job_status: str | None = None
    memory: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


class BondFixedIncomeOverviewModel(BaseModel):
    global_pulse: BondSnapshotGlobalPulseModel
    pillar_groups: list[BondSnapshotPillarGroupModel] = Field(default_factory=list)
    curve_preview: list[BondSnapshotCurvePointModel] = Field(default_factory=list)
    audit_matrix: list[BondSnapshotAuditRowModel] = Field(default_factory=list)
    raw_registry: list[BondSnapshotRegistryItemModel] = Field(default_factory=list)
    eligible_sources: list[BondSnapshotEligibleSourceModel] = Field(default_factory=list)
    eligible_instruments: list[BondSnapshotEligibleInstrumentModel] = Field(default_factory=list)
    scheduler: BondSnapshotSchedulerModel
    selected_source_summary: BondSnapshotSourceSummaryModel
    system_diagnostics: BondSnapshotSystemDiagnosticsModel
    group_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    sourced_ready_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    instrument_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    ust_metrics: dict[str, Any] | None = None
    tips_metrics: dict[str, Any] | None = None
    lqd_metrics: dict[str, Any] | None = None
    group_metrics: dict[str, dict[str, Any] | None] | None = None
    ust_sourced_count: int | None = None
    ust_ready_count: int | None = None
    tips_sourced_count: int | None = None
    tips_ready_count: int | None = None
    ig_sourced_count: int | None = None
    ig_ready_count: int | None = None
    ust_10y_2y_spread_bps: float | None = None
    top_ust_10y_2y_spread_bps: float | None = None
    tips_real_yield_pct: float | None = None
    tips_inflation_factor: float | None = None
    tips_breakeven_pct: float | None = None
    lqd_effective_duration: float | None = None
    lqd_sec_yield_30d_pct: float | None = None
    lqd_credit_quality: dict[str, Any] | str | None = None
    lqd_tracking_status: str | None = None
    quality_audit: list[dict[str, Any]] = Field(default_factory=list)
    repair_rules: list[dict[str, Any]] = Field(default_factory=list)
    daily_accrual_status: list[dict[str, Any]] = Field(default_factory=list)
    risk_budget_inputs: list[dict[str, Any]] = Field(default_factory=list)


class SnapshotOverviewResponseModel(BaseModel):
    overall_status: str
    last_refreshed_at: str | None = None
    dataset_snapshots: list[DatasetSnapshotResponseModel] = Field(default_factory=list)
    universe_snapshots: list[UniverseSnapshotResponseModel] = Field(default_factory=list)
    latest_job: SnapshotRefreshJobResponseModel | None = None
    blocking_code: str | None = None
    blocking_target: Any | None = None
    message: str | None = None
    allowed_actions: list[AllowedAction | str] = Field(default_factory=list)
    bond_fixed_income: BondFixedIncomeOverviewModel
