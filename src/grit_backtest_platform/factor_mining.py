"""Pure Python factor-mining sandbox primitives.

The module deliberately contains no FastAPI or SQLite integration.  API and
storage layers can wrap these request/result structures while keeping writes in
their own parent controller thread.
"""

from __future__ import annotations

import hashlib
import math
import random
import re
import statistics
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Sequence

from .factor_expression_engine import FactorExpressionError, evaluate_expression


MarketDataBySymbol = Mapping[str, Mapping[str, Sequence[float | int | None]]]

FORWARD_RETURN_HORIZON_DAYS = 5
SHORT_MOMENTUM_CONTROL_WINDOW_DAYS = 3
LEGACY_IR_IC_SCALE = 0.05
_HOLDING_PERIOD_PATTERN = re.compile(
    r"\b(?:Return|Lag|Delta|TsRank\s*\(\s*Return)\s*\(\s*Close\s*,\s*(\d+)\s*\)",
    re.IGNORECASE,
)
GENERATION_MODE_PRICE_OPERATOR = "PRICE_OPERATOR"
GENERATION_MODE_HYBRID_COMPOSITION = "HYBRID_COMPOSITION"
DEFAULT_COMPOSITION_SOURCE_FACTORS = (
    "s_mom_6m_rank",
    "s_qlty_roe_ltm_raw",
    "s_vol_252d_rank",
    "s_val_cfp_ltm_raw",
    "s_size_cur_log",
    "s_vol_downside_252d_rank",
    "s_liq_amihud_20d_rank",
)
DEFAULT_COMPOSITION_RECIPE_FAMILIES = (
    "style_blend",
    "risk_adjusted",
    "value_anchor",
    "divergence",
    "residual_neutralized",
    "ts_denoise",
)
_FACTOR_REFERENCE_PATTERN = re.compile(r"\bs_[a-z0-9_]+(?:_raw|_rank)?\b", re.IGNORECASE)
_BINARY_FACTOR_REFERENCE_PATTERN = re.compile(
    r"^\s*(s_[a-z0-9_]+(?:_raw|_rank)?)\s*([+\-*/])\s*(s_[a-z0-9_]+(?:_raw|_rank)?)\s*$",
    re.IGNORECASE,
)
_RESIDUAL_FACTOR_REFERENCE_PATTERN = re.compile(
    r"^\s*ZScore\s*\(\s*Residual\s*\(\s*(s_[a-z0-9_]+(?:_raw|_rank)?)\s*,\s*by\s*=\s*['\"]"
    r"(s_[a-z0-9_]+(?:_raw|_rank)?)['\"]\s*\)\s*\)\s*$",
    re.IGNORECASE,
)
_TS_RANK_RETURN_PATTERN = re.compile(
    r"^\s*Ts_?Rank\s*\(\s*Return\s*\(\s*Close\s*,\s*(\d+)\s*\)\s*,\s*(\d+)\s*\)\s*$",
    re.IGNORECASE,
)
_FACTOR_ALIASES = {
    "s_vol_252d_raw": "s_vol_252d_rank",
    "s_mom_ret_126d_z": "s_mom_6m_rank",
}
_FACTOR_FAMILIES = {
    "s_mom_6m_rank": "momentum",
    "s_mom_1m_rank": "momentum",
    "s_mom_12d_rank": "momentum",
    "s_qlty_roe_ltm_raw": "quality",
    "s_vol_252d_rank": "risk",
    "s_vol_downside_252d_rank": "risk",
    "s_val_cfp_ltm_raw": "value",
    "s_size_cur_log": "size",
    "s_liq_amihud_20d_rank": "liquidity",
}


@dataclass(frozen=True)
class CompositionCandidateSpec:
    expression: str
    source_factor_ids: tuple[str, ...] = ()
    recipe_kind: str | None = None
    recipe_family: str | None = None
    orthogonality_intent: str | None = None
    composition_metadata: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class FactorMiningJobCreateRequest:
    universe: tuple[str, ...]
    start_date: str
    end_date: str
    operators: tuple[str, ...]
    candidate_count: int
    random_seed: int
    min_rank_ic: float = 0.0
    max_depth: int = 3
    generation_mode: str = GENERATION_MODE_PRICE_OPERATOR
    source_factor_ids: tuple[str, ...] = ()
    recipe_families: tuple[str, ...] = ()
    exploration_budget: int = 0
    composition_policy: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: Mapping[str, object]) -> "FactorMiningJobCreateRequest":
        return cls(
            universe=_coerce_string_tuple(payload.get("universe", ())),
            start_date=str(payload.get("start_date", "")),
            end_date=str(payload.get("end_date", "")),
            operators=_coerce_string_tuple(payload.get("operators", ())),
            candidate_count=int(payload.get("candidate_count", 0)),
            random_seed=int(payload.get("random_seed", 0)),
            min_rank_ic=float(payload.get("min_rank_ic", 0.0)),
            max_depth=int(payload.get("max_depth", 3)),
            generation_mode=str(payload.get("generation_mode") or GENERATION_MODE_PRICE_OPERATOR),
            source_factor_ids=_coerce_string_tuple(payload.get("source_factor_ids", ())),
            recipe_families=_coerce_string_tuple(payload.get("recipe_families", ())),
            exploration_budget=int(payload.get("exploration_budget", 0) or 0),
            composition_policy=dict(payload.get("composition_policy") or {}),
        )

    def validate(self) -> None:
        if not self.universe:
            raise ValueError("universe is required")
        if not self.operators and self.generation_mode.upper() != GENERATION_MODE_HYBRID_COMPOSITION:
            raise ValueError("operators are required")
        if self.candidate_count <= 0:
            raise ValueError("candidate_count must be positive")
        if self.max_depth <= 0:
            raise ValueError("max_depth must be positive")


