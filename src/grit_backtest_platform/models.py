from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

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
CreationSessionStrategyType = Literal['GENERAL', 'GRID', 'MOMENTUM', 'MEAN_REVERSION', 'BUY_AND_HOLD', 'ASSET_ALLOCATION']
StrategyType = Literal[
    'GENERAL',
    'GRID',
    'MOMENTUM',
    'MEAN_REVERSION',
    'BUY_AND_HOLD',
    'ASSET_ALLOCATION',
    'MULTI_FACTOR',
]
FieldSource = Literal['user_input', 'system_inference', 'system_default', 'manual_override']
BacktestRunStatus = Literal['QUEUED', 'RUNNING', 'INTERRUPTED', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED']
BacktestExecutionStage = Literal['DATA_FETCHING', 'SIMULATING', 'METRIC_CALCULATING']
OptimizationJobStatus = Literal['QUEUED', 'RUNNING', 'INTERRUPTED', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED']
OptimizationMatchingCombinationSource = Literal['all_trials', 'persisted_candidates']
SnapshotStatus = Literal['READY', 'STALE', 'INCOMPLETE', 'FAILED']
SnapshotKind = Literal['DATASET', 'UNIVERSE']
TrialStatus = Literal['SUCCEEDED', 'FAILED', 'PENDING']
PromoteMode = Literal['set_current', 'create_copy']
SnapshotRefreshMode = Literal['incremental', 'repair', 'full']
SnapshotRefreshTarget = Literal[
    'price',
    'corporate',
    'valuations',
    'universes',
    'fundamentals',
    'sentiment',
    'macro_derivatives',
    'bond',
]
DataSegmentType = Literal['FULL', 'TRAIN', 'TEST', 'VALIDATION']
OptimizationConstraintPresetKey = Literal['balanced', 'defensive', 'offensive']
SnapshotProviderAccessTier = Literal['public', 'free_account', 'paid_optional', 'public_web', 'repo_local']
OfficialSeedStatus = Literal['complete', 'partial', 'missing']
LegType = Literal['strategy', 'asset', 'cash']
CompositionStatus = Literal['DRAFT', 'ACTIVE', 'ARCHIVED']
FactorSource = Literal['MANUAL', 'SYSTEM_SEED', 'AUTO_MINED']
FactorLifecycleStatus = Literal['DRAFT', 'VERIFIED', 'PRODUCTION', 'DECAYED', 'DEPRECATED', 'PRUNED']
FactorDiagnosticStatus = Literal[
    'READY_TO_DIAGNOSE',
    'SANDBOX_READY',
    'BLOCKED_PIT',
    'BLOCKED_DATA',
    'RUNNING',
    'COMPLETED',
    'FAILED',
]
FactorDiagnosticMode = Literal['VERIFIED', 'SANDBOX']
FactorDirection = Literal['HIGH_IS_BETTER', 'LOW_IS_BETTER', 'NEUTRAL']
FactorFrequency = Literal['DAILY', 'WEEKLY', 'MONTHLY']
FactorMiningJobStatus = Literal['QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED']
FactorQuarantineStatus = Literal['PENDING', 'RUNNING', 'PASSED', 'REJECTED', 'NEEDS_REVIEW', 'PUBLISHED', 'SUPERSEDED']
FactorPublishStatus = Literal['ELIGIBLE', 'BLOCKED', 'MANUAL_REVIEW_REQUIRED', 'PUBLISHED']
FactorGovernanceStatus = Literal['WATCH', 'REVIEW', 'DECAYED', 'CROWDED', 'SUSPENDED']
FactorFactoryAutomationStatus = Literal['ACTIVE', 'PAUSED']
FactorFactoryRunStatus = Literal['QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', 'FAILED']
FactorFactoryRunTrigger = Literal['DAILY', 'MANUAL']


class FactorDescriptorRequest(BaseModel):
    source_prefix: str = Field(default='m', min_length=1)
    category: str = Field(min_length=1)
    metric: str = ''
    window: str = Field(min_length=1)
    operator: str = Field(min_length=1)


class FactorCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    market: str = Field(default='US', min_length=1)
    universe: str = Field(default='SP500', min_length=1)
    expression: str = Field(min_length=1)
    frequency: FactorFrequency = 'DAILY'
    direction: FactorDirection = 'HIGH_IS_BETTER'
    tags: list[str] = Field(default_factory=list)
    descriptor: FactorDescriptorRequest


class FactorDiagnosticRequest(BaseModel):
    start_date: str
    end_date: str
    universe: str | None = None
    dataset_snapshot_id: str = Field(min_length=1)
    universe_snapshot_id: str = Field(min_length=1)
    return_window_days: int = Field(default=21, ge=1, le=252)
    group_count: int = Field(default=5, ge=2, le=10)
    diagnostic_mode: FactorDiagnosticMode = 'VERIFIED'


class FactorDiagnosticPreviewRequest(BaseModel):
    expression: str = ''
    market: str = Field(default='US', min_length=1)
    universe: str = Field(default='SP500', min_length=1)
    dataset_snapshot_id: str | None = None
    universe_snapshot_id: str | None = None
    lookback_years: int = Field(default=5, ge=1, le=10)
    return_window_days: int = Field(default=21, ge=1, le=126)
    batch: bool = False
    factor_ids: list[str] = Field(default_factory=list)
    diagnostic_mode: FactorDiagnosticMode = 'SANDBOX'
    include: list[str] = Field(default_factory=list)


class FactorMiningJobCreateRequest(BaseModel):
    universe: str = Field(default='SP500', min_length=1)
    start_date: str = Field(default='2018-01-01', min_length=1)
    end_date: str = Field(default='2024-12-31', min_length=1)
    operators: list[str] = Field(default_factory=lambda: ['Rank', 'ZScore', 'Winsorize'])
    candidate_count: int = Field(default=1000, ge=1, le=10000)
    random_seed: int | None = None
    min_rank_ic: float = Field(default=0.03, ge=-1.0, le=1.0)
    max_depth: int = Field(default=4, ge=1, le=8)

    @field_validator('operators')
    @classmethod
    def _require_operators(cls, value: list[str]) -> list[str]:
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        if not cleaned:
            raise ValueError('operators must not be empty')
        return cleaned


class FactorFactoryGatePolicy(BaseModel):
    pit_gate_mode: Literal['DIAGNOSTIC_ONLY'] = 'DIAGNOSTIC_ONLY'
    max_style_correlation: float = Field(default=0.3, ge=0.0, le=1.0)
    residual_enabled: bool = True
    max_drawdown_relative_to_benchmark: float = Field(default=1.5, gt=0.0)
    min_oos_to_is_ratio: float = Field(default=0.5, ge=0.0, le=1.0)


class FactorFactoryProfile(BaseModel):
    id: str = 'default'
    status: FactorFactoryAutomationStatus = 'ACTIVE'
    timezone: str = 'Asia/Hong_Kong'
    schedule_time: str = Field(default='14:00', pattern=r'^\d{2}:\d{2}$')
    request: FactorMiningJobCreateRequest = Field(default_factory=FactorMiningJobCreateRequest)
    gate_policy: FactorFactoryGatePolicy = Field(default_factory=FactorFactoryGatePolicy)


class FactorFactoryAutomationRequest(BaseModel):
    timezone: str = 'Asia/Hong_Kong'
    schedule_time: str = Field(default='14:00', pattern=r'^\d{2}:\d{2}$')
    request: FactorMiningJobCreateRequest = Field(default_factory=FactorMiningJobCreateRequest)
    gate_policy: FactorFactoryGatePolicy = Field(default_factory=FactorFactoryGatePolicy)


class FactorFactoryRunNowRequest(BaseModel):
    request: FactorMiningJobCreateRequest = Field(default_factory=FactorMiningJobCreateRequest)
    gate_policy: FactorFactoryGatePolicy = Field(default_factory=FactorFactoryGatePolicy)


class FactorQuarantineIntakeRequest(BaseModel):
    mining_job_id: str | None = None
    candidate_ids: list[str] = Field(default_factory=list)


class FactorQuarantineRunRequest(BaseModel):
    reason: str | None = None
    rule_version: str | None = None


class FactorQuarantinePublishRequest(BaseModel):
    operator: str | None = None
    rule_version: str | None = None


class FactorGovernanceExecuteRequest(BaseModel):
    confirm: bool = False
    command: str = Field(min_length=1)
    factor_ids: list[str] = Field(default_factory=list)
    factor_id: str | None = None
    reason: str = Field(min_length=1)
    keep_factor_id: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)


class FactorModelSuggestionRequest(BaseModel):
    factor_ids: list[str] = Field(default_factory=list)
    factor_id: str | None = None


class FactorModelComponentRequest(BaseModel):
    factor_id: str = Field(min_length=1)
    weight: float = Field(default=1.0)
    direction: FactorDirection = 'HIGH_IS_BETTER'


class FactorModelNeutralizationRequest(BaseModel):
    enabled: bool = False
    method: str = Field(default='industry')


class FactorModelPreviewRequest(BaseModel):
    name: str | None = None
    universe: str = Field(default='SP500', min_length=1)
    rebalance_frequency: str = Field(default='monthly', min_length=1)
    scoring_method: str = Field(default='zscore_weighted', min_length=1)
    components: list[FactorModelComponentRequest] = Field(default_factory=list, min_length=1)
    neutralization: FactorModelNeutralizationRequest = Field(default_factory=FactorModelNeutralizationRequest)


class FactorModelCreateRequest(FactorModelPreviewRequest):
    idempotency_key: str | None = None
    description: str | None = None


class ApiMultiFactorComponent(BaseModel):
    factor_id: str
    name: str | None = None
    family: str | None = None
    direction: FactorDirection | str = 'HIGH_IS_BETTER'
    weight: float = 0.0
    normalized_weight: float = 0.0
    diagnostic_status: str | None = None
    pit_coverage: dict[str, Any] = Field(default_factory=dict)


class ApiMultiFactorNeutralization(BaseModel):
    enabled: bool = False
    method: str = 'industry'
    industry_field: str | None = None
    execution_status: str = 'DISABLED'
    blocker_reason: str | None = None


class ApiMultiFactorProfile(BaseModel):
    components: list[ApiMultiFactorComponent] = Field(default_factory=list)
    neutralization: ApiMultiFactorNeutralization = Field(default_factory=ApiMultiFactorNeutralization)
    scoring_method: str = 'zscore_weighted'
    rebalance_frequency: str = 'monthly'
    pit_snapshot_refs: dict[str, Any] = Field(default_factory=dict)
    coverage_summary: dict[str, Any] = Field(default_factory=dict)


class ApiMultiFactorPrecheck(BaseModel):
    status: Literal['PASS', 'WARN', 'BLOCKED'] = 'PASS'
    factor_count: int = 0
    coverage_pct: float = 0.0
    blocked_factors: list[dict[str, Any]] = Field(default_factory=list)
    neutralization_status: dict[str, Any] = Field(default_factory=dict)
    estimated_turnover_pct: float | None = None
    warnings: list[str] = Field(default_factory=list)


class ApiMultiFactorAttribution(BaseModel):
    summary: dict[str, Any] = Field(default_factory=dict)
    factor_contributions: list[dict[str, Any]] = Field(default_factory=list)
    industry_exposures: list[dict[str, Any]] = Field(default_factory=list)
    coverage: dict[str, Any] = Field(default_factory=dict)
    neutralization_status: dict[str, Any] = Field(default_factory=dict)
    attribution_source: str = 'estimated'
    warnings: list[str] = Field(default_factory=list)


class ApiMultiFactorParameterRange(BaseModel):
    key: str
    label: str
    mode: Literal['range', 'fixed', 'discrete'] = 'fixed'
    current: Any | None = None
    start: Any | None = None
    end: Any | None = None
    step: Any | None = None
    values: list[Any] | None = None


class PitResearchWaiverRequest(BaseModel):
    dataset_snapshot_id: str | None = None
    universe_snapshot_id: str | None = None
    ignored_symbols: list[str] = Field(default_factory=list)
    reason: str | None = None
    created_by: str | None = None


class PitIdentityOverrideRequest(BaseModel):
    symbol: str = Field(min_length=1)
    canonical_symbol: str = Field(min_length=1)
    company_name: str | None = None
    cik: str | None = None
    exchange: str | None = None
    ipo_date: str | None = None
    delisting_date: str | None = None
    valid_from: str | None = None
    valid_to: str | None = None
    reason: str | None = None
    created_by: str | None = None


class PitIdentityScraperRestartRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list)
    max_symbols: int | None = Field(default=None, ge=1, le=1000)
    reason: str | None = None
    created_by: str | None = None


