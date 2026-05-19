from __future__ import annotations

import math

import pytest

from grit_backtest_platform.factor_expression_engine import evaluate_expression
from grit_backtest_platform.operator_registry import (
    DEFAULT_ENABLED_OPERATORS,
    DEFAULT_GOVERNANCE_PROTOCOL,
    DEFAULT_OPERATOR_DEPTH,
    DEFAULT_OPERATOR_WINDOW_SPACE,
    default_operator_config,
    normalize_operator_config,
    operator_definitions,
)


def test_operator_registry_registers_core_phase0_defaults() -> None:
    definitions = operator_definitions()
    operator_ids = {item.operator_id for item in definitions}

    assert len(definitions) >= 25
    assert set(DEFAULT_ENABLED_OPERATORS) == {"TS_Return", "TS_Rank", "TS_Corr"}
    assert {"TS_Return", "TS_Rank", "TS_Corr", "Reg_Resid", "Signed_Power", "Sum_Out_Of"} <= operator_ids

    draft = default_operator_config()
    assert draft["enabled_operators"] == list(DEFAULT_ENABLED_OPERATORS)
    assert draft["window_space"] == list(DEFAULT_OPERATOR_WINDOW_SPACE)
    assert draft["default_depth"] == DEFAULT_OPERATOR_DEPTH
    assert draft["daily_formula_budget"] == 10000
    assert draft["compute_backend"] == "pandas_bottleneck"
    assert "DATA_SOURCE_BLOCKED" in draft["blocked_field_policy"]
    assert "NaN" in draft["min_periods_policy"]
    assert draft["governance_protocol"] == DEFAULT_GOVERNANCE_PROTOCOL
    assert draft["governance_protocol"]["wnzt_standard_flow"] is True
    assert draft["governance_protocol"]["orthogonalization_enabled"] is False
    assert draft["governance_protocol"]["turnover_filter_enabled"] is False


def test_operator_config_validation_rejects_unknown_operator_and_window() -> None:
    with pytest.raises(ValueError):
        normalize_operator_config({"enabled_operators": ["TS_Return", "Unknown_Operator"]})

    with pytest.raises(ValueError):
        normalize_operator_config({"window_space": [3, 0, 21]})

    with pytest.raises(ValueError):
        normalize_operator_config({"daily_formula_budget": 10001})

    normalized = normalize_operator_config(
        {
            "governance_protocol": {
                "orthogonalization_enabled": True,
                "turnover_filter_enabled": True,
            }
        }
    )
    assert normalized["governance_protocol"]["orthogonalization_enabled"] is True
    assert normalized["governance_protocol"]["turnover_filter_enabled"] is True
    assert normalized["governance_protocol"]["wnzt_standard_flow"] is True


def test_phase0_expression_aliases_preserve_nan_for_insufficient_history() -> None:
    data = {
        "Close": [10.0, 20.0, 30.0, 40.0],
        "Volume": [10.0, 20.0, 30.0, 40.0],
    }

    ts_return = evaluate_expression("TS_Return(Close, 2)", data)
    assert ts_return[:2] == [None, None]
    assert ts_return[-1] == pytest.approx(1.0)

    ts_rank = evaluate_expression("TS_Rank(Close, 3)", data)
    assert ts_rank[:2] == [None, None]
    assert ts_rank[-1] is not None

    corr = evaluate_expression("TS_Corr(Close, Volume, 3)", data)
    assert corr[:2] == [None, None]
    assert corr[-1] == pytest.approx(1.0)

    log_values = evaluate_expression("Log(Close - 20)", data)
    assert log_values[0] is None
    assert math.isfinite(log_values[-1])