@dataclass(frozen=True)
class FactorMiningCandidateSummary:
    candidate_id: str
    rank: int
    expression: str
    rank_ic: float | None
    coverage: float
    status: str
    pure_rank_ic: float | None = None
    information_ratio: float | None = None
    holding_period: int | None = None
    newey_west_lags: int | None = None
    fitness_score: float | None = None
    max_style_correlation: float | None = None
    correlation_penalty: float = 0.0
    max_drawdown_pct: float | None = None
    benchmark_max_drawdown_pct: float | None = None
    drawdown_vs_benchmark_ratio: float | None = None
    turnover: float = 0.0
    depth: int | None = None
    auto_residual_summary: Mapping[str, object] | None = None
    source_factor_ids: tuple[str, ...] = ()
    recipe_kind: str | None = None
    recipe_family: str | None = None
    orthogonality_intent: str | None = None
    composition_metadata: Mapping[str, object] | None = None
    risk_flags: tuple[str, ...] = ()
    error_message: str | None = None
    persisted_to_factor_definitions: bool = False

    def to_api_dict(self) -> dict[str, object]:
        return {
            "candidate_id": self.candidate_id,
            "rank": self.rank,
            "expression": self.expression,
            "rank_ic": self.rank_ic,
            "pure_rank_ic": self.pure_rank_ic,
            "ir": self.information_ratio,
            "information_ratio": self.information_ratio,
            "holding_period": self.holding_period,
            "newey_west_lags": self.newey_west_lags,
            "fitness_score": self.fitness_score,
            "max_style_correlation": self.max_style_correlation,
            "correlation_penalty": self.correlation_penalty,
            "max_drawdown_pct": self.max_drawdown_pct,
            "benchmark_max_drawdown_pct": self.benchmark_max_drawdown_pct,
            "drawdown_vs_benchmark_ratio": self.drawdown_vs_benchmark_ratio,
            "turnover": self.turnover,
            "depth": self.depth,
            "auto_residual_summary": dict(self.auto_residual_summary or {}),
            "source_factor_ids": list(self.source_factor_ids),
            "recipe_kind": self.recipe_kind,
            "recipe_family": self.recipe_family,
            "orthogonality_intent": self.orthogonality_intent,
            "composition_metadata": dict(self.composition_metadata or {}),
            "coverage": self.coverage,
            "status": self.status,
            "risk_flags": list(self.risk_flags),
            "error_message": self.error_message,
            "persisted_to_factor_definitions": self.persisted_to_factor_definitions,
        }


@dataclass(frozen=True)
class FactorMiningFailedSample:
    candidate_index: int
    expression: str
    error_message: str

    def to_api_dict(self) -> dict[str, object]:
        return {
            "candidate_index": self.candidate_index,
            "expression": self.expression,
            "error_message": self.error_message,
        }


@dataclass(frozen=True)
class FactorMiningJobResult:
    job_id: str
    status: str
    requested_candidates: int
    candidates_evaluated: int
    progress_pct: float
    throughput_per_second: float
    failed_samples: tuple[FactorMiningFailedSample, ...] = ()
    top_candidates: tuple[FactorMiningCandidateSummary, ...] = ()
    all_candidates: tuple[FactorMiningCandidateSummary, ...] = field(default_factory=tuple)

    def to_api_dict(self) -> dict[str, object]:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "requested_candidates": self.requested_candidates,
            "candidates_evaluated": self.candidates_evaluated,
            "progress_pct": self.progress_pct,
            "throughput_per_second": self.throughput_per_second,
            "failed_samples": [sample.to_api_dict() for sample in self.failed_samples],
            "top_candidates": [candidate.to_api_dict() for candidate in self.top_candidates],
        }


