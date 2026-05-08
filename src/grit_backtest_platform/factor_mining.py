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
from typing import Callable, Mapping, Sequence

from .factor_expression_engine import FactorExpressionError, evaluate_expression


MarketDataBySymbol = Mapping[str, Mapping[str, Sequence[float | int | None]]]

FORWARD_RETURN_HORIZON_DAYS = 5
SHORT_MOMENTUM_CONTROL_WINDOW_DAYS = 3
LEGACY_IR_IC_SCALE = 0.05
_HOLDING_PERIOD_PATTERN = re.compile(
    r"\b(?:Return|Lag|Delta)\s*\(\s*Close\s*,\s*(\d+)\s*\)",
    re.IGNORECASE,
)


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
        candidate_drawdown = _estimate_candidate_drawdown_pct(expression, market_data, self.request.universe)
        benchmark_drawdown = _benchmark_drawdown_pct(market_data, self.request.universe)
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
            candidate_id=_candidate_id(expression, index),
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
            factor_value = _finite_at_or_before(evaluate_expression(expression, symbol_data), anchor_index)
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
            )
        ).encode("utf-8")
    ).hexdigest()[:12]
    return f"fm_{digest}"


def _candidate_id(expression: str, index: int) -> str:
    digest = hashlib.sha1(f"{index}:{expression}".encode("utf-8")).hexdigest()[:12]
    return f"cand_{digest}"


def _unique_candidates_by_expression(
    candidates: Sequence[FactorMiningCandidateSummary],
) -> tuple[FactorMiningCandidateSummary, ...]:
    seen: set[str] = set()
    unique_candidates: list[FactorMiningCandidateSummary] = []
    for candidate in candidates:
        signature = " ".join(candidate.expression.split()).lower()
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
    if "residual" in normalized:
        return 0.24
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


def _estimate_candidate_drawdown_pct(
    expression: str,
    market_data: MarketDataBySymbol,
    universe: Sequence[str],
) -> float | None:
    symbol_drawdowns: list[float] = []
    multiplier = 1.0
    normalized = expression.lower()
    if "std" in normalized or "vol" in normalized:
        multiplier = 0.82
    elif "log" in normalized:
        multiplier = 1.08
    elif "return" in normalized or "momentum" in normalized or "lag" in normalized:
        multiplier = 1.16
    for symbol in universe:
        close = _close_series(market_data.get(symbol) or {})
        if close:
            symbol_drawdowns.append(_max_drawdown_pct(close) * multiplier)
    if not symbol_drawdowns:
        return None
    return round(statistics.fmean(symbol_drawdowns), 6)


def _benchmark_drawdown_pct(
    market_data: MarketDataBySymbol,
    universe: Sequence[str],
) -> float | None:
    benchmark = market_data.get("SPY") or market_data.get("QQQ")
    if benchmark is None:
        benchmark_symbol = universe[0] if universe else ""
        benchmark = market_data.get(benchmark_symbol)
    close = _close_series(benchmark or {})
    return round(_max_drawdown_pct(close), 6) if close else None


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
