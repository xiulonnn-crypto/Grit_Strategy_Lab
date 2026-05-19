"""Safe factor expression evaluation primitives.

This module is intentionally independent from API and storage wiring.  It
provides the shared, whitelist-only expression surface that diagnostics,
mining, and model preview code can call without exposing Python execution.
"""

from __future__ import annotations

import ast
import math
import re
import statistics
from collections import deque
from dataclasses import dataclass
from typing import Any, Mapping, Sequence


SeriesValue = float | None
Series = list[SeriesValue]
ScalarOrSeries = float | Series


class FactorExpressionError(ValueError):
    """Base error for rejected or unevaluable factor expressions."""


class UnsafeExpressionError(FactorExpressionError):
    """Raised when an expression contains blocked Python syntax."""


class UnknownFieldError(FactorExpressionError):
    """Raised when an expression references a field outside the whitelist."""


class UnknownOperatorError(FactorExpressionError):
    """Raised when an expression calls a function outside the whitelist."""


class FutureReferenceError(FactorExpressionError):
    """Raised when an expression attempts to read t+N."""


class ExpressionDepthError(FactorExpressionError):
    """Raised when an expression AST exceeds the configured depth limit."""


MAX_AST_DEPTH = 18

FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "Close": ("Close", "close", "adj_close", "adjusted_close"),
    "Open": ("Open", "open", "adj_open", "adjusted_open"),
    "Volume": ("Volume", "volume"),
    "MarketCap": ("MarketCap", "market_cap"),
    "BookValueEquity": ("BookValueEquity", "book_value_equity"),
    "NetIncome": ("NetIncome", "net_income"),
    "LtmEarnings": ("LtmEarnings", "ltm_earnings"),
    "OperatingCashFlow": ("OperatingCashFlow", "operating_cash_flow"),
    "OperatingCashFlowLTM": (
        "OperatingCashFlowLTM",
        "operating_cash_flow_ltm",
        "operating_cash_flow",
    ),
    "SharesOutstanding": ("SharesOutstanding", "shares_outstanding", "total_shares"),
    "TotalAssets": ("TotalAssets", "total_assets"),
    "CapexLTM": ("CapexLTM", "capex_ltm", "capex"),
    "EnterpriseValue": ("EnterpriseValue", "enterprise_value"),
    "Turnover": ("Turnover", "turnover"),
    "RetUp": ("RetUp", "ret_up"),
    "RetDown": ("RetDown", "ret_down"),
}

FIELD_NAMES = frozenset(FIELD_ALIASES)
FUNCTION_NAMES = frozenset(
    {
        "Return",
        "TS_Return",
        "Std",
        "StdDev",
        "TS_Std",
        "Mean",
        "TS_Mean",
        "Sum",
        "TS_Sum",
        "Abs",
        "Sign",
        "Signed_Power",
        "If_Then_Else",
        "Correlation",
        "TS_Corr",
        "TS_Cov",
        "Reg_Slope",
        "Reg_Resid",
        "Skew",
        "TS_Skew",
        "TS_Kurt",
        "Ts_Rank",
        "TsRank",
        "TS_Rank",
        "TS_Max",
        "TS_Min",
        "TS_Delta",
        "Decay_Linear",
        "High_Day",
        "Sum_Out_Of",
        "Log",
        "Rank",
        "CS_Rank",
        "ZScore",
        "CS_ZScore",
        "CS_Scale",
        "CS_Neutral",
        "Winsorize",
        "Lag",
    }
)
ALLOWED_CALLS = FIELD_NAMES | FUNCTION_NAMES

_FUTURE_REFERENCE_PATTERN = re.compile(r"\bt\s*\+\s*\d+\b")
_DANGEROUS_TOKENS = ("import", "eval", "__", ";")


@dataclass(frozen=True)
class ParsedFactorExpression:
    expression: str
    tree: ast.Expression

    def evaluate(self, data: Mapping[str, Sequence[float | int | None]]) -> Series:
        return evaluate_expression(self, data)