class FactorMiningRunner:
    """Synchronous small-batch runner for factor-mining jobs."""

    def __init__(self, request: FactorMiningJobCreateRequest) -> None:
        request.validate()
        self.request = request
        self.job_id = _job_id_for_request(request)

    def run(
        self,
        market_data: MarketDataBySymbol | None = None,
        *,
        should_cancel: Callable[[int], bool] | None = None,
        top_k: int = 10,
    ) -> FactorMiningJobResult:
        data = market_data or create_synthetic_market_data(
            self.request.universe,
            length=320,
            seed=self.request.random_seed,
        )
        start = time.perf_counter()
        rng = random.Random(self.request.random_seed)
        composition_specs = self._composition_candidate_specs(rng)
        candidates: list[FactorMiningCandidateSummary] = []
        failures: list[FactorMiningFailedSample] = []
        cancelled = False

        for index in range(self.request.candidate_count):
            if should_cancel is not None and should_cancel(index):
                cancelled = True
                break
            spec = self._generate_candidate_spec(index, rng, composition_specs)
            expression = spec.expression
            try:
                candidate = self._evaluate_candidate(index, expression, data, metadata=spec)
                candidates.append(candidate)
            except (FactorExpressionError, ValueError, ZeroDivisionError) as exc:
                failures.append(
                    FactorMiningFailedSample(
                        candidate_index=index,
                        expression=expression,
                        error_message=str(exc),
                    )
                )

        elapsed = max(time.perf_counter() - start, 0.000001)
        evaluated = len(candidates) + len(failures)
        sorted_candidates = sorted(
            candidates,
            key=lambda candidate: (
                candidate.fitness_score is not None,
                candidate.fitness_score if candidate.fitness_score is not None else -math.inf,
                candidate.rank_ic if candidate.rank_ic is not None else -math.inf,
            ),
            reverse=True,
        )
        unique_ranked_source = _unique_candidates_by_expression(sorted_candidates)
        ranked_candidates = tuple(
            FactorMiningCandidateSummary(
                candidate_id=candidate.candidate_id,
                rank=rank,
                expression=candidate.expression,
                rank_ic=candidate.rank_ic,
                fitness_score=candidate.fitness_score,
                max_style_correlation=candidate.max_style_correlation,
                correlation_penalty=candidate.correlation_penalty,
                max_drawdown_pct=candidate.max_drawdown_pct,
                benchmark_max_drawdown_pct=candidate.benchmark_max_drawdown_pct,
                drawdown_vs_benchmark_ratio=candidate.drawdown_vs_benchmark_ratio,
                turnover=candidate.turnover,
                depth=candidate.depth,
                auto_residual_summary=candidate.auto_residual_summary,
                source_factor_ids=candidate.source_factor_ids,
                recipe_kind=candidate.recipe_kind,
                recipe_family=candidate.recipe_family,
                orthogonality_intent=candidate.orthogonality_intent,
                composition_metadata=candidate.composition_metadata,
                coverage=candidate.coverage,
                status=candidate.status,
                risk_flags=candidate.risk_flags,
                error_message=candidate.error_message,
                persisted_to_factor_definitions=False,
            )
            for rank, candidate in enumerate(
                unique_ranked_source,
                start=1,
            )
        )
        top_candidates = tuple(ranked_candidates[:top_k])
        status = _job_status(cancelled=cancelled, completed=len(candidates), failed=len(failures))
        progress = 100.0 if self.request.candidate_count == 0 else round(evaluated / self.request.candidate_count * 100, 2)
        if cancelled:
            progress = min(progress, 99.0)

        return FactorMiningJobResult(
            job_id=self.job_id,
            status=status,
            requested_candidates=self.request.candidate_count,
            candidates_evaluated=evaluated,
            progress_pct=progress,
            throughput_per_second=round(evaluated / elapsed, 3),
            failed_samples=tuple(failures[:20]),
            top_candidates=top_candidates,
            all_candidates=ranked_candidates,
        )

    def _uses_composition_generation(self) -> bool:
        return self.request.generation_mode.upper() == GENERATION_MODE_HYBRID_COMPOSITION

    def _generate_candidate_spec(
        self,
        index: int,
        rng: random.Random,
        composition_specs: Sequence[CompositionCandidateSpec],
    ) -> CompositionCandidateSpec:
        if index < len(composition_specs):
            return composition_specs[index]
        return CompositionCandidateSpec(expression=self._generate_expression(index, rng))

    def _composition_candidate_specs(self, rng: random.Random) -> tuple[CompositionCandidateSpec, ...]:
        if not self._uses_composition_generation():
            return ()
        parent_pool = tuple(
            _canonical_factor_id(item)
            for item in (self.request.source_factor_ids or DEFAULT_COMPOSITION_SOURCE_FACTORS)
            if str(item).strip()
        )
        active_parents = tuple(dict.fromkeys(parent_pool or DEFAULT_COMPOSITION_SOURCE_FACTORS))
        active_parent_set = set(active_parents)
        families = {
            str(item).strip().lower()
            for item in (self.request.recipe_families or DEFAULT_COMPOSITION_RECIPE_FAMILIES)
            if str(item).strip()
        } or set(DEFAULT_COMPOSITION_RECIPE_FAMILIES)
        specs: list[CompositionCandidateSpec] = []
        for spec in _composition_template_specs():
            if spec.recipe_family not in families:
                continue
            if spec.source_factor_ids and not set(spec.source_factor_ids).issubset(active_parent_set):
                continue
            specs.append(spec)

        exploration_budget = max(0, int(self.request.exploration_budget or 0))
        if exploration_budget:
            specs.extend(_exploratory_pairwise_specs(active_parents, budget=exploration_budget, rng=rng))

        seen: set[tuple[str, tuple[str, ...]]] = set()
        unique_specs: list[CompositionCandidateSpec] = []
        for spec in specs:
            parents = tuple(sorted(_canonical_factor_id(item) for item in spec.source_factor_ids))
            key = (_expression_signature(spec.expression), parents)
            if key in seen:
                continue
            seen.add(key)
            unique_specs.append(spec)
        return tuple(unique_specs)

    def _generate_expression(self, index: int, rng: random.Random) -> str:
        operators = self.request.operators or ("return", "rank", "zscore", "winsorize")
        operator = operators[index % len(operators)].strip().lower()
        window = rng.choice((3, 5, 10, 21, 63, 126, 252))
        secondary_window = rng.choice((3, 5, 10, 21, 63))

        if operator in {"momentum", "lag"}:
            return f"(Close / Lag(Close, {window})) - 1"
        if operator in {"return", "ret"}:
            return f"Return(Close, {window})"
        if operator in {"std", "volatility", "lowvol"}:
            return f"Std(Return(Close, 1), {window})"
        if operator == "log":
            return "Log(Close)"
        if operator == "rank":
            return f"Rank(Return(Close, {window}))"
        if operator == "zscore":
            return f"ZScore(Return(Close, {window}))"
        if operator == "winsorize":
            return f"Winsorize(Return(Close, {window}), 3)"
        if operator in {"arithmetic", "blend"}:
            return f"(Return(Close, {window}) + Return(Close, {secondary_window})) / 2"
        return f"{operator}(Close)"

    def _evaluate_candidate(
        self,
        index: int,
        expression: str,
        market_data: MarketDataBySymbol,
        *,
        metadata: CompositionCandidateSpec | None = None,
    ) -> FactorMiningCandidateSummary:
        factor_values: dict[str, float] = {}
        factor_series_by_symbol: dict[str, Sequence[float | None]] = {}
        targets: dict[str, float] = {}
        for symbol in self.request.universe:
            symbol_data = market_data.get(symbol)
            if not symbol_data:
                continue
            series = _evaluate_factor_mining_expression(expression, symbol_data)
            factor_series_by_symbol[symbol] = series
            anchor_index = _forward_return_anchor_index(symbol_data)
            value = _finite_at_or_before(series, anchor_index)
            target = _target_return(symbol_data, anchor_index=anchor_index)
            if value is None or target is None:
                continue
            factor_values[symbol] = value
            targets[symbol] = target

        coverage = len(factor_values) / len(self.request.universe)
        rank_ic = _spearman_rank_ic(factor_values, targets) if len(factor_values) >= 2 else None
        holding_period = infer_holding_period_from_expression(expression)
        pure_rank_ic = self._pure_residual_rank_ic(
            expression=expression,
            market_data=market_data,
            targets=targets,
            holding_period=holding_period,
        )
        information_ratio = factor_ir_from_rank_ic(rank_ic, holding_period)
        risk_flags: list[str] = []
        if coverage < 0.5:
            risk_flags.append("LOW_COVERAGE")
        if rank_ic is None:
            risk_flags.append("INSUFFICIENT_CROSS_SECTION")
        elif abs(rank_ic) < self.request.min_rank_ic:
            risk_flags.append("BELOW_IC_THRESHOLD")
        depth = _expression_depth(expression)
        max_style_correlation = _estimate_style_correlation(expression)
        correlation_penalty = round(max(0.0, max_style_correlation - 0.3), 6)
        candidate_drawdown, benchmark_drawdown = _estimate_candidate_portfolio_drawdowns_pct(
            factor_series_by_symbol,
            market_data,
            self.request.universe,
            rank_ic=rank_ic,
        )
        drawdown_ratio = None
        if candidate_drawdown is not None and benchmark_drawdown and benchmark_drawdown > 0:
            drawdown_ratio = round(candidate_drawdown / benchmark_drawdown, 6)
        turnover = _estimate_turnover(expression)
        auto_residual_summary = None
        if max_style_correlation > 0.3:
            base_signal = _infer_residual_base_signal(expression)
            control_signal = _infer_residual_control_signal(expression)
            residual_rank_ic = pure_rank_ic if pure_rank_ic is not None else rank_ic
            residual_expression = f'ZScore(Residual({base_signal}, by="{control_signal}"))'
            if holding_period > SHORT_MOMENTUM_CONTROL_WINDOW_DAYS:
                residual_expression = f'ZScore(Residual({expression}, by="Return(Close, {SHORT_MOMENTUM_CONTROL_WINDOW_DAYS})"))'
                control_signal = f"Return(Close, {SHORT_MOMENTUM_CONTROL_WINDOW_DAYS})"
            auto_residual_summary = {
                "status": "CANDIDATE",
                "reason": "STYLE_CORRELATION_GT_0_3",
                "original_expression": expression,
                "residual_expression": residual_expression,
                "control_factor_id": control_signal,
                "pre_residual_correlation": round(max_style_correlation, 6),
                "post_residual_correlation": 0.24,
                "residual_rank_ic": None if residual_rank_ic is None else round(residual_rank_ic, 6),
                "residual_method": (
                    "cross_sectional_residual_vs_return_3"
                    if holding_period > SHORT_MOMENTUM_CONTROL_WINDOW_DAYS
                    else "style_proxy_residual"
                ),
            }
        raw_score = abs(rank_ic) if rank_ic is not None else 0.0
        complexity_penalty = 0.01 * max(depth - 1, 0)
        drawdown_penalty = max(0.0, (drawdown_ratio or 1.0) - 1.0) * 0.02
        fitness_score = round(raw_score - correlation_penalty * 0.15 - complexity_penalty - drawdown_penalty, 6)

        return FactorMiningCandidateSummary(
            candidate_id=_candidate_id(expression, index, source_factor_ids=metadata.source_factor_ids if metadata else ()),
            rank=index + 1,
            expression=expression,
            rank_ic=rank_ic,
            pure_rank_ic=pure_rank_ic,
            information_ratio=information_ratio,
            holding_period=holding_period,
            newey_west_lags=max(0, holding_period - 1),
            fitness_score=fitness_score,
            max_style_correlation=round(max_style_correlation, 6),
            correlation_penalty=correlation_penalty,
            max_drawdown_pct=candidate_drawdown,
            benchmark_max_drawdown_pct=benchmark_drawdown,
            drawdown_vs_benchmark_ratio=drawdown_ratio,
            turnover=turnover,
            depth=depth,
            auto_residual_summary=auto_residual_summary,
            source_factor_ids=metadata.source_factor_ids if metadata else (),
            recipe_kind=metadata.recipe_kind if metadata else None,
            recipe_family=metadata.recipe_family if metadata else None,
            orthogonality_intent=metadata.orthogonality_intent if metadata else None,
            composition_metadata=metadata.composition_metadata if metadata else None,
            coverage=round(coverage, 4),
            status="COMPLETED",
            risk_flags=tuple(risk_flags),
            persisted_to_factor_definitions=False,
        )

    def _pure_residual_rank_ic(
        self,
        *,
        expression: str,
        market_data: MarketDataBySymbol,
        targets: Mapping[str, float],
        holding_period: int,
    ) -> float | None:
        if holding_period <= SHORT_MOMENTUM_CONTROL_WINDOW_DAYS:
            return None
        factor_values: dict[str, float] = {}
        control_values: dict[str, float] = {}
        control_expression = f"Return(Close, {SHORT_MOMENTUM_CONTROL_WINDOW_DAYS})"
        for symbol in self.request.universe:
            if symbol not in targets:
                continue
            symbol_data = market_data.get(symbol)
            if not symbol_data:
                continue
            anchor_index = _forward_return_anchor_index(symbol_data)
            factor_value = _finite_at_or_before(_evaluate_factor_mining_expression(expression, symbol_data), anchor_index)
            control_value = _finite_at_or_before(evaluate_expression(control_expression, symbol_data), anchor_index)
            if factor_value is None or control_value is None:
                continue
            factor_values[symbol] = factor_value
            control_values[symbol] = control_value
        return _residualized_rank_ic(factor_values, control_values, targets)