class CreationMessageCreate(BaseModel):
    content: str = Field(min_length=1)
    revision: int | None = Field(default=None, ge=1)


class CreateCreationSessionRequest(BaseModel):
    strategy_type: CreationSessionStrategyType | None = None
    mode: CreationSessionMode = 'CREATE'
    base_strategy_id: str | None = None
    base_parameter_version_id: str | None = None


class PrepareConfirmationRequest(BaseModel):
    context_notes: str | None = None
    revision: int | None = Field(default=None, ge=1)


class ConfirmationUpdateRequest(BaseModel):
    revision: int = Field(ge=1)
    strategy_type: CreationSessionStrategyType | None = None
    core: dict[str, Any] = Field(default_factory=dict)
    logic: dict[str, Any] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)


class MaterializeRequest(BaseModel):
    idempotency_key: str = Field(min_length=1)
    confirmed_revision: int | None = Field(default=None, ge=1)
    base_parameter_version_id: str | None = None


class AssetAllocationRecommendationAsset(BaseModel):
    symbol: str = Field(min_length=1)
    display_name: str | None = None
    asset_class: str | None = None
    target_weight_pct: float | None = Field(default=None, ge=0)


class AssetAllocationRecommendationRequest(BaseModel):
    assets: list[AssetAllocationRecommendationAsset] = Field(default_factory=list)
    lookback_days: int = Field(default=252, ge=21)


