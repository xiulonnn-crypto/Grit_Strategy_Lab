from __future__ import annotations

import json

from grit_backtest_platform.operator_engine import (
    OperatorEngineConfig,
    PandasBottleneckOperatorEngine,
    materialize_operator_engine_result,
    normalize_expression,
)
from grit_backtest_platform.operator_registry import operator_definitions


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


def test_operator_engine_all_enabled_operators_expand_beyond_default_formula_space() -> None:
    engine = PandasBottleneckOperatorEngine()
    fields = [f"f1_signal_{index:02d}" for index in range(15)]
    windows = [3, 5, 10, 21, 63, 126, 252]
    default_result = engine.generate_candidates(
        f1_fields=fields,
        config=OperatorEngineConfig.from_mapping(
            {
                "enabled_operators": ["TS_Return", "TS_Rank", "TS_Corr"],
                "window_space": windows,
                "daily_formula_budget": 10000,
            }
        ),
    )

    full_result = engine.generate_candidates(
        f1_fields=fields,
        config=OperatorEngineConfig.from_mapping(
            {
                "enabled_operators": [definition.operator_id for definition in operator_definitions()],
                "window_space": windows,
                "daily_formula_budget": 10000,
            }
        ),
    )

    expressions = [candidate.expression for candidate in full_result.candidates]
    assert default_result.deduped_formula_count == 1470
    assert full_result.deduped_formula_count > default_result.deduped_formula_count
    assert full_result.deduped_formula_count == 10000
    assert any(expression.startswith("TS_Mean(") for expression in expressions)
    assert any(expression.startswith("TS_Cov(") for expression in expressions)
    assert any(expression.startswith("Reg_Resid(") for expression in expressions)
    assert any(expression.startswith("CS_ZScore(") for expression in expressions)
    assert any(expression.startswith("Signed_Power(") for expression in expressions)
    assert any(expression.startswith("Decay_Linear(") for expression in expressions)


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

    materialized = materialize_operator_engine_result(
        result,
        run_id="test_run",
        root=tmp_path,
        job_id="mine_test",
        source_job_id="mine_test",
        created_at="2026-05-26T00:00:00Z",
        refined_count=len(result.candidates),
    )

    artifact_refs = materialized["artifact_refs"]
    manifest_path = tmp_path / artifact_refs["formula_manifest"]
    matrix_path = tmp_path / artifact_refs["raw_f2_matrix"]
    assert manifest_path.exists()
    assert matrix_path.exists()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    matrix = json.loads(matrix_path.read_text(encoding="utf-8"))
    assert manifest["job_id"] == "mine_test"
    assert manifest["source_job_id"] == "mine_test"
    assert manifest["formula_count"] == 4
    assert manifest["refined_count"] == 4
    assert manifest["created_at"] == "2026-05-26T00:00:00Z"
    assert manifest["hash"]
    assert manifest["deduped_formula_count"] == len(result.candidates) == 4
    assert manifest["candidates"][0]["expression"] == "TS_Rank(TS_Return(f1_analyst_expectation_raw, 5), 5)"
    assert matrix["candidate_count"] == 4
    for refs in materialized["candidate_artifact_refs"].values():
        assert (tmp_path / refs["series"]).exists()
        assert (tmp_path / refs["stats"]).exists()