def run_factor_mining_job(
    request: FactorMiningJobCreateRequest,
    market_data: MarketDataBySymbol | None = None,
    *,
    should_cancel: Callable[[int], bool] | None = None,
    top_k: int = 10,
) -> FactorMiningJobResult:
    return FactorMiningRunner(request).run(
        market_data=market_data,
        should_cancel=should_cancel,
        top_k=top_k,
    )


def factor_mining_job_id_for_request(request: FactorMiningJobCreateRequest) -> str:
    return _job_id_for_request(request)


def create_synthetic_market_data(
    universe: Sequence[str],
    *,
    length: int,
    seed: int,
) -> dict[str, dict[str, list[float]]]:
    rng = random.Random(seed)
    data: dict[str, dict[str, list[float]]] = {}
    for symbol_index, symbol in enumerate(universe):
        price = 80.0 + symbol_index * 12.5 + rng.random() * 5.0
        drift = 0.0004 + symbol_index * 0.00015
        close: list[float] = []
        for day_index in range(length):
            seasonal = ((day_index + symbol_index) % 13 - 6) * 0.00025
            price = max(1.0, price * (1.0 + drift + seasonal))
            close.append(round(price, 6))
        data[symbol] = {"Close": close}
    return data


def _coerce_string_tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        return tuple(part.strip() for part in value.split(",") if part.strip())
    if isinstance(value, Sequence):
        return tuple(str(item).strip() for item in value if str(item).strip())
    return ()


def _canonical_factor_id(value: object) -> str:
    raw = str(value or "").strip()
    lowered = raw.lower()
    return _FACTOR_ALIASES.get(lowered, lowered)


def _expression_signature(expression: str) -> str:
    return " ".join(str(expression or "").split()).lower()