class AssetAllocationRecommendedWeight(BaseModel):
    symbol: str
    display_name: str | None = None
    asset_class: str | None = None
    target_weight_pct: float
    risk_contribution_pct: float
    data_status: str


class AssetAllocationRecommendationResponse(BaseModel):
    method: str
    weights: list[AssetAllocationRecommendedWeight] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


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


class ResumeBacktestRunRequest(BaseModel):
    idempotency_key: str = Field(min_length=1)


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


class OptimizationJobFilteredResultCreateRequest(OptimizationJobConstraintUpdateRequest):
    pass


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
    decision_note: str | None = None


class ParameterVersionRestoreRequest(BaseModel):
    idempotency_key: str = Field(min_length=1)
    base_parameter_version_id: str | None = None
    decision_note: str | None = None


class SnapshotRefreshRequest(BaseModel):
    reason: str | None = None
    mode: SnapshotRefreshMode = 'incremental'
    targets: list[SnapshotRefreshTarget] = Field(default_factory=list)
    repair_symbol_limit: int | None = Field(default=None, ge=1, le=5000)


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


class SnapshotProviderReadinessSummaryModel(BaseModel):
    provider_count: int = 0
    registered_provider_count: int = 0
    enabled_provider_count: int = 0
    credential_ready_provider_count: int = 0
    usable_provider_count: int = 0
    attempted_provider_count: int = 0
    attempt_event_count: int = 0
    unique_attempted_provider_count: int = 0
    latest_job_attempt_event_count: int = 0
    latest_job_attempted_provider_count: int = 0
    attempt_rollup_policy: str = "unique_provider_latest_job_priority"
    quota_limited_provider_count: int = 0
    cooldown_provider_count: int = 0
    missing_credential_provider_count: int = 0
    failed_provider_count: int = 0
    auxiliary_only_provider_count: int = 0
    target_type_counts: dict[str, int] = Field(default_factory=dict)
    top_blockers: list[dict[str, Any]] = Field(default_factory=list)
    last_attempt_at: str | None = None
    openbb: dict[str, Any] = Field(default_factory=dict)