@dataclass(frozen=True)
class CrossSectionNormalizationResult:
    scores: dict[str, float | None]
    winsorized_values: dict[str, float | None]
    median: float | None
    mad: float | None
    stdev: float | None
    direction: str
    blockers: tuple[str, ...] = ()


@dataclass(frozen=True)
class NeutralizationResult:
    status: str
    values: dict[str, float | None]
    blockers: tuple[str, ...] = ()
    group_means: dict[str, float] | None = None


def parse_expression(expression: str, *, max_depth: int = MAX_AST_DEPTH) -> ParsedFactorExpression:
    """Parse and validate a factor expression without executing Python code."""

    if not isinstance(expression, str) or not expression.strip():
        raise FactorExpressionError("expression must be a non-empty string")
    _reject_dangerous_text(expression)
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as exc:
        raise UnsafeExpressionError(f"invalid expression syntax: {exc.msg}") from exc
    _validate_ast(tree, max_depth=max_depth)
    return ParsedFactorExpression(expression=expression, tree=tree)


def evaluate_expression(
    expression: str | ParsedFactorExpression,
    data: Mapping[str, Sequence[float | int | None]],
) -> Series:
    """Evaluate an already validated expression against in-memory series data."""

    parsed = parse_expression(expression) if isinstance(expression, str) else expression
    evaluator = _Evaluator(data)
    value = evaluator.evaluate(parsed.tree.body)
    return evaluator.to_series(value)


def normalize_cross_section(
    values: Mapping[str, float | int | None],
    *,
    direction: str = "HIGHER_IS_BETTER",
    mad_scale: float = 3.0,
) -> CrossSectionNormalizationResult:
    """MAD-winsorize, z-score, and direction-adjust a cross section."""

    normalized_direction = direction.upper()
    if normalized_direction not in {"HIGHER_IS_BETTER", "LOWER_IS_BETTER"}:
        raise FactorExpressionError(f"unknown factor direction: {direction}")

    numeric_values = {
        symbol: float(value)
        for symbol, value in values.items()
        if value is not None and math.isfinite(float(value))
    }
    if not numeric_values:
        return CrossSectionNormalizationResult(
            scores={symbol: None for symbol in values},
            winsorized_values={symbol: None for symbol in values},
            median=None,
            mad=None,
            stdev=None,
            direction=normalized_direction,
            blockers=("NO_VALID_VALUES",),
        )

    raw = list(numeric_values.values())
    median = statistics.median(raw)
    raw_mad = statistics.median(abs(value - median) for value in raw)
    scaled_mad = raw_mad * 1.4826

    if scaled_mad > 0:
        lower = median - mad_scale * scaled_mad
        upper = median + mad_scale * scaled_mad
        clipped = {
            symbol: min(max(value, lower), upper) for symbol, value in numeric_values.items()
        }
    else:
        clipped = dict(numeric_values)

    clipped_values = list(clipped.values())
    stdev = statistics.pstdev(clipped_values) if len(clipped_values) > 1 else 0.0
    mean = statistics.fmean(clipped_values)

    scores: dict[str, float | None] = {}
    for symbol in values:
        clipped_value = clipped.get(symbol)
        if clipped_value is None:
            scores[symbol] = None
            continue
        zscore = 0.0 if stdev == 0 else (clipped_value - mean) / stdev
        scores[symbol] = -zscore if normalized_direction == "LOWER_IS_BETTER" else zscore

    return CrossSectionNormalizationResult(
        scores=scores,
        winsorized_values={symbol: clipped.get(symbol) for symbol in values},
        median=median,
        mad=scaled_mad,
        stdev=stdev,
        direction=normalized_direction,
    )