def _composition_template_specs() -> tuple[CompositionCandidateSpec, ...]:
    return (
        CompositionCandidateSpec(
            expression="s_mom_6m_rank * s_qlty_roe_ltm_raw",
            source_factor_ids=("s_mom_6m_rank", "s_qlty_roe_ltm_raw"),
            recipe_kind="template",
            recipe_family="style_blend",
            orthogonality_intent="quality_driven_momentum",
            composition_metadata={"label": "Quality-Driven Momentum", "publish_boundary": "manual_after_quarantine"},
        ),
        CompositionCandidateSpec(
            expression="s_mom_6m_rank / s_vol_252d_rank",
            source_factor_ids=("s_mom_6m_rank", "s_vol_252d_rank"),
            recipe_kind="template",
            recipe_family="risk_adjusted",
            orthogonality_intent="risk_adjusted_momentum",
            composition_metadata={"label": "Risk-Adjusted Momentum", "publish_boundary": "manual_after_quarantine"},
        ),
        CompositionCandidateSpec(
            expression='ZScore(Residual(s_val_cfp_ltm_raw, by="s_size_cur_log"))',
            source_factor_ids=("s_val_cfp_ltm_raw", "s_size_cur_log"),
            recipe_kind="template",
            recipe_family="value_anchor",
            orthogonality_intent="size_neutral_cashflow_value",
            composition_metadata={"label": "Value-Cashflow Anchor", "publish_boundary": "manual_after_quarantine"},
        ),
        CompositionCandidateSpec(
            expression="s_mom_6m_rank - s_vol_downside_252d_rank",
            source_factor_ids=("s_mom_6m_rank", "s_vol_downside_252d_rank"),
            recipe_kind="template",
            recipe_family="divergence",
            orthogonality_intent="momentum_downside_divergence",
            composition_metadata={"label": "Momentum Divergence", "publish_boundary": "manual_after_quarantine"},
        ),
        CompositionCandidateSpec(
            expression='ZScore(Residual(s_liq_amihud_20d_rank, by="s_size_cur_log"))',
            source_factor_ids=("s_liq_amihud_20d_rank", "s_size_cur_log"),
            recipe_kind="template",
            recipe_family="residual_neutralized",
            orthogonality_intent="size_neutral_liquidity_anomaly",
            composition_metadata={"label": "Size-Neutral Liquidity", "publish_boundary": "manual_after_quarantine"},
        ),
        CompositionCandidateSpec(
            expression="TsRank(Return(Close, 5), 252)",
            source_factor_ids=(),
            recipe_kind="template",
            recipe_family="ts_denoise",
            orthogonality_intent="short_return_time_series_denoise",
            composition_metadata={"label": "Short-Horizon Return Denoise", "publish_boundary": "manual_after_quarantine"},
        ),
    )


def _exploratory_pairwise_specs(
    source_factor_ids: Sequence[str],
    *,
    budget: int,
    rng: random.Random,
) -> tuple[CompositionCandidateSpec, ...]:
    candidates = [
        _canonical_factor_id(item)
        for item in source_factor_ids
        if _canonical_factor_id(item) in _FACTOR_FAMILIES
    ]
    pairs: list[tuple[str, str]] = []
    for left_index, left in enumerate(candidates):
        for right in candidates[left_index + 1:]:
            left_family = _FACTOR_FAMILIES.get(left)
            right_family = _FACTOR_FAMILIES.get(right)
            if not left_family or not right_family:
                continue
            if left_family == right_family:
                continue
            if left_family == right_family == "momentum":
                continue
            pairs.append((left, right))
    rng.shuffle(pairs)
    specs: list[CompositionCandidateSpec] = []
    for left, right in pairs:
        if len(specs) >= budget:
            break
        left_family = _FACTOR_FAMILIES[left]
        right_family = _FACTOR_FAMILIES[right]
        parents = tuple(sorted((left, right)))
        expression = f"{left} * {right}"
        intent = "cross_family_style_blend"
        if "risk" in {left_family, right_family}:
            momentum = left if left_family == "momentum" else right if right_family == "momentum" else left
            risk = right if momentum == left else left
            expression = f"{momentum} / {risk}"
            intent = "risk_adjusted_pairwise"
        elif "size" in {left_family, right_family} and ({left_family, right_family} & {"value", "liquidity"}):
            target = right if left_family == "size" else left
            expression = f'ZScore(Residual({target}, by="s_size_cur_log"))'
            intent = "size_neutral_pairwise"
        elif "momentum" in {left_family, right_family} and "quality" not in {left_family, right_family}:
            momentum = left if left_family == "momentum" else right
            control = right if momentum == left else left
            expression = f"{momentum} - {control}"
            intent = "momentum_divergence_pairwise"
        specs.append(
            CompositionCandidateSpec(
                expression=expression,
                source_factor_ids=parents,
                recipe_kind="exploratory_pairwise",
                recipe_family="pairwise_cross_family",
                orthogonality_intent=intent,
                composition_metadata={
                    "label": "Bounded Pairwise Composition",
                    "left_family": left_family,
                    "right_family": right_family,
                    "publish_boundary": "manual_after_quarantine",
                },
            )
        )
    return tuple(specs)


def infer_holding_period_from_expression(expression: str) -> int:
    windows = [
        int(match.group(1))
        for match in _HOLDING_PERIOD_PATTERN.finditer(str(expression or ""))
        if int(match.group(1)) > 0
    ]
    return max(windows, default=1)


def newey_west_overlap_multiplier(holding_period: int) -> float:
    normalized_period = max(1, int(holding_period or 1))
    if normalized_period <= 1:
        return 1.0
    # Bartlett/Newey-West long-run variance for fully overlapping N-day returns.
    return 1.0 + 2.0 * sum(1.0 - lag / normalized_period for lag in range(1, normalized_period))


def factor_ir_from_rank_ic(rank_ic: float | None, holding_period: int | None) -> float | None:
    if rank_ic is None:
        return None
    multiplier = newey_west_overlap_multiplier(max(1, int(holding_period or 1)))
    if multiplier <= 0:
        multiplier = 1.0
    return round(abs(float(rank_ic)) / LEGACY_IR_IC_SCALE / math.sqrt(multiplier), 4)


def _job_id_for_request(request: FactorMiningJobCreateRequest) -> str:
    digest = hashlib.sha1(
        "|".join(
            (
                ",".join(request.universe),
                request.start_date,
                request.end_date,
                ",".join(request.operators),
                str(request.candidate_count),
                str(request.random_seed),
                f"{request.min_rank_ic:.12g}",
                str(request.max_depth),
                request.generation_mode.upper(),
                ",".join(_canonical_factor_id(item) for item in request.source_factor_ids),
                ",".join(str(item).strip().lower() for item in request.recipe_families),
                str(max(0, int(request.exploration_budget or 0))),
            )
        ).encode("utf-8")
    ).hexdigest()[:12]
    return f"fm_{digest}"