class SnapshotProviderRegistryItemModel(BaseModel):
    provider_id: str
    source_name: str
    access_tier: SnapshotProviderAccessTier | str
    credential_requirements: dict[str, Any] = Field(default_factory=dict)
    target_types: list[str] = Field(default_factory=list)
    fallback_order: dict[str, int] = Field(default_factory=dict)
    latest_attempt: dict[str, Any] | None = None
    quota_cooldown: dict[str, Any] = Field(default_factory=dict)
    error_summary: dict[str, Any] = Field(default_factory=dict)
    pit_permission: dict[str, Any] = Field(default_factory=dict)
    source_governance: dict[str, Any] = Field(default_factory=dict)
    trust_profile: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = False
    credential_ready: bool = True
    usable: bool = False
    readiness_status: str = "disabled"
    optional_layer: str | None = None


class SnapshotProviderRegistryResponseModel(BaseModel):
    generated_at: str
    openbb_enabled: bool = False
    items: list[SnapshotProviderRegistryItemModel] = Field(default_factory=list)


class SnapshotProviderAttemptItemModel(BaseModel):
    attempt_id: str
    provider_id: str
    target_type: str
    snapshot_kind: str
    snapshot_id: str
    job_id: str | None = None
    status: str
    selection_status: str | None = None
    access_tier: SnapshotProviderAccessTier | str = 'public'
    attempted_at: str | None = None
    next_retry_at: str | None = None
    quota_limited: bool = False
    cooldown_active: bool = False
    reason: str | None = None
    error: str | None = None
    landed_row_count: int = 0
    landed_symbol_count: int = 0
    auxiliary_only: bool = False
    pit_effect: dict[str, Any] = Field(default_factory=dict)