def neutralize_by_industry(
    values: Mapping[str, float | int | None],
    *,
    enabled: bool,
    industry_by_symbol: Mapping[str, str] | None = None,
) -> NeutralizationResult:
    """Return industry-neutral residuals or an explicit blocker.

    Phase 2 step 1 does not fabricate industry PIT data.  When neutralization is
    requested without an industry mapping, callers get an explicit blocker.
    """

    current_values = {
        symbol: (float(value) if value is not None and math.isfinite(float(value)) else None)
        for symbol, value in values.items()
    }
    if not enabled:
        return NeutralizationResult(status="DISABLED", values=current_values)
    if not industry_by_symbol:
        return NeutralizationResult(
            status="NOT_EXECUTED_MISSING_INDUSTRY_PIT",
            values=current_values,
            blockers=("MISSING_INDUSTRY_PIT",),
        )
    missing = tuple(symbol for symbol in current_values if symbol not in industry_by_symbol)
    if missing:
        return NeutralizationResult(
            status="NOT_EXECUTED_MISSING_INDUSTRY_PIT",
            values=current_values,
            blockers=("MISSING_INDUSTRY_PIT",),
        )

    grouped: dict[str, list[float]] = {}
    for symbol, value in current_values.items():
        if value is None:
            continue
        grouped.setdefault(industry_by_symbol[symbol], []).append(value)
    group_means = {
        group: statistics.fmean(group_values)
        for group, group_values in grouped.items()
        if group_values
    }
    residuals: dict[str, float | None] = {}
    for symbol, value in current_values.items():
        if value is None:
            residuals[symbol] = None
            continue
        residuals[symbol] = value - group_means[industry_by_symbol[symbol]]
    return NeutralizationResult(
        status="EXECUTED",
        values=residuals,
        group_means=group_means,
    )


def _reject_dangerous_text(expression: str) -> None:
    lowered = expression.lower()
    for token in _DANGEROUS_TOKENS:
        if token in lowered:
            raise UnsafeExpressionError(f"blocked token in expression: {token}")
    if _FUTURE_REFERENCE_PATTERN.search(expression):
        raise FutureReferenceError("future references such as t+N are not allowed")


def _validate_ast(tree: ast.AST, *, max_depth: int) -> None:
    allowed_nodes = (
        ast.Expression,
        ast.BinOp,
        ast.UnaryOp,
        ast.Call,
        ast.Name,
        ast.Load,
        ast.Constant,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.USub,
        ast.UAdd,
    )

    def walk(node: ast.AST, depth: int) -> None:
        if depth > max_depth:
            raise ExpressionDepthError("factor expression exceeds maximum AST depth")
        if not isinstance(node, allowed_nodes):
            raise UnsafeExpressionError(f"blocked syntax: {type(node).__name__}")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise UnsafeExpressionError("only direct whitelist function calls are allowed")
            if node.func.id not in ALLOWED_CALLS:
                raise UnknownOperatorError(f"unknown operator: {node.func.id}")
            if node.keywords:
                raise UnsafeExpressionError("keyword arguments are not allowed")
        if isinstance(node, ast.Name):
            if node.id not in FIELD_NAMES and node.id not in FUNCTION_NAMES and node.id != "t":
                raise UnknownFieldError(f"unknown field: {node.id}")
        for child in ast.iter_child_nodes(node):
            walk(child, depth + 1)

    walk(tree, 0)