def _candidate_id(expression: str, index: int, *, source_factor_ids: Sequence[str] = ()) -> str:
    parent_key = ",".join(sorted(_canonical_factor_id(item) for item in source_factor_ids))
    seed = f"{_expression_signature(expression)}|{parent_key}" if parent_key else f"{index}:{expression}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]
    return f"cand_{digest}"


def _unique_candidates_by_expression(
    candidates: Sequence[FactorMiningCandidateSummary],
) -> tuple[FactorMiningCandidateSummary, ...]:
    seen: set[str] = set()
    unique_candidates: list[FactorMiningCandidateSummary] = []
    for candidate in candidates:
        parent_key = ",".join(sorted(candidate.source_factor_ids))
        signature = f"{_expression_signature(candidate.expression)}|{parent_key}"
        if not signature or signature in seen:
            continue
        seen.add(signature)
        unique_candidates.append(candidate)
    return tuple(unique_candidates)


def _forward_return_anchor_index(
    symbol_data: Mapping[str, Sequence[float | int | None]],
    *,
    horizon: int = FORWARD_RETURN_HORIZON_DAYS,
) -> int | None:
    close = symbol_data.get("Close") or symbol_data.get("close") or symbol_data.get("adj_close")
    if not close or len(close) <= horizon:
        return None
    return len(close) - 1 - horizon


def _expression_depth(expression: str) -> int:
    return max(1, expression.count("("))


def _estimate_style_correlation(expression: str) -> float:
    normalized = expression.lower()
    tokens = {_canonical_factor_id(match.group(0)) for match in _FACTOR_REFERENCE_PATTERN.finditer(expression)}
    if "residual" in normalized:
        return 0.24
    if "tsrank" in normalized or "ts_rank" in normalized:
        return 0.29
    if len(tokens) >= 2:
        families = {_FACTOR_FAMILIES.get(token) for token in tokens}
        if "risk" in families and "momentum" in families:
            return 0.27
        if "size" in families and ({"value", "liquidity"} & families):
            return 0.24
        if len(families) >= 2:
            return 0.26
    if "log" in normalized:
        return 0.52
    if "return" in normalized or "lag" in normalized or "momentum" in normalized:
        return 0.42
    if "rank" in normalized or "zscore" in normalized:
        return 0.34
    if "std" in normalized or "vol" in normalized:
        return 0.22
    return 0.28


def _estimate_turnover(expression: str) -> float:
    normalized = expression.lower()
    if "tsrank" in normalized or "ts_rank" in normalized:
        return 72.0
    if "amihud" in normalized or "liq" in normalized:
        return 48.0
    if "lag" in normalized or "momentum" in normalized or "return" in normalized:
        return 34.0
    if "std" in normalized or "vol" in normalized:
        return 18.0
    if "rank" in normalized or "zscore" in normalized:
        return 27.0
    return 12.0


def _infer_residual_base_signal(expression: str) -> str:
    normalized = expression.lower()
    if "std" in normalized or "vol" in normalized:
        return "s_vol_252d_raw"
    if "log" in normalized:
        return "s_size_cur_log"
    return "s_mom_6m_rank"


def _infer_residual_control_signal(expression: str) -> str:
    normalized = expression.lower()
    if "std" in normalized or "vol" in normalized:
        return "s_size_cur_log"
    return "s_vol_252d_raw"


def _evaluate_factor_mining_expression(
    expression: str,
    symbol_data: Mapping[str, Sequence[float | int | None]],
) -> list[float | None]:
    formula = str(expression or "").strip()
    if (
        not _FACTOR_REFERENCE_PATTERN.search(formula)
        and not re.search(r"\bTs_?Rank\s*\(", formula, flags=re.IGNORECASE)
    ):
        return list(evaluate_expression(formula, symbol_data))

    ts_rank = _TS_RANK_RETURN_PATTERN.match(formula)
    if ts_rank:
        return _series_ts_rank(
            _series_return(_close_series(symbol_data), int(ts_rank.group(1))),
            int(ts_rank.group(2)),
        )

    residual = _RESIDUAL_FACTOR_REFERENCE_PATTERN.match(formula)
    if residual:
        target = _series_from_factor_reference(residual.group(1), symbol_data)
        control = _series_from_factor_reference(residual.group(2), symbol_data)
        return _series_zscore(_series_binary(target, control, "-"))

    binary = _BINARY_FACTOR_REFERENCE_PATTERN.match(formula)
    if binary:
        left = _series_from_factor_reference(binary.group(1), symbol_data)
        right = _series_from_factor_reference(binary.group(3), symbol_data)
        return _series_binary(left, right, binary.group(2))

    direct_factor = re.match(r"^\s*(s_[a-z0-9_]+(?:_raw|_rank)?)\s*$", formula, flags=re.IGNORECASE)
    if direct_factor:
        return _series_from_factor_reference(direct_factor.group(1), symbol_data)

    return list(evaluate_expression(formula, symbol_data))


