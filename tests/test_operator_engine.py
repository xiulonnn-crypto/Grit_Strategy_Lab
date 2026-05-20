from __future__ import annotations

import json

from grit_backtest_platform.operator_engine import (
    OperatorEngineConfig,
    PandasBottleneckOperatorEngine,
    materialize_operator_engine_result,
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


def test_operator_engine_materializes_full_raw_f2_artifacts(tmp_path) -> None:
    engine = PandasBottleneckOperatorEngine()
    config = OperatorEngineConfig.from_mapping(
        {
            "enabled_operators": ["TS_Return", "TS_Rank"],
            "window_space": [5, 21],
            "daily_formula_budget": 4,
        }
    )
    result = engine.generate_candidates(f1_fields=["f1_analyst_expectation_raw"], config=config)

    materialized = materialize_operator_engine_result(result, run_id="test_run", root=tmp_path)

    artifact_refs = materialized["artifact_refs"]
    manifest_path = tmp_path / artifact_refs["formula_manifest"]
    matrix_path = tmp_path / artifact_refs["raw_f2_matrix"]
    assert manifest_path.exists()
    assert matrix_path.exists()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
    assert manifest["deduped_formula_count"] == len(result.candidates) == 4
    assert manifest["candidates"][0]["expression"] == "TS_Rank(TS_Return(f1_analyst_expectation_raw, 5), 5)"
    assert matrix["candidate_count"] == 4
    for refs in materialized["candidate_artifact_refs"].values():
        assert (tmp_path / refs["series"]).exists()
        assert (tmp_path / refs["stats"]).exists()