class _Evaluator:
    def __init__(self, data: Mapping[str, Sequence[float | int | None]]) -> None:
        if not data:
            raise FactorExpressionError("data is required")
        self._data = data
        self._length = self._infer_length(data)

    def evaluate(self, node: ast.AST) -> ScalarOrSeries:
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
                raise UnsafeExpressionError("only numeric constants are allowed")
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id == "t":
                raise UnsafeExpressionError("bare t is not allowed")
            return self._resolve_field(node.id)
        if isinstance(node, ast.UnaryOp):
            value = self.evaluate(node.operand)
            if isinstance(node.op, ast.USub):
                return _unary_series(value, lambda item: -item)
            if isinstance(node.op, ast.UAdd):
                return value
        if isinstance(node, ast.BinOp):
            left = self.evaluate(node.left)
            right = self.evaluate(node.right)
            if isinstance(node.op, ast.Add):
                return _binary_series(left, right, lambda a, b: a + b, self._length)
            if isinstance(node.op, ast.Sub):
                return _binary_series(left, right, lambda a, b: a - b, self._length)
            if isinstance(node.op, ast.Mult):
                return _binary_series(left, right, lambda a, b: a * b, self._length)
            if isinstance(node.op, ast.Div):
                return _binary_series(
                    left,
                    right,
                    lambda a, b: None if b == 0 else a / b,
                    self._length,
                )
        if isinstance(node, ast.Call):
            return self._call(node)
        raise UnsafeExpressionError(f"blocked syntax: {type(node).__name__}")

    def to_series(self, value: ScalarOrSeries) -> Series:
        return _as_series(value, self._length)

    def _call(self, node: ast.Call) -> ScalarOrSeries:
        assert isinstance(node.func, ast.Name)
        name = node.func.id
        if name in FIELD_NAMES:
            if len(node.args) == 0:
                return self._resolve_field(name)
            if len(node.args) == 1:
                return _lag_series(self._resolve_field(name), self._parse_time_lag(node.args[0]))
            raise FactorExpressionError(f"{name} accepts at most one time argument")

        if name == "Lag":
            self._expect_arg_count(name, node.args, 2)
            return _lag_series(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name in {"Return", "TS_Return"}:
            if len(node.args) not in {1, 2}:
                raise FactorExpressionError("Return accepts one series and an optional lag")
            periods = self._positive_int(node.args[1]) if len(node.args) == 2 else 1
            return _return_series(self.to_series(self.evaluate(node.args[0])), periods)
        if name in {"Std", "TS_Std"}:
            self._expect_arg_count(name, node.args, 2)
            return _rolling_std(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name == "StdDev":
            self._expect_arg_count(name, node.args, 2)
            return _rolling_std(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name in {"Mean", "TS_Mean"}:
            self._expect_arg_count(name, node.args, 2)
            return _rolling_mean(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name in {"Sum", "TS_Sum"}:
            self._expect_arg_count(name, node.args, 2)
            return _rolling_sum(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name == "TS_Max":
            self._expect_arg_count(name, node.args, 2)
            return _rolling_extreme(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]), max)
        if name == "TS_Min":
            self._expect_arg_count(name, node.args, 2)
            return _rolling_extreme(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]), min)
        if name == "TS_Delta":
            self._expect_arg_count(name, node.args, 2)
            series = self.to_series(self.evaluate(node.args[0]))
            return _binary_series(series, _lag_series(series, self._positive_int(node.args[1])), lambda a, b: a - b, self._length)
        if name == "Abs":
            self._expect_arg_count(name, node.args, 1)
            return _map_series(self.to_series(self.evaluate(node.args[0])), abs)
        if name == "Sign":
            self._expect_arg_count(name, node.args, 1)
            return _map_series(self.to_series(self.evaluate(node.args[0])), _sign)
        if name == "Signed_Power":
            self._expect_arg_count(name, node.args, 2)
            power = float(self.evaluate(node.args[1]))
            return _map_series(self.to_series(self.evaluate(node.args[0])), lambda value: _signed_power(value, power))
        if name == "If_Then_Else":
            self._expect_arg_count(name, node.args, 3)
            return _if_then_else_series(
                self.to_series(self.evaluate(node.args[0])),
                self.evaluate(node.args[1]),
                self.evaluate(node.args[2]),
                self._length,
            )
        if name in {"Correlation", "TS_Corr"}:
            self._expect_arg_count(name, node.args, 3)
            return _rolling_correlation(
                self.to_series(self.evaluate(node.args[0])),
                self.to_series(self.evaluate(node.args[1])),
                self._positive_int(node.args[2]),
            )
        if name == "TS_Cov":
            self._expect_arg_count(name, node.args, 3)
            return _rolling_covariance(
                self.to_series(self.evaluate(node.args[0])),
                self.to_series(self.evaluate(node.args[1])),
                self._positive_int(node.args[2]),
            )
        if name == "Reg_Slope":
            self._expect_arg_count(name, node.args, 3)
            return _rolling_regression_slope(
                self.to_series(self.evaluate(node.args[0])),
                self.to_series(self.evaluate(node.args[1])),
                self._positive_int(node.args[2]),
            )
        if name == "Reg_Resid":
            self._expect_arg_count(name, node.args, 3)
            return _rolling_regression_residual(
                self.to_series(self.evaluate(node.args[0])),
                self.to_series(self.evaluate(node.args[1])),
                self._positive_int(node.args[2]),
            )
        if name in {"Skew", "TS_Skew"}:
            self._expect_arg_count(name, node.args, 2)
            return _rolling_skew(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name == "TS_Kurt":
            self._expect_arg_count(name, node.args, 2)
            return _rolling_kurtosis(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name in {"Ts_Rank", "TsRank", "TS_Rank"}:
            self._expect_arg_count(name, node.args, 2)
            return _rolling_ts_rank(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name == "Decay_Linear":
            self._expect_arg_count(name, node.args, 2)
            return _decay_linear(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name == "High_Day":
            self._expect_arg_count(name, node.args, 2)
            return _high_day(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name == "Sum_Out_Of":
            self._expect_arg_count(name, node.args, 2)
            return _sum_out_of(self.to_series(self.evaluate(node.args[0])), self._positive_int(node.args[1]))
        if name == "Log":
            self._expect_arg_count(name, node.args, 1)
            return _map_series(self.to_series(self.evaluate(node.args[0])), _safe_log)
        if name in {"Rank", "CS_Rank"}:
            self._expect_arg_count(name, node.args, 1)
            return _rank_series(self.to_series(self.evaluate(node.args[0])))
        if name in {"ZScore", "CS_ZScore"}:
            self._expect_arg_count(name, node.args, 1)
            return _zscore_series(self.to_series(self.evaluate(node.args[0])))
        if name == "CS_Scale":
            self._expect_arg_count(name, node.args, 1)
            return _scale_series(self.to_series(self.evaluate(node.args[0])))
        if name == "CS_Neutral":
            if len(node.args) not in {1, 2}:
                raise FactorExpressionError("CS_Neutral accepts a series and an optional group placeholder")
            return self.to_series(self.evaluate(node.args[0]))
        if name == "Winsorize":
            if len(node.args) not in {1, 2}:
                raise FactorExpressionError("Winsorize accepts one series and an optional MAD scale")
            scale = float(self.evaluate(node.args[1])) if len(node.args) == 2 else 3.0
            return _winsorize_series(self.to_series(self.evaluate(node.args[0])), scale)

        raise UnknownOperatorError(f"unknown operator: {name}")

    def _resolve_field(self, canonical_name: str) -> Series:
        aliases = FIELD_ALIASES.get(canonical_name)
        if aliases is None:
            raise UnknownFieldError(f"unknown field: {canonical_name}")
        for alias in aliases:
            if alias in self._data:
                return _coerce_series(self._data[alias])
        if canonical_name == "Turnover":
            return _binary_series(
                self._resolve_field("Volume"),
                self._resolve_field("SharesOutstanding"),
                lambda volume, shares: None if shares == 0 else volume / shares,
                self._length,
            )
        if canonical_name in {"RetUp", "RetDown"}:
            returns = _return_series(self._resolve_field("Close"), 1)
            if canonical_name == "RetUp":
                return [value if value is not None and value > 0 else None for value in returns]
            return [value if value is not None and value < 0 else None for value in returns]
        raise UnknownFieldError(f"field not available in data: {canonical_name}")

    def _parse_time_lag(self, node: ast.AST) -> int:
        if isinstance(node, ast.BinOp) and isinstance(node.left, ast.Name) and node.left.id == "t":
            if isinstance(node.op, ast.Sub):
                return self._positive_int(node.right)
            if isinstance(node.op, ast.Add):
                raise FutureReferenceError("future references such as t+N are not allowed")
        raise FactorExpressionError("time argument must use t-N")

    def _positive_int(self, node: ast.AST) -> int:
        value = self.evaluate(node)
        if not isinstance(value, (int, float)):
            raise FactorExpressionError("expected numeric lag/window")
        if value <= 0 or int(value) != value:
            raise FactorExpressionError("lag/window must be a positive integer")
        return int(value)

    @staticmethod
    def _expect_arg_count(name: str, args: list[ast.expr], expected: int) -> None:
        if len(args) != expected:
            raise FactorExpressionError(f"{name} expects {expected} arguments")

    @staticmethod
    def _infer_length(data: Mapping[str, Sequence[float | int | None]]) -> int:
        lengths = {len(values) for values in data.values()}
        if not lengths or 0 in lengths:
            raise FactorExpressionError("all input series must be non-empty")
        if len(lengths) != 1:
            raise FactorExpressionError("all input series must have equal length")
        return lengths.pop()


def _coerce_series(values: Sequence[float | int | None]) -> Series:
    result: Series = []
    for value in values:
        if value is None:
            result.append(None)
        else:
            numeric = float(value)
            result.append(numeric if math.isfinite(numeric) else None)
    return result


def _as_series(value: ScalarOrSeries, length: int) -> Series:
    if isinstance(value, list):
        return value
    return [float(value)] * length


def _unary_series(value: ScalarOrSeries, op: Any) -> ScalarOrSeries:
    if isinstance(value, list):
        return [None if item is None else op(item) for item in value]
    return op(float(value))


def _binary_series(left: ScalarOrSeries, right: ScalarOrSeries, op: Any, length: int) -> Series:
    left_series = _as_series(left, length)
    right_series = _as_series(right, length)
    result: Series = []
    for left_value, right_value in zip(left_series, right_series):
        if left_value is None or right_value is None:
            result.append(None)
            continue
        computed = op(left_value, right_value)
        result.append(computed if computed is not None and math.isfinite(computed) else None)
    return result


def _map_series(series: Series, op: Any) -> Series:
    return [None if value is None else op(value) for value in series]


def _safe_log(value: float) -> float | None:
    return math.log(value) if value > 0 else None


def _sign(value: float) -> float:
    if value > 0:
        return 1.0
    if value < 0:
        return -1.0
    return 0.0


def _signed_power(value: float, power: float) -> float | None:
    if not math.isfinite(power):
        return None
    return _sign(value) * (abs(value) ** power)


def _lag_series(series: Series, periods: int) -> Series:
    return [None] * periods + series[:-periods]


def _return_series(series: Series, periods: int) -> Series:
    lagged = _lag_series(series, periods)
    return _binary_series(series, lagged, lambda a, b: None if b == 0 else a / b - 1.0, len(series))


def _rolling_std(series: Series, window: int) -> Series:
    result: Series = []
    normalized_window = max(1, int(window or 1))
    window_values: deque[SeriesValue] = deque()
    running_sum = 0.0
    running_sum_sq = 0.0
    finite_count = 0
    for value in series:
        window_values.append(value)
        if value is not None:
            numeric = float(value)
            running_sum += numeric
            running_sum_sq += numeric * numeric
            finite_count += 1
        if len(window_values) > normalized_window:
            expired = window_values.popleft()
            if expired is not None:
                numeric = float(expired)
                running_sum -= numeric
                running_sum_sq -= numeric * numeric
                finite_count -= 1
        if len(window_values) < normalized_window:
            result.append(None)
            continue
        if finite_count != normalized_window:
            result.append(None)
        else:
            mean = running_sum / normalized_window
            variance = running_sum_sq / normalized_window - mean * mean
            if variance < 0.0:
                variance = 0.0
            result.append(math.sqrt(variance))
    return result


def _rolling_mean(series: Series, window: int) -> Series:
    result: Series = []
    for index in range(len(series)):
        if index + 1 < window:
            result.append(None)
            continue
        window_values = series[index + 1 - window : index + 1]
        finite_values = [value for value in window_values if value is not None]
        result.append(statistics.fmean(finite_values) if len(finite_values) == window else None)
    return result


def _rolling_sum(series: Series, window: int) -> Series:
    result: Series = []
    for index in range(len(series)):
        if index + 1 < window:
            result.append(None)
            continue
        window_values = series[index + 1 - window : index + 1]
        finite_values = [value for value in window_values if value is not None]
        result.append(sum(finite_values) if len(finite_values) == window else None)
    return result


def _rolling_extreme(series: Series, window: int, op: Any) -> Series:
    result: Series = []
    for index in range(len(series)):
        if index + 1 < window:
            result.append(None)
            continue
        window_values = series[index + 1 - window : index + 1]
        finite_values = [value for value in window_values if value is not None]
        result.append(op(finite_values) if len(finite_values) == window else None)
    return result


def _rolling_correlation(left: Series, right: Series, window: int) -> Series:
    result: Series = []
    for index in range(len(left)):
        if index + 1 < window:
            result.append(None)
            continue
        left_values = left[index + 1 - window : index + 1]
        right_values = right[index + 1 - window : index + 1]
        if any(value is None for value in left_values) or any(value is None for value in right_values):
            result.append(None)
            continue
        left_finite = [float(value) for value in left_values if value is not None]
        right_finite = [float(value) for value in right_values if value is not None]
        result.append(_pearson_series(left_finite, right_finite))
    return result


def _rolling_covariance(left: Series, right: Series, window: int) -> Series:
    result: Series = []
    for index in range(len(left)):
        if index + 1 < window:
            result.append(None)
            continue
        left_values = left[index + 1 - window : index + 1]
        right_values = right[index + 1 - window : index + 1]
        if any(value is None for value in left_values) or any(value is None for value in right_values):
            result.append(None)
            continue
        left_finite = [float(value) for value in left_values if value is not None]
        right_finite = [float(value) for value in right_values if value is not None]
        if len(left_finite) != window or window < 2:
            result.append(None)
            continue
        left_mean = statistics.fmean(left_finite)
        right_mean = statistics.fmean(right_finite)
        result.append(sum((x - left_mean) * (y - right_mean) for x, y in zip(left_finite, right_finite)) / window)
    return result


def _rolling_regression_slope(y_series: Series, x_series: Series, window: int) -> Series:
    cov = _rolling_covariance(y_series, x_series, window)
    x_var = _rolling_covariance(x_series, x_series, window)
    return _binary_series(cov, x_var, lambda a, b: None if abs(b) <= 1e-12 else a / b, len(y_series))


def _rolling_regression_residual(y_series: Series, x_series: Series, window: int) -> Series:
    slope = _rolling_regression_slope(y_series, x_series, window)
    result: Series = []
    for index, (y_value, x_value, beta) in enumerate(zip(y_series, x_series, slope)):
        if index + 1 < window or y_value is None or x_value is None or beta is None:
            result.append(None)
            continue
        y_window = [value for value in y_series[index + 1 - window : index + 1] if value is not None]
        x_window = [value for value in x_series[index + 1 - window : index + 1] if value is not None]
        if len(y_window) != window or len(x_window) != window:
            result.append(None)
            continue
        intercept = statistics.fmean(y_window) - beta * statistics.fmean(x_window)
        result.append(y_value - (intercept + beta * x_value))
    return result


def _rolling_skew(series: Series, window: int) -> Series:
    result: Series = []
    for index in range(len(series)):
        if index + 1 < window:
            result.append(None)
            continue
        window_values = series[index + 1 - window : index + 1]
        finite_values = [float(value) for value in window_values if value is not None]
        if len(finite_values) != window or len(finite_values) < 3:
            result.append(None)
            continue
        mean = statistics.fmean(finite_values)
        stdev = statistics.stdev(finite_values)
        if stdev <= 0:
            result.append(None)
            continue
        count = len(finite_values)
        result.append(count / ((count - 1) * (count - 2)) * sum(((value - mean) / stdev) ** 3 for value in finite_values))
    return result


def _rolling_kurtosis(series: Series, window: int) -> Series:
    result: Series = []
    for index in range(len(series)):
        if index + 1 < window:
            result.append(None)
            continue
        window_values = series[index + 1 - window : index + 1]
        finite_values = [float(value) for value in window_values if value is not None]
        if len(finite_values) != window or len(finite_values) < 4:
            result.append(None)
            continue
        mean = statistics.fmean(finite_values)
        stdev = statistics.pstdev(finite_values)
        if stdev <= 0:
            result.append(None)
            continue
        result.append(sum(((value - mean) / stdev) ** 4 for value in finite_values) / len(finite_values) - 3.0)
    return result


def _rolling_ts_rank(series: Series, window: int) -> Series:
    result: Series = []
    for index, value in enumerate(series):
        if value is None or index + 1 < window:
            result.append(None)
            continue
        window_values = [item for item in series[index + 1 - window : index + 1] if item is not None]
        if len(window_values) != window:
            result.append(None)
            continue
        result.append(sum(1 for item in window_values if item <= value) / len(window_values))
    return result


def _pearson_series(left: Sequence[float], right: Sequence[float]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None
    left_mean = statistics.fmean(left)
    right_mean = statistics.fmean(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    left_var = sum((x - left_mean) ** 2 for x in left)
    right_var = sum((y - right_mean) ** 2 for y in right)
    denominator = math.sqrt(left_var * right_var)
    return None if denominator <= 1e-12 else numerator / denominator


def _rank_series(series: Series) -> Series:
    finite_values = [(index, value) for index, value in enumerate(series) if value is not None]
    if not finite_values:
        return [None for _ in series]
    sorted_values = sorted(finite_values, key=lambda item: item[1])
    ranks: dict[int, float] = {}
    denominator = max(len(sorted_values) - 1, 1)
    for rank, (index, _value) in enumerate(sorted_values):
        ranks[index] = rank / denominator
    return [ranks.get(index) for index in range(len(series))]


def _scale_series(series: Series) -> Series:
    denominator = sum(abs(value) for value in series if value is not None)
    if denominator <= 0:
        return [None if value is None else 0.0 for value in series]
    return [None if value is None else value / denominator for value in series]


def _if_then_else_series(condition: Series, true_value: ScalarOrSeries, false_value: ScalarOrSeries, length: int) -> Series:
    true_series = _as_series(true_value, length)
    false_series = _as_series(false_value, length)
    result: Series = []
    for cond, left, right in zip(condition, true_series, false_series):
        if cond is None:
            result.append(None)
        else:
            result.append(left if cond > 0 else right)
    return result


def _decay_linear(series: Series, window: int) -> Series:
    weights = [float(index + 1) for index in range(window)]
    denominator = sum(weights)
    result: Series = []
    for index in range(len(series)):
        if index + 1 < window:
            result.append(None)
            continue
        window_values = series[index + 1 - window : index + 1]
        if any(value is None for value in window_values):
            result.append(None)
            continue
        result.append(sum(float(value) * weight for value, weight in zip(window_values, weights) if value is not None) / denominator)
    return result


def _high_day(series: Series, window: int) -> Series:
    result: Series = []
    for index in range(len(series)):
        if index + 1 < window:
            result.append(None)
            continue
        window_values = series[index + 1 - window : index + 1]
        if any(value is None for value in window_values):
            result.append(None)
            continue
        finite_values = [float(value) for value in window_values if value is not None]
        high = max(finite_values)
        high_index = max(idx for idx, value in enumerate(finite_values) if value == high)
        result.append(float(window - 1 - high_index))
    return result


def _sum_out_of(series: Series, window: int) -> Series:
    result: Series = []
    for index in range(len(series)):
        if index + 1 < window:
            result.append(None)
            continue
        window_values = series[index + 1 - window : index + 1]
        if any(value is None for value in window_values):
            result.append(None)
            continue
        result.append(float(sum(1 for value in window_values if value is not None and value > 0)))
    return result


def _zscore_series(series: Series) -> Series:
    finite_values = [value for value in series if value is not None]
    if not finite_values:
        return [None for _ in series]
    mean = statistics.fmean(finite_values)
    stdev = statistics.pstdev(finite_values) if len(finite_values) > 1 else 0.0
    return [None if value is None else (0.0 if stdev == 0 else (value - mean) / stdev) for value in series]


def _winsorize_series(series: Series, mad_scale: float) -> Series:
    finite_values = [value for value in series if value is not None]
    if not finite_values:
        return [None for _ in series]
    median = statistics.median(finite_values)
    raw_mad = statistics.median(abs(value - median) for value in finite_values)
    scaled_mad = raw_mad * 1.4826
    if scaled_mad == 0:
        return list(series)
    lower = median - mad_scale * scaled_mad
    upper = median + mad_scale * scaled_mad
    return [
        None if value is None else min(max(value, lower), upper)
        for value in series
    ]