def _series_from_factor_reference(
    factor_id: str,
    symbol_data: Mapping[str, Sequence[float | int | None]],
) -> list[float | None]:
    canonical = _canonical_factor_id(factor_id)
    close = _close_series(symbol_data)
    if not close:
        raise FactorExpressionError(f"missing close series for {factor_id}")
    one_day_return = _series_return(close, 1)
    if canonical == "s_mom_6m_rank":
        return _series_return(close, 126)
    if canonical == "s_mom_1m_rank":
        return _series_return(close, 21)
    if canonical == "s_mom_12d_rank":
        return _series_return(close, 12)
    if canonical == "s_vol_252d_rank":
        return _series_std(one_day_return, 252, downside_only=False)
    if canonical == "s_vol_downside_252d_rank":
        return _series_std(one_day_return, 252, downside_only=True)
    if canonical == "s_size_cur_log":
        market_cap = _numeric_series(symbol_data, "MarketCap", len(close))
        if market_cap:
            return [math.log(value) if value and value > 0 else None for value in market_cap]
        return [math.log(value) if value > 0 else None for value in close]
    if canonical == "s_qlty_roe_ltm_raw":
        trailing_return = _series_return(close, 252)
        trailing_vol = _series_std(one_day_return, 126, downside_only=False)
        return _series_binary(trailing_return, _series_scale(trailing_vol, 0.5), "-")
    if canonical == "s_val_cfp_ltm_raw":
        market_cap = _numeric_series(symbol_data, "MarketCap", len(close))
        cashflow = _numeric_series(symbol_data, "OperatingCashflow", len(close))
        if market_cap and cashflow:
            return _series_binary(cashflow, market_cap, "/")
        return [1.0 / value if value > 0 else None for value in close]
    if canonical == "s_liq_amihud_20d_rank":
        volume = _numeric_series(symbol_data, "Volume", len(close)) or _numeric_series(symbol_data, "volume", len(close))
        if not volume:
            volume = [max(price * 10_000.0, 1.0) for price in close]
        raw = [
            None if ret is None or volume[index] in (None, 0) else abs(ret) / max(float(volume[index]), 1.0)
            for index, ret in enumerate(one_day_return[: len(volume)])
        ]
        return _series_rolling_mean(raw, 20)
    raise FactorExpressionError(f"unsupported factor reference: {factor_id}")


def _numeric_series(
    symbol_data: Mapping[str, Sequence[float | int | None]],
    key: str,
    length: int,
) -> list[float] | None:
    raw = symbol_data.get(key) or symbol_data.get(key.lower())
    if not raw:
        return None
    values: list[float] = []
    for value in raw[:length]:
        if value is None:
            values.append(float("nan"))
            continue
        numeric = float(value)
        values.append(numeric if math.isfinite(numeric) else float("nan"))
    if not any(math.isfinite(value) and value != 0 for value in values):
        return None
    while len(values) < length:
        values.append(values[-1] if values else float("nan"))
    return values


def _series_return(close: Sequence[float], window: int) -> list[float | None]:
    normalized_window = max(1, int(window or 1))
    output: list[float | None] = []
    for index, value in enumerate(close):
        prior_index = index - normalized_window
        if prior_index < 0:
            output.append(None)
            continue
        prior = close[prior_index]
        if prior <= 0:
            output.append(None)
            continue
        output.append(value / prior - 1.0)
    return output


def _series_std(series: Sequence[float | None], window: int, *, downside_only: bool) -> list[float | None]:
    normalized_window = max(2, int(window or 2))
    output: list[float | None] = []
    for index in range(len(series)):
        start = max(0, index + 1 - normalized_window)
        values = [
            float(value)
            for value in series[start:index + 1]
            if value is not None and math.isfinite(float(value)) and (not downside_only or float(value) < 0)
        ]
        if len(values) < 2:
            output.append(None)
        else:
            output.append(statistics.pstdev(values))
    return output


def _series_rolling_mean(series: Sequence[float | None], window: int) -> list[float | None]:
    normalized_window = max(1, int(window or 1))
    output: list[float | None] = []
    for index in range(len(series)):
        start = max(0, index + 1 - normalized_window)
        values = [
            float(value)
            for value in series[start:index + 1]
            if value is not None and math.isfinite(float(value))
        ]
        output.append(statistics.fmean(values) if values else None)
    return output


def _series_zscore(series: Sequence[float | None], window: int = 252) -> list[float | None]:
    normalized_window = max(2, int(window or 2))
    output: list[float | None] = []
    for index in range(len(series)):
        start = max(0, index + 1 - normalized_window)
        values = [
            float(value)
            for value in series[start:index + 1]
            if value is not None and math.isfinite(float(value))
        ]
        current = series[index]
        if current is None or len(values) < 2:
            output.append(None)
            continue
        stdev = statistics.pstdev(values)
        output.append(None if stdev <= 0 else (float(current) - statistics.fmean(values)) / stdev)
    return output


def _series_ts_rank(series: Sequence[float | None], window: int) -> list[float | None]:
    normalized_window = max(2, int(window or 2))
    output: list[float | None] = []
    for index, current in enumerate(series):
        start = max(0, index + 1 - normalized_window)
        values = [
            float(value)
            for value in series[start:index + 1]
            if value is not None and math.isfinite(float(value))
        ]
        if current is None or not values:
            output.append(None)
            continue
        rank = sum(1 for value in values if value <= float(current))
        output.append(rank / len(values))
    return output


def _series_binary(
    left: Sequence[float | None],
    right: Sequence[float | None],
    operator: str,
) -> list[float | None]:
    length = min(len(left), len(right))
    output: list[float | None] = []
    for index in range(length):
        left_value = left[index]
        right_value = right[index]
        if (
            left_value is None
            or right_value is None
            or not math.isfinite(float(left_value))
            or not math.isfinite(float(right_value))
        ):
            output.append(None)
            continue
        if operator == "+":
            output.append(float(left_value) + float(right_value))
        elif operator == "-":
            output.append(float(left_value) - float(right_value))
        elif operator == "*":
            output.append(float(left_value) * float(right_value))
        elif operator == "/":
            denominator = float(right_value)
            output.append(None if abs(denominator) <= 1e-12 else float(left_value) / denominator)
        else:
            output.append(None)
    return output


def _series_scale(series: Sequence[float | None], scalar: float) -> list[float | None]:
    return [
        None if value is None or not math.isfinite(float(value)) else float(value) * scalar
        for value in series
    ]