class SnapshotProviderAttemptListResponseModel(BaseModel):
    generated_at: str
    latest_job_id: str | None = None
    items: list[SnapshotProviderAttemptItemModel] = Field(default_factory=list)
    rollup: dict[str, Any] = Field(default_factory=dict)


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
    version_reason: str | None = None
    version_change_summary: str | None = None
    version_source: str | None = None
    version_candidate_id: str | None = None
    version_candidate_label: str | None = None


class CompositionSourceFreezeRefreshRequest(BaseModel):
    reason: str | None = None
    confirmed_by: str | None = None


class CompositionBacktestRunCreateRequest(BaseModel):
    idempotency_key: str | None = None
    composition_version: str | None = None
    period: str = "10Y"
    horizon_years: int | None = Field(default=10, ge=1, le=30)
    start_date: str | None = None
    end_date: str | None = None
    rebalance_frequency: str | None = None
    drift_threshold_pct: float = 8.0
    fee_bps: float = 1.5
    slippage_bps: float = 2.5
    missing_data_rule: str = "proxy"
    notes: str | None = None


class CompositionAllocationJobCreateRequest(BaseModel):
    idempotency_key: str | None = None
    intent: str = 'risk_parity'
    target_volatility_pct: float | None = Field(default=None, ge=0)
    volatility_band_pct: float | None = Field(default=2.0, ge=0)
    lookback_window: str | None = '10y'
    history_window_years: int | None = Field(default=10, ge=1)
    max_turnover_bucket: str | None = 'medium'
    max_turnover_pct: float | None = Field(default=18.0, ge=0)
    covariance_model: str | None = "ledoit_wolf"
    return_source: str | None = "historical"
    constraints: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None


class CompositionPromotionDraftRequest(BaseModel):
    base_version_id: str | None = None
    decision_note: str | None = None


class CompositionDecisionPacketCreateRequest(BaseModel):
    version_id: str | None = None
    backtest_run_id: str | None = None
    allocation_job_id: str | None = None
    candidate_id: str | None = None
    recommendation: str | None = None
    notes: str | None = None


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
    source_integrity: dict[str, Any] | None = None
    freeze_hash: str | None = None
    signature_status: str | None = None
    drift_status: str | None = None
    current_ref_id: str | None = None
    alerts: list[str] = Field(default_factory=list)
    return_quality: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)


class LegInventoryResponseModel(BaseModel):
    counts: LegInventoryCountModel = Field(default_factory=LegInventoryCountModel)
    filters: LegInventoryFiltersModel = Field(default_factory=LegInventoryFiltersModel)
    rows: list[LegInventoryRowModel] = Field(default_factory=list)
    strategy_reference_counts: dict[str, int] = Field(default_factory=dict)


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
    leg_quality: list[dict[str, Any]] = Field(default_factory=list)


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


class CompositionStatusActionModel(BaseModel):
    label: str
    action_key: str
    action_kind: str = 'open_new_tab'
    route: str | None = None
    enabled: bool = True


