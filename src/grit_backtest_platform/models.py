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
SnapshotStatus = Literal['READY', 'STALE', 'INCOMPLETE', 'FAILED']
SnapshotKind = Literal['DATASET', 'UNIVERSE']
TrialStatus = Literal['SUCCEEDED', 'FAILED', 'PENDING']
PromoteMode = Literal['set_current', 'create_copy']
SnapshotRefreshMode = Literal['incremental', 'repair', 'full']
SnapshotRefreshTarget = Literal['price', 'corporate', 'universes']
DataSegmentType = Literal['FULL', 'TRAIN', 'TEST', 'VALIDATION']
OptimizationConstraintPresetKey = Literal['balanced', 'defensive', 'offensive']


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
    fee_bps: float | None = Field(default=None, ge=0)
    slippage_bps: float | None = Field(default=None, ge=0)
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