def _estimate_candidate_portfolio_drawdowns_pct(
    factor_series_by_symbol: Mapping[str, Sequence[float | None]],
    market_data: MarketDataBySymbol,
    universe: Sequence[str],
    *,
    rank_ic: float | None,
) -> tuple[float | None, float | None]:
    direction = 1.0 if rank_ic is None or rank_ic >= 0 else -1.0
    candidate_equity = 1.0
    benchmark_equity = 1.0
    candidate_curve = [candidate_equity]
    benchmark_curve = [benchmark_equity]
    observation_count = 0
    close_by_symbol = {
        symbol: _close_series(market_data.get(symbol) or {})
        for symbol in universe
    }

    max_length = 0
    for symbol in universe:
        close = close_by_symbol.get(symbol) or []
        signals = factor_series_by_symbol.get(symbol) or ()
        max_length = max(max_length, min(len(close), len(signals)))

    for index in range(1, max_length):
        eligible: list[tuple[float, float]] = []
        for symbol in universe:
            close = close_by_symbol.get(symbol) or []
            signals = factor_series_by_symbol.get(symbol) or ()
            if index >= len(close) or index - 1 >= len(signals):
                continue
            signal = signals[index - 1]
            prior = close[index - 1]
            current = close[index]
            if (
                signal is None
                or not math.isfinite(float(signal))
                or prior <= 0
                or current <= 0
            ):
                continue
            one_day_return = current / prior - 1.0
            if not math.isfinite(one_day_return):
                continue
            eligible.append((direction * float(signal), one_day_return))
        if len(eligible) < 2:
            continue
        eligible.sort(key=lambda item: item[0], reverse=True)
        selected_count = max(1, math.ceil(len(eligible) * 0.3))
        selected_returns = [item[1] for item in eligible[:selected_count]]
        candidate_return = statistics.fmean(selected_returns)
        benchmark_return = statistics.fmean(item[1] for item in eligible)
        candidate_equity *= max(0.0, 1.0 + candidate_return)
        benchmark_equity *= max(0.0, 1.0 + benchmark_return)
        candidate_curve.append(candidate_equity)
        benchmark_curve.append(benchmark_equity)
        observation_count += 1

    if observation_count < 20:
        return None, None
    return round(_max_drawdown_pct(candidate_curve), 6), round(_max_drawdown_pct(benchmark_curve), 6)


def _close_series(symbol_data: Mapping[str, Sequence[float | int | None]]) -> list[float]:
    raw = symbol_data.get("Close") or symbol_data.get("close") or symbol_data.get("adj_close") or ()
    close: list[float] = []
    for value in raw:
        if value is None:
            continue
        numeric = float(value)
        if math.isfinite(numeric) and numeric > 0:
            close.append(numeric)
    return close


def _max_drawdown_pct(close: Sequence[float]) -> float:
    peak = 0.0
    max_drawdown = 0.0
    for price in close:
        peak = max(peak, float(price))
        if peak <= 0:
            continue
        max_drawdown = max(max_drawdown, (peak - float(price)) / peak)
    return max_drawdown * 100.0


def _job_status(*, cancelled: bool, completed: int, failed: int) -> str:
    if cancelled:
        return "CANCELLED"
    if completed and failed:
        return "PARTIALLY_FAILED"
    if failed and not completed:
        return "FAILED"
    return "COMPLETED"


def _last_finite(series: Sequence[float | None]) -> float | None:
    for value in reversed(series):
        if value is not None and math.isfinite(value):
            return float(value)
    return None


def _finite_at_or_before(series: Sequence[float | None], index: int | None) -> float | None:
    if index is None:
        return _last_finite(series)
    cursor = min(index, len(series) - 1)
    while cursor >= 0:
        value = series[cursor]
        if value is not None and math.isfinite(value):
            return float(value)
        cursor -= 1
    return None


def _target_return(
    symbol_data: Mapping[str, Sequence[float | int | None]],
    *,
    anchor_index: int | None = None,
    horizon: int = FORWARD_RETURN_HORIZON_DAYS,
) -> float | None:
    if "target_return" in symbol_data:
        target = _finite_at_or_before(symbol_data["target_return"], anchor_index)
        if target is not None:
            return target
    close = symbol_data.get("Close") or symbol_data.get("close") or symbol_data.get("adj_close")
    if not close or len(close) <= horizon:
        return None
    if anchor_index is None:
        anchor_index = len(close) - 1 - horizon
    if anchor_index < 0 or anchor_index + horizon >= len(close):
        return None
    latest = close[anchor_index + horizon]
    prior = close[anchor_index]
    if latest is None or prior in (None, 0):
        return None
    latest_float = float(latest)
    prior_float = float(prior)
    if not math.isfinite(latest_float) or not math.isfinite(prior_float) or prior_float == 0:
        return None
    return latest_float / prior_float - 1.0


def _residualized_rank_ic(
    factor_values: Mapping[str, float],
    control_values: Mapping[str, float],
    targets: Mapping[str, float],
) -> float | None:
    symbols = [symbol for symbol in factor_values if symbol in control_values and symbol in targets]
    if len(symbols) < 3:
        return None
    factor_series = [factor_values[symbol] for symbol in symbols]
    control_series = [control_values[symbol] for symbol in symbols]
    factor_mean = statistics.fmean(factor_series)
    control_mean = statistics.fmean(control_series)
    control_var = sum((value - control_mean) ** 2 for value in control_series)
    if control_var <= 1e-12:
        residuals = {
            symbol: factor_values[symbol] - factor_mean
            for symbol in symbols
        }
    else:
        covariance = sum(
            (factor - factor_mean) * (control - control_mean)
            for factor, control in zip(factor_series, control_series)
        )
        beta = covariance / control_var
        alpha = factor_mean - beta * control_mean
        residuals = {
            symbol: factor_values[symbol] - (alpha + beta * control_values[symbol])
            for symbol in symbols
        }
    return _spearman_rank_ic(residuals, targets)


def _spearman_rank_ic(factor_values: Mapping[str, float], targets: Mapping[str, float]) -> float | None:
    symbols = [symbol for symbol in factor_values if symbol in targets]
    if len(symbols) < 2:
        return None
    factor_ranks = _rank_values({symbol: factor_values[symbol] for symbol in symbols})
    target_ranks = _rank_values({symbol: targets[symbol] for symbol in symbols})
    factor_series = [factor_ranks[symbol] for symbol in symbols]
    target_series = [target_ranks[symbol] for symbol in symbols]
    return _pearson(factor_series, target_series)


def _rank_values(values: Mapping[str, float]) -> dict[str, float]:
    ordered = sorted(values.items(), key=lambda item: item[1])
    denominator = max(len(ordered) - 1, 1)
    return {symbol: rank / denominator for rank, (symbol, _value) in enumerate(ordered)}


def _pearson(left: Sequence[float], right: Sequence[float]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None
    left_mean = statistics.fmean(left)
    right_mean = statistics.fmean(right)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right))
    left_denominator = math.sqrt(sum((a - left_mean) ** 2 for a in left))
    right_denominator = math.sqrt(sum((b - right_mean) ** 2 for b in right))
    denominator = left_denominator * right_denominator
    if denominator == 0:
        return 0.0
    return numerator / denominator
