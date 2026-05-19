from __future__ import annotations

from grit_backtest_platform.operator_engine import (
    OperatorEngineConfig,
    PandasBottleneckOperatorEngine,
    normalize_expression,
)


def test_operator_engine_generates_deterministic_budgeted_raw_f2_plan() -> None:
    engine = PandasBottleneckOperatorEngine()
    config = OperatorEngineConfig.from_mapping(
        {
            "enabled_operators": ["TS_Return", "TS_Rank", "TS_Corr"],
            "window_space": [5, 21],
            "daily_formula_budget": 5,
            "compute_backend": "pandas_bottleneck",
        }
    )

    result = engine.generate_candidates(
        f1_fields=[
            {"factor_id": "f1_price_close"},
            {"factor_id": "f1_price_volume"},
        ],
        config=config,
    )

    expressions = [candidate.expression for candidate in result.candidates]
    assert result.backend == "pandas_bottleneck"
    assert result.requested_budget == 5
    assert len(expressions) == 5
    assert expressions[:4] == [
        "TS_Rank(TS_Return(f1_price_close, 5), 5)",
        "TS_Rank(TS_Return(f1_price_close, 5), 21)",
        "TS_Rank(TS_Return(f1_price_close, 21), 5)",
        "TS_Rank(TS_Return(f1_price_close, 21), 21)",
    ]
    assert expressions[4] == "TS_Rank(TS_Return(f1_price_volume, 5), 5)"
    assert result.truncated is True
    assert len({candidate.normalized_expression for candidate in result.candidates}) == 5


def test_operator_engine_preserves_min_periods_nan_contract_in_metadata() -> None:
    engine = PandasBottleneckOperatorEngine()
    config = OperatorEngineConfig.from_mapping(
        {
            "enabled_operators": ["TS_Return", "TS_Rank"],
            "window_space": [21],
            "daily_formula_budget": 1,
        }
    )

    result = engine.generate_candidates(f1_fields=["Close"], config=config)
    candidate = result.candidates[0]

    assert normalize_expression(candidate.expression) == candidate.normalized_expression
    assert candidate.min_periods["policy"] == "insufficient_history_outputs_nan"
    assert candidate.min_periods["forward_fill"] is False
    assert candidate.min_periods["zero_fill"] is False
    assert candidate.nan_ratio > 0