class CompositionProxyContextModel(BaseModel):
    leg_id: str | None = None
    target_symbol: str | None = None
    proxy_symbol: str | None = None
    horizon_label: str | None = None
    proxy_signature: str
    proxy_source: str = 'unknown'
    coverage_window: dict[str, Any] = Field(default_factory=dict)
    explanation: str | None = None


class CompositionStatusDiagnosisModel(BaseModel):
    status: str
    issue_type: str
    diagnosis_type: str
    diagnosis_label: str
    frontend_explanation: str
    action: str
    resolution_criteria: str
    actions: list[CompositionStatusActionModel] = Field(default_factory=list)
    proxy_context: list[CompositionProxyContextModel] = Field(default_factory=list)
    system_disposition: str | None = None
    debug_facts: dict[str, Any] = Field(default_factory=dict)


class CompositionProxyConfirmationRequest(BaseModel):
    leg_id: str | None = None
    target_symbol: str | None = None
    proxy_symbol: str | None = None
    horizon_label: str | None = None
    proxy_signature: str | None = None
    coverage_window: dict[str, Any] = Field(default_factory=dict)
    reason: str | None = None
    confirmed_by: str | None = None


class CompositionAuditTrailItemModel(BaseModel):
    id: str
    action: str
    actor: str = 'system'
    at: str
    summary: str
    hash_before: str | None = None
    hash_after: str | None = None
    reason: str | None = None
    change_summary: str | None = None
    version_before: int | None = None
    version_after: int | None = None
    version_source: str | None = None
    version_candidate_id: str | None = None
    version_candidate_label: str | None = None


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
    primary_diagnosis: CompositionStatusDiagnosisModel | None = None
    diagnoses: list[CompositionStatusDiagnosisModel] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    advisories: list[str] = Field(default_factory=list)


class CompositionListItemModel(BaseModel):
    id: str
    name: str
    status: str
    version_label: str | None = None
    version_status: str | None = None
    evidence_grade: str | None = None
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
    has_new_version: bool = False
    source_integrity: list[CompositionSourceIntegrityModel] = Field(default_factory=list)
    latest_backtest_summary: dict[str, Any] = Field(default_factory=dict)
    backtest_period_coverage: list[dict[str, Any]] = Field(default_factory=list)
    lab_summary: dict[str, Any] = Field(default_factory=dict)
    pending_decision_count: int = 0
    promotion_readiness: dict[str, Any] = Field(default_factory=dict)
    primary_diagnosis: CompositionStatusDiagnosisModel | None = None
    diagnoses: list[CompositionStatusDiagnosisModel] = Field(default_factory=list)


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


class CompositionBacktestHistoryItemModel(BaseModel):
    run_id: str
    created_at: str
    completed_at: str | None = None
    composition_version_label: str | None = None
    composition_version_number: int | None = None
    strategy_version_label: str | None = None
    strategy_versions: list[dict[str, Any]] = Field(default_factory=list)
    period_label: str | None = None
    horizon_years: float | None = None
    annualized_return: float | None = None
    sharpe: float | None = None


class CompositionDetailResponseModel(BaseModel):
    id: str
    name: str
    description: str | None = None
    status: str
    status_label: str
    current_composition_version_label: str | None = None
    current_composition_version_number: int | None = None
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
    backtest_history: list[CompositionBacktestHistoryItemModel] = Field(default_factory=list)
    audit_trail: list[CompositionAuditTrailItemModel] = Field(default_factory=list)
    primary_diagnosis: CompositionStatusDiagnosisModel | None = None
    diagnoses: list[CompositionStatusDiagnosisModel] = Field(default_factory=list)
    composition_score: CompositionScoreModel = Field(default_factory=CompositionScoreModel)
    latest_activity_label: str
    deep_link_actions: list[AllowedAction | str] = Field(default_factory=list)


class CompositionBacktestOrderItemModel(BaseModel):
    id: str
    order_id: str
    run_id: str
    event_id: str
    event_label: str
    event_date: str | None = None
    symbol: str
    side: str
    quantity: float | None = None
    quantity_unit: str = 'weight_pct'
    price: float | None = None
    slippage_bps: float = 0.0
    fee_amount: float | None = None
    source_leg_id: str
    source_leg_name: str
    source_leg_kind: str
    trigger_reason: str
    gross_buy_quantity: float = 0.0
    gross_sell_quantity: float = 0.0
    internal_net_quantity: float = 0.0
    external_quantity: float = 0.0
    netting_ratio_pct: float = 0.0
    netting_status: str = 'not_nettable'
    execution_kind: str = 'simulated_rebalance_instruction'
    quality_label: str
    evidence_label: str


