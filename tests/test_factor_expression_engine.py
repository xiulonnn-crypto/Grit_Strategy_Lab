from __future__ import annotations

import math

import pytest

from grit_backtest_platform.factor_expression_engine import (
    ExpressionDepthError,
    FactorExpressionError,
    FutureReferenceError,
    UnknownFieldError,
    UnknownOperatorError,
    UnsafeExpressionError,
    evaluate_expression,
    neutralize_by_industry,
    normalize_cross_section,
    parse_expression,
)


def test_expression_engine_evaluates_whitelisted_time_series_operators() -> None:
    data = {"Close": [100.0, 105.0, 110.0, 121.0, 133.1]}

    one_day_return = evaluate_expression("Return(Close, 1)", data)
    assert one_day_return[0] is None
    assert one_day_return[-1] == pytest.approx(0.10)

    momentum = evaluate_expression("(Close / Lag(Close, 2)) - 1", data)
    assert momentum[:2] == [None, None]
    assert momentum[-1] == pytest.approx(133.1 / 110.0 - 1.0)

    point_in_time_lag = evaluate_expression("Close(t-2)", data)
    assert point_in_time_lag == [None, None, 100.0, 105.0, 110.0]

    rolling_vol = evaluate_expression("Std(Return(Close, 1), 2)", data)
    assert rolling_vol[0] is None
    assert rolling_vol[1] is None
    assert rolling_vol[-1] == pytest.approx(0.0)

    log_close = evaluate_expression("Log(Close)", data)
    assert log_close[-1] == pytest.approx(math.log(133.1))


def test_expression_engine_evaluates_rank_zscore_winsorize() -> None:
    data = {"Close": [100.0, 101.0, 103.0, 250.0, 106.0]}

    ranks = evaluate_expression("Rank(Close)", data)
    assert ranks[0] == 0.0
    assert ranks[3] == 1.0

    zscores = evaluate_expression("ZScore(Close)", data)
    finite_zscores = [value for value in zscores if value is not None]
    assert sum(finite_zscores) == pytest.approx(0.0)

    winsorized = evaluate_expression("Winsorize(Close, 1)", data)
    assert winsorized[3] < 250.0


@pytest.mark.parametrize(
    ("expression", "error_type"),
    [
        ("eval(Close)", UnsafeExpressionError),
        ('__import__("os").system("echo no")', UnsafeExpressionError),
        ("Close; Return(Close, 1)", UnsafeExpressionError),
        ("Close(t+1)", FutureReferenceError),
        ("Open + Close", UnknownFieldError),
        ("Foo(Close)", UnknownOperatorError),
    ],
)
def test_expression_engine_rejects_dangerous_or_unknown_expressions(
    expression: str,
    error_type: type[Exception],
) -> None:
    with pytest.raises(error_type):
        parse_expression(expression)


def test_expression_engine_rejects_excessive_ast_depth() -> None:
    expression = "Close"
    for _ in range(8):
        expression = f"({expression} + 1)"

    with pytest.raises(ExpressionDepthError):
        parse_expression(expression, max_depth=4)


def test_normalize_cross_section_winsorizes_zscores_and_applies_direction() -> None:
    values = {"AAPL": 1.0, "MSFT": 2.0, "NVDA": 100.0, "AMZN": None}

    higher = normalize_cross_section(values, direction="HIGHER_IS_BETTER", mad_scale=1.0)
    lower = normalize_cross_section(values, direction="LOWER_IS_BETTER", mad_scale=1.0)

    assert higher.blockers == ()
    assert higher.winsorized_values["NVDA"] is not None
    assert higher.winsorized_values["NVDA"] < 100.0
    assert lower.scores["AAPL"] == pytest.approx(-higher.scores["AAPL"])
    assert higher.scores["AMZN"] is None


def test_normalize_cross_section_reports_empty_blocker() -> None:
    result = normalize_cross_section({"AAPL": None, "MSFT": None})

    assert result.blockers == ("NO_VALID_VALUES",)
    assert result.scores == {"AAPL": None, "MSFT": None}


def test_neutralization_returns_blocker_when_industry_pit_is_missing() -> None:
    values = {"AAPL": 1.0, "MSFT": 2.0}

    result = neutralize_by_industry(values, enabled=True, industry_by_symbol=None)

    assert result.status == "NOT_EXECUTED_MISSING_INDUSTRY_PIT"
    assert result.blockers == ("MISSING_INDUSTRY_PIT",)
    assert result.values == values


def test_neutralization_residualizes_by_industry_when_mapping_is_available() -> None:
    values = {"AAPL": 1.0, "MSFT": 3.0, "JPM": 5.0}
    industries = {"AAPL": "Tech", "MSFT": "Tech", "JPM": "Financials"}

    result = neutralize_by_industry(values, enabled=True, industry_by_symbol=industries)

    assert result.status == "EXECUTED"
    assert result.values["AAPL"] == pytest.approx(-1.0)
    assert result.values["MSFT"] == pytest.approx(1.0)
    assert result.values["JPM"] == pytest.approx(0.0)


def test_invalid_lag_or_window_inputs_are_rejected() -> None:
    with pytest.raises(FactorExpressionError):
        evaluate_expression("Lag(Close, -1)", {"Close": [1.0, 2.0, 3.0]})

    with pytest.raises(FactorExpressionError):
        evaluate_expression("Std(Close, 0)", {"Close": [1.0, 2.0, 3.0]})
