"""Pure Python factor-mining sandbox primitives.

The module deliberately contains no FastAPI or SQLite integration.  API and
storage layers can wrap these request/result structures while keeping writes in
their own parent controller thread.
"""

from __future__ import annotations

import hashlib
import math
import random
import statistics
import time
from dataclasses import dataclass, field
from typing import Callable, Mapping, Sequence

from .factor_expression_engine import FactorExpressionError, evaluate_expression


MarketDataBySymbol = Mapping[str, Mapping[str, Sequence[float | int | None]]]


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

    @classmethod
    def from_payload(cls, payload: Mapping[str, object]) -> "FactorMiningJobCreateRequest":
        return cls(
            universe=tuple(str(symbol) for symbol in payload.get("universe", ())),
            start_date=str(payload.get("start_date", "")),
            end_date=str(payload.get("end_date", "")),
            operators=tuple(str(operator) for operator in payload.get("operators", ())),
            candidate_count=int(payload.get("candidate_count", 0)),
            random_seed=int(payload.get("random_seed", 0)),
            min_rank_ic=float(payload.get("min_rank_ic", 0.0)),
            max_depth=int(payload.get("max_depth", 3)),
        )

    def validate(self) -> None:
        if not self.universe:
            raise ValueError("universe is required")
        if not self.operators:
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
    risk_flags: tuple[str, ...] = ()
    error_message: str | None = None
    persisted_to_factor_definitions: bool = False

    def to_api_dict(self) -> dict[str, object]:
        return {
            "candidate_id": self.candidate_id,
            "rank": self.rank,
            "expression": self.expression,
            "rank_ic": self.rank_ic,
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
        candidates: list[FactorMiningCandidateSummary] = []
        failures: list[FactorMiningFailedSample] = []
        cancelled = False

        for index in range(self.request.candidate_count):
            if should_cancel is not None and should_cancel(index):
                cancelled = True
                break
            expression = self._generate_expression(index, rng)
            try:
                candidate = self._evaluate_candidate(index, expression, data)
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
        ranked_candidates = tuple(
            FactorMiningCandidateSummary(
                candidate_id=candidate.candidate_id,
                rank=rank,
                expression=candidate.expression,
                rank_ic=candidate.rank_ic,
                coverage=candidate.coverage,
                status=candidate.status,
                risk_flags=candidate.risk_flags,
                error_message=candidate.error_message,
                persisted_to_factor_definitions=False,
            )
            for rank, candidate in enumerate(
                sorted(
                    candidates,
                    key=lambda candidate: (
                        candidate.rank_ic is not None,
                        candidate.rank_ic if candidate.rank_ic is not None else -math.inf,
                    ),
                    reverse=True,
                ),
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

    def _generate_expression(self, index: int, rng: random.Random) -> str:
        operator = self.request.operators[index % len(self.request.operators)].strip().lower()
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
    ) -> FactorMiningCandidateSummary:
        factor_values: dict[str, float] = {}
        targets: dict[str, float] = {}
        for symbol in self.request.universe:
            symbol_data = market_data.get(symbol)
            if not symbol_data:
                continue
            series = evaluate_expression(expression, symbol_data)
            value = _last_finite(series)
            target = _target_return(symbol_data)
            if value is None or target is None:
                continue
            factor_values[symbol] = value
            targets[symbol] = target

        coverage = len(factor_values) / len(self.request.universe)
        rank_ic = _spearman_rank_ic(factor_values, targets) if len(factor_values) >= 2 else None
        risk_flags: list[str] = []
        if coverage < 0.5:
            risk_flags.append("LOW_COVERAGE")
        if rank_ic is None:
            risk_flags.append("INSUFFICIENT_CROSS_SECTION")
        elif abs(rank_ic) < self.request.min_rank_ic:
            risk_flags.append("BELOW_IC_THRESHOLD")

        return FactorMiningCandidateSummary(
            candidate_id=_candidate_id(expression, index),
            rank=index + 1,
            expression=expression,
            rank_ic=rank_ic,
            coverage=round(coverage, 4),
            status="COMPLETED",
            risk_flags=tuple(risk_flags),
            persisted_to_factor_definitions=False,
        )


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
            )
        ).encode("utf-8")
    ).hexdigest()[:12]
    return f"fm_{digest}"


def _candidate_id(expression: str, index: int) -> str:
    digest = hashlib.sha1(f"{index}:{expression}".encode("utf-8")).hexdigest()[:12]
    return f"cand_{digest}"


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


def _target_return(symbol_data: Mapping[str, Sequence[float | int | None]]) -> float | None:
    if "target_return" in symbol_data:
        target = _last_finite(symbol_data["target_return"])
        if target is not None:
            return target
    close = symbol_data.get("Close") or symbol_data.get("close") or symbol_data.get("adj_close")
    if not close or len(close) < 6:
        return None
    latest = close[-1]
    prior = close[-6]
    if latest is None or prior in (None, 0):
        return None
    latest_float = float(latest)
    prior_float = float(prior)
    if not math.isfinite(latest_float) or not math.isfinite(prior_float) or prior_float == 0:
        return None
    return latest_float / prior_float - 1.0


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