class CompositionBacktestOrderPageModel(BaseModel):
    items: list[CompositionBacktestOrderItemModel] = Field(default_factory=list)
    page: int = 1
    page_size: int = 100
    total: int = 0
    symbol_filter: str | None = None
    source_leg_filter: str | None = None
    filters: dict[str, Any] = Field(default_factory=dict)
    generated_from: str = 'composition_rebalance_events_and_strategy_trades'
    quality_label: str
    evidence_label: str


class CompositionBacktestOrderNettingModel(BaseModel):
    order_id: str
    run_id: str
    composition_id: str
    symbol: str
    event_id: str
    event_label: str
    event_date: str | None = None
    source_leg_id: str
    source_leg_name: str
    before_netting: dict[str, float] = Field(default_factory=dict)
    after_netting: dict[str, float] = Field(default_factory=dict)
    internal_net_quantity: float = 0.0
    external_quantity: float = 0.0
    netting_ratio_pct: float = 0.0
    netting_status: str
    generated_from: str = 'composition_rebalance_events_and_strategy_trades'
    quality_label: str
    evidence_label: str


class CompositionBacktestRunResponseModel(BaseModel):
    id: str
    run_id: str
    composition_id: str
    current_composition_version_label: str | None = None
    current_composition_version_number: int | None = None
    status: str
    created_at: str
    completed_at: str | None = None
    request: dict[str, Any] = Field(default_factory=dict)
    summary: dict[str, Any] = Field(default_factory=dict)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    returns_preview: list[CompositionReturnPointModel] = Field(default_factory=list)
    benchmark_series: list[CompositionBenchmarkPointModel] = Field(default_factory=list)
    risk_contribution_preview: list[CompositionRiskContributionModel] = Field(default_factory=list)
    rebalance_events: list[CompositionRebalanceEventModel] = Field(default_factory=list)
    return_quality_summary: CompositionReturnQualitySummaryModel = Field(default_factory=CompositionReturnQualitySummaryModel)
    source_integrity: list[CompositionSourceIntegrityModel] = Field(default_factory=list)
    audit_trail: list[CompositionAuditTrailItemModel] = Field(default_factory=list)
    order_summary: dict[str, Any] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)
    evidence_grade: str | None = None
    scenario_anchors: list[dict[str, Any]] = Field(default_factory=list)
    risk_budget_timeline: list[dict[str, Any]] = Field(default_factory=list)
    promotion_readiness: dict[str, Any] = Field(default_factory=dict)
    primary_diagnosis: CompositionStatusDiagnosisModel | None = None
    diagnoses: list[CompositionStatusDiagnosisModel] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class CompositionAllocationJobResponseModel(BaseModel):
    id: str
    job_id: str
    composition_id: str
    status: str
    created_at: str
    completed_at: str | None = None
    request: dict[str, Any] = Field(default_factory=dict)
    summary: dict[str, Any] = Field(default_factory=dict)
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    frontier_points: list[dict[str, Any]] = Field(default_factory=list)
    residual_budget: dict[str, Any] = Field(default_factory=dict)
    covariance_preview: list[dict[str, Any]] = Field(default_factory=list)
    return_quality_summary: CompositionReturnQualitySummaryModel = Field(default_factory=CompositionReturnQualitySummaryModel)
    source_integrity: list[CompositionSourceIntegrityModel] = Field(default_factory=list)
    audit_trail: list[CompositionAuditTrailItemModel] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)
    evidence_grade: str | None = None
    scenario_anchors: list[dict[str, Any]] = Field(default_factory=list)
    risk_budget_timeline: list[dict[str, Any]] = Field(default_factory=list)
    promotion_readiness: dict[str, Any] = Field(default_factory=dict)
    primary_diagnosis: CompositionStatusDiagnosisModel | None = None
    diagnoses: list[CompositionStatusDiagnosisModel] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class CompositionVersionSummaryModel(BaseModel):
    id: str
    composition_id: str
    version_number: int
    status: str
    source_kind: str
    source_ref_id: str | None = None
    created_at: str
    diff_summary: dict[str, Any] = Field(default_factory=dict)
    evidence: dict[str, Any] = Field(default_factory=dict)


