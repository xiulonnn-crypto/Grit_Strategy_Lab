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
SnapshotRefreshTarget = Literal['price', 'corporate', 'universes']
DataSegmentType = Literal['FULL', 'TRAIN', 'TEST', 'VALIDATION']
OptimizationConstraintPresetKey = Literal['balanced', 'defensive', 'offensive']
SnapshotProviderAccessTier = Literal['public', 'free_account', 'paid_optional']
OfficialSeedStatus = Literal['complete', 'partial', 'missing']


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
    unit: str = Field(default="")


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
    probe_status_breakdown: dict[str, int] = Field(default_factory=dict)
    coverage_kind_breakdown: dict[str, int] = Field(default_factory=dict)
    complete_no_events_symbol_count: int | None = None
    formal_event_symbol_count: int | None = None
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