class CompositionVersionDetailModel(CompositionVersionSummaryModel):
    snapshot: dict[str, Any] = Field(default_factory=dict)
    diff: dict[str, Any] = Field(default_factory=dict)


class CompositionVersionListResponseModel(BaseModel):
    composition_id: str
    items: list[CompositionVersionSummaryModel] = Field(default_factory=list)


class CompositionGlobalBacktestRunListResponseModel(BaseModel):
    items: list[CompositionBacktestRunResponseModel] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    decision_queue: list[dict[str, Any]] = Field(default_factory=list)


class CompositionGlobalAllocationJobListResponseModel(BaseModel):
    items: list[CompositionAllocationJobResponseModel] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    decision_queue: list[dict[str, Any]] = Field(default_factory=list)


class CompositionDecisionPacketModel(BaseModel):
    id: str
    composition_id: str
    version_id: str | None = None
    source_refs: dict[str, Any] = Field(default_factory=dict)
    packet: dict[str, Any] = Field(default_factory=dict)
    export_markdown: str = ""
    export_html: str = ""
    created_at: str


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
    tracking_error_source: str | None = None
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
    tracking_error_source: str | None = None
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
    provider_readiness_summary: SnapshotProviderReadinessSummaryModel = Field(
        default_factory=SnapshotProviderReadinessSummaryModel
    )
    data_trust_summary: dict[str, Any] = Field(default_factory=dict)
    data_layer_readiness: list[dict[str, Any]] = Field(default_factory=list)
    snapshot_quality_alerts: list[dict[str, Any]] = Field(default_factory=list)
    factor_dimension_readiness: list[dict[str, Any]] = Field(default_factory=list)
    bond_fixed_income: BondFixedIncomeOverviewModel


class PitDataOverviewResponseModel(BaseModel):
    dataset_snapshot_id: str
    fundamental_snapshot_id: str | None = None
    universe_snapshot_id: str
    as_of_date: str
    cleaning_version: str
    overall_status: str
    adjusted_price_status: str
    universe_status: str
    outlier_cleaning_status: str
    corporate_action_status: str | None = None
    fundamental_status: str | None = None
    coverage: dict[str, Any] = Field(default_factory=dict)
    fundamental_coverage: dict[str, Any] = Field(default_factory=dict)
    blocking_items: list[dict[str, Any]] = Field(default_factory=list)
    status_reasons: dict[str, Any] = Field(default_factory=dict)
    ops_guidance: dict[str, Any] = Field(default_factory=dict)
    sample_securities: list[str] = Field(default_factory=list)
    quality_events: list[dict[str, Any]] = Field(default_factory=list)
    coverage_gap: dict[str, Any] = Field(default_factory=dict)
    factor_admission_coverage: dict[str, Any] = Field(default_factory=dict)
    cleaning_rule_previews: list[dict[str, Any]] = Field(default_factory=list)
    universe_history_series: list[dict[str, Any]] = Field(default_factory=list)
    adjustment_trace: dict[str, Any] = Field(default_factory=dict)
    research_waiver: dict[str, Any] | None = None
    full_ready_repair_plan: dict[str, Any] = Field(default_factory=dict)
    external_source_readiness: dict[str, Any] = Field(default_factory=dict)
    data_trust_summary: dict[str, Any] = Field(default_factory=dict)
    factor_diagnostics_enabled: bool = False
    verified_diagnostics_enabled: bool | None = None
    limited_diagnostics_enabled: bool | None = None
    sandbox_diagnostics_enabled: bool | None = None
    diagnostic_windows: dict[str, Any] = Field(default_factory=dict)
    gate_fix_target: str
    source: dict[str, Any] = Field(default_factory=dict)
    pit_layer_readiness: list[dict[str, Any]] = Field(default_factory=list)
    factor_diagnostic_readiness: list[dict[str, Any]] = Field(default_factory=list)
    pit_quality_alerts: list[dict[str, Any]] = Field(default_factory=list)
    snapshot_layer_linkage: list[dict[str, Any]] = Field(default_factory=list)
